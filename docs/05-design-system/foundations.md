# Design foundations — v0.1

This document is the implementation contract for Ledger Lite’s visual foundations. Product code consumes semantic tokens, never one-off literal values.

## 1. Token architecture

```text
Primitive tokens (blue-600, slate-900, space-4)
        ↓
Semantic tokens (color-action-primary, color-text-default)
        ↓
Component tokens (button-primary-background, table-row-hover)
```

Primitives can change during brand refinement. Semantic and component tokens protect feature code from those changes.

## 2. CSS token contract

Use CSS custom properties as the runtime token layer. A future design-token build may generate these values, but the names below are stable.

```css
:root {
  /* Typography */
  --font-sans: Inter, "Noto Sans Arabic", "Segoe UI", Arial, sans-serif;
  --font-mono: "Roboto Mono", Consolas, monospace;
  --font-size-100: 0.75rem;   /* 12px */
  --font-size-200: 0.875rem;  /* 14px */
  --font-size-300: 1rem;      /* 16px */
  --font-size-400: 1.125rem;  /* 18px */
  --font-size-500: 1.25rem;   /* 20px */
  --font-size-600: 1.5rem;    /* 24px */
  --font-size-700: 1.875rem;  /* 30px */
  --line-height-tight: 1.2;
  --line-height-normal: 1.5;

  /* Space and size: 4px base */
  --space-0: 0;
  --space-1: 0.25rem;  /* 4px */
  --space-2: 0.5rem;   /* 8px */
  --space-3: 0.75rem;  /* 12px */
  --space-4: 1rem;     /* 16px */
  --space-5: 1.25rem;  /* 20px */
  --space-6: 1.5rem;   /* 24px */
  --space-8: 2rem;     /* 32px */
  --space-10: 2.5rem;  /* 40px */
  --space-12: 3rem;    /* 48px */
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --shadow-sm: 0 1px 2px rgb(15 23 42 / 8%);
  --shadow-md: 0 4px 12px rgb(15 23 42 / 12%);

  /* Light semantic colours */
  --color-page: #F8FAFC;
  --color-surface: #FFFFFF;
  --color-surface-subtle: #F1F5F9;
  --color-surface-selected: #EFF6FF;
  --color-text: #0F172A;
  --color-text-muted: #475569;
  --color-text-disabled: #94A3B8;
  --color-border: #CBD5E1;
  --color-border-strong: #94A3B8;
  --color-action-primary: #1D4ED8;
  --color-action-primary-hover: #1E40AF;
  --color-action-primary-text: #FFFFFF;
  --color-action-secondary: #E2E8F0;
  --color-focus: #2563EB;
  --color-success: #15803D;
  --color-success-subtle: #DCFCE7;
  --color-warning: #B45309;
  --color-warning-subtle: #FEF3C7;
  --color-danger: #B91C1C;
  --color-danger-subtle: #FEE2E2;
  --color-info: #1D4ED8;
  --color-info-subtle: #DBEAFE;
}

[data-theme="dark"] {
  --color-page: #0F172A;
  --color-surface: #172033;
  --color-surface-subtle: #1E293B;
  --color-surface-selected: #1E3A5F;
  --color-text: #F8FAFC;
  --color-text-muted: #CBD5E1;
  --color-text-disabled: #64748B;
  --color-border: #334155;
  --color-border-strong: #64748B;
  --color-action-primary: #60A5FA;
  --color-action-primary-hover: #93C5FD;
  --color-action-primary-text: #0F172A;
  --color-action-secondary: #334155;
  --color-focus: #93C5FD;
  --color-success: #4ADE80;
  --color-success-subtle: #163622;
  --color-warning: #FBBF24;
  --color-warning-subtle: #422006;
  --color-danger: #F87171;
  --color-danger-subtle: #450A0A;
  --color-info: #93C5FD;
  --color-info-subtle: #172554;
}
```

## 3. Typography

| Use | Token | Weight | Notes |
| --- | --- | ---: | --- |
| Page title | `--font-size-600` | 600 | One per page; 24px desktop, 20px compact. |
| Section title | `--font-size-400` | 600 | Use for cards and major groups. |
| Body / table text | `--font-size-200` | 400 | Default dense back-office size. |
| POS product / primary action | `--font-size-300` | 500–600 | Minimum readable checkout text. |
| Helper / metadata | `--font-size-100` | 400 | Never use for essential instructions. |
| Money / quantity | inherited | 500 | Enable `font-variant-numeric: tabular-nums`. |

- Default body text uses `--line-height-normal`; headings use `--line-height-tight`.
- Text content may grow to 200% without clipping or overlapping.
- Use logical alignment: start-aligned text, end-aligned financial values. Arabic/RTL uses the same semantic alignment.
- Do not place essential data only in all caps or use light font weights below 400.

## 4. Layout and responsive rules

| Range | Intent | Layout rule |
| --- | --- | --- |
| Compact: < 640px | handheld POS/support view | Single column; drawer navigation; POS cart is a full-screen step or bottom sheet. |
| Standard: 640–1023px | tablet POS | Two-region checkout when room permits; touch targets remain large. |
| Wide: ≥ 1024px | desktop back office/POS | Persistent side navigation; POS product region and fixed cart column. |
| Extra wide: ≥ 1440px | reporting workspace | Main content max width 1600px; tables may use more columns, never excessive line lengths. |

- Application shell: `--space-6` page padding at wide size, `--space-4` at standard, `--space-3` compact.
- Back-office content uses a 1200–1600px maximum readable width depending on table/report purpose.
- POS cart is 360–440px wide on desktop; it never scrolls away from the payment total.
- Use CSS logical properties (`padding-inline`, `margin-inline`, `inset-inline-start`) exclusively for directional layout.

## 5. Interaction/accessibility tokens

- Minimum pointer target: 24×24px; primary POS controls: 44×44px or greater.
- Keyboard focus: `outline: 3px solid var(--color-focus); outline-offset: 2px;` and must remain visible above surfaces.
- Interactive states are required: default, hover, focus-visible, active, disabled, loading.
- Colour is never the only state indicator; pair status colour with text and, where useful, an icon.
- Error messages appear next to the affected control, are linked programmatically, and remain until resolved.

## 6. Financial-format rules

- Store/render money using locale-aware currency formatting; do not concatenate currency strings manually.
- Amount columns align to the inline end and use tabular figures.
- Use a single company-level display convention for negatives (recommended: `- AED 120.00`), with semantic danger styling only as a secondary signal.
- Show date, timezone, currency, and report-generation context where financial data could otherwise be misread.
