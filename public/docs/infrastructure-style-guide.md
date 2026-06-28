# Infrastructure Development Style Guide

Project conventions, tooling, and design principles for infrastructure, CI/CD,
and GitOps. Informed by the GitOps lineage (Git as the single source of truth,
reconciled by automation), the immutable-infrastructure thesis (build once,
deploy, never mutate in place), and the same Astral (uv/ruff) philosophy of fast,
single-purpose, declarative tooling that runs through the [Python](./python-style-guide.md)
and [TypeScript](./typescript-style-guide.md) guides.

This guide is **provider-agnostic and complexity-agnostic**: one core philosophy
that holds whether the target is a single Cloudflare Worker in its first week or a
multi-account AWS estate, and whether you deploy to Cloudflare, AWS, or GitHub.
It commits to specific tools the way its sibling guides commit to uv and Pydantic. The tools are the implementation; the **principles** are the part that
transfers.

The throughline from the other two guides carries directly into infrastructure.
Where application code declares intent through a type system and an enforcing
checker, infrastructure declares intent through **declarative desired-state** and
an enforcing **reconciler**. Where application code validates at the boundary with
Pydantic or Zod, infrastructure validates at the boundary with **policy-as-code**.
Where application code commits a lock file, infrastructure **pins module versions
and commits its plan**. Drift is the infrastructure type error.

---

## Tech Stack

### Core

| Tool | Role | Why |
|------|------|-----|
| **OpenTofu** | IaC engine (the pillar) | One declarative tool for every provider. MPL-licensed, Linux Foundation governed; the open, community-driven choice. Native state encryption. |
| **HCL** | Configuration language | Enforced-declarative. No imperative escape hatch; declarativeness is guaranteed, not policed. |
| **GitHub Actions** | Pipeline + the only sanctioned writer | The pipeline is where every change to the world originates. |
| **OIDC federation** | Cloud authentication | Short-lived, federated identity. No long-lived cloud keys to store, rotate, or leak. |
| **Object storage** | State backend | R2 (Cloudflare), S3 (AWS), GCS (GCP): remote, locked, encrypted. The implementation follows the target; the principle is fixed. |

### Tooling

| Tool | Role | Application-guide equivalent |
|------|------|------------------------------|
| **OpenTofu** | The one tool: init, validate, plan, apply, test | uv / Bun |
| **`tofu fmt`** | Formatter | ruff format / Biome |
| **`tofu validate` + `tflint`** | Lint + static checks | ruff / Biome lint |
| **`variable` validation + `check` blocks** | Boundary + plan-time policy | Pydantic / Zod |
| **`tofu test`** | Test runner | pytest / Vitest |
| **OPA / Conftest** | Centralised policy *(graduation rung)* | — |
| **SOPS** | Encrypted desired-state secrets | pydantic-settings (`.env`) |

**Why OpenTofu over Terraform:** they are the same tool at the HCL and provider
level. OpenTofu reads Terraform state natively and uses the same provider
protocol, so it is a drop-in and the entire ecosystem transfers. The differences
are exactly the ones the sibling guides optimise for. OpenTofu is MPL-licensed
under Linux Foundation governance, where Terraform sits under the Business Source
Licence after HashiCorp's relicense and IBM's acquisition, the same open-tooling
ethos that makes ruff the default over a proprietary pile. It also ships **native
client-side state and plan encryption**, which Terraform lacks, closing the single
worst secrets hole in HCL. For greenfield work with no legacy Terraform estate,
OpenTofu is the no-regrets default. **Terraform is the lowest common denominator**,
named only as the fallback when an org is already locked into HCP Terraform
Stacks or Sentinel. This is the same move the Python guide makes choosing pyright
over mypy.

> **Watch this space:** the live question in this space is not OpenTofu versus
> Terraform. It is whether the separate-HCL-codebase-plus-separate-state model
> itself stays the right primitive, as infrastructure-from-application-code
> frameworks mature. The principles in this guide (desired-state, boundary
> validation, single-writer, authored promotion) survive that shift even if the
> tool underneath changes, the same way the Python guide's principles outlast any
> single type checker.

---

## Source of Truth

**Git is the system of record.** The live state of every environment is a
*projection* of what is in the repository, never the other way around. Nothing
exists that is not declared in Git, and the acid test is concrete: *you must be
able to rebuild the entire environment, from an empty cloud account, using only
the repository.* If something would not survive that, it has escaped the source of
truth and needs to be brought back in.

Three structural rules make this guarantee real rather than aspirational, and they
all rest on one thing, **the module**:

- **No resource exists outside a blessed module.** A raw, hand-rolled resource
  dropped into an environment directory is itself a violation. Modules are the
  unit of policy, parity, and promotion; a resource outside a module sits outside
  all three guarantees.
- **Environments are instances of one module**, differing only in validated inputs.
- **Modules are pinned by version** per environment, so a change is "in staging but
  not yet prod" by virtue of a version difference, not a timing accident.

---

## Project Structure

The directory tree is **environment-major**: the most dangerous axis (the
environment, the blast-radius and credential boundary) is the most visible one,
at the top. Within each environment, state is partitioned into **thematic
components** (`network`, `storage`, `compute`) from the very first commit, the
infrastructure equivalent of writing `types.py` first. You lay the seams up front
and let everything hang off them; you do not earn them later.

```
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
├── modules/                       # the blessed, versioned, single source of shape
│   ├── network/
│   │   ├── main.tf
│   │   ├── variables.tf           # the typed interface - written first
│   │   ├── outputs.tf
│   │   └── checks.tf              # check blocks: policy that travels with the module
│   ├── storage/
│   └── compute/
├── policy/                        # native tofu test suites + (on graduation) Rego
├── .github/
│   └── workflows/
│       ├── plan.yml               # PR: fmt -> validate -> lint -> policy -> plan (artifact)
│       ├── apply-staging.yml      # merge to main: apply staging (automatic)
│       ├── apply-prod.yml         # prod ref-bump PR merged: apply prod (gated)
│       └── drift.yml              # scheduled plan; non-empty plan = drift = failure
├── .pre-commit-config.yaml
└── README.md
```

### Principles

- **`modules/variables.tf` is written first.** It is the typed interface of the
  component. Define it before any resource logic, and let the validations guide
  the implementation.
- **Environment directories are thin.** A backend block, a pinned module call, a
  `.tfvars`, and read-only remote-state lookups. No loose resources. Ever.
- **Component states depend downward, never sideways or up.** `compute` reads
  `network`'s outputs via a read-only remote-state lookup; `network` knows nothing
  of `compute`. This is composition-over-inheritance expressed as a dependency DAG.
- **Tests mirror modules.** A policy suite lives alongside the module it guards.

---

## State

State is the real control surface, so the rules around it are the strictest in the
guide.

### Remote, Encrypted, Locked — From Day One

Never local `terraform.tfstate`, never in Git. The backend is the object store
native to the deployment target (R2, S3, GCS), with locking enabled and
**OpenTofu's native state and plan encryption configured in the committed backend
block**, so the security guarantee lives in version-controlled config rather than a
bucket setting applied out of band. This is the commit-the-lock-file rule of
infrastructure: non-negotiable, cheap, done before anything else.

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

### Remote State Has Exactly One Writer, and It Is Never a Human

The pipeline is the only sanctioned writer of remote state, and this is enforced
by **credential placement, not policy**: only the pipeline holds state-write
credentials (via OIDC), so a developer laptop *physically cannot* apply to a real
environment. "No manual changes" stops being a rule people must remember and
becomes a property of the architecture.

The laptop phase does not die; it relocates. You may `tofu apply` freely against a
**local or ephemeral backend** while iterating; that is the scratchpad. "Make it
real" means "push it to a remote backend," which by definition means "hand it to
the pipeline." Local state is the pure core; remote state is the effectful shell.

### Break-Glass

A no-exceptions rule with no emergency valve gets routed around when prod
is on fire, and a rule violated in silence is worse than a loud, rare, audited one.
So break-glass exists, modelled exactly on how the sibling guides treat `Any`:
**permitted, narrow, named, temporary, and loud.** A separate, alarmed,
audit-logged credential path that screams when used and carries a hard expectation
that you reconcile state back through Git immediately afterward, the infra version
of "the `Any` must disappear within a few lines." Drift detection (below) is what
enforces that reconciliation actually happens.

---

## Environments

### Instances of One Module, Differing Only in Validated Inputs

The reason staging exists is to be a faithful rehearsal of prod. The moment they
diverge in *shape*, staging stops being a test. Parity is therefore guaranteed
**by construction**: every environment consumes the identical module and its
identical `variables.tf`, so the only thing that *can* differ between environments
is the value of a declared, validated variable. If a difference is not exposed as a
variable, it cannot exist.

```hcl
# modules/compute/variables.tf - the typed boundary (Pydantic/Zod analogue)
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

When you find yourself reaching for many env-conditionals inside a module, treat
that as a **partitioning signal, not a coding problem**: the divergent piece wants
to become its own thematic component-state or its own module. Divergence is
promoted *into the structure*, never dropped as a loose per-environment override.

### Promotion by Version Pin

Shared modules are referenced by pinned version per environment, using a Git tag, which
needs zero extra infrastructure and works identically across every cloud. The pin
**is** the promotion artifact: promoting a change to prod is a one-line diff
bumping prod's `ref`, which is reviewable, greppable, and revertable. "What is
different between staging and prod right now?" is a `diff` of two `ref` lines.

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

> A brand-new single-environment project may reference modules by local path. With only one environment there is nothing to promote *to*, so the pin buys
> nothing yet. The instant a second environment appears, path references are
> forbidden and every module reference must be a pinned tag. *No module is shared
> across environments until it is versioned.*

### The Promotion Mechanism

A two-speed pipeline, dividing labour exactly where the sibling guides do, automating the rote and reserving humans for the irreducible judgment call:

- **Staging promotes automatically.** A merge to `main` bumps staging's pin, and the
  pipeline applies. Fast inner loop; staging is meant to absorb breakage.
- **Prod promotes by deliberate version-bump PR.** A human authors a one-line diff
  bumping prod's `ref`, reviewed against a single question (*is staging healthy
  enough to promote?*), then merged and applied by the pipeline. Every prod change thus
  has a named author, a one-line diff, a timestamp, and a one-line revert.
  *Graduates* to gated automation (auto-promote after a defined bake window plus
  smoke tests, human veto retained) once you have enough staging signal to make
  "healthy" a measurable bar rather than a vibe.

### Rollback Is a Roll-Forward

When prod breaks after a promotion, recovery is a normal promotion PR that bumps
the `ref` back to the previous known-good tag, on **the same path, the same review, no
privileged fast lane.** A rollback is a roll-*forward* to a known-good version. A
"fast rollback that skips review" is how a small outage becomes corrupted state.

---

## Policy

Policy-as-code is the boundary-validation layer of infrastructure, the Pydantic/Zod
of the stack, and it is a **hard, blocking, merge-gating check from day one**, run
identically in pre-commit and in CI (the same shift-left parity the sibling guides
apply to type-checking). What graduates over time is the *number* of rules behind
the gate, not whether the gate exists.

Policy is **OpenTofu-native by default**, and it lives in the shared modules so it
**travels with them**: every environment that pins a module inherits its policy for
free. A module's policy therefore ships wherever the module ships, with no separate wiring.

- **`variable` validation** guards *inputs* at the door (region allow-lists, valid
  environment names, sane sizes).
- **`check` blocks** assert *planned and actual* state (no public buckets, mandatory
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

Day-one rules are the cheap, universal, non-negotiable ones: mandatory tagging,
region allow-lists, no unannotated `0.0.0.0/0` exposure. Cost thresholds and
resource-type allow-lists graduate in as the project earns them.

> **Graduation rung:** a centralised external engine (OPA/Conftest) is reached only
> when you can no longer trust that every repo author wrote the checks, i.e. when
> policy must be enforced *on* authors rather than *by* them. For a solo operator
> who controls every repo and builds everything from blessed modules, native checks
> are airtight and Conftest is unnecessary weight.

---

## Secrets

Secrets are the one qualified exception to "everything in Git," so the discipline
is making the exception **explicit and narrow** rather than letting it leak. The
unifying rule, true across Cloudflare, AWS, and GitHub alike:

> **OpenTofu holds a *reference* to a secret, never the secret itself.** The value
> lives in whichever store is native to the boundary that consumes it.

Secrets are classified by **lifecycle, not by secrecy**. Each class has exactly
one system of record, named by *role* rather than by product so it stays
provider-agnostic:

| Secret class | Lives in | Rationale |
|--------------|----------|-----------|
| **Provisioning** (what OpenTofu needs to build things) | The pipeline's secret store, GitHub Actions environments, scoped per environment | Never in the repo; injected at apply time. |
| **Runtime** (what the deployed app reads) | The target platform's native store, Workers Secrets, AWS Secrets Manager / SSM | OpenTofu *references* it, never contains it, so it never enters state. |
| **Desired-state config** (rare config that genuinely belongs to the model) | SOPS-encrypted in Git | Versioned, reviewed, and drift-checked alongside the resource it configures. |

This is pure-core/effectful-shell applied to secrets: the value is the most
effectful thing in the system, so it lives at the edge that uses it, and the
desired-state config only ever names it. Native state encryption is the backstop
for the unavoidable cases where a value transits state anyway.

### The Root of Trust Is Federated, Not Stored

The pipeline needs exactly one root credential to reach everything else, and that
root is **OIDC federation, not a stored long-lived key**. GitHub Actions assumes an
AWS IAM role and authenticates to Cloudflare via short-lived OIDC tokens, so there
is *no standing secret to store, rotate, or leak*. The bootstrap secret is **zero**,
not "one carefully-guarded key."

```yaml
# .github/workflows/apply-prod.yml (excerpt)
permissions:
  id-token: write          # mint the OIDC token
  contents: read
jobs:
  apply:
    runs-on: ubuntu-latest
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/prod-tofu-apply
          aws-region: ap-southeast-2
          # no access keys - the role is assumed via the OIDC token
```

---

## Drift

Drift is the infrastructure type error: live reality no longer matches declared
desired-state. Someone clicked in a console; a break-glass apply was not reconciled;
a provider mutated something underneath you.

**Detection** is a scheduled `tofu plan` on a cadence (nightly, plus the implicit
pre-apply plan every promotion already runs). A clean plan means reality matches
Git; **any non-empty plan against deployed state is drift.**

**Response is alert-and-stop, never auto-correction.** Auto-applying to "heal"
drift would mean the pipeline writes to the world in response to a *timer* rather
than an authored Git event, which reintroduces the exact "infrastructure changes with
no authoring PR" problem the whole guide outlaws, and risking the silent reversion
of a human's in-flight emergency fix. Instead, detected drift is a **loud, blocking
failure**:

- **It blocks promotion, always.** You never stack a new change on top of an
  un-accounted-for divergence.
- **Paging scales with the resource.** Drift in `network` or `storage` pages now;
  a low-stakes `compute` tag drift is a next-business-day ticket. "Loud" must not
  become "cry wolf at 3am over a tag."
- **The fix is itself an authored Git event**: either correct Git to match a
  legitimate reality, or merge a re-apply PR to force reality back. Reality only
  ever changes through Git, including the correction.

Drift detection thus does double duty as the **auditor that enforces break-glass
reconciliation**: an emergency fix shows up as drift, alarms, and forces the
reconciliation the break-glass rule already requires.

---

## The Pipeline

The stages are the sum of every rule above, run identically in pre-commit and CI:

```
fmt -> validate -> lint -> policy (validate + check + test) -> plan -> [gate] -> apply
```

### The Plan Is the Lock File of an Apply

CI saves the plan as an artifact, and **`apply` consumes that exact artifact**,
never a fresh plan at apply time. The thing a human reviewed and approved in the
gate *is* the thing that hits the world, byte for byte. A re-plan between approval
and apply could silently differ if provider state changed underneath. You apply
what was reviewed, or you do not apply.

```yaml
# plan.yml
- run: tofu plan -out=tfplan
- uses: actions/upload-artifact@v4
  with: { name: tfplan, path: tfplan }

# apply-*.yml
- uses: actions/download-artifact@v4
  with: { name: tfplan }
- run: tofu apply tfplan      # the reviewed artifact, not a fresh plan
```

---

## Observability

This guide owns the **infrastructure** boundary and explicitly defers
**application** telemetry to the [Python](./python-style-guide.md) and
[TypeScript](./typescript-style-guide.md) guides. This keeps single responsibility intact; it does
not swallow the other two. It inherits their structured-event stance (dotted,
lowercase, queryable event names; structured fields, never string interpolation)
and names the infra events that must always exist.

"Fail loudly" for infrastructure means **no apply, drift, or policy decision is
ever silent.** Every one of the following is emitted as a structured, queryable,
audit-grade event, paged by the same severity model as drift:

- `tofu.apply.complete` / `tofu.apply.failed`: every apply outcome, with
  environment, component, and plan summary.
- `tofu.drift.detected`: environment, component, and the diff.
- `policy.check.blocked`: which rule, which resource.
- `promotion.applied`: author, from-version, to-version, environment.

---

## Naming & Tagging

- **Resource names** are descriptive and consistent: `{project}-{env}-{component}-{purpose}`.
  Boolean-ish feature flags follow the sibling guides (`enable_`, `is_`).
- **Mandatory tags on every resource**, enforced by the day-one policy gate:
  `owner`, `environment`, `cost-centre`, `managed-by` (always `opentofu`). Untagged
  resources do not merge.
- **State keys** mirror the directory tree: `{component}/terraform.tfstate` under a
  per-environment bucket. The path tells you the environment and the component
  unambiguously.

---

## Testing

Testing infrastructure means asserting on plans and on module behaviour, not on a
running cloud:

- **`tofu test`** exercises modules against fixture inputs, asserting on planned
  output; pure, fast, and the highest-value layer because it encodes the rules.
- **Policy tests** assert that bad inputs are *rejected*; the `ValidationError`
  path matters as much as the happy path, exactly as in the application guides.
- **Plan tests** assert that a known change produces the expected diff and *no
  unexpected* resource replacement.
- **Never test against real shared state.** Use a local backend and provider
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

## Design Principles

### 1. Enforced Declarative Desired-State, No Exceptions

Declare what the world should be; never script the steps to get there. HCL gives no
imperative escape hatch, which makes "declarative" a property the tool guarantees
rather than a rule you police. It is the `strict: true` of infrastructure.

### 2. Remote State Has Exactly One Writer, and It Is Never a Human

The pipeline alone writes remote state, enforced by credential placement: only CI
holds state-write credentials, so a laptop physically cannot touch a real
environment.

### 3. No Project Is Real Until It Has a Pipeline

The moment state goes remote, on day one, a pipeline must exist to write it. Going
remote and having a pipeline are the same gesture, shipped together in project
scaffolding.

### 4. Break-Glass Is Loud, Narrow, and Reconciled Away at Once

The emergency valve exists so the rule is never bypassed in silence. It alarms,
it is audited, and it carries a hard expectation of immediate reconciliation
through Git, the `Any` that must disappear within a few lines.

### 5. Environments Are Instances of One Module

Prod and staging are the same module with different validated inputs. If a
difference is not a declared variable, it cannot exist. Genuine divergence is a
partitioning signal, promoted into the structure rather than dropped as a local
override.

### 6. Promotion Is a Version Bump in Git, Never a Merge Side-Effect

Modules are pinned per environment. A change reaches prod through a deliberate,
authored, one-line `ref` bump that is reviewable, greppable, and revertable, not because a
merge silently took effect everywhere.

### 7. Promotion Is an Event With an Author

Staging promotes automatically; prod promotes by human-authored PR against the
single question "is staging healthy?" Every prod change has a name, a diff, a
timestamp, and a one-line revert.

### 8. Rollback Is a Roll-Forward, No Privileged Fast Lane

Recovery is a normal promotion PR to a known-good version: same path, same review.
A review-skipping fast rollback turns an outage into corrupted state.

### 9. Policy Travels With Modules

Boundary validation lives in the shared modules and is inherited by every
environment that pins them. Native checks by default, a central engine only when
authors can no longer be trusted to carry it. A module carries its own policy with it.

### 10. No Resource Exists Outside a Blessed Module

The module is the unit of policy, parity, and promotion. A resource outside a
module sits outside all three guarantees, so it is itself a violation.

### 11. Drift Is a Loud, Blocking Failure, Never an Auto-Correction

Reality diverging from Git stops promotions and pages by severity. The fix is
always an authored Git event. Drift detection is also the auditor that enforces
break-glass reconciliation.

### 12. OpenTofu Holds References to Secrets, Never Secrets

Each secret lives in the store native to its boundary: pipeline, runtime, or
encrypted-in-Git for desired-state config. The only root of trust is short-lived
and federated; there are no long-lived credentials to store or rotate.

### 13. The Plan Is the Lock File of an Apply

CI saves the plan; apply consumes that exact artifact. You apply what was reviewed,
byte for byte, or you do not apply.

---

## References

**Important:** Before setting up infrastructure standards, tooling, or writing
any HCL, read through the documentation linked below. Each link uses the
`defuddle.md` prefix which returns clean, agent-readable markdown. Read the full
documentation — not just the getting-started pages — to understand the conventions,
APIs, and patterns available in each tool.

- [OpenTofu documentation](https://defuddle.md/opentofu.org/docs/)
- [OpenTofu state & plan encryption](https://defuddle.md/opentofu.org/docs/language/state/encryption/)
- [OpenTofu `check` blocks](https://defuddle.md/opentofu.org/docs/language/checks/)
- [OpenTofu tests (`tofu test`)](https://defuddle.md/opentofu.org/docs/cli/commands/test/)
- [OpenTofu module sources & version pinning](https://defuddle.md/opentofu.org/docs/language/modules/sources/)
- [HCL — the configuration language](https://defuddle.md/developer.hashicorp.com/terraform/language)
- [GitHub Actions — OpenID Connect](https://defuddle.md/docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- [GitHub Actions — OIDC with AWS](https://defuddle.md/docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [GitHub Actions — environments & secrets](https://defuddle.md/docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)
- [Cloudflare Terraform/OpenTofu provider](https://defuddle.md/developers.cloudflare.com/terraform/)
- [AWS provider](https://defuddle.md/registry.terraform.io/providers/hashicorp/aws/latest/docs)
- [tflint](https://defuddle.md/github.com/terraform-linters/tflint)
- [Open Policy Agent](https://defuddle.md/www.openpolicyagent.org/docs/latest/)
- [Conftest](https://defuddle.md/www.conftest.dev/)
- [SOPS](https://defuddle.md/getsops.io/docs/)
- [OpenGitOps principles (CNCF)](https://defuddle.md/opengitops.dev/)
