# Product documentation

| Area                                                              | Purpose                                                                    |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [Product](01-product/BRD.md)                                      | Vision, business requirements, scope, and success measures.                |
| [Market research](01-product/market-and-architecture-research.md) | Public POS/accounting benchmark findings and product implications.         |
| [Requirements](02-requirements/user-stories.md)                   | Epics, user stories, and acceptance criteria.                              |
| [Domain](03-domain/accounting-rules.md)                           | Accounting and offline POS rules that cannot be violated.                  |
| [Architecture](04-architecture/architecture-principles.md)        | Technical constraints and decisions.                                       |
| [Database design](04-architecture/database/README.md)             | PostgreSQL schema, integrity, operations, and recovery design.             |
| [Design system](05-design-system/design-system.md)                | Foundations and component rules for a consistent product UI.               |
| [Delivery](06-delivery/backlog.md)                                | Prioritized MVP roadmap.                                                   |
| [Project operating model](06-delivery/project-operating-model.md) | Source-of-truth rules, work-item lifecycle, quality gates, and milestones. |
| [Story tracker](06-delivery/story-tracker.md)                     | MVP story status, completed enablers, acceptance evidence, and blockers.   |
| [Pilot provisioning](06-delivery/assisted-pilot-provisioning.md)  | Secure assisted setup of the first pilot company owner and branch.         |
| [Repository review](06-delivery/repository-review-2026-07-25.md)  | Review evidence, resolved findings, and remediation order.                 |

## Working agreement

1. A feature begins with a documented user story and acceptance criteria.
2. Any lasting technical or product choice is recorded as an ADR before implementation.
3. Every merged change updates the relevant documents when behaviour, scope, or decisions change.
4. Financial events are auditable; corrections use reversals or adjustments, never silent history edits.
