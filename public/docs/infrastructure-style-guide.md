# Infrastructure style guide

This guide explains how we manage services through Git. The same ideas apply to
DNS, source repositories, application releases, and other managed resources.
Read the [authoring guide](./infrastructure-authoring-guide.md) when building or
changing an implementation.

---

## Start with the change

A person should be able to answer four questions without tracing scripts:

- What do we want the service to look like?
- What needs to change?
- What happened when we tried?
- What needs attention now?

Git records the configuration we want. The service shows what exists. OpenTofu
compares the two and performs changes through its providers. Its state file
connects configuration addresses to service objects. State helps manage those
objects, but does not prove that the service still matches Git.

Use OpenTofu, GitHub Actions, and remote state as the default tools. Keep an
existing working backend, such as R2. Add a tool when it removes enough recurring
work to justify maintaining it.

## Three operations

Use these names in workflows, pull requests, instructions, and results.

| Operation | Purpose                                    | Behaviour                                                               |
| --------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| Plan      | Understand a proposed Git revision.        | Read the service and show the proposed changes.                         |
| Apply     | Bring the service into agreement with Git. | Make a fresh plan, check permission, perform it, and verify the result. |
| Drift     | Find differences from main.                | Compare and report differences, including unmanaged resources.          |

Plan and Drift leave the managed service unchanged. Apply is the normal path
for changing it. A plan inside Apply is part of that operation.

```text
Pull request -> Plan -> review -> merge
                                  |
                                  v
                        Apply: fresh plan -> changes -> verification

main + live service -> Drift -> report
                                 |
                 correct Git -> Apply
                   wrong Git -> pull request
```

We deliberately keep Drift read-only and repair differences through Apply.
[OpenGitOps](https://opengitops.dev/) also calls for continuous attempts to apply
the desired state. Our operating model makes that repair a deliberate choice.

## Targets give changes a home

A Target is a named group of resources that we operate on together. Each Target
has one directory, one OpenTofu root, and one state. Its name stays the same in
configuration, Plan, Apply, and Drift results.

For example, a DNS Target might hold a zone's records. A repositories Target
might hold a GitHub repository fleet. A Worker and its dedicated storage might
share a Target when we normally operate on them together.

Create another Target when resources need independent operation. A difference
in resource type alone does not require a separate Target. Add environment
names only when there are separate environments to manage.

Targets are independent by default. Record a dependency when one Target needs
another Target's change to succeed first. Show that relationship in Plan. If
creating a database fails, explain why the Worker cannot proceed.

## Six operations within a plan

These verbs describe changes to managed objects. Always name the affected
object and explain its relevant before and after values.

| Operation | Meaning                                                          |
| --------- | ---------------------------------------------------------------- |
| Import    | Bring an existing object under management without recreating it. |
| Create    | Create an object that does not exist.                            |
| Update    | Change an existing object's settings in place.                   |
| Move      | Change the OpenTofu address used to track an existing object.    |
| Replace   | Replace an existing object with a new object.                    |
| Destroy   | Remove an existing object from the managed service.              |

Import and Update can appear together. Move and Update can also appear together.
Moving a repository's OpenTofu address does not rename the repository in GitHub.
The plan must show both actions when its address and service settings change.

Show the actual effect of Replace, including the order of removal and creation.
Some provider resources describe a version or an ownership record. Replacing
that record does not necessarily destroy the application. Explain that distinction.

OpenTofu also supports giving up ownership while retaining the service object.
That action falls outside the six operations above. Stop automatic Apply and
require an explicit ownership decision rather than hiding or mislabelling it.
[OpenTofu plan format](https://opentofu.org/docs/internals/json-format/)

## A merge authorises Apply

A pull request proposes configuration and presents a Plan. Review the intended
configuration, the proposed changes, and any permission to destroy or replace.
Merging authorises Apply to bring the affected Targets into agreement with Git.

The pull request Plan is a preview. The service may change before Apply starts.
Apply therefore creates a fresh plan and executes that saved plan in the same
run. The merge authorises the desired configuration, subject to the permission
rules below. Report the revision and the changes that Apply actually used.

Run one Apply at a time for each Target. Let a running Apply finish. Independent
Targets can run concurrently. A newer merge can make queued work unnecessary.
Skip that older work only when the newer run covers its outstanding changes.
Record the older result as superseded and identify the replacement run.

An older run must never overwrite a newer revision. Skipping a run must also
preserve any permission still needed for its changes, or stop for renewed
permission. Skipping intermediate runs does not mean dropping intended changes.

## Permission to destroy or replace

Destroy and Replace need explicit permission for named objects in the change.
A normal merge does not grant permission to destroy every object in a Target.
Stop that Target's Apply if the fresh plan includes an operation without permission.

Permission belongs to a specific change. It can support a retry only when there
is evidence that the permitted operation remains unfinished. Completed work
must not gain another destructive attempt from an old permission record.

For example, replacing a bucket might succeed before another update fails.
A retry must not use the old permission to replace the new bucket again. If the
result is uncertain, stop and obtain renewed permission through a pull request.
There is no additional approval click after merging that request.

## Results must explain what happened

A short Plan summary names each Target, the proposed operations, and any
missing permission. Link to the full plan for attribute details.

Apply succeeds when there is enough evidence that the intended change worked.
Use provider confirmation where it is sufficient. Add a direct check where
necessary, such as confirming the intended application version is running.

Report changes and verification separately when their outcomes differ. A useful
failure says that deployment completed but the health check failed. It identifies
the uncertain result and the next check or repair.

A failed Target blocks changes that need its success. Independent Targets can
continue. A later pull request can fix the cause and attempt Apply again. A
failure does not permanently lock the Target.

## Make every human-facing surface legible

Treat repository paths, workflow names, PR checks, inputs, logs, summaries, and
instructions as one interface. Use the same operation names, Target names, and
outcome words throughout. A person should not need to translate internal script
names into the GitOps model.

Checks prove that the repository is ready. They support Plan, Apply, and Drift
without adding another GitOps operation. Name checks for what they establish,
such as valid configuration or passing helper tests. Explain failures with the
affected file or object, the cause, and the next useful action.

The workflow graph should show selected Targets and real dependencies. Opening
a Target job should reveal planning, permission, changes, and verification as
named steps. Keep those stages visible even when helpers perform the work.

A green PR result must mean all required work completed successfully. Explain
why work did not run. Missing results and failed discovery cannot mean success.
Keep the short answer in checks and summaries, with detailed evidence in linked
plans and logs. Do not require a reader to assemble the outcome from raw output.

## Drift includes the gaps in ownership

Compare the service against a recorded revision of main. Show each Target's
Apply status beside its differences, including waiting and failed runs. A
partly completed Apply still needs comparison against the intended configuration.

Also report resources that no Target owns. Record deliberate exclusions and
why they exist. Discovery reports resources without importing or deleting them.

Say what Drift inspected: service accounts, resource types, and any limits on
access. A failed or incomplete read is an incomplete result. It is never proof
that the account is empty or everything matches Git.

If Git is correct, invoke Apply for the Target against main. If the service
change should remain, edit Git through a pull request. Drift itself makes
neither choice.

## Ownership includes releases and secrets

Each GitOps repository owns the desired configuration for its managed service.
Application repositories own source code and publish versioned builds. The
GitOps repository selects the build to run and the settings that go with it.
Use immutable build references and verify their contents before deployment.

Prefer one owner for an object. When two systems manage different parts, record
exactly which settings each system owns. Each setting has one writer.

Keep secret values in an appropriate secret store. Git records the required
secret names, references, and ownership. A secret update that also deploys an
application belongs in the Apply path or a documented emergency procedure.

Some release work sits outside an OpenTofu resource plan, such as database
migrations. Show the intended steps and their outcomes within the Target's
Plan and Apply results. A list of SQL files does not prove their effects are
safe. Define review, ordering, and recovery for those changes explicitly.

## Recovery and the machinery underneath

Undo configuration changes through a revert pull request. Plan explains what
returning to that configuration requires. Merge uses the normal Apply path.
Restoring lost data requires a separate recovery decision and procedure.

Keep state remote, locked, encrypted, and recoverable. Retain the keys and
backups needed to restore it. Rehearse recovery before relying on those backups.

State storage and deployment identities follow the same operating model for
ongoing changes. Document the small initial setup needed to start the system.
Document emergency access for when the system cannot operate. Record emergency
changes and reconcile them with Git through the normal workflow.

## Keep the implementation small

Use provider features before writing another implementation of them. Keep
custom code for a specific missing capability and test the behaviour it protects.
Recheck workarounds when the provider changes.

Use the existing workflow interface before building a dashboard or mandatory
command-line wrapper. Share code when several places repeat the same behaviour.
Keep service-specific details in their implementation, with a clear reason for
any departure from these operating rules.

The [authoring guide](./infrastructure-authoring-guide.md) turns these rules into
repository structure, execution requirements, and checks for a new implementation.

## References

- [OpenGitOps principles](https://opengitops.dev/)
- [OpenTofu state](https://opentofu.org/docs/language/state/)
- [OpenTofu plan format](https://opentofu.org/docs/internals/json-format/)
