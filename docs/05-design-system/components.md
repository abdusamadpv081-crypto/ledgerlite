# Core component contracts — v0.1

Each component must implement all documented states before it is reused. “Looks correct” is not sufficient: keyboard, loading, error, RTL, and accessibility behavior are part of the contract.

## 1. Button

**Purpose:** trigger a deliberate user action.

| Variant | Use | Rules |
| --- | --- | --- |
| Primary | Main action in a region: `Complete sale`, `Save`. | One dominant action per region; never destructive. |
| Secondary | Supporting action: `Cancel`, `Print`. | Lower visual emphasis. |
| Tertiary/ghost | Low-emphasis contextual action. | Must retain visible focus and sufficient hit area. |
| Destructive | `Refund`, `Void`, `Delete`. | Require confirmation when consequence is not immediately reversible. |

**API concept:** `variant`, `size`, `isLoading`, `isDisabled`, `iconStart`, `iconEnd`, `type`.

**Required behavior:** native `<button>` whenever possible; disabled buttons explain why through nearby help text; loading retains width and prevents duplicate submission; icon-only buttons require accessible names/tooltips.

## 2. Text, search, barcode, money, and quantity input

**Purpose:** structured entry with a persistent label, help/error association, and safe value parsing.

| Input | Special contract |
| --- | --- |
| Search/barcode | Scanner input must reach the intended field after checkout readiness; Enter submits only unambiguous results. |
| Money | Accept locale-aware input, store decimal string/precise value, display currency context, reject float rounding ambiguity. |
| Quantity | Accept only permitted precision; provide keyboard increment/decrement where applicable. |
| Password/PIN | Never reveal by default; rate-limit/policy protect verification; no value in logs. |

**States:** default, hover, focus-visible, filled, read-only, disabled, validation error, loading/async validation.

## 3. Data table

**Purpose:** inspect, filter, and act on lists of business records.

- Header names are concise and stable; columns persist in a meaningful order.
- Numeric columns use end alignment and tabular figures; dates use a consistent localized format.
- Include loading, empty, filtered-empty, error, and permission-restricted states.
- Row selection is separate from row navigation; bulk actions show a selection count and confirmation for high-risk actions.
- On compact screens, prioritize key columns and expose remaining fields through a detail panel rather than horizontal chaos.
- Financial tables must show report context, currency, and totals where relevant.

**API concept:** `columns`, `rows`, `rowId`, `sort`, `filters`, `selection`, `onRowActivate`, `status`.

## 4. Status badge and sync indicator

**Purpose:** communicate a stable record or system state.

| State family | Required label examples | Treatment |
| --- | --- | --- |
| Positive | Synced, Posted, Closed | Success semantic token plus readable text. |
| Attention | Pending sync, Needs review, Closing | Warning token plus plain-language next action. |
| Negative | Rejected, Failed, Overdue | Danger token plus reason/detail path. |
| Neutral | Draft, Open, Archived | Neutral surface/border and label. |

The POS shell has a persistent sync indicator. It must state both network connectivity and unsynced-event state; “Online” alone is not proof that all sales have synchronized.

## 5. Dialog and confirmation

**Purpose:** hold a bounded decision or task that needs user focus.

- Use a dialog only when staying in context is valuable; use a page for substantial forms/workflows.
- Focus moves to the dialog on open and returns to the trigger on close.
- Escape closes only when it is safe; destructive confirmation shows what will happen and the affected record.
- Primary action labels name the consequence: `Issue refund`, not `Confirm`.

## 6. Alert, toast, and inline validation

| Pattern | Use |
| --- | --- |
| Inline field error | Correctable form data problem. |
| Page/region alert | Persistent operational issue such as failed sync or closed fiscal period. |
| Toast | Confirm a completed non-critical action; never the only presentation of a failure requiring resolution. |
| Exception item | Durable assigned issue with reason, state, owner, and next action. |

## 7. POS cart

**Purpose:** cashier’s persistent transaction summary and final payment surface.

**Required regions:** cart items; item quantity/edit controls; discount/tax summary; subtotal/VAT/grand total; payment method; completion action; network/sync state.

**Rules:**

- Grand total remains visible while items scroll.
- `Complete sale` is disabled until a valid payment method and required values are present; explain the reason.
- Payment confirmation has a clear final amount and cannot be triggered repeatedly while processing.
- Pending-sync result is explicit on the receipt/outcome screen.
- The cart supports keyboard/scanner flow and 44px primary touch targets.

## 8. Financial amount

**Purpose:** display monetary values consistently.

**API concept:** `amount`, `currency`, `locale`, `signStyle`, `emphasis`, `showCurrency`.

Use precise decimal values from the domain layer. For tables, keep amounts unwrapped where practical; visually distinguish a total through weight and border, not larger random colours.
