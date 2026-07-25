# UAE payments and POS hardware research — v0.1

**Date:** 2026-07-25  
**Scope:** Public provider/manufacturer documentation. Commercial eligibility, terminal models, fees, support, and contracts must be validated directly with providers and pilot retailers.

## Executive recommendation

For the first pilot and vertical slice, Ledger Lite supports:

1. **Cash** payments.
2. **External card-terminal** payments: cashier processes the card on the merchant’s existing terminal, then records the approved payment against the Ledger Lite sale.
3. **Browser receipt printing** through the operating system’s print dialog, plus digital/on-screen receipts where appropriate.
4. **Keyboard-wedge barcode scanners** that act as standard keyboard input.

Do **not** implement card data capture, direct terminal API, terminal-initiated refunds, or offline card acceptance in the first vertical slice. These require acquirer onboarding, PCI scope assessment, terminal certification/support, settlement/reversal/reconciliation workflow, and merchant liability decisions.

## UAE payment-provider observations

### Network International / N-Genius

Network International publicly offers N-Genius in-person terminals and describes wired EPOS, cloud API, and Android app-to-app integration approaches. Its integrated-payment offering targets retail use cases including supermarkets, and its terminal offering includes printer/printerless devices. [Integrated payment solutions](https://www.network.ae/en/merchant-solutions/in-person-payments/integrated-payments) [N-Genius terminal](https://www.network.ae/en/merchant-solutions/in-person-payments/n-genius-pos-terminal)

It is a credible first candidate for a future UAE terminal-integration pilot because it operates locally and advertises cloud API integration. However, availability of a particular integration method, costs, terminal model, merchant onboarding, supported payment methods, offline behavior, sandbox access, support SLAs, and reconciliation data must be confirmed directly before selection.

### What this means for Ledger Lite

The payment adapter must remain provider-neutral:

```text
POS sale
  → PaymentAttempt (cash | external_terminal | integrated_terminal)
  → provider adapter only when integrated
  → settlement/reconciliation workflow later
```

The POS/application never receives, stores, logs, or transmits PAN, CVV, PIN, or card-track data. An integrated provider/terminal owns cardholder-data handling.

## Offline payment risk

Offline card acceptance is not the same as recording an offline cash sale. Public POS documentation shows that offline card transactions can remain pending and later decline, and that providers impose limits/permissions. [Shopify offline payments](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/selling-offline/offline-payments) [Lightspeed offline payments](https://retail-support.lightspeedhq.com/hc/en-us/articles/27640682216731-Processing-payments-in-standalone-and-offline-mode)

Ledger Lite MVP offline mode therefore permits only:

- cash; and
- a merchant-configured manual/external payment record only when the external terminal/provider has independently confirmed the payment.

The UI distinguishes `payment recorded`, `provider approved`, `provider pending`, `provider declined`, and `settled/reconciled` states. In release one, `external_terminal` is a merchant-attested payment record, not a provider-integrated proof of settlement.

## Hardware findings

### Barcode scanners

Use HID/keyboard-wedge scanners for MVP. They behave as keyboard input and work without browser-specific hardware APIs. The POS scan field and keyboard workflow are the integration point.

### Receipts and printers

`window.print()` is broadly available and opens the operating-system print dialog, making it the baseline printer path for a browser POS. [MDN print()](https://developer.mozilla.org/en-US/docs/Web/API/Window/print)

For later silent/direct receipt printing, select and certify a specific printer family. Epson publishes a JavaScript ePOS SDK for web applications and compatible intelligent TM printers; Star offers browser/cloud printing options including WebPRNT and CloudPRNT. [Epson ePOS JavaScript SDK](https://download3.ebz.epson.net/dsc/f/03/00/15/05/77/9d401ca48f7317da830d0db3555fe4744fbfd7bc/ov_ePOS_SDK_JavaScript_v2.22.0.pdf) [Star CloudPRNT](https://star-m.jp/products/s_print/archive/CloudPRNTSDK/Documentation/en/articles/cloudprnt.html)

Do not depend on raw WebUSB/Web Serial for MVP. They have limited browser availability and would constrain our support surface. [MDN Web Serial](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)

### Cash drawers

For MVP, use manual opening or a drawer controlled through the chosen receipt-printer/terminal setup. Browser code does not directly control arbitrary drawers. Automatic drawer opening is a phase-two certified peripheral feature.

## Pilot hardware profile

| Item | Initial support stance |
| --- | --- |
| POS host | Windows desktop/laptop using current Chrome or Edge. |
| Barcode scanner | USB or Bluetooth keyboard-wedge scanner. |
| Receipt printer | Any OS-supported printer via print dialog; certify one Epson/Star model before direct-print commitment. |
| Cash drawer | Manual or connected to the certified receipt printer; no direct-browser guarantee. |
| Card terminal | Merchant-supplied/acquirer-supplied external terminal, processed independently. |
| Tablet | Android Chrome is a later pilot option after printer/terminal testing. |

## Provider/pilot due-diligence checklist

- Merchant onboarding eligibility, pricing, settlement cycles, support SLA, and UAE contracting entity.
- Terminal/API integration style: cloud, wired EPOS, Android app-to-app, and supported terminal models.
- Sandbox, API documentation, webhook/event model, idempotency, refund/reversal/cancel semantics, and reporting exports.
- PCI responsibilities and written confirmation that Ledger Lite does not handle cardholder data.
- Payment types accepted, currencies, UAE requirements, offline limits/liability, and terminal replacement process.
- Reconciliation identifiers available to link provider payment, POS sale, bank settlement, and accounting clearing account.
- Pilot hardware models, firmware, local networking, receipt printing, scanner behavior, and cash-drawer test.
