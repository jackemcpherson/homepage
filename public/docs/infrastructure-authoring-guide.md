# Infrastructure authoring guide

Use this guide to build a GitOps repository with OpenTofu and GitHub Actions.
Read the [style guide](./infrastructure-style-guide.md) first for the operating
rules. This document defines the implementation requirements beneath those rules.

---

## Establish the management boundary

Before writing resources, inspect the provider and the service's own tools.
Verify the behaviour of the provider version the repository will use.

Record the following in the repository README or a linked inventory:

- The service accounts and resource types this repository manages.
- Each Target's resources and any dependencies on another Target.
- The settings another system owns and the reason for that split.
- Deliberate exclusions from management and discovery limits.
- The credentials each operation needs, without recording their values.
- The evidence that confirms a successful change and the recovery procedure.

Check provider behaviour with concrete cases: importing an object, changing a
setting, replacing a resource, and observing an external change. A resource
schema alone does not prove that the provider detects the change we care about.

## Use a small repository structure

```text
service-infra/
  targets/
    <target>/
      main.tf
      backend.tf
      versions.tf
      .terraform.lock.hcl
  .github/workflows/
    plan.yml
    apply.yml
    drift.yml
  README.md
```

This tree is the starting structure. Add `variables.tf`, `outputs.tf`, local modules,
helpers, tests, or release files when they have content that belongs there.
Avoid empty files and mandatory modules that only pass through their inputs.

The directories under `targets/` are the Target registry. Use lowercase names
with hyphens. Discover the directories rather than maintaining another complete
list. Store only additional information, such as dependencies, outside that list.

Configure providers in the root. Child modules declare their provider
requirements and accept configuration from the caller. Give variables explicit
types and descriptions. Validate actual constraints and define what null means.
Expose outputs only when another part of the system uses them.

Use `snake_case` for HCL names. Use stable keys with `for_each` for collections.
Keep provider object identifiers separate from the Target's name. Commit import
and moved blocks for adoption and address changes. Preserve the required
refactoring history until every affected state has used it.
[Import](https://opentofu.org/docs/language/import/),
[refactoring](https://opentofu.org/docs/language/modules/develop/refactoring/)

Give each root a unique backend key. Keep existing keys during directory
cleanups unless the change includes an explicit state migration. Removing a
Target directory must not silently abandon its state or service resources.
Verify an empty state or complete an explicit ownership transfer first.

Use references for dependencies within a root. Use `depends_on` for a real hidden
dependency. Run the whole Target root. Reserve OpenTofu's `-target` option for
exceptional recovery. [Resource dependencies](https://opentofu.org/docs/language/resources/behavior/#resource-dependencies),
[planning options](https://opentofu.org/docs/cli/commands/plan/)

## Keep three visible workflows

Use the workflow names Plan, Apply, and Drift, with these entry points:

| File        | Trigger                          | Required behaviour                                                    |
| ----------- | -------------------------------- | --------------------------------------------------------------------- |
| `plan.yml`  | Pull request                     | Validate and show proposed changes for affected Targets.              |
| `apply.yml` | Merge to main or manual dispatch | Reconcile affected Targets, or the explicitly selected repair Target. |
| `drift.yml` | Schedule or manual dispatch      | Inspect declared Targets and the documented discovery scope.          |

Repository checks support these operations. Start with a `Check repository` job
inside Plan. A separate Checks workflow needs an independent trigger or a clear
benefit to the PR interface. Do not repeat the same checks in both places.

Use this default job graph:

```text
Plan
  Check repository ------------------------> Plan result
  Select Targets -> Plan / <target> --------> Plan result

Apply
  Select Targets -> Apply / <target>

Drift
  Select Targets -> Drift / <target>
  Discover unmanaged resources
```

Each `<target>` expands into independent jobs. Discovery covers its declared
service scope and may run inside a Target job when that scope matches.
Add dependency edges only when work actually needs another job's result.
A job earns its place through independent execution, credentials, dependencies,
or a required result. Keep ordinary command sequencing in steps.
[Workflow graph](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph)

Name every workflow, job, and substantive step explicitly. Use these patterns:

| Surface               | Pattern or example                                                       |
| --------------------- | ------------------------------------------------------------------------ |
| Run title             | `Plan PR #42`, `Apply merged changes`, `Apply dns`, `Drift all Targets`  |
| Target job            | `Plan / dns`, `Apply / dns`, `Drift / dns`                               |
| Repository check step | `Check formatting`, `Validate workflows`, `Test helpers`                 |
| Operator input        | `Target`, described as a Target name or the supported all-Targets choice |
| Result                | Operation, Target, actual revision, outcome, reason, details link        |

Keep required check names stable and unique across workflows. Keep changing
identifiers in run titles and results. GitHub's `run-name` accepts `github` and
`inputs` contexts, so discovered Targets belong in job names and summaries.
An Apply title must not imply that its trigger revision is the attempted revision.
[Workflow names](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#run-name)

Avoid generic names such as `CI`, `Run`, or `Execute pipeline`. Use tool names
inside steps and logs when they help diagnosis. Keep the same Target spelling
in directories, inputs, job names, PR results, and repair instructions.

### Explain Target selection

Select Targets conservatively. A Target-local edit selects that Target.
A shared module or execution change selects its consumers, or all Targets
until narrower selection earns its complexity. Include rename and deletion
information from Git. Cover outstanding changes from superseded runs.

Select once for routing and report each selected Target with its reason.
Distinguish a successful empty selection from a selection failure. Preserve
the revision checks inside Apply after a Target acquires its execution slot.

Plan and Drift should also support inspecting the whole repository. Validate
manual Target input against the discovered directories. Keep the state key,
provider addresses, and shell fragments out of operator input.

Use descriptive, typed dispatch inputs with safe defaults. Explain their scope
and where results appear. GitHub's branch selector does not grant permission to
deploy another branch. Enforce Apply against main in the workflow.

### Expose the execution steps

Use these visible stages within each Target job. Setup can contain several
named steps when failures need different remedies.

| Operation | Ordered stages after checkout and setup                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Plan      | Validate configuration, create preview plan, check permission, report result.                                                          |
| Apply     | Check revision and prerequisites, prepare inputs, create saved plan, check permission, apply saved plan, verify result, report result. |
| Drift     | Record revision, compare with main, report result.                                                                                     |

Show the six plan verbs in the plan summary. Give migrations, release activation,
and ownership discovery their own named steps at their actual execution point.
Do not hide permission, mutation, or verification inside one generic command.

Keep triggers, selection, dependencies, permissions, concurrency, and step order
visible in workflow YAML. Helpers may parse plans or call service APIs.
They must not become another scheduler or secretly choose the operation.

Start with direct jobs. Extract a reusable workflow when substantial repetition
justifies it, with one direct call from the operation workflow. Deeper reuse
needs a documented reason. Prefer short repeated setup over a trivial wrapper.

Composite actions may share setup, but must not hide the operation's stages.
GitHub exposes reusable workflow jobs and steps separately in logs. A composite
appears as one caller step.
[Workflow reuse](https://docs.github.com/en/actions/concepts/workflows-and-actions/reusing-workflow-configurations)

Keep Plan, Apply, and Drift execution paths explicit. Avoid a shared executor
whose command input switches most steps on or off. Do not chain workflows using
events merely to continue the same operation. An external event or trust boundary
can justify a separate workflow, with its reason recorded beside the trigger.

### Make CI checks prove readiness

Group checks that share setup and failure handling into named steps within
`Check repository`. Separate jobs when checks need independent status, execution,
or credentials. Do not create one job per tool by default.

Use the repository's configured formatting, validation, lint, and test commands.
Validate workflow files with a workflow-aware checker, such as `actionlint`.
Keep Target-specific validation in its Plan job. Run credential-free checks
without service credentials. Document the same commands for local use.
[Workflow validation](https://github.com/rhysd/actionlint)

Make `Plan result` the stable required PR check when Target selection varies.
It must depend on repository checks, selection, and all Plan execution jobs.
Use a bounded, non-mutating job with `if: ${{ always() }}` to inspect their results.
Reject failed, cancelled, missing, or unexpectedly skipped work. Accept no Targets
only after successful selection explains why none need a Plan.

Run the required workflow for every PR targeting the protected branch. Select
work inside the run. Whole-workflow path filters can leave required checks
pending. Skipped jobs can count as successful, and failed dependencies can skip
a dependent result job.
If using merge queues, also handle `merge_group` for required checks.
[Required checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)

The final check should name the failed check or Target and link to its details.
Do not rerun tools or invent another verdict system in that job. For a fixed,
small set of unconditional jobs, requiring those checks directly can avoid
the extra gate. Add aggregate Apply or Drift jobs only when combined results
serve a clear need.

Preserve command failures. Do not use `continue-on-error` or `|| true` to make
required work green. Handle expected nonzero results explicitly, including
OpenTofu's detailed plan exit codes. Keep mutation steps conditional on success.
For ordinary reporting after failure, use `if: ${{ !cancelled() }}`. Reserve
`always()` for bounded result handling, not setup or service changes.
[Status expressions](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#status-check-functions)

Use the repository's dependency updater to maintain exact tool versions and
provider lock files. Pin third-party actions to full commit identifiers and
pin the runner image to a release name. Set a timeout for every job.

## Implement Apply as one controlled sequence

Acquire the Target's execution slot before planning or changing the service.
Use the same slot for merge-triggered Apply, manual repair, migrations, and
other release steps. Keep the backend lock as protection against other clients.

A per-Target matrix job can use this concurrency setting:

```yaml
concurrency:
  group: apply-${{ matrix.target }}
  cancel-in-progress: false
  queue: max
```

GitHub's queue orders arrival at the concurrency group, not Git merges. Its
capacity is finite. Concurrency settings alone do not prevent stale deployment.
[GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)

Implement this sequence:

1. Fetch current main after acquiring the slot and record that immutable revision.
2. Ensure the run cannot overwrite a newer revision. Skip superseded work only
   when its replacement covers the outstanding changes and permissions.
3. Check Target prerequisites and prepare the pinned inputs.
4. Create a fresh saved plan and produce its human summary.
5. Check every planned operation against the change's permission.
6. Perform the saved plan and any declared release steps in their required order.
7. Verify the result and record what changed, what failed, and what remains.

Use configuration, release inputs, and permission decisions from the recorded
revision. Execute through trusted workflow code. If a newer main revision arrives
after the checks, let this Apply finish and leave the newer work pending.

Store the actual attempted revision and result for each Target using existing
workflow records where sufficient. Guard old reruns as well as new workflow
starts. A failed newer attempt can leave partial changes that an older run
must not overwrite. An intentional revert arrives through a new pull request.

Create and consume the saved plan within the same job. A typical command pair
is `tofu plan -out=plan.bin` followed by `tofu apply plan.bin`. Put the permission
check between them. Use non-interactive execution and a bounded lock wait.
Keep the pull request's preview separate from the executable Apply plan.
[Saved-plan Apply](https://opentofu.org/docs/cli/commands/apply/)

Prefer native resource ordering. For a few cross-Target dependencies, explicit
workflow jobs and `needs` are sufficient. Check prerequisites even when the
upstream Target has no change in this run. Detect dependency cycles before
any write. Use `strategy.fail-fast: false` for independent matrix jobs, preserving
failed job status. `continue-on-error` would hide the failure.

## Check destructive permission

Define one machine-readable permission format for the repository. Each entry
identifies a Target, an exact object address, Destroy or Replace, and an
immutable change identity. Show that permission during pull request review.
A mutable label or permanent permission list cannot establish that authority.

Read permission from the reviewed change and compare it with the fresh plan.
An earlier merged change may still have unfinished work after a newer run takes
over.
Carry its permission only when its origin and unfinished operation are clear.
Otherwise require renewed permission through a pull request.

A retry needs evidence that the permitted operation has not already completed.
If a timeout, crash, or partial failure makes completion uncertain, stop.
Require renewed permission instead of constructing an automatic recovery guess.
Manual Drift repair must not inherit completed grants from old files.

Keep permission separate from force-replacement input. The `-replace` option asks
OpenTofu to replace an object. An allowance merely permits a replacement that
the fresh plan proposes. `prevent_destroy` can protect selected resources, but
removing the resource block removes that protection.
[Planning options](https://opentofu.org/docs/cli/commands/plan/),
[resource lifecycle](https://opentofu.org/docs/language/resources/behavior/)

Test the gate with small fixtures covering denied deletion, allowed replacement,
completed replacement followed by another failure, stale retries, and newer runs
taking over.
Reject unsupported destructive actions before any release step writes to the service.

## Present the same results everywhere

Use OpenTofu's JSON plan for classification. Inspect import and move metadata
before skipping a no-op action. [Plan JSON](https://opentofu.org/docs/internals/json-format/)

| Display | JSON evidence                                                             |
| ------- | ------------------------------------------------------------------------- |
| Import  | `change.importing` is present.                                            |
| Create  | `change.actions` is `["create"]`.                                         |
| Update  | `change.actions` is `["update"]`.                                         |
| Move    | `previous_address` is present.                                            |
| Replace | `change.actions` contains both `create` and `delete`, in execution order. |
| Destroy | `change.actions` is `["delete"]`.                                         |

Retain combined operations, old and new addresses, unknown values, and actual
replacement effects. A read or unchanged attribute needs no extra plan verb.
Reject unsupported format versions. Stop on `forget` or another unsupported
ownership change rather than treating it as a clean or destructive plan.

Every result must identify the operation, Target, Git revision, outcome, reason,
and link to details. Use consistent outcome words:

| Operation | Outcomes                                                 |
| --------- | -------------------------------------------------------- |
| Plan      | Ready, Blocked, Failed                                   |
| Apply     | Pending, Running, Succeeded, Failed, Blocked, Superseded |
| Drift     | Clean, Different, Incomplete                             |

Use Blocked when a prerequisite or permission prevents execution. Use Failed
when an attempted operation or its verification fails. A superseded result
identifies the run that takes responsibility for its outstanding work.

Use GitHub job summaries and pull request checks as the default interface.
The PR check gives the verdict and links to details. The run summary explains
selection and Target outcomes. Logs supply detailed evidence. Start with these
native surfaces. Add a PR comment only when it closes a demonstrated reading gap.

Write one concise summary per Target. Include discovery coverage in Drift.
Explain blocked dependencies and missing results at run level when the Target
job could not report. A skipped job alone does not explain why work stopped.
Do not assume that summaries appear in Target order or that a summary upload
failure fails the job. Preserve the execution verdict independently.

When collecting matrix results, retain a distinct result for each Target.
Do not let jobs overwrite the same output or treat missing results as success.
[Matrix outputs](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#using-job-outputs-in-a-matrix-job)

Use the tools' existing diagnostics. Include a file and line for configuration
errors, or a Target and object for service errors. Add a short next action and
local reproduction command where applicable. For example:

```text
Check formatting failed: targets/dns/main.tf
Run tofu fmt targets/dns, commit the result, and update the PR.

Apply / dns: Blocked
Destroy cloudflare_dns_record.legacy lacks permission in this change.
Add permission for this object through a PR, or correct the configuration.
```

Use native file annotations when available. An error annotation alone does not
fail a job. Keep the command's failing exit status. Group lengthy logs by their
named step and keep the cause visible without expanding unrelated output.
[Annotations and log groups](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands)

Keep full human-readable plans and relevant logs accessible. Raw JSON can
contain sensitive values. Limit it and executable plans to trusted processing
and deliberate retention. [Job summaries](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#adding-a-job-summary),
[plan output](https://opentofu.org/docs/cli/commands/show/)

## Implement Drift with honest coverage

Record the main revision and observation time. Run a normal refreshing plan,
not refresh-only, for each selected Target. Handle detailed exit codes explicitly:
0 means no plan differences, 2 means differences, and 1 means failure.
[Plan modes](https://opentofu.org/docs/cli/commands/plan/)

Show Apply status alongside differences. If Apply overlaps observation, report
that uncertainty or repeat the observation after Apply finishes. Preserve
read-only operation and handle state access without stranding a write lock.

List the accounts, resource types, pagination, and permissions covered by
discovery. Compare service object identifiers with managed state and exclusions.
Include configuration awaiting Import when explaining ownership status.
Keep one explicit exclusion list with reasons.

Incomplete access, failed reads, or missing pages produce Incomplete. Retain any
differences already found. A service that hides secret values permits checking
presence or references only. Document that limit.

Fail the Drift job on Different or Incomplete, preserving the result details.
Only Clean passes, after both Target checks and discovery complete successfully.

Choose a schedule and use the existing workflow notification channel first.
Document who receives failures and how they run Apply or propose a correction.

## Add only necessary service-specific steps

Use native provider behaviour when it covers the required change. Keep a small
helper when it covers a verified gap. Record the reason and the condition for
removing it.

For application delivery, select immutable builds and verify their digests.
Keep the deployment settings under the declared owner's control. Check whether
native version uploads include settings that would cross that ownership boundary.

For migrations or other changes outside the OpenTofu plan, show their pinned
inputs, proposed work, ordering, verification, and recovery procedure.
Review destructive data changes explicitly. The infrastructure permission check
cannot infer the effects of arbitrary SQL. Keep mutation and verification
outcomes separate when only part of the release succeeds.

A post-Apply check should prove a specific requirement. Ordinary OpenTofu check
blocks only warn. Use a blocking condition or an explicit failing verification
step when success depends on the result.
[Checks and conditions](https://opentofu.org/docs/language/checks/)

## Protect credentials and recovery

Give Plan and Drift read-only service credentials where supported. Allow only
trusted code to access state or readable plans. Untrusted pull requests can
run credential-free validation, with the missing live Plan clearly visible.
Never execute untrusted pull request code with deployment credentials.

Set workflow `permissions` to `{}` and grant each job the scopes it needs. Use
short-lived identities where supported and scoped credentials otherwise.
Bind event data through environment variables and validate it before use.
Protect workflow code, permission checks, and merge rules together.
[GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use)

Keep state remote, locked, encrypted, and outside Git. Commit backend settings
without credentials. Keep sensitive values out of ordinary output and store
runtime secrets in the service's secret store where practical. When a provider
must retain a secret in state, protect and document that state access.

Document initial setup and emergency access. Rehearse restoring state and
recovering the encryption keys. Verify the backend's actual locking and backup
behaviour instead of assuming compatibility from its name.
[State locking](https://opentofu.org/docs/language/state/locking/),
[state encryption](https://opentofu.org/docs/language/state/encryption/)

## Prove the implementation

Run `tofu fmt -check`, `tofu validate`, and the configured linter. Pin the toolchain
and commit provider lock files. Test meaningful module logic and custom control
flow. Reuse the repository's tools and keep fixtures isolated from shared state.

Review the actual PR checks panel, run graph, expanded Target job, summaries,
manual form, and README instructions. Without opening helper implementations,
a reader must be able to identify:

- The operation, trigger, selected Targets, and selection reasons.
- The purpose of each check and how to reproduce a failure locally.
- The permission check, first mutation, and verification steps.
- The attempted revision, completed work, and remaining or blocked work.
- The failure cause and the next useful action or detail link.

Inspect successful and failing runs, including no selected Targets, denied
permission, blocked dependencies, and missing results. Confirm that selection
failures and unexpected skips cannot produce a green required check.
Workflow syntax validation alone does not prove these behaviours.

Before calling the repository complete, demonstrate these cases:

- A PR shows a Plan and merging applies its configuration.
- Import with Update and Move with Update remain visible.
- Destroy or Replace without permission stops before any mutation.
- An ambiguous destructive retry requires renewed permission.
- Two nearby merges and an old rerun cannot regress a Target's revision.
- A newer run covers earlier changes and preserves or renews needed permission.
- A failed Target leaves independent Targets running and explains blocked ones.
- Drift reports a managed difference, an unmanaged object, and incomplete access.
- Manual Apply repairs drift through the same permission checks.
- A failed verification reports any changes that already occurred.
- Target removal preserves ownership, and recovery restores usable state.

Add release and migration cases only where that repository performs those
operations. Keep the proof commands and expected results in the repository so
another agent can repeat them. Record provider limits as explicit exceptions.

## References

- [OpenTofu language](https://opentofu.org/docs/language/)
- [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use)
