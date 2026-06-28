# Infrastructure Authoring Style Guide

How to actually write the two artifacts our infrastructure work is made of: **HCL
modules** and **GitHub Actions workflows**. The workflows cover both continuous
integration (linting, type-checking, and testing the application code from the
Python and TypeScript guides) and continuous delivery (planning and applying
infrastructure), because both are written to one set of conventions. This is the
syntax-and-convention layer
that sits beneath the [Infrastructure Philosophy guide](./infrastructure-style-guide.md),
the way the [Python](./python-style-guide.md) and [TypeScript](./typescript-style-guide.md)
guides give concrete conventions beneath shared design principles. The philosophy
guide settles *what and why*: OpenTofu, OIDC, environment-major layout,
modules-as-the-unit, the plan-as-lockfile rule. This guide covers *how you write
the lines*.

Two parts: OpenTofu/HCL first, GitHub Actions second. Both close into a shared set
of design principles and a reference list.

---

# Part 1 — OpenTofu (HCL)

## Formatting & Tooling

`tofu fmt` is non-negotiable and runs in pre-commit and CI; unformatted HCL fails
the build, exactly as ruff-format failures fail the Python build. `tflint` runs
alongside it for provider-aware static checks (deprecated syntax, invalid instance
types, missing required arguments) that `validate` alone misses.

| Command | Purpose |
|---------|---------|
| `tofu fmt -recursive` | Format every file. CI runs `tofu fmt -check`. |
| `tofu validate` | Schema and reference validation. |
| `tflint` | Provider-aware lint and naming rules. |
| `tofu test` | Run module test suites. |
| `terraform-docs` | Generate the inputs/outputs tables in each module README. |

Two-space indentation and alignment are handled by `fmt`. Never argue with it,
never hand-align. Let the formatter own whitespace so diffs stay about meaning.

## File Layout Within a Module

One file per concern. A reader should know where to look before opening anything.

```
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

`versions.tf` pins the toolchain and providers, and the **lock file
`.terraform.lock.hcl` is committed**. It is the `uv.lock` / `bun.lockb` of
infrastructure, guaranteeing every run resolves the same provider builds.

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

A module never declares a `provider` block of its own. Providers are configured by
the root and passed in, so the same module runs against any account or region the
caller points it at.

## Naming Conventions

Everything is `snake_case`. Names describe **role**, not type. The resource type
is already in the address, so `aws_s3_bucket.state` not `aws_s3_bucket.bucket`.

| Construct | Convention | Example |
|-----------|-----------|---------|
| Resources, data sources | `snake_case`, role-named | `aws_s3_bucket.state`, `aws_iam_role.apply` |
| The single primary resource of a single-purpose module | `this` | `aws_kms_key.this` |
| Variables | `snake_case` | `vpc_cidr`, `enable_replica` |
| Outputs | `snake_case` | `bucket_arn`, `subnet_ids` |
| Locals | `snake_case` | `name_prefix`, `common_tags` |
| Modules (calls) | `snake_case`, role-named | `module.network`, `module.compute` |
| Files | `snake_case.tf` | `main.tf`, `variables.tf` |

- **Boolean variables** start with `enable_`, `is_`, or `has_`: `enable_replica`,
  `is_public`.
- **Collections are plural** and keyed names singular: `subnet_ids`, and a
  `for_each` over `var.subnets`.
- **Compose names once** in a local and reuse it, rather than re-deriving the same
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

## Variables — the Typed Boundary

Every variable carries a `type`, a `description`, and a `validation` block where the
value has rules. This is the HCL form of validating at the boundary: the variable
interface is the contract, and bad input is rejected at the door rather than
producing a confusing error deep in a plan.

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

- **No untyped variables.** A bare `variable "x" {}` accepts anything and defeats
  the point. Always constrain the type; use `object(...)` for structured input.
- **Descriptions are mandatory.** They render into the generated README and into
  editor tooltips.
- **`nullable = false`** unless absent is genuinely meaningful.
- **`sensitive = true`** on anything secret-adjacent, so values are redacted from
  plan output.
- **No unused variables.** `tflint` flags them; remove them.

## Outputs — the Public Interface

`outputs.tf` is the module's public API: the only values another layer is allowed
to read. Expose what consumers need and nothing more, and document every one.

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

## Resources & Logic

### `for_each` over `count`

Default to `for_each`. It addresses resources by a stable key, so removing the
second of three items deletes that one item; `count` addresses by index, so the
same removal renumbers everything after it and forces needless destroy-and-recreate.

```hcl
# Good - keyed, stable addressing
resource "aws_subnet" "private" {
  for_each          = var.subnets
  vpc_id            = aws_vpc.this.id
  cidr_block        = each.value.cidr
  availability_zone = each.value.availability_zone
  tags              = merge(local.common_tags, { Name = "${local.name_prefix}-${each.key}" })
}

# Acceptable - count only for a simple create-or-not toggle
resource "aws_flow_log" "this" {
  count = var.enable_flow_logs ? 1 : 0
  # ...
}
```

### Refactor with `moved`, never by silent rename

Renaming a resource is a destroy-and-recreate unless you tell the engine the
address moved. Use a `moved` block so the refactor is a no-op apply.

```hcl
moved {
  from = aws_subnet.private_subnet
  to   = aws_subnet.private
}
```

### Other resource rules

- **Prefer implicit dependencies** through references; reach for `depends_on` only
  when a dependency genuinely can't be expressed as a reference.
- **`dynamic` blocks sparingly.** They obscure the plan; use them only for
  genuinely variable-length nested blocks, not to save three lines.
- **No `local-exec` / `remote-exec` as glue.** Provisioners that shell out are
  imperative escape hatches; if you need them, the thing you're modelling probably
  wants a real provider or a separate tool.
- **No hardcoded ARNs, account IDs, or regions** in a module. They arrive as
  variables or from data sources.

## Cross-Layer References Are Read-Only

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

## Checks & Tests

`check` blocks assert on planned and actual state; `tofu test` exercises the module
against fixture inputs, including the rejection paths. Tests live beside the module
and the negative path matters as much as the happy one, exactly as with Pydantic
models in the Python guide.

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

## Documentation

- A description on every variable and output, a one-line comment at the top of each
  module stating its purpose, and a README whose inputs/outputs tables are generated
  by `terraform-docs` (never hand-maintained — they go stale).
- Comments explain **why**, not what. `# capture price at order time so historical
  values stay stable` earns its place; `# create the bucket` does not.

## Anti-Patterns

| Don't | Do |
|-------|-----|
| Untyped `variable "x" {}` | Constrain the type; `object(...)` for structure |
| `count` for a keyed set | `for_each` over a map |
| Renaming a resource in place | A `moved` block |
| `provider` block inside a module | Configure in root, pass in |
| Hardcoded ARNs / regions / account IDs | Variables and data sources |
| Secrets in plaintext or in state | References to a secret store; encrypted state |
| One 600-line `main.tf` | Split by concern; split state by component |
| Hand-written README tables | `terraform-docs` |

---

# Part 2 — GitHub Actions (YAML)

Every workflow in the repository is written to the conventions in this part,
whether it runs **CI** (validating the Python and TypeScript code) or **CD**
(planning and applying infrastructure). The structural and security rules below
(layout, naming, triggers, permissions, pinning, secrets, reuse) apply to both;
only the job body differs. Two shapes close the part: the CI shape and the CD shape.

## File Layout & Naming

```
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

- Workflow files are `kebab-case` and verb-named: `apply-prod.yml`, not `prod.yml`.
- **`name:` on every workflow, job, and step.** A named step reads like a sentence
  in the log and tells you what failed at a glance, the workflow analogue of
  naming a test as a sentence.

## Triggers & Concurrency

Declare `on:` explicitly with path filters so each workflow fires only on the
changes it cares about: source paths for CI, infra paths for plan and apply. Use a
`concurrency` group to stop runs from racing. But the apply
behaviour is the opposite of the plan behaviour, and this distinction matters:

```yaml
# plan.yml - cancel a superseded plan, it is cheap and disposable
concurrency:
  group: plan-${{ github.ref }}
  cancel-in-progress: true

# apply-prod.yml - NEVER cancel a half-finished apply; serialise instead
concurrency:
  group: apply-prod
  cancel-in-progress: false
```

Cancelling an in-flight apply can leave state and reality disagreeing. Applies
queue; they never interrupt each other.

Avoid `pull_request_target` for anything that checks out and runs PR code, and
treat all PR metadata (title, branch name, body) as untrusted input.

## Permissions — Least Privilege

Start from nothing and grant the minimum each job needs. The default token is
read-only; write scopes and `id-token` are added only to the job that uses them.

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
Granting it globally hands every job the ability to authenticate to your cloud;
grant it to the apply job alone.

## Pinning — the Security Core

**Pin every third-party action to a full 40-character commit SHA**, with a trailing
comment naming the version it corresponds to. Tags and branches are mutable: a
compromised upstream can repoint `@v4` or `@main` to malicious code, and your next
run executes it. A SHA is immutable. It runs the exact code you audited. This is
the single most important rule in the file, driven by a run of real supply-chain
compromises (tj-actions/changed-files, reviewdog, Trivy) that hit tens of thousands
of repositories by moving tags.

```yaml
# Bad - mutable references
- uses: actions/checkout@v4
- uses: some-org/deploy@main

# Good - immutable SHA, version in a comment for humans and Dependabot
- uses: actions/checkout@<full-40-char-commit-sha>   # v4.2.2
```

Use the SHA of a tagged, audited release (not an arbitrary commit), and obtain and
maintain those SHAs through tooling rather than by hand:

- **Dependabot** on the `github-actions` ecosystem opens reviewed PRs that bump a
  pinned SHA when a new release ships.
- **A minimum release age** (a 7-14 day cooldown via `pinact` or Renovate) before
  adopting a new version catches the large majority of supply-chain attacks, whose
  detection window is usually under a week.
- **A workflow linter** (`zizmor`, `actionlint`) in CI catches unpinned actions,
  template injection, and dangerous triggers before they merge.

```yaml
# dependabot.yml
version: 2
updates:
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

> **Watch this space:** GitHub's roadmap includes a `dependencies:` block — a
> workflow lock file that pins direct and transitive action dependencies to SHAs,
> the way `go.sum` locks Go modules. Until it lands, SHA pinning plus reviewed
> updates is the strongest control. Same trajectory as the Python guide's note on
> `ty`: the manual discipline becomes a built-in once the tooling catches up.

## Secrets & OIDC

No long-lived cloud keys live in GitHub. The apply job authenticates to the cloud
through **OIDC**, assuming a role scoped by subject claim (repo, branch,
environment), so there is no standing credential to leak. See the philosophy guide
for the full rationale.

```yaml
- uses: aws-actions/configure-aws-credentials@<full-40-char-commit-sha>  # v4.x
  with:
    role-to-assume: arn:aws:iam::123456789012:role/prod-tofu-apply
    aws-region: ap-southeast-2
    # no access keys - the role is assumed via the OIDC token
```

- **GitHub Environments are the prod gate.** Put the prod role behind an
  environment with required reviewers and a branch restriction; the apply job
  references that environment, and the review is the deliberate human promotion
  decision the philosophy guide describes.
- **Environment secrets over repository secrets**: they are readable only by jobs
  that name the environment.
- **Never interpolate untrusted input into a `run:` script.** `${{ github.event.*
  }}` values can carry shell injection; bind them to `env:` and reference the
  variable instead:

```yaml
# Bad - injection vector
- run: echo "Title: ${{ github.event.pull_request.title }}"

# Good - pass through env, quote the variable
- env:
    PR_TITLE: ${{ github.event.pull_request.title }}
  run: echo "Title: $PR_TITLE"
```

## Reuse — Workflows and Composite Actions

Don't copy-paste a workflow per environment. Extract the shared shape into a
**reusable workflow** and call it with typed inputs, the way environments share one
OpenTofu module. Pass secrets explicitly rather than letting them inherit.

```yaml
# apply-staging.yml
jobs:
  apply:
    uses: ./.github/workflows/tofu-pipeline.yml
    with:
      environment: staging
      command: apply
    secrets: inherit   # or pass named secrets explicitly for tighter scope
```

Reach for a **composite action** (`.github/actions/tofu-setup/action.yml`) for the
repeated step sequence inside a job — install OpenTofu, authenticate, configure the
backend — rather than a reusable workflow, which composes whole jobs.

## The CI Shape

CI validates application code on every pull request and push, running exactly the
checks the [Python](./python-style-guide.md) and [TypeScript](./typescript-style-guide.md)
guides already define for pre-commit. Running the same gate in both places is the
shift-left rule: a failure shows up on the laptop before it reaches CI, and CI is
the backstop that makes the gate non-optional.

The job is the same five beats every time: check out, set up the toolchain with a
cache keyed on the lock file, install from the lock file, run the gate (format,
lint, type-check, test), and report. Permissions stay at `contents: read`; CI has
no business writing anything.

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

- **Cache keyed on the lock file, nothing vaguer.** A cache keyed on `uv.lock` or
  `bun.lockb` invalidates exactly when dependencies change and never otherwise, so
  CI stays both fast and correct. `enable-cache: true` on `setup-uv` does this for
  you; for other toolchains, key `actions/cache` on a hash of the lock file.
- **Matrix only where it changes behaviour.** A matrix over operating systems or
  supported language versions earns its runtime when the code genuinely has to work
  across them. A matrix that fans out combinations nothing depends on just burns
  minutes, and since the language guides pin a single version, most projects need no
  matrix at all.

## The CD Shape (Plan / Apply)

The infrastructure pipeline stages are the sum of the rules above, and they encode
the plan-as-lockfile rule directly: the plan workflow saves the plan as an
artifact, and apply consumes that exact artifact rather than re-planning.

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

Set `timeout-minutes` on every job so a hung apply can't run indefinitely, and pin
the runner image (`runs-on: ubuntu-24.04`, not `ubuntu-latest`) so the environment
doesn't drift underneath you.

## Anti-Patterns

| Don't | Do |
|-------|-----|
| `uses: action@v4` or `@main` | Pin to a full commit SHA with a version comment |
| `permissions: write-all` | `permissions: {}` then grant per job |
| `id-token: write` at workflow level | Only on the OIDC job |
| Static cloud keys in secrets | OIDC role assumption |
| `${{ github.* }}` inside `run:` | Bind to `env:` and quote the variable |
| `cancel-in-progress: true` on apply | Serialise applies; never cancel one |
| `runs-on: ubuntu-latest` | Pin the runner image |
| Copy-pasted per-environment workflows | One reusable workflow, called with inputs |
| CI checks that differ from pre-commit | Run the identical gate in both |
| Cache keyed on a date or commit | Key the cache on the lock file |
| Matrix over combinations nothing needs | Matrix only where behaviour changes |

---

# Design Principles

### 1. The Formatter and Linter Are Not Optional

Unformatted HCL or an unpinned action fails the build, in pre-commit and in CI.
Whitespace and pinning are settled by tools, not in review.

### 2. Every Input Is Typed and Validated; Every Output Is Documented

`variables.tf` is the module's contract. A bare untyped variable is the `any` of
infrastructure. Constrain it, validate it, describe it.

### 3. Address Resources by Name, Never by Index

`for_each` over `count`. Removing one item should delete one item, not renumber the
rest into a destroy-and-recreate.

### 4. Pin Everything to an Immutable Reference

A SHA for actions, the lock file for providers, a tag for modules. If a reference
can move underneath you, it will.

### 5. Least Privilege by Default

`permissions: {}`, then grant the one job that needs the one scope it needs.
`id-token: write` belongs to the apply job alone.

### 6. Secrets Are Referenced, Never Written

OIDC for the cloud, environment-scoped for everything else, never interpolated into
a shell. The value lives in the store native to its boundary.

### 7. The Plan Is the Artifact

CI plans and uploads; apply downloads and applies. A workflow never re-plans at
apply time. You apply what was reviewed.

### 8. Reuse, Don't Repeat

Shared modules and reusable workflows hold the one definition. Environments and
pipelines differ by input, not by copied code.

### 9. Local, CI, and the Merge Gate Run the Same Checks

CI runs exactly what pre-commit runs, and the merge gate requires it green. A check
that lives only in CI gets discovered late; one that lives only locally gets
skipped. The same gate in all three places is what makes it real.

---

# References

**Important:** Before writing infrastructure code or workflows, read the
documentation linked below. Each link uses the `defuddle.md` prefix, which returns
clean, agent-readable markdown. Read the full documentation, not just the
getting-started pages.

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
