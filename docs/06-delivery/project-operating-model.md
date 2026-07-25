# Project operating model

## Purpose

This is Ledger Lite's lightweight operating system for delivery. It makes work
discoverable and traceable without turning a small team into a process-heavy
organization.

## One source of truth per kind of information

| Information                                               | Authoritative location                     | Rule                                                                   |
| --------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| Product scope, business rules, architecture, and UI rules | `docs/`                                    | Update the relevant document when a merged change alters it.           |
| Durable technical or product decision                     | `docs/04-architecture/adr/`                | Record the decision before implementation when it is hard to reverse.  |
| Planned, active, blocked, and completed work              | GitHub Issues + Ledger Lite GitHub Project | Do not use a document checklist or chat as the live task status.       |
| Code, executable tests, migrations, and API contracts     | Repository source                          | Code and automated checks are authoritative for implemented behaviour. |
| Release health, launch gates, risks, and pilot evidence   | This document and the GitHub Project       | Link the supporting issue, document, test run, or interview evidence.  |

`docs/06-delivery/backlog.md` remains the durable MVP roadmap. Once the GitHub
Project exists, its issue state is the live delivery status.

## Work-item lifecycle

Every meaningful change has one GitHub Issue. Small corrective changes may use
the issue created by the parent story.

```text
Inbox -> Ready -> In progress -> In review -> Done
                   |                 |
                   +-> Blocked <-----+
```

- **Inbox:** captured but not yet prioritized or sized.
- **Ready:** passes the Definition of Ready and can be started.
- **In progress:** one active owner is implementing it. Keep work in progress
  deliberately low; a solo developer normally has one primary implementation
  issue at a time.
- **In review:** a pull request exists and required checks/review are pending.
- **Blocked:** cannot progress; record the dependency, owner, and next review
  date in the issue.
- **Done:** passes the Definition of Done. Close the issue from the merged PR.

## Definition of Ready

An implementation issue is ready only when it has:

1. A user outcome and acceptance criteria, linked to the applicable user story.
2. Clear in-scope and out-of-scope boundaries.
3. An owner, priority, area, and target milestone.
4. Links to relevant design, domain, database, and ADR documents.
5. Identified security, privacy, tenant-isolation, offline, and migration impact.
6. A proportionate test/verification approach.

## Definition of Done

Close an issue only after:

1. Its acceptance criteria are demonstrated or automated.
2. The smallest relevant type, build, test, and migration checks pass.
3. The PR links the issue and states the verification evidence.
4. Database changes have an additive migration, integrity tests, and a
   rollback/recovery note where required.
5. API, security, accounting, offline-sync, or design documentation is updated
   when behaviour or a decision changed.
6. Any customer-visible rollout, support, or feature-flag action is recorded.

Posted financial behaviour, tenant boundaries, authentication, and offline sync
must always have automated negative-path tests before being marked done.

## GitHub Project structure

Create one project named **Ledger Lite delivery**. Use these fields:

| Field       | Values / use                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------- |
| Status      | Inbox, Ready, In progress, In review, Blocked, Done                                           |
| Priority    | P0, P1, P2                                                                                    |
| Epic        | E01–E06 from the delivery backlog                                                             |
| Area        | platform, accounting, inventory, POS, web, API, database, security, operations, documentation |
| Size        | XS, S, M, L; split L work before starting it                                                  |
| Risk        | low, medium, high                                                                             |
| Milestone   | M0 Foundation, M1 Trust Path, M2 Pilot Readiness                                              |
| Target date | Forecast only; not a substitute for priority                                                  |

Maintain three views: a delivery board grouped by Status, a P0 table grouped by
Epic, and a milestone roadmap. Use issue dependencies for blockers rather than
only mentioning them in prose.

## Milestones

| Milestone          | Outcome                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| M0 Foundation      | Repeatable local/CI workflow, tenancy/security baseline, and database migration discipline.                        |
| M1 Trust Path      | Offline cash sale can sync once, post inventory and a balanced journal, and be traced by an accountant.            |
| M2 Pilot Readiness | Pilot workflows, backup/restore evidence, security/release gates, UAE operational readiness, and support playbook. |

## Planning rhythm

- **Before starting work:** select one Ready issue, confirm dependencies, and
  create a short-lived branch named after its issue.
- **Daily:** update the issue when it becomes blocked, changes scope, or enters
  review. Do not duplicate a daily status log in multiple documents.
- **Weekly:** review P0 work, blocked items, risks, decisions due, and the next
  smallest demonstrable slice.
- **At each milestone:** demo the acceptance path, record evidence, and decide
  explicitly whether to proceed, fix gaps, or change scope.

## Risk, assumption, and pilot-evidence register

Track each item as a GitHub Issue with the `risk`, `assumption`, or `research`
label. The issue must record: description, impact, likelihood, owner, next
action, review date, and evidence/decision link. High-risk examples include
tenant isolation, accounting integrity, offline data loss, authentication,
backup restore, UAE VAT treatment, payment hardware, and pilot support.

## Branch, commit, and review rules

- Protect `main`: merge through pull requests, require the CI workflow, prevent
  force-pushes, and require one approval once another regular contributor joins.
- Keep branches and commits small and focused. Follow `CONTRIBUTING.md`.
- PRs must reference their issue and identify database, security, or release
  impact explicitly.
- Do not bypass a failing check. Fix it, document an approved exception, or
  revert the change.

## Release gates

Before a pilot or production release, capture evidence for:

1. CI, migration, regression, and critical E2E results.
2. Tenant-isolation, authorization, accounting-invariant, and offline-sync
   negative-path tests.
3. Backup restoration and migration rollback/recovery rehearsal.
4. Security review, dependency/secret scan, and outstanding high-risk issues.
5. Monitoring, alerting, support ownership, and a rollback decision.
6. Pilot user feedback and UAE operational/compliance assumptions still open.
