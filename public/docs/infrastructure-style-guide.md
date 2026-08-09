# Infrastructure Development Style Guide

Project conventions, tools, and design principles for infrastructure, CI/CD,
and GitOps. GitOps makes Git the single source of truth and uses automation for
reconciliation. Immutable infrastructure replaces deployed resources instead of
changing them in place. The [Python](./python-style-guide.md) and
[TypeScript](./typescript-style-guide.md) guides use the same preference for fast,
single-purpose tools.

This guide applies to all providers and project sizes. Its core principles
apply to one Cloudflare Worker or a multi-account AWS estate. They also apply
across Cloudflare, AWS, and GitHub. The guide selects specific implementation
tools, but its principles transfer to other tools.

The principles from the other two guides apply directly to infrastructure.
Declare desired state and use a reconciler to enforce it. Use policy-as-code to
validate configuration. Pin module versions and commit dependency locks. Apply
only a reviewed plan. Detect and reconcile drift.

---

## Tech Stack

Use the core tools and supporting checks in this section.

### Core

| Tool                | Role                          | Why                                                                                                       |
| ------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| **OpenTofu**        | Infrastructure-as-code engine | One declarative tool for each provider. MPL-licensed. Linux Foundation governed. Native state encryption. |
| **HCL**             | Configuration language        | Declarative configuration without imperative operations.                                                  |
| **GitHub Actions**  | Deployment pipeline           | The pipeline applies each infrastructure change.                                                          |
| **OIDC federation** | Cloud authentication          | Short-lived identity for providers that support OIDC.                                                     |
| **Object storage**  | State backend                 | Use remote, locked, and encrypted R2, S3, or GCS storage.                                                 |

### Tooling

| Tool                                       | Role                                            | Application-guide equivalent |
| ------------------------------------------ | ----------------------------------------------- | ---------------------------- |
| **OpenTofu**                               | The one tool: init, validate, plan, apply, test | uv / Bun                     |
| **`tofu fmt`**                             | Formatter                                       | ruff format / Biome          |
| **`tofu validate` + `tflint`**             | Lint + static checks                            | ruff / Biome lint            |
| **`variable` validation + `check` blocks** | Boundary + plan-time policy                     | Pydantic / Zod               |
| **`tofu test`**                            | Test runner                                     | pytest / Vitest              |
| **OPA / Conftest**                         | Optional central policy                         | N/A                          |
| **SOPS**                                   | Encrypted desired-state secrets                 | pydantic-settings (`.env`)   |

### OpenTofu Selection

OpenTofu and Terraform use HCL and the same provider protocol. OpenTofu can read
Terraform state. Existing provider configurations can therefore move to OpenTofu.

The Linux Foundation governs the
MPL-licensed OpenTofu project. Terraform uses the Business Source Licence after
HashiCorp's licence change and IBM's acquisition. OpenTofu also provides native
client-side state and plan encryption. Terraform does not provide this feature.

Use OpenTofu for new work without a legacy Terraform estate. Use Terraform when
HCP Terraform Stacks or Sentinel requires it.

### Future Infrastructure Tools

Infrastructure-from-application-code tools can replace separate HCL repositories
and state. Review the selected tools as these products mature. Keep the required
controls for desired state, validation, state writes, and promotion.

---

## Source of Truth

Git is the system of record. Declare every resource in Git. Live infrastructure
must match the repository. You must be able to rebuild the complete environment
in an empty cloud account from the repository.

Use these module rules:

- Put each resource in an approved module. Do not put resource declarations in
  an environment directory. Modules contain policy, parity, and promotion rules.
- Environments are instances of one module, differing only in validated inputs.
- Pin each module version for each environment. Version differences identify
  changes that are present in staging but not production.

---

## Project Structure

Put the environment at the top of the directory tree. This position makes the
credential boundary and potential change scope visible. Divide each environment
into components such as `network`, `storage`, and `compute` from the first commit.

```text
infra/
├── environments/
│   ├── staging/
│   │   ├── network/
│   │   │   ├── main.tf            # backend block + module call + remote-state lookups
│   │   │   ├── backend.tf         # remote, encrypted, locked - keyed to this component
│   │   │   └── staging.tfvars     # validated inputs; values only, never structure
│   │   ├── storage/
│   │   └── compute/
│   └── prod/
│       ├── network/
│       ├── storage/
│       └── compute/
├── modules/                       # approved and versioned resource definitions
│   ├── network/
│   │   ├── main.tf
│   │   ├── variables.tf           # the typed interface - written first
│   │   ├── outputs.tf
│   │   └── checks.tf              # check blocks stored with the module
│   ├── storage/
│   └── compute/
├── policy/                        # native tofu tests and optional Rego policy
├── .github/
│   └── workflows/
│       ├── plan.yml               # PR: fmt -> validate -> lint -> policy -> plan (artifact)
│       ├── apply-staging.yml      # merge to main: apply staging (automatic)
│       ├── apply-prod.yml         # prod ref-bump PR merged: apply prod (gated)
│       └── drift.yml              # scheduled plan; non-empty plan = drift = failure
├── .pre-commit-config.yaml
└── README.md
```

### Project Structure Rules

- Define `modules/variables.tf` first. It is the typed interface of the component.
  Define it before any resource logic, and let the validations guide the
  implementation.
- Keep environment directories small. Include a backend block, a pinned module
  call, a `.tfvars` file, and read-only remote-state lookups.
- Component states depend downward, never sideways or up. `compute` reads
  `network`'s outputs via a read-only remote-state lookup. Do not add a dependency
  from `network` to `compute`.
- Tests mirror modules. A policy suite lives alongside the module it guards.

---

## State

State records the resources that OpenTofu manages. Apply the following controls
to each state file.

### Configure Remote, Encrypted, and Locked State

Do not use local `terraform.tfstate` for a shared or deployed environment. Never
commit state to Git. Use the object store that is native to the deployment
target. Enable locking.

Enable OpenTofu's native state and plan encryption in the committed backend
block. Version-controlled configuration therefore contains the security
guarantee. An external bucket setting cannot silently change it. Configure these
controls before you create resources.

```hcl
# environments/prod/network/backend.tf
terraform {
  backend "s3" {
    bucket         = "acme-tfstate-prod"
    key            = "network/terraform.tfstate"
    region         = "ap-southeast-2"
    dynamodb_table = "tfstate-locks"
    encrypt        = true
  }

  encryption {
    key_provider "aws_kms" "state" {
      kms_key_id = var.state_kms_key_id
    }
    method "aes_gcm" "default" {
      keys = key_provider.aws_kms.state
    }
    state { method = method.aes_gcm.default }
    plan  { method = method.aes_gcm.default }
  }
}
```

### Allow State Writes Only from the Pipeline

The pipeline is the only approved writer of remote state. Credential placement
enforces this rule. Only the pipeline receives state-write credentials through
OIDC. A developer laptop therefore cannot apply to a real environment. The
architecture prevents manual changes.

During development, you can use `tofu apply` with a local or temporary backend.
Use the pipeline for each change to a remote backend.

### Emergency State Access

Provide a separate credential for emergency state changes. Restrict and monitor
this credential. Record each use. Reconcile the state through Git immediately.
Use drift detection to verify the reconciliation.

---

## Environments

Create each environment from the same modules and validated inputs.

### Instances of One Module, Differing Only in Validated Inputs

Staging must use the same structure as production. Every environment uses the
same module and `variables.tf`. Only declared and validated variable values can
differ between environments.

```hcl
# modules/compute/variables.tf - the typed boundary (similar to Pydantic or Zod)
variable "environment" {
  type = string
  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environment must be 'staging' or 'prod'."
  }
}

variable "instance_count" {
  type    = number
  default = 1
  validation {
    condition     = var.instance_count >= 1 && var.instance_count <= 50
    error_message = "instance_count must be between 1 and 50."
  }
}
```

Many environment conditions in one module indicate a partitioning problem. Move
the divergent part into its own component state or module. Express divergence in
the structure instead of a loose environment override.

### Promotion by Version Pin

Each environment references a shared module by a pinned Git tag. This method needs
no extra infrastructure and works across cloud providers. To promote a change,
update the production `ref` in one reviewed commit. Compare environment `ref`
values to identify different module versions.

```hcl
# environments/staging/compute/main.tf
module "compute" {
  source = "git::https://github.com/acme/infra-modules.git//compute?ref=v1.4.0"
  environment    = "staging"
  instance_count = 2
}

# environments/prod/compute/main.tf - still on the previous version
module "compute" {
  source = "git::https://github.com/acme/infra-modules.git//compute?ref=v1.3.0"
  environment    = "prod"
  instance_count = 10
}
```

### Single-Environment Module Exception

A new project with one environment can reference modules by local path. When you
add a second environment, pin every shared module to a versioned tag.

### The Promotion Mechanism

Use these promotion rules:

- Staging promotes automatically. A merge to `main` bumps staging's pin, and
  the pipeline applies the change. Use staging to find deployment faults.
- Prod promotes by deliberate version-bump PR. A person authors a one-line diff
  that updates the production `ref`. The reviewer verifies that staging meets the
  promotion health criteria. The pipeline applies the merged change. Every
  production change has a named author, a one-line diff, a timestamp, and a
  one-line revert.
- Add automatic promotion only after smoke tests and a defined observation period
  give a measurable health result. Keep a human veto.

### Restore a Known-Good Version

If a promotion causes a production fault, create a normal promotion PR. Set the
`ref` to the previous known-good tag. Use the normal review and deployment path.

---

## Policy

Policy-as-code validates infrastructure configuration. Make policy a blocking
merge check from the first commit. Run the same checks in pre-commit and CI. Add
rules as the project grows, but keep the check.

Use OpenTofu-native policy by default. Store policy in shared modules so each
environment receives the same rules. No separate policy wiring is necessary.

- `variable` validation checks inputs such as region allow-lists, valid
  environment names, and permitted sizes.
- `check` blocks assert planned and actual state (no public buckets, mandatory
  tags present), and `tofu test` runs them in CI against a plan.

```hcl
# modules/storage/checks.tf
check "no_public_buckets" {
  assert {
    condition     = alltrue([for b in aws_s3_bucket.this : !b.acl_public])
    error_message = "Buckets must not be publicly accessible."
  }
}

check "mandatory_tags" {
  assert {
    condition = alltrue([
      for r in aws_s3_bucket.this :
      alltrue([for k in ["owner", "environment", "cost-centre", "managed-by"] :
        contains(keys(r.tags), k)])
    ])
    error_message = "All resources must carry owner, environment, cost-centre, managed-by tags."
  }
}
```

Start with mandatory tags, region allow-lists, and no unannotated `0.0.0.0/0`
exposure. Add cost thresholds and resource-type allow-lists when the project
requires them.

### External Policy Engine

Add a central policy engine when repository authors cannot maintain all required
module checks. A single operator can use native checks in approved modules.

---

## Secrets

Do not store secret values in Git. Apply this rule to Cloudflare, AWS, and
GitHub.

OpenTofu stores a secret reference, not the secret value. Store the value in the
system that consumes it.

Classify secrets by lifecycle. Each class has one system of record. Name each
class by role so the model applies to all providers.

| Secret class                                                               | Lives in                                                                         | Rationale                                                                    |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Provisioning** (what OpenTofu needs to build things)                     | The pipeline's secret store, GitHub Actions environments, scoped per environment | Never in the repo. Injected at apply time.                                   |
| **Runtime** (what the deployed app reads)                                  | The target platform's native store, Workers Secrets, AWS Secrets Manager / SSM   | OpenTofu references it, never contains it, so it never enters state.         |
| **Desired-state config** (rare config that genuinely belongs to the model) | SOPS-encrypted in Git                                                            | Versioned, reviewed, and drift-checked alongside the resource it configures. |

Store each secret in the system that uses it. Desired-state configuration only
names the secret. Use native state encryption when a value must transit state.

### Use Federated Authentication

Use OIDC federation when the target provider supports it. For example, GitHub
Actions can assume an AWS IAM role. For a provider without OIDC support, store a
narrowly scoped credential in the deployment environment and rotate it.

```yaml
# .github/workflows/apply-prod.yml (excerpt)
permissions:
  id-token: write          # mint the OIDC token
  contents: read
jobs:
  apply:
    runs-on: ubuntu-24.04
    steps:
      - uses: aws-actions/configure-aws-credentials@<full-40-char-commit-sha> # v4.x
        with:
          role-to-assume: arn:aws:iam::123456789012:role/prod-tofu-apply
          aws-region: ap-southeast-2
          # no access keys - the role is assumed via the OIDC token
```

---

## Drift

Drift occurs when live infrastructure does not match the declared state. Manual
console changes, emergency changes outside Git, and provider changes can cause
drift.

Run a scheduled `tofu plan` each night and before each apply. An empty plan means
that live infrastructure matches Git. A non-empty plan against deployed state is
drift.

Send an alert and stop. Never correct drift automatically. An automatic
apply lets a timer change infrastructure without an authored Git event. It can
also reverse an active emergency fix. Treat detected drift as a blocking failure:

- Block promotion until you reconcile the drift.
- Paging scales with the resource. Drift in `network` or `storage` pages now.
  Create a next-business-day ticket for a low-risk `compute` tag change.
- Correct Git for an authorised live change. Otherwise, merge a PR that reapplies
  the declared state.

Drift detection also audits break-glass reconciliation. An emergency fix appears
as drift and causes an alarm. The alarm requires the expected reconciliation.

---

## The Pipeline

Run these stages in pre-commit and CI:

```text
fmt -> validate -> lint -> policy (validate + check + test) -> plan -> [gate] -> apply
```

### Apply the Reviewed Plan

CI saves the plan as an artefact. `apply` uses that exact artefact instead of
a new plan. Provider changes could make a later plan different. Apply only the
reviewed plan.

```yaml
# plan.yml
- run: tofu plan -out=tfplan
- uses: actions/upload-artifact@<full-40-char-commit-sha> # v4.x
  with: { name: tfplan, path: tfplan }

# apply-*.yml
- uses: actions/download-artifact@<full-40-char-commit-sha> # v4.x
  with: { name: tfplan }
- run: tofu apply tfplan      # the reviewed artifact, not a fresh plan
```

---

## Observability

This guide defines infrastructure telemetry. The
[Python](./python-style-guide.md) and
[TypeScript](./typescript-style-guide.md) guides define application telemetry.
Use lowercase, dotted event names and structured fields. Do not interpolate
values into event names.

Emit a structured audit event for each apply, drift result, and policy decision.
Use the drift severity model for alerts:

- `tofu.apply.complete` / `tofu.apply.failed`: every apply outcome, with
  environment, component, and plan summary.
- `tofu.drift.detected`: environment, component, and the diff.
- `policy.check.blocked`: which rule, which resource.
- `promotion.applied`: author, from-version, to-version, environment.

---

## Naming and Tagging

- Use `{project}-{env}-{component}-{purpose}` for resource names. Use `enable_`
  and `is_` prefixes for Boolean feature flags.
- Apply the initial policy check to mandatory tags. Require `owner`,
  `environment`, `cost-centre`, and `managed-by`. Set `managed-by` to `opentofu`.
  Do not merge an untagged resource.
- State keys mirror the directory tree. Use `{component}/terraform.tfstate`
  under a per-environment bucket. The path identifies the environment and the
  component.

---

## Testing

Test plans and module behaviour with local state and provider fixtures:

- `tofu test` exercises modules against fixture inputs and checks planned output.
- Policy tests verify that the module rejects invalid inputs.
- Plan tests assert that a known change produces the expected diff and *no
  unexpected* resource replacement.
- Never test against real shared state. Use a local backend and provider
  fixtures. Name tests as sentences.

```hcl
# policy/compute.tftest.hcl
run "rejects_oversized_instance_count" {
  command = plan
  variables {
    environment    = "staging"
    instance_count = 9999
  }
  expect_failures = [var.instance_count]
}
```

---

## References

Before you set infrastructure standards or write HCL, read the referenced
documentation. The `defuddle.md` prefix returns Markdown. Read the complete
documentation for each selected tool.

- [OpenTofu documentation](https://defuddle.md/opentofu.org/docs/)
- [OpenTofu state & plan encryption](https://defuddle.md/opentofu.org/docs/language/state/encryption/)
- [OpenTofu `check` blocks](https://defuddle.md/opentofu.org/docs/language/checks/)
- [OpenTofu tests (`tofu test`)](https://defuddle.md/opentofu.org/docs/cli/commands/test/)
- [OpenTofu module sources & version pinning](https://defuddle.md/opentofu.org/docs/language/modules/sources/)
- [HCL: the configuration language](https://defuddle.md/developer.hashicorp.com/terraform/language)
- [GitHub Actions: OpenID Connect](https://defuddle.md/docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- [GitHub Actions: OIDC with AWS](https://defuddle.md/docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [GitHub Actions: environments & secrets](https://defuddle.md/docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)
- [Cloudflare Terraform/OpenTofu provider](https://defuddle.md/developers.cloudflare.com/terraform/)
- [AWS provider](https://defuddle.md/registry.terraform.io/providers/hashicorp/aws/latest/docs)
- [tflint](https://defuddle.md/github.com/terraform-linters/tflint)
- [Open Policy Agent](https://defuddle.md/www.openpolicyagent.org/docs/latest/)
- [Conftest](https://defuddle.md/www.conftest.dev/)
- [SOPS](https://defuddle.md/getsops.io/docs/)
- [OpenGitOps principles (CNCF)](https://defuddle.md/opengitops.dev/)
