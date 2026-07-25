# Product documentation

| Area | Purpose |
| --- | --- |
| [Product](01-product/BRD.md) | Vision, business requirements, scope, and success measures. |
| [Market research](01-product/market-and-architecture-research.md) | Public POS/accounting benchmark findings and product implications. |
| [Requirements](02-requirements/user-stories.md) | Epics, user stories, and acceptance criteria. |
| [Domain](03-domain/accounting-rules.md) | Accounting and offline POS rules that cannot be violated. |
| [Architecture](04-architecture/architecture-principles.md) | Technical constraints and decisions. |
| [Database design](04-architecture/database/README.md) | PostgreSQL schema, integrity, operations, and recovery design. |
| [Design system](05-design-system/design-system.md) | Foundations and component rules for a consistent product UI. |
| [Delivery](06-delivery/backlog.md) | Prioritized MVP backlog and daily working record. |

## Working agreement

1. A feature begins with a documented user story and acceptance criteria.
2. Any lasting technical or product choice is recorded as an ADR before implementation.
3. Every merged change updates the relevant documents when behaviour, scope, or decisions change.
4. Financial events are auditable; corrections use reversals or adjustments, never silent history edits.
