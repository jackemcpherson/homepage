# Infrastructure Authoring Guide

This guide defines how to write HCL modules and GitHub Actions workflows. It
supplies the syntax layer beneath the
[infrastructure style guide](./infrastructure-style-guide.md), which records
the design decisions and their reasons.

Part 1 covers OpenTofu and HCL. Part 2 covers GitHub Actions. Part 3 contains
the worked example. The final section contains references.

---

## Part 1: OpenTofu (HCL)

Part 1 defines conventions for the project module and its environment callers.

### Formatting and Tooling

Run the same gate in pre-commit and CI. Unformatted HCL fails the build.

| Command               | Purpose                                       |
| --------------------- | --------------------------------------------- |
| `tofu fmt -recursive` | Format every file. CI runs `tofu fmt -check`. |
| `tofu validate`       | Schema and reference validation.              |
| `tflint`              | Provider-aware lint and naming rules.         |

`fmt` handles two-space indentation and alignment. Do not align HCL manually.
Use the formatter so a diff shows content changes.

Two tools are optional. `terraform-docs` generates README input and output
tables when a module gains external readers. Write a `tofu test` suite only
when a module contains logic worth testing. Variable validation stays required
everywhere.

### Repository Layout

Each application repository carries its infrastructure in an `infra`
directory. The [style guide](./infrastructure-style-guide.md#repositories)
records the reasons. One file per concern, so a reader knows where to look
before opening anything.

```text
example-worker/
├── src/                          # application code
├── infra/
│   ├── modules/
│   │   └── project/              # every resource lives here
│   │       ├── main.tf           # resources and data sources
│   │       ├── variables.tf      # the typed input interface - written first
│   │       ├── outputs.tf        # the public interface
│   │       ├── versions.tf       # required_version + pinned providers
│   │       └── locals.tf         # derived values (omit if there are none)
│   └── environments/
│       └── production/           # thin caller
│           ├── backend.tf        # remote, locked state
│           ├── providers.tf      # provider configuration
│           ├── main.tf           # one local-path module call
│           ├── variables.tf      # declarations for the tfvars values
│           └── production.tfvars # validated inputs; values only
└── .github/
    └── workflows/
```

`versions.tf` pins the toolchain and providers. Commit the
`.terraform.lock.hcl` lock file. It has the same role as `uv.lock` and
`bun.lock`. It makes each run resolve the same provider builds.

```hcl
# versions.tf
terraform {
  required_version = ">= 1.10"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0" # pin the major, allow patch/minor
    }
  }
}
```

A module never declares a `provider` block. The environment directory
configures providers and calls the module. The caller can therefore select any
account.

### Naming Conventions

Everything is `snake_case`. Names describe the resource role. The address
already contains the resource type. Use `cloudflare_r2_bucket.media`.

| Construct                                              | Convention               | Example                                                   |
| ------------------------------------------------------ | ------------------------ | --------------------------------------------------------- |
| Resources, data sources                                | `snake_case`, role-named | `cloudflare_r2_bucket.media`, `cloudflare_dns_record.www` |
| The single primary resource of a single-purpose module | `this`                   | `cloudflare_r2_bucket.this`                               |
| Variables                                              | `snake_case`             | `zone_id`, `enable_log_bucket`                            |
| Outputs                                                | `snake_case`             | `media_bucket_name`, `hostname`                           |
| Locals                                                 | `snake_case`             | `name_prefix`, `common_tags`                              |
| Modules (calls)                                        | `snake_case`, role-named | `module.project`                                          |
| Files                                                  | `snake_case.tf`          | `main.tf`, `variables.tf`                                 |

- Boolean variables start with `enable_`, `is_`, or `has_`:
  `enable_log_bucket`, `is_public`.
- Collections are plural and keyed names singular: `alias_records`, and a
  `for_each` over `var.alias_records`.
- Name resources with a `{project}-{environment}-{purpose}` pattern. Compose
  the prefix once in a local and reuse it.
- Key state as `{project}/{environment}/terraform.tfstate` in the shared
  state bucket. The path identifies the project and the environment.
- Tags are a convention, not a gate. Where a provider supports tags, compose
  them once in a `common_tags` local. No check enforces them.

```hcl
# locals.tf
locals {
  name_prefix = "${var.project}-${var.environment}"

  common_tags = {
    owner       = var.owner
    environment = var.environment
    managed-by  = "opentofu"
  }
}
```

### Variables: the Typed Boundary

Every variable has a `type`, a `description`, and a `validation` block when
rules apply. The variable interface is the boundary contract. Validation
rejects bad input before it causes a confusing plan error.

```hcl
# variables.tf
variable "environment" {
  type        = string
  description = "Deployment environment. Drives naming."

  validation {
    condition     = contains(["production", "staging"], var.environment)
    error_message = "environment must be 'production' or 'staging'."
  }
}

variable "account_id" {
  type        = string
  description = "Cloudflare account that holds the project resources."

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.account_id))
    error_message = "account_id must be a 32-character hex account ID."
  }
}

variable "alias_records" {
  type        = map(string)
  description = "Proxied CNAME records keyed by record name."
  default     = {}
}
```

Rules:

- Declare a type for every variable. A bare `variable "x" {}` accepts any
  value. Use `object(...)` for structured input.
- Add a description to every variable. Descriptions appear in editor
  tooltips.
- Set `nullable = false` unless the absence of a value has a defined
  meaning.
- Set `sensitive = true` for secret values. This setting redacts the values
  from plan output.
- Remove unused variables. `tflint` identifies them.

### Outputs: the Public Interface

`outputs.tf` is the module's public API. Expose only the values that
consumers need, and document each value.

```hcl
# outputs.tf
output "media_bucket_name" {
  value       = cloudflare_r2_bucket.media.name
  description = "Name of the R2 bucket that stores media assets."
}
```

### Resources and Logic

Use these rules to keep resource addresses stable and dependencies explicit.

#### `for_each` Over `count`

Default to `for_each` because it addresses resources by a stable key.
Removing one item then deletes only that item. In contrast, `count` addresses
by index. A removal can renumber later resources and force unnecessary
replacement.

Write:

```hcl
resource "cloudflare_dns_record" "alias" {
  for_each = var.alias_records
  zone_id  = var.zone_id
  name     = each.key
  type     = "CNAME"
  content  = each.value
  proxied  = true
  ttl      = 1
}
```

Use `count` only for one optional resource:

```hcl
resource "cloudflare_r2_bucket" "logs" {
  count      = var.enable_log_bucket ? 1 : 0
  account_id = var.account_id
  name       = "${local.name_prefix}-logs"
}
```

#### Refactor with `moved`, Never by Silent Rename

Renaming a resource is a destroy-and-recreate unless you tell the engine the
address moved. Use a `moved` block so the refactor is a no-op apply.

```hcl
moved {
  from = cloudflare_dns_record.www_alias
  to   = cloudflare_dns_record.alias
}
```

#### Other Resource Rules

- Prefer implicit dependencies through references. Use `depends_on` only
  when no reference can express the dependency.
- Use `dynamic` blocks only for variable-length nested blocks. They make the
  plan more difficult to read.
- Do not use `local-exec` or `remote-exec` to connect resources. Use a
  provider or a separate tool for an imperative operation.
- Do not put fixed account IDs, zone IDs, or hostnames in a module. Supply
  them through variables or data sources.

### Checks and Tests

Variable validation is the workhorse and stays required everywhere. Use a
`check` block only for a real module invariant that validation cannot
express. Write a `tofu test` suite only when a module contains logic worth
testing, such as conditional resources or derived values. The
[retrofit rule](./infrastructure-style-guide.md#the-retrofit-rule) explains
this demotion: a team can add tests later without restructure.

When a test suite exists, store it beside the module, use fixture inputs, and
name tests as sentences. Never test against real shared state.

### Documentation

- Add a description to every variable and output. Add a one-line purpose
  comment at the top of each module.
- Use comments to explain a decision or constraint. For example, use
  `# capture price at order time so historical values stay stable`. Do not
  add a comment that restates the code, such as `# create the bucket`.

### HCL Anti-Patterns

| Do not                                    | Do                                              |
| ----------------------------------------- | ----------------------------------------------- |
| Untyped `variable "x" {}`                 | Constrain the type. `object(...)` for structure |
| `count` for a keyed set                   | `for_each` over a map                           |
| Renaming a resource in place              | A `moved` block                                 |
| `provider` block inside a module          | Configure in the environment directory          |
| Hardcoded account IDs, zone IDs, or hosts | Variables and data sources                      |
| Secrets in plaintext or in state          | References to a secret store                    |
| One 600-line `main.tf`                    | Split the module files by concern               |

---

## Part 2: GitHub Actions (YAML)

Every workflow in the repository follows these conventions. The default
repository has exactly three workflows plus the Dependabot configuration. Do
not add a reusable workflow or a composite action in the default. The
[do not build list](./infrastructure-style-guide.md#the-do-not-build-list)
records that decision.

### File Layout

```text
.github/
├── workflows/
│   ├── ci.yml         # each pull request: app checks + infra checks + plan comment
│   ├── deploy.yml     # each merge to main: apply infra, then deploy the app
│   └── drift.yml      # weekly: plan; a non-empty plan fails the run
└── dependabot.yml     # weekly github-actions version updates
```

Add `name:` to every workflow, job, and step that runs a script. A clear name
identifies a failure in the log.

### Triggers, Path Filters, and Concurrency

Declare `on:` explicitly. Path filters select the jobs that each change runs.
The workflows below use a `changes` job so one workflow file serves both the
application and the infrastructure.

Plan and apply require different concurrency behaviour:

```yaml
# ci.yml - cancel a superseded plan
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

# deploy.yml - never cancel a half-finished apply; serialise instead
concurrency:
  group: deploy-production
  cancel-in-progress: false
```

Cancelling an active apply can make the state differ from the infrastructure.
Queue apply jobs. Do not interrupt an apply job.

Do not use `pull_request_target` for a workflow that checks out and runs pull
request code.

### Permissions: Least Privilege

Set workflow permissions to `{}` and grant the minimum permissions to each
job. Add write scopes only to the job that uses them.

```yaml
permissions: {} # workflow-level default: nothing

jobs:
  infra:
    permissions:
      contents: read       # read the repository
      pull-requests: write # post the plan summary as a PR comment
```

Where a provider supports OIDC, grant `id-token: write` only to the job that
mints the token.

### Untrusted Input

Treat all pull request metadata, including titles, branch names, and bodies,
as untrusted input. Never interpolate untrusted input into a `run:` script.
Values from `${{ github.event.* }}` can carry shell injection. Bind them to
`env:` and reference the variable instead.

Write:

```yaml
- env:
    PR_TITLE: ${{ github.event.pull_request.title }}
  run: echo "$PR_TITLE"
```

Do not write:

```yaml
- run: echo "${{ github.event.pull_request.title }}"
```

### Action Versions

Reference each third-party action by its major version tag:

```yaml
- uses: actions/checkout@v5
```

Do not pin commit SHAs in the default. The
[accepted risks](./infrastructure-style-guide.md#accepted-risks) section
records this decision and the mitigation. Dependabot keeps the version tags
current through a weekly pull request:

```yaml
# dependabot.yml
version: 2
updates:
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

### Authentication and Secrets

Use OIDC to assume a role when the provider supports it. The Cloudflare API
has no OIDC path, so the default uses scoped tokens:

- Store the pipeline credentials in the `production` GitHub environment.
  Only jobs that name the environment can read them. Scope the Cloudflare
  API token to this project's zone and R2 storage, and rotate it.
- Store runtime secrets in the platform store with `wrangler secret put`.
  OpenTofu never contains the values.

### The Three Workflows

The three files below are complete. They serve the worked example in Part 3.

#### `ci.yml`

The pull request plan is a preview. `deploy.yml` plans again after the merge
and applies the fresh plan. Do not upload the plan as an artefact for a later
workflow. Artefacts do not cross workflows, and a pull request plan goes
stale.

```yaml
name: CI

on:
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions: {}

jobs:
  changes:
    name: Detect changes
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions:
      contents: read
      pull-requests: read
    outputs:
      app: ${{ steps.filter.outputs.app }}
      infra: ${{ steps.filter.outputs.infra }}
    steps:
      - name: Filter changed paths
        uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            app:
              - "src/**"
              - "test/**"
              - "package.json"
              - "bun.lock"
              - "wrangler.jsonc"
            infra:
              - "infra/**"
              - ".github/workflows/**"

  app:
    name: Application checks
    needs: changes
    if: needs.changes.outputs.app == 'true'
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
      - name: Install dependencies
        run: bun install --frozen-lockfile
      - name: Lint
        run: bun run check
      - name: Type-check
        run: bun run typecheck
      - name: Test
        run: bun run test

  infra:
    name: Infrastructure checks
    needs: changes
    if: needs.changes.outputs.infra == 'true'
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    environment: production
    permissions:
      contents: read
      pull-requests: write
    env:
      AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    defaults:
      run:
        working-directory: infra/environments/production
    steps:
      - uses: actions/checkout@v5
      - uses: opentofu/setup-opentofu@v1
      - uses: terraform-linters/setup-tflint@v6
      - name: Check formatting
        run: tofu fmt -check -recursive ../..
      - name: Init
        run: tofu init -input=false
      - name: Validate
        run: tofu validate
      - name: Lint
        run: tflint --chdir=../../modules/project
      - name: Plan
        run: tofu plan -input=false -no-color -out=tfplan
      - name: Render the plan
        run: tofu show -no-color tfplan > plan.txt
      - name: Post the plan comment
        uses: actions/github-script@v8
        with:
          script: |
            const fs = require("fs");
            const plan = fs.readFileSync(
              "infra/environments/production/plan.txt",
              "utf8",
            );
            const marker = "## Infrastructure plan";
            const body = marker + "\n\n```text\n" + plan + "\n```";
            const { data: comments } = await github.rest.issues.listComments({
              ...context.repo,
              issue_number: context.issue.number,
            });
            const previous = comments.find((c) => c.body.startsWith(marker));
            if (previous) {
              await github.rest.issues.updateComment({
                ...context.repo,
                comment_id: previous.id,
                body,
              });
            } else {
              await github.rest.issues.createComment({
                ...context.repo,
                issue_number: context.issue.number,
                body,
              });
            }
```

#### `deploy.yml`

The apply job replans and applies in one run. The application deploys after
the infrastructure apply succeeds, so a new binding target exists before the
Worker references it.

```yaml
name: Deploy

on:
  push:
    branches: [main]

concurrency:
  group: deploy-production
  cancel-in-progress: false

permissions: {}

jobs:
  changes:
    name: Detect changes
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions:
      contents: read
    outputs:
      app: ${{ steps.filter.outputs.app }}
      infra: ${{ steps.filter.outputs.infra }}
    steps:
      - uses: actions/checkout@v5
      - name: Filter changed paths
        uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            app:
              - "src/**"
              - "test/**"
              - "package.json"
              - "bun.lock"
              - "wrangler.jsonc"
            infra:
              - "infra/**"
              - ".github/workflows/**"

  infra:
    name: Apply infrastructure
    needs: changes
    if: needs.changes.outputs.infra == 'true'
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    environment: production
    permissions:
      contents: read
    env:
      AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    defaults:
      run:
        working-directory: infra/environments/production
    steps:
      - uses: actions/checkout@v5
      - uses: opentofu/setup-opentofu@v1
      - name: Init
        run: tofu init -input=false
      - name: Plan
        run: tofu plan -input=false -out=tfplan
      - name: Apply
        run: tofu apply -input=false tfplan

  app:
    name: Deploy application
    needs: [changes, infra]
    if: >-
      !failure() && !cancelled() &&
      needs.changes.outputs.app == 'true'
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    environment: production
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
      - name: Install dependencies
        run: bun install --frozen-lockfile
      - name: Deploy the Worker
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

The `app` job condition uses `!failure() && !cancelled()`, so an
application-only merge still deploys when the pipeline skips the `infra` job.

#### `drift.yml`

`-detailed-exitcode` returns exit code 2 for a non-empty plan, which fails
the run. GitHub emails the operator about the failed scheduled run. That
email is the complete alerting model. The workflow shares the
`deploy-production` concurrency group, so a drift plan never runs during an
apply.

```yaml
name: Drift

on:
  schedule:
    - cron: "0 19 * * 0" # weekly, Monday 05:00 Melbourne
  workflow_dispatch:

concurrency:
  group: deploy-production
  cancel-in-progress: false

permissions: {}

jobs:
  plan:
    name: Detect drift
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    environment: production
    permissions:
      contents: read
    env:
      AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    defaults:
      run:
        working-directory: infra/environments/production
    steps:
      - uses: actions/checkout@v5
      - uses: opentofu/setup-opentofu@v1
      - name: Init
        run: tofu init -input=false
      - name: Plan
        run: tofu plan -input=false -detailed-exitcode
```

### Workflow Anti-Patterns

| Do not                                   | Do                                               |
| ---------------------------------------- | ------------------------------------------------ |
| `permissions: write-all`                 | `permissions: {}` then grant per job             |
| `id-token: write` at workflow level      | Only on the job that mints a token               |
| `${{ github.* }}` inside `run:`          | Bind to `env:` and quote the variable            |
| `cancel-in-progress: true` on apply      | Serialise applies. Never cancel one              |
| `runs-on: ubuntu-latest`                 | Pin the runner image                             |
| A plan artefact passed between workflows | Plan again after the merge. Apply the fresh plan |
| CI checks that differ from pre-commit    | Run the identical gate in both                   |
| Cache keyed on a date or commit          | Key the cache on the lock file                   |

---

## Part 3: Worked Example

The example is one Cloudflare Worker project named `example-worker`. The
foundation repository already exists. It holds the R2 state bucket, the DNS
zone, and the scoped API tokens. The
[style guide](./infrastructure-style-guide.md#repositories) records the
foundation procedure.

The example applies a one-writer rule: each resource has exactly one writer.
OpenTofu manages the resources that `wrangler deploy` never writes, which are
the media bucket and the `www` alias record. Wrangler owns the Worker script,
its bindings, its runtime secrets, and the custom domain. Two writers on one
resource create permanent drift.

```text
example-worker/
├── src/
│   └── index.ts
├── test/
│   └── index.test.ts
├── package.json
├── bun.lock
├── tsconfig.json
├── wrangler.jsonc
├── infra/
│   ├── modules/
│   │   └── project/
│   │       ├── main.tf
│   │       ├── variables.tf
│   │       ├── outputs.tf
│   │       ├── versions.tf
│   │       └── locals.tf
│   └── environments/
│       └── production/
│           ├── backend.tf
│           ├── providers.tf
│           ├── main.tf
│           ├── variables.tf
│           ├── production.tfvars
│           └── .terraform.lock.hcl
├── .github/
│   ├── workflows/
│   │   ├── ci.yml
│   │   ├── deploy.yml
│   │   └── drift.yml
│   └── dependabot.yml
├── .pre-commit-config.yaml
└── README.md
```

The three workflow files appear in
[Part 2](#the-three-workflows). The remaining files follow.

### `wrangler.jsonc`

The custom domain and the bucket binding live here, because wrangler is their
writer. The binding references the module-created bucket by name.

```jsonc
{
  "name": "example-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-01",
  "routes": [{ "pattern": "example.com", "custom_domain": true }],
  "r2_buckets": [
    { "binding": "MEDIA", "bucket_name": "example-worker-production-media" }
  ]
}
```

### The Project Module

```hcl
# infra/modules/project/versions.tf
terraform {
  required_version = ">= 1.10"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}
```

```hcl
# infra/modules/project/variables.tf
variable "account_id" {
  type        = string
  description = "Cloudflare account that holds the project resources."

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.account_id))
    error_message = "account_id must be a 32-character hex account ID."
  }
}

variable "zone_id" {
  type        = string
  description = "DNS zone that serves the project hostname."

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.zone_id))
    error_message = "zone_id must be a 32-character hex zone ID."
  }
}

variable "project" {
  type        = string
  description = "Project name. Drives resource naming."

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]*$", var.project))
    error_message = "project must be lowercase kebab-case."
  }
}

variable "environment" {
  type        = string
  description = "Deployment environment. Drives resource naming."

  validation {
    condition     = contains(["production", "staging"], var.environment)
    error_message = "environment must be 'production' or 'staging'."
  }
}

variable "hostname" {
  type        = string
  description = "Apex hostname that the Worker serves."
}
```

```hcl
# infra/modules/project/locals.tf
locals {
  name_prefix = "${var.project}-${var.environment}"
}
```

```hcl
# infra/modules/project/main.tf
# Resources that wrangler never writes: storage and zone records.

resource "cloudflare_r2_bucket" "media" {
  account_id = var.account_id
  name       = "${local.name_prefix}-media"
  location   = "APAC"
}

resource "cloudflare_dns_record" "www" {
  zone_id = var.zone_id
  name    = "www.${var.hostname}"
  type    = "CNAME"
  content = var.hostname
  proxied = true
  ttl     = 1
}
```

```hcl
# infra/modules/project/outputs.tf
output "media_bucket_name" {
  value       = cloudflare_r2_bucket.media.name
  description = "Name of the R2 bucket that stores media assets."
}
```

The module has no `check` blocks and no test suite. It contains no logic
worth testing. Variable validation carries the policy.

### The Production Environment

The backend uses R2 through the S3-compatible API. R2 supports conditional
writes, so `use_lockfile` provides state locking. R2 encrypts objects at
rest, which satisfies the
[security floor](./infrastructure-style-guide.md#security-floor). The R2
credentials arrive as `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`
environment variables and never appear in the file.

```hcl
# infra/environments/production/backend.tf
terraform {
  backend "s3" {
    bucket = "acme-tfstate"
    key    = "example-worker/production/terraform.tfstate"
    region = "auto"

    endpoints = {
      s3 = "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com"
    }

    use_path_style              = true
    use_lockfile                = true
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
  }
}
```

```hcl
# infra/environments/production/providers.tf
# The provider reads CLOUDFLARE_API_TOKEN from the environment.
provider "cloudflare" {}
```

```hcl
# infra/environments/production/main.tf
module "project" {
  source = "../../modules/project"

  account_id  = var.account_id
  zone_id     = var.zone_id
  project     = var.project
  environment = var.environment
  hostname    = var.hostname
}
```

```hcl
# infra/environments/production/variables.tf
# Declarations for the tfvars values. The module validates them.

variable "account_id" {
  type        = string
  description = "Cloudflare account that holds the project resources."
}

variable "zone_id" {
  type        = string
  description = "DNS zone that serves the project hostname."
}

variable "project" {
  type        = string
  description = "Project name. Drives resource naming."
}

variable "environment" {
  type        = string
  description = "Deployment environment. Drives resource naming."
}

variable "hostname" {
  type        = string
  description = "Apex hostname that the Worker serves."
}
```

```hcl
# infra/environments/production/production.tfvars
account_id  = "0123456789abcdef0123456789abcdef"
zone_id     = "abcdef0123456789abcdef0123456789"
project     = "example-worker"
environment = "production"
hostname    = "example.com"
```

Run the environment from its directory:

```shell
cd infra/environments/production
tofu init
tofu plan -var-file=production.tfvars
```

The pipeline is the default apply path. A workstation apply through the same
commands stays permitted while the operator works alone.

---

## References

Consult a reference when a question exists. The `defuddle.md` prefix returns
Markdown.

- [OpenTofu language reference](https://defuddle.md/opentofu.org/docs/language/)
- [OpenTofu style conventions](https://defuddle.md/opentofu.org/docs/language/syntax/style/)
- [OpenTofu variable validation](https://defuddle.md/opentofu.org/docs/language/values/variables/)
- [OpenTofu S3 backend](https://defuddle.md/opentofu.org/docs/language/settings/backends/s3/)
- [Cloudflare Terraform/OpenTofu provider](https://defuddle.md/developers.cloudflare.com/terraform/)
- [Cloudflare R2 as a state backend](https://defuddle.md/developers.cloudflare.com/terraform/advanced-topics/remote-backend/)
- [Wrangler configuration](https://defuddle.md/developers.cloudflare.com/workers/wrangler/configuration/)
- [tflint](https://defuddle.md/github.com/terraform-linters/tflint)
- [terraform-docs](https://defuddle.md/terraform-docs.io/)
- [pre-commit-terraform](https://defuddle.md/github.com/antonbabenko/pre-commit-terraform)
- [GitHub Actions workflow syntax](https://defuddle.md/docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions)
- [GitHub Actions secure use reference](https://defuddle.md/docs.github.com/en/actions/reference/security/secure-use)
- [GitHub Actions environments](https://defuddle.md/docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)
- [Dependabot for Actions](https://defuddle.md/docs.github.com/en/code-security/dependabot/working-with-dependabot/keeping-your-actions-up-to-date-with-dependabot)
