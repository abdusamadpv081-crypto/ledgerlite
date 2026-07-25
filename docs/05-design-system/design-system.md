# Ledger Lite design system — v0.1

## Product character

Calm, professional, and data-forward. Accounting screens prioritize scanability and confidence; POS screens prioritize speed, large touch targets, and recovery from mistakes. Decoration must never compete with financial data or sale completion.

## Design principles

1. **Make financial state explicit.** Posted, pending sync, failed sync, refunded, and voided states must be labelled; colour alone is never the only signal.
2. **Optimize the frequent path.** A cashier should complete a barcode sale with minimal pointer movement and reliable keyboard support.
3. **Prevent irreversible mistakes.** Clearly summarize totals and payment before completion; require reason/permission for high-risk actions.
4. **Make dense data legible.** Tables use stable columns, right-aligned numeric values, tabular numerals, useful defaults, and progressive disclosure.
5. **Design globally from the start.** Text must be externalized, layouts must mirror in RTL, and dates/numbers/currencies must be locale-aware.

## Foundations

- Use semantic tokens (`surface`, `text`, `border`, `primary`, `success`, `warning`, `danger`, `info`) rather than raw colour names in components.
- Use an 8px spacing grid; compact POS controls may use 4px increments only where needed.
- Use a highly legible sans-serif UI typeface with tabular-number support.
- Amounts are right-aligned; debit/credit columns remain consistently positioned; negative figures have a text/sign convention as well as colour.
- Default to a light workspace. Dark mode is desirable, but should follow the same semantic tokens.

## Accessibility requirements

- Target WCAG 2.2 AA.
- All POS and back-office workflows are keyboard operable.
- Pointer controls meet at least 24×24 CSS px; target 44×44 px for primary POS touch controls.
- Focus is visible and never obscured; errors are specific, persistent, and programmatically associated with inputs.
- Never depend on colour alone for status or validation.

## Core components for MVP

| Component | Required variants/behaviour |
| --- | --- |
| Button | primary, secondary, tertiary, destructive; loading and disabled states; keyboard focus. |
| Input | text, money, quantity, barcode/search; label, help, error, read-only states. |
| Data table | sortable columns, numeric alignment, empty/loading/error states, responsive strategy. |
| Status badge | semantic status plus readable label and icon where helpful. |
| Dialog | explicit title, keyboard trap/escape behaviour, dangerous-action confirmation. |
| Toast/alert | success, warning, error, offline/sync status; never the only record of an error. |
| POS cart | items, quantity edits, discounts, tax, totals, payment selection, pending-sync indicator. |

## RTL and localization rules

- Use logical CSS properties (`margin-inline`, `padding-inline`, `inset-inline`) rather than left/right positioning.
- Mirror navigation and directional icons in RTL; do not mirror universally recognized non-directional icons.
- Currency and numeric columns preserve the reading/order appropriate to their locale and are tested in both LTR and RTL layouts.
- Avoid text baked into icons, images, or component layouts.
