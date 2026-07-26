# Infrastructure Authoring Style Guide

This guide defines how to write HCL modules and GitHub Actions workflows.
Workflows support continuous integration and continuous delivery. The same
conventions apply to both uses. This authoring guide supplies the syntax layer
beneath the [infrastructure philosophy guide](./infrastructure-style-guide.md).

The [Python](./python-style-guide.md) and
[TypeScript](./typescript-style-guide.md) guides have the same relationship to
the shared design principles. The philosophy guide defines the decisions and
reasons. This guide defines the implementation conventions.

Part 1 covers OpenTofu and HCL. Part 2 covers GitHub Actions. The final section
contains references.

---

## Part 1: OpenTofu (HCL)

Part 1 defines conventions for OpenTofu modules and HCL files.

### Formatting and Tooling

Run `tofu fmt` in pre-commit and CI. Unformatted HCL fails the build. Run `tflint`
alongside it for provider-aware static checks (deprecated syntax, invalid instance
types, missing required arguments) that `validate` alone misses.

| Command               | Purpose                                                   |
| --------------------- | --------------------------------------------------------- |
| `tofu fmt -recursive` | Format every file. CI runs `tofu fmt -check`.             |
| `tofu validate`       | Schema and reference validation.                          |
| `tflint`              | Provider-aware lint and naming rules.                     |
| `tofu test`           | Run module test suites.                                   |
| `terraform-docs`      | Generate the inputs/outputs tables in each module README. |

`fmt` handles two-space indentation and alignment. Do not align HCL manually.
Use the formatter so a diff shows content changes.

### File Layout Within a Module

One file per concern. A reader should know where to look before opening anything.

```text
modules/network/
├── main.tf          # resources and data sources
├── variables.tf     # the typed input interface — written first
├── outputs.tf       # the public interface — what consumers may read
├── versions.tf      # required_version + pinned required_providers
├── locals.tf        # derived values (omit if there are none)
├── checks.tf        # check blocks: policy that travels with the module
├── README.md        # purpose + generated inputs/outputs tables
└── tests/
    └── network.tftest.hcl
```

`versions.tf` pins the toolchain and providers. Commit the
`.terraform.lock.hcl` lock file. It has the same role as `uv.lock` and
`bun.lockb`. It makes each run resolve the same provider builds.

```hcl
# versions.tf
terraform {
  required_version = ">= 1.8"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"   # pin the major, allow patch/minor
    }
  }
}
```

A module never declares a `provider` block. The root configures providers and
passes them to the module. The caller can therefore select any account or region.

### Naming Conventions

Everything is `snake_case`. Names describe the resource role. The address already
contains the resource type. Use `aws_s3_bucket.state`.

| Construct                                              | Convention               | Example                                     |
| ------------------------------------------------------ | ------------------------ | ------------------------------------------- |
| Resources, data sources                                | `snake_case`, role-named | `aws_s3_bucket.state`, `aws_iam_role.apply` |
| The single primary resource of a single-purpose module | `this`                   | `aws_kms_key.this`                          |
| Variables                                              | `snake_case`             | `vpc_cidr`, `enable_replica`                |
| Outputs                                                | `snake_case`             | `bucket_arn`, `subnet_ids`                  |
| Locals                                                 | `snake_case`             | `name_prefix`, `common_tags`                |
| Modules (calls)                                        | `snake_case`, role-named | `module.network`, `module.compute`          |
| Files                                                  | `snake_case.tf`          | `main.tf`, `variables.tf`                   |

- Boolean variables start with `enable_`, `is_`, or `has_`: `enable_replica`,
  `is_public`.
- Collections are plural and keyed names singular: `subnet_ids`, and a
  `for_each` over `var.subnets`.
- Compose names once in a local and reuse it, rather than re-deriving the same
  string in every resource:

```hcl
# locals.tf
locals {
  name_prefix = "${var.project}-${var.environment}"
  common_tags = {
    owner       = var.owner
    environment = var.environment
    cost-centre = var.cost_centre
    managed-by  = "opentofu"
  }
}
```

### Variables: the Typed Boundary

Every variable has a `type`, a `description`, and a `validation` block when
rules apply. The variable interface is the boundary contract. Validation rejects
bad input before it causes a confusing plan error.

```hcl
# variables.tf
variable "environment" {
  type        = string
  description = "Deployment environment. Drives naming and tag values."

  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environment must be 'staging' or 'prod'."
  }
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR block for the VPC."

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "vpc_cidr must be a valid CIDR block."
  }
}

variable "subnets" {
  type = map(object({
    cidr              = string
    availability_zone = string
    public            = optional(bool, false)
  }))
  description = "Subnet definitions keyed by name."
}
```

Rules:

- Declare a type for every variable. A bare `variable "x" {}` accepts any value.
  Use `object(...)` for structured input.
- Add a description to every variable. Descriptions appear in the generated
  README and editor tooltips.
- Set `nullable = false` unless the absence of a value has a defined meaning.
- Set `sensitive = true` for secret values. This setting redacts the values from
  plan output.
- Remove unused variables. `tflint` identifies them.

### Outputs: the Public Interface

`outputs.tf` is the module's public API. Other layers can read only these values.
Expose only the values that consumers need, and document each value.

```hcl
# outputs.tf
output "vpc_id" {
  value       = aws_vpc.this.id
  description = "ID of the created VPC."
}

output "private_subnet_ids" {
  value       = [for s in aws_subnet.private : s.id]
  description = "IDs of the private subnets, ordered by name."
}
```

### Resources and Logic

Use these rules to keep resource addresses stable and dependencies explicit.

#### `for_each` Over `count`

Default to `for_each` because it addresses resources by a stable key. Removing
one item then deletes only that item. In contrast, `count` addresses by index.
A removal can renumber later resources and force unnecessary replacement.

```hcl
# Good - keyed, stable addressing
resource "aws_subnet" "private" {
  for_each          = var.subnets
  vpc_id            = aws_vpc.this.id
  cidr_block        = each.value.cidr
  availability_zone = each.value.availability_zone
  tags              = merge(local.common_tags, { Name = "${local.name_prefix}-${each.key}" })
}

# Acceptable - use count only for one optional resource
resource "aws_flow_log" "this" {
  count = var.enable_flow_logs ? 1 : 0
  # ...
}
```

#### Refactor with `moved`, Never by Silent Rename

Renaming a resource is a destroy-and-recreate unless you tell the engine the
address moved. Use a `moved` block so the refactor is a no-op apply.

```hcl
moved {
  from = aws_subnet.private_subnet
  to   = aws_subnet.private
}
```

#### Other Resource Rules

- Prefer implicit dependencies through references. Use `depends_on` only
  when a dependency genuinely cannot be expressed as a reference.
- Use `dynamic` blocks only for variable-length nested blocks. They make the plan
  more difficult to read.
- Do not use `local-exec` or `remote-exec` to connect resources. Use a provider
  or a separate tool for an imperative operation.
- Do not put fixed ARNs, account IDs, or regions in a module. Supply them through
  variables or data sources.

### Cross-Layer References Are Read-Only

A component reads another layer's outputs through a remote-state data source, and
only reads. Layers depend downward (compute on network), never sideways or up, and
a layer never declares another layer's resources.

```hcl
# compute reading network's outputs - read-only
data "terraform_remote_state" "network" {
  backend = "s3"
  config = {
    bucket = "acme-tfstate-${var.environment}"
    key    = "network/terraform.tfstate"
    region = var.region
  }
}

resource "aws_instance" "app" {
  subnet_id = data.terraform_remote_state.network.outputs.private_subnet_ids[0]
  # ...
}
```

### Checks and Tests

`check` blocks verify planned and actual state. `tofu test` uses fixture inputs,
including invalid inputs. Store tests beside the applicable module. A failed
invalid-input test has the same priority as a failed valid-input test.

```hcl
# tests/network.tftest.hcl
run "creates_expected_subnet_count" {
  command = plan
  variables {
    environment = "staging"
    vpc_cidr    = "10.0.0.0/16"
    subnets = {
      a = { cidr = "10.0.1.0/24", availability_zone = "ap-southeast-2a" }
      b = { cidr = "10.0.2.0/24", availability_zone = "ap-southeast-2b" }
    }
  }
  assert {
    condition     = length(aws_subnet.private) == 2
    error_message = "Expected two private subnets."
  }
}

run "rejects_invalid_cidr" {
  command = plan
  variables {
    environment = "staging"
    vpc_cidr    = "not-a-cidr"
  }
  expect_failures = [var.vpc_cidr]
}
```

### Documentation

- Add a description to every variable and output. Add a one-line purpose comment
  at the top of each module. Use `terraform-docs` to generate each README input
  and output table.
- Use comments to explain a decision or constraint. For example, use
  `# capture price at order time so historical values stay stable`. Do not add a
  comment that restates the code, such as `# create the bucket`.

### HCL Anti-Patterns

| Do not                                 | Do                                              |
| -------------------------------------- | ----------------------------------------------- |
| Untyped `variable "x" {}`              | Constrain the type. `object(...)` for structure |
| `count` for a keyed set                | `for_each` over a map                           |
| Renaming a resource in place           | A `moved` block                                 |
| `provider` block inside a module       | Configure in root, pass in                      |
| Hardcoded ARNs / regions / account IDs | Variables and data sources                      |
| Secrets in plaintext or in state       | References to a secret store. Encrypted state   |
| One 600-line `main.tf`                 | Split by concern. Split state by component      |
| Hand-written README tables             | `terraform-docs`                                |

---

## Part 2: GitHub Actions (YAML)

Every workflow in the repository follows these conventions. Continuous
integration validates Python and TypeScript code. Continuous delivery plans and
applies infrastructure. The structural and security rules apply to both uses.
Only the job body differs. The final examples show both workflow shapes.

### File Layout and Naming

```text
.github/
├── workflows/
│   ├── ci-python.yml         # PR + push: lint, type-check, test Python
│   ├── ci-typescript.yml     # PR + push: lint, type-check, test TypeScript
│   ├── plan.yml              # PR: validate + plan, upload the plan artifact
│   ├── apply-staging.yml     # merge to main: apply staging automatically
│   ├── apply-prod.yml        # prod ref-bump PR merged: apply prod (gated)
│   ├── drift.yml             # scheduled: plan, non-empty = failure
│   └── tofu-pipeline.yml     # reusable workflow the above call
├── actions/
│   └── tofu-setup/
│       └── action.yml        # composite action: install + auth boilerplate
└── dependabot.yml            # github-actions ecosystem updates
```

- Use a verb and kebab-case for each workflow filename, such as `apply-prod.yml`.
- Add `name:` to every workflow, job, and step. A clear name identifies a failure
  in the log.

### Triggers and Concurrency

Declare `on:` explicitly with path filters. Use source paths for CI and
infrastructure paths for plan and apply. Use a `concurrency` group to prevent
races. Apply and plan require different concurrency behaviour:

```yaml
# plan.yml - cancel a superseded plan
concurrency:
  group: plan-${{ github.ref }}
  cancel-in-progress: true

# apply-prod.yml - NEVER cancel a half-finished apply; serialise instead
concurrency:
  group: apply-prod
  cancel-in-progress: false
```

Cancelling an active apply can make the state differ from the infrastructure.
Queue apply jobs. Do not interrupt an apply job.

Do not use `pull_request_target` for a workflow that checks out and runs PR code.
Treat all PR metadata, including titles, branch names, and bodies, as untrusted
input.

### Permissions: Least Privilege

Set workflow permissions to `{}` and grant the minimum permissions to each job.
Add write scopes and `id-token` only to the job that uses them.

```yaml
permissions: {}          # workflow-level default: nothing

jobs:
  plan:
    permissions:
      contents: read       # read the repo
      pull-requests: write # post the plan summary as a PR comment
    # ...

  apply:
    permissions:
      contents: read
      id-token: write      # OIDC - only here, never globally
    # ...
```

`id-token: write` is what lets the job mint an OIDC token to assume a cloud role.
Granting it globally permits every job to authenticate to your cloud.
Grant it to the apply job alone.

### Pinning Third-Party Actions

Pin every third-party action to a full 40-character commit SHA. Add a trailing
comment that gives the corresponding version. Tags and branches are mutable. A
compromised upstream can point `@v4` or `@main` at malicious code. A SHA is
immutable and runs the code that you audited. A moved tag can make a later
workflow run execute different code.

```yaml
# Bad - mutable references
- uses: actions/checkout@v4
- uses: some-org/deploy@main

# Good - immutable SHA, version in a comment for humans and Dependabot
- uses: actions/checkout@<full-40-char-commit-sha>   # v4.2.2
```

Use the SHA of a tagged and audited release. Use tools to obtain and maintain the
SHAs.

- Dependabot for the `github-actions` ecosystem opens a PR that updates a pinned
  SHA when a new release is available.
- Configure a seven-day minimum release age before an update can merge.
- Run `actionlint` in CI to check workflow syntax and expressions.

```yaml
# dependabot.yml
version: 2
updates:
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

### Secrets and Authentication

Use OIDC to assume a role when the provider supports it. Subject claims restrict
the role by repository, branch, and environment. Store a narrowly scoped
credential in a protected environment when a provider does not support OIDC.

```yaml
- uses: aws-actions/configure-aws-credentials@<full-40-char-commit-sha>  # v4.x
  with:
    role-to-assume: arn:aws:iam::123456789012:role/prod-tofu-apply
    aws-region: ap-southeast-2
    # no access keys - the role is assumed via the OIDC token
```

- GitHub Environments enforce production approval. Put the production role in an
  environment with required reviewers and a branch restriction. The apply job
  references that environment, and the review is the deliberate human promotion
  decision the philosophy guide describes.
- Prefer environment secrets because only jobs that name the environment can read
  them.
- Never interpolate untrusted input into a `run:` script. Values from
  `${{ github.event.* }}` can carry shell injection. Bind them to `env:` and
  reference the variable instead:

```yaml
# Bad - injection vector
- run: echo "Title: ${{ github.event.pull_request.title }}"

# Good - pass through env, quote the variable
- env:
    PR_TITLE: ${{ github.event.pull_request.title }}
  run: echo "Title: $PR_TITLE"
```

### Reuse: Workflows and Composite Actions

Do not copy a workflow for each environment. Put shared jobs in a reusable
workflow and call it with typed inputs. Pass each secret explicitly.

```yaml
# apply-staging.yml
jobs:
  apply:
    uses: ./.github/workflows/tofu-pipeline.yml
    with:
      environment: staging
      command: apply
    secrets:
      cloud_role: ${{ secrets.CLOUD_ROLE }}
```

Use a composite action for a repeated step sequence inside one job. For
example, `.github/actions/tofu-setup/action.yml` can install OpenTofu,
authenticate, and configure the backend. A reusable workflow composes whole jobs.

### CI Workflow

CI validates application code on every pull request and push. It runs the checks
that the [Python](./python-style-guide.md) and
[TypeScript](./typescript-style-guide.md) guides define for pre-commit. The same
local and CI gate reports failures early and makes the checks mandatory.

Each job uses the same sequence. Check out the repository and set up the cached
toolchain. Install from the lock file. Run formatting, linting, type checks, and
tests.

Then report the result. Keep permissions at `contents: read`. CI does not
write repository content.

```yaml
# ci-python.yml
name: CI (Python)
on:
  pull_request:
    paths: ["src/**", "tests/**", "pyproject.toml", "uv.lock"]
  push:
    branches: [main]

concurrency:
  group: ci-python-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@<full-40-char-commit-sha>      # v4.x
      - uses: astral-sh/setup-uv@<full-40-char-commit-sha>    # vX.Y.Z
        with:
          enable-cache: true            # cache keyed on uv.lock
      - run: uv sync --locked           # install exactly the lock file
      - run: uv run ruff format --check .
      - run: uv run ruff check .
      - run: uv run pyright
      - run: uv run pytest
```

```yaml
# ci-typescript.yml
name: CI (TypeScript)
on:
  pull_request:
    paths: ["src/**", "test/**", "package.json", "bun.lockb", "tsconfig.json"]
  push:
    branches: [main]

concurrency:
  group: ci-ts-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@<full-40-char-commit-sha>   # v4.x
      - uses: oven-sh/setup-bun@<full-40-char-commit-sha>  # vX.Y.Z
      - run: bun install --frozen-lockfile
      - run: bun run check          # biome
      - run: bun run typecheck      # tsc --noEmit
      - run: bun run test           # vitest
```

Two CI-specific rules:

- Key each cache on its lock file. A cache keyed on `uv.lock` or `bun.lockb`
  changes when the dependencies change. `enable-cache: true` on `setup-uv` uses
  this key. For other toolchains, key `actions/cache` on a hash of the lock file.
- Use a matrix only when the project supports multiple operating systems or
  language versions. Do not use a matrix when the project pins one version.

### CD Workflow (Plan and Apply)

The infrastructure pipeline applies the preceding rules. The plan workflow saves
its plan as an artefact. The apply workflow uses that exact artefact and does not
create a new plan.

```yaml
# plan.yml (PR)
- run: tofu init
- run: tofu fmt -check
- run: tofu validate
- run: tflint
- run: tofu test
- run: tofu plan -out=tfplan
- uses: actions/upload-artifact@<full-40-char-commit-sha>   # v4.x
  with:
    name: tfplan
    path: tfplan

# apply-prod.yml (after the gated ref-bump PR merges)
- uses: actions/download-artifact@<full-40-char-commit-sha>  # v4.x
  with:
    name: tfplan
- run: tofu apply tfplan      # the reviewed artifact, not a fresh plan
```

Set `timeout-minutes` on every job. Pin the runner image, for example
`runs-on: ubuntu-24.04`. Do not use `ubuntu-latest`.

### Anti-Patterns

| Do not                                 | Do                                              |
| -------------------------------------- | ----------------------------------------------- |
| `uses: action@v4` or `@main`           | Pin to a full commit SHA with a version comment |
| `permissions: write-all`               | `permissions: {}` then grant per job            |
| `id-token: write` at workflow level    | Only on the OIDC job                            |
| Static cloud keys in secrets           | OIDC role assumption                            |
| `${{ github.* }}` inside `run:`        | Bind to `env:` and quote the variable           |
| `cancel-in-progress: true` on apply    | Serialise applies. Never cancel one             |
| `runs-on: ubuntu-latest`               | Pin the runner image                            |
| Copy-pasted per-environment workflows  | One reusable workflow, called with inputs       |
| CI checks that differ from pre-commit  | Run the identical gate in both                  |
| Cache keyed on a date or commit        | Key the cache on the lock file                  |
| Unneeded matrix combinations           | Matrix only where behaviour changes             |

---

## References

Before you write infrastructure code or workflows, read the linked documentation.
Each link uses the `defuddle.md` prefix, which returns agent-readable Markdown.
Read the complete documentation, including pages outside the getting-started
section.

- [OpenTofu language reference](https://defuddle.md/opentofu.org/docs/language/)
- [OpenTofu style conventions](https://defuddle.md/opentofu.org/docs/language/syntax/style/)
- [OpenTofu variable validation](https://defuddle.md/opentofu.org/docs/language/values/variables/)
- [OpenTofu `check` blocks](https://defuddle.md/opentofu.org/docs/language/checks/)
- [OpenTofu tests](https://defuddle.md/opentofu.org/docs/cli/commands/test/)
- [OpenTofu provider version constraints](https://defuddle.md/opentofu.org/docs/language/providers/requirements/)
- [HCL syntax](https://defuddle.md/developer.hashicorp.com/terraform/language/syntax/configuration)
- [tflint](https://defuddle.md/github.com/terraform-linters/tflint)
- [terraform-docs](https://defuddle.md/terraform-docs.io/)
- [pre-commit-terraform](https://defuddle.md/github.com/antonbabenko/pre-commit-terraform)
- [GitHub Actions workflow syntax](https://defuddle.md/docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions)
- [GitHub Actions secure use reference](https://defuddle.md/docs.github.com/en/actions/reference/security/secure-use)
- [GitHub Actions security hardening](https://defuddle.md/docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)
- [GitHub Actions OIDC](https://defuddle.md/docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- [GitHub Actions reusable workflows](https://defuddle.md/docs.github.com/en/actions/sharing-automations/reusing-workflows)
- [GitHub Actions environments](https://defuddle.md/docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)
- [Dependabot for Actions](https://defuddle.md/docs.github.com/en/code-security/dependabot/working-with-dependabot/keeping-your-actions-up-to-date-with-dependabot)
- [GitHub Actions caching dependencies](https://defuddle.md/docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/caching-dependencies-to-speed-up-workflows)
- [GitHub Actions matrix strategies](https://defuddle.md/docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/running-variations-of-jobs-in-a-workflow)
- [setup-uv action](https://defuddle.md/github.com/astral-sh/setup-uv)
- [setup-bun action](https://defuddle.md/github.com/oven-sh/setup-bun)
- [zizmor (workflow static analysis)](https://defuddle.md/docs.zizmor.sh/)
- [actionlint](https://defuddle.md/github.com/rhysd/actionlint)
