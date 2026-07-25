# MVP epics and user stories

## Story format

`As a <role>, I want <outcome>, so that <benefit>.`

Every story must have acceptance criteria, priority, and a link to its epic. Stories are only ready for implementation after the criteria and affected accounting/offline rules are understood.

## Epic E01 — SaaS foundation

**Outcome:** a retailer can create and administer an isolated company workspace.

- **US-001 — Create company.** As an owner, I want to create my company workspace with legal and VAT details, so that Ledger Lite can issue correct business documents.
  - Given I am an authorized owner, when I submit valid company details, then a new isolated company workspace is created.
  - Then the system records the actor and timestamp in the audit log.
- **US-002 — Manage branches.** As an owner, I want to add branches, so that POS activity and stock can be tracked by location.
- **US-003 — Manage access.** As an owner, I want to assign staff permissions by branch, so that each employee can only perform authorized actions.

## Epic E02 — Accounting core

**Outcome:** every financial event is traceable and financially correct.

- **US-010 — Configure chart of accounts.** As an accountant, I want a UAE retail starter chart of accounts that I can tailor, so that the company can categorize transactions and report correctly.
- **US-011 — Post a journal.** As the system, I want to post balanced journal entries atomically, so that every accepted event preserves double-entry integrity.
  - Given a proposed journal does not balance, when posting is requested, then it is rejected and no partial entries are saved.
  - Given a journal is posted, then its entries cannot be edited or deleted.
- **US-012 — Close a fiscal period.** As an accountant, I want to close a period, so that historical reporting remains stable.

## Epic E03 — Product and inventory

**Outcome:** a retailer can sell and track basic stock by branch.

- **US-020 — Maintain product catalogue.** As a manager, I want to create products with SKU, barcode, price, tax class, and branch availability, so that cashiers can sell them accurately.
- **US-021 — Receive stock.** As a stock manager, I want to record stock received by branch, so that on-hand quantity is accurate.
- **US-022 — Adjust stock.** As an authorized manager, I want to make a reasoned stock adjustment, so that discrepancies are traceable.

## Epic E04 — Offline POS

**Outcome:** a cashier can continue essential selling without an internet connection.

- **US-030 — Start shift.** As a cashier, I want to open a cash shift with an opening float, so that cash accountability starts before sales.
- **US-031 — Complete offline sale.** As a cashier, I want to scan/search products, take cash or card payment, and issue a receipt offline, so that customers can be served during an outage.
  - Given the device is offline and the cashier is signed in, when a valid sale is completed, then it is saved locally with a unique immutable event ID and shown as pending sync.
  - Then the receipt clearly identifies the sale and its synchronization status where required.
- **US-035 — Record external terminal payment.** As a cashier, I want to record an independently approved external card-terminal payment against a sale, so that the sale and its payment-clearing accounting entry are traceable without Ledger Lite handling card data.
- **US-032 — Synchronize sale.** As the system, I want to upload a pending sale exactly once when online, so that accounting and inventory are updated without duplicates.
- **US-033 — Refund sale.** As an authorized cashier, I want to refund a completed sale with a reason, so that customer corrections are auditable.
- **US-034 — Close shift.** As a cashier, I want to count and close my shift, so that expected versus actual cash differences are visible.

## Epic E05 — UAE compliance and reporting

**Outcome:** the retailer can meet foundational UAE accounting and VAT needs.

- **US-040 — Produce tax receipt/invoice.** As a VAT-registered retailer, I want tax documents with required UAE data, so that I can provide compliant evidence of a sale.
- **US-041 — View VAT summary.** As an accountant, I want a VAT summary by tax period, so that I can prepare VAT reporting.
- **US-042 — View financial statements.** As an owner, I want trial balance, profit and loss, and balance sheet reports, so that I can understand financial performance.

## Epic E06 — Design system and localization

**Outcome:** users receive consistent, accessible UI across accounting and POS workflows.

- **US-050 — Use a component system.** As a product team member, I want documented tokens and component states, so that every feature looks and behaves consistently.
- **US-051 — Use keyboard-first POS.** As a cashier, I want keyboard and barcode-scanner friendly checkout, so that I can sell quickly without unnecessary mouse actions.
- **US-052 — Support RTL.** As an Arabic-reading user, I want layouts that render correctly in RTL, so that future Arabic content is usable without a visual rewrite.
