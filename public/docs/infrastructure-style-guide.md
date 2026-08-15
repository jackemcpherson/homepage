# Infrastructure Style Guide

Design principles and default architecture for infrastructure, deployment
pipelines, and GitOps. Git is the system of record. Declare every resource in
Git and let the pipeline reconcile the live estate. The
[authoring guide](./infrastructure-authoring-guide.md) defines the HCL and
workflow syntax beneath these decisions. The [Python](./python-style-guide.md)
and [TypeScript](./typescript-style-guide.md) guides share the same preference
for fast, single-purpose tools.

---

## Scope

This guide serves a solo operator. Every selected pattern must extend to a
small team without restructure. The guide selects OpenTofu, GitHub Actions,
and object-storage state. Its principles transfer to other tools, but the
defaults target one operator with a small number of projects.

## The Retrofit Rule

The retrofit rule is the primary design principle. Test every requirement
against the cost of a later retrofit:

- Keep a requirement in the default when a later retrofit is expensive.
  State layout, repository layout, naming, and credential architecture are
  expensive retrofits.
- Defer a requirement when a team can add it later without restructure.
  Review requirements, apply permissions, and alert rules are cheap
  additions.

The [growth table](#growth-moves) records each deferred requirement and its
trigger. The [do not build list](#the-do-not-build-list) names the apparatus
that a default project must not carry.

---

## Tech Stack

| Tool               | Role                          | Why                                                        |
| ------------------ | ----------------------------- | ---------------------------------------------------------- |
| **OpenTofu**       | Infrastructure-as-code engine | One declarative tool for each provider. Open governance.   |
| **HCL**            | Configuration language        | Declarative configuration without imperative operations.   |
| **GitHub Actions** | Deployment pipeline           | The pipeline applies each infrastructure change.           |
| **Object storage** | State backend                 | Remote and locked R2, S3, or GCS storage.                  |

### OpenTofu Selection

OpenTofu and Terraform use HCL and the same provider protocol. OpenTofu can
read Terraform state. The Linux Foundation governs the MPL-licensed OpenTofu
project. Terraform uses the Business Source Licence. Use OpenTofu for new
work. Use Terraform only when a HashiCorp-specific product requires it.

---

## Repositories

Projects sit at the top of every hierarchy. Environments sit inside each
project. Each application repository carries its own infrastructure in an
`infra` directory. An application change and its infrastructure change then
travel in one pull request.

One shared foundation repository holds the account-level resources: the state
storage, the deploy identities (OIDC roles or scoped API tokens), and the DNS
zones. The foundation repository has no pipeline. Apply foundation changes by
hand from a workstation. The foundation README records the procedure.

Each environment directory holds its own backend and credentials, so the
credential boundary stays visible.

A repository must still rebuild its estate in an empty account. The foundation
procedure plus the project module satisfy that requirement. The
[authoring guide](./infrastructure-authoring-guide.md#repository-layout)
shows the directory tree.

---

## State

Each environment has one state file. The state is remote and locked. Never
commit state to Git. Rely on the bucket's server-side encryption.

The foundation repository creates the state storage before any project
pipeline runs. This order resolves the bootstrap sequence.

Split a state into components only when a trigger in the
[growth table](#growth-moves) is true. When you split, record the migration
path with the `tofu state mv` command, so the deferred cost stays visible.

---

## Modules and Environments

Each repository contains one project module. Environment directories are thin
callers of that module. A thin caller contains a backend block, a module call
with a local path, and a `.tfvars` file.

Resources live in the project module. Extract a sub-module only when a second
project shares the pattern. Do not create a separate module repository, and do
not reference modules by Git tag in the default. A later move to tags changes
one source string.

Keep the parity principle: environments run the same code and differ only in
validated inputs.

### Environments and Promotion

The default project has one environment. The pull request plan reviews the
infrastructure change. Platform preview deployments review the application
change. A staging environment is a growth move.

When a project adds staging, apply these rules:

- Staging tracks the main branch and applies on each merge.
- Production promotes through a manually triggered workflow.
- The promote workflow plans production and prints the plan summary on the
  run page.
- An environment approval sits between the production plan and the apply.
  The click then approves a plan that the operator has read.
- The operator approves alone today. A team adds required reviewers and
  self-review prevention later.

Do not attach a production gate to every merge. Parked approval runs create
noise and expire as failures.

---

## The Pipeline

The default repository has three workflows. The
[authoring guide](./infrastructure-authoring-guide.md#the-three-workflows)
contains the complete files.

| Workflow     | Trigger            | Behaviour                                                                             |
| ------------ | ------------------ | ------------------------------------------------------------------------------------- |
| `ci.yml`     | Each pull request  | Run the application checks and the infrastructure checks. Post the plan as a comment. |
| `deploy.yml` | Each merge to main | Plan and apply the infrastructure, then deploy the application.                       |
| `drift.yml`  | A weekly schedule  | Plan each environment. A non-empty plan fails the run.                                |

Apply these pipeline rules:

- The pull request plan is a preview. The pipeline plans again after the
  merge and applies the fresh plan. Do not carry a plan artefact between
  workflows. Artefacts do not cross workflows, and a pull request plan goes
  stale.
- Where a promotion gate exists, the plan and the gated apply share one run.
- A concurrency group serialises applies. An apply job never cancels.
- Set a timeout on every job. Pin the runner image to a release name.
- Path filters select the jobs that each change runs.
- A rollback is a revert pull request through the same path.
- The operator can apply from a workstation. Keep the pipeline as the
  default path.
  A team later revokes workstation credentials without restructure.

A failed `drift.yml` run and the notification email are the complete drift
response. Reconcile the drift through a pull request before the next apply.

---

## Secrets

Do not store secret values in Git. OpenTofu stores a secret reference, not the
secret value. Store each value in the system that consumes it:

| Secret class                                  | Lives in                                          |
| --------------------------------------------- | ------------------------------------------------- |
| Pipeline credentials (what the pipeline uses) | GitHub environments, scoped per environment       |
| Runtime secrets (what the deployed app reads) | The platform's native store, set outside OpenTofu |

The default model holds no desired-state secrets, so no encryption tooling
guards the repository.

---

## Security Floor

The floor contains the controls below. Each control is one-time setup, a few
lines of configuration, or a habit. The
[authoring guide](./infrastructure-authoring-guide.md#part-2-github-actions-yaml)
shows each implementation.

| Control         | Form                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Pipeline auth   | Use OIDC where the provider supports it. Use a scoped rotated token elsewhere.                                       |
| Permissions     | Set `permissions: {}` at the workflow level. Grant each job its own scopes.                                          |
| Untrusted input | Bind event values to environment variables. Never interpolate them into run scripts.                                 |
| State           | Keep state remote and locked. Rely on the bucket's server-side encryption.                                           |
| Secrets         | Store references only. Pipeline credentials live in GitHub environments. Runtime secrets live in the platform store. |
| Variables       | Give every variable a type, a description, and validation where rules exist.                                         |
| Dependencies    | Commit the provider lock file. Let Dependabot update action versions weekly.                                         |

---

## Accepted Risks

Each decision below accepts a named risk. Build the mitigation, not the
removed control.

### Version Tags Instead of Commit Pins

A moved action tag can run code that nobody has audited. Reference actions by
version tag anyway. Do not pin commit SHAs in the default.

Mitigation: OIDC removes long-lived keys where the provider supports it.
Elsewhere, scoped rotated tokens limit a hijacked run to one project.
Dependabot keeps versions current.

### A Merge Applies Without a Later Human Step

A merge applies to production with no later human step. The pull request plan
is the only review.

Mitigation: the revert path restores the prior state through the same
pipeline.

---

## Growth Moves

Add an item only when its trigger is true.

| Addition                                            | Trigger                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| Staging environment and promote workflow            | The project has real users or performs risky data migrations.        |
| Component state split                               | Plans run slowly, blast radius needs separation, or applies collide. |
| SHA pins for actions                                | A credential's blast radius grows beyond one personal project.       |
| Module repository with version tags                 | A second repository consumes the module.                             |
| Required reviewers and self-review prevention       | A second person joins.                                               |
| Workstation credential removal                      | A second person joins.                                               |
| Tag enforcement checks                              | An organisation needs cost attribution.                              |
| Client-side state encryption                        | State must hold a secret value.                                      |
| A workflow linter                                   | The workflow count or the contributor count grows.                   |
| Version-lagged releases through a production branch | The team needs production to trail staging.                          |

---

## The Do Not Build List

Build no item below unless its growth trigger is true:

- A staging environment or any promotion gate.
- A component state split.
- OPA, Conftest, SOPS, or a workflow linter.
- Break-glass procedures.
- A reusable workflow or a composite action.
- A separate module repository or version-pinned promotion.
- Client-side state encryption.
- Tag enforcement checks.
- SHA pins for actions.

---

## References

Consult a reference when a question exists. The `defuddle.md` prefix returns
Markdown.

- [OpenTofu documentation](https://defuddle.md/opentofu.org/docs/)
- [OpenTofu state locking](https://defuddle.md/opentofu.org/docs/language/state/locking/)
- [OpenTofu module sources](https://defuddle.md/opentofu.org/docs/language/modules/sources/)
- [Cloudflare Terraform/OpenTofu provider](https://defuddle.md/developers.cloudflare.com/terraform/)
- [GitHub Actions: OpenID Connect](https://defuddle.md/docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- [GitHub Actions: environments & secrets](https://defuddle.md/docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)
- [OpenGitOps principles (CNCF)](https://defuddle.md/opengitops.dev/)
