import {
  createHash,
  randomUUID,
  timingSafeEqual,
  webcrypto,
} from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import {
  posCashSaleSignaturePayload,
  type PosCashSaleEvent,
} from "@ledgerlite/domain";
import { Pool, type PoolClient } from "pg";
import { AUTHORIZATION_POOL } from "../auth/authorization.service.js";

type Context = Readonly<{ companyId: string; actorUserId: string }>;
type DeviceRow = Readonly<{
  branch_id: string;
  id: string;
  public_key_jwk: JsonWebKey;
  status: "registered" | "suspended" | "retired";
}>;
type GrantRow = Readonly<{
  branch_id: string;
  cashier_user_id: string;
  capabilities: readonly string[];
  device_id: string;
  expires_at: string;
  issued_at: string;
  policy_id: string;
  policy_version: number;
  revoked_at: string | null;
}>;
type ShiftRow = Readonly<{
  branch_id: string;
  cashier_user_id: string;
  device_id: string;
  policy_id: string;
  policy_version: number;
  status: "open" | "close_requested" | "closed" | "voided";
}>;
type ProductRow = Readonly<{
  id: string;
  product_kind: "stock" | "service";
}>;
type ExistingSaleRow = Readonly<{
  accepted_at: string;
  branch_id: string;
  cashier_user_id: string;
  device_id: string;
  id: string;
  journal_entry_id: string;
  local_receipt_id: string;
  payload_digest: Buffer;
  stock_exception: boolean;
}>;
type ExistingEventRow = Readonly<{
  id: string;
  payload_digest: Buffer;
}>;
type AccountRow = Readonly<{ code: string; id: string }>;
type PeriodRow = Readonly<{ id: string; journal_date: string }>;

export type SaleSyncInput = PosCashSaleEvent &
  Readonly<{
    deviceSignature: string;
  }>;
export type SaleSyncResult =
  | Readonly<{
      acknowledgedAt: string;
      eventId: string;
      journalEntryId: string;
      localReceiptId: string;
      saleId: string;
      status:
        "accepted" | "duplicate_accepted" | "accepted_with_stock_exception";
      stockException: boolean;
    }>
  | Readonly<{
      acknowledgedAt: string;
      eventId: string;
      rejectionCode: string;
      rejectionMessage: string;
      status: "rejected";
    }>;
export type SaleSyncResponse = Readonly<{
  correlationId: string;
  data: SaleSyncResult;
}>;

const decimalPlaces = 6;
const decimalScale = 10n ** BigInt(decimalPlaces);
const maxMoneyUnits = 10n ** 20n - 1n;
const decimal = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;

class SaleSyncRejection extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function moneyUnits(value: string): bigint {
  if (!decimal.test(value))
    throw new SaleSyncRejection(
      "SALE_TOTAL_INVALID",
      "A sale amount is invalid.",
    );
  const [whole, fraction = ""] = value.split(".");
  const result =
    BigInt(whole) * decimalScale + BigInt(fraction.padEnd(decimalPlaces, "0"));
  if (result > maxMoneyUnits)
    throw new SaleSyncRejection(
      "SALE_TOTAL_INVALID",
      "A sale amount exceeds the supported precision.",
    );
  return result;
}
function roundedDivide(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n)
    throw new SaleSyncRejection(
      "SALE_TOTAL_INVALID",
      "A sale amount is invalid.",
    );
  return (numerator + denominator / 2n) / denominator;
}
function base64UrlBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}
function arrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}
function unsignedEvent(input: SaleSyncInput): PosCashSaleEvent {
  const { deviceSignature: _deviceSignature, ...event } = input;
  return event;
}
function payloadDigest(event: SaleSyncInput): Buffer {
  return createHash("sha256")
    .update(posCashSaleSignaturePayload(unsignedEvent(event)))
    .digest();
}
function sameDigest(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}
function timestamp(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result))
    throw new SaleSyncRejection(
      "EVENT_SCHEMA_UNSUPPORTED",
      "The sale event timestamp is invalid.",
    );
  return result;
}
function rejection(eventId: string, error: SaleSyncRejection): SaleSyncResult {
  return {
    acknowledgedAt: new Date().toISOString(),
    eventId,
    rejectionCode: error.code,
    rejectionMessage: error.message,
    status: "rejected",
  };
}

@Injectable()
export class SaleSyncService {
  constructor(@Inject(AUTHORIZATION_POOL) private readonly pool: Pool) {}

  async sync(
    context: Context,
    branchId: string,
    input: SaleSyncInput,
  ): Promise<SaleSyncResponse> {
    const correlationId = randomUUID();
    return this.withTenant(context, async (client) => {
      await client.query(
        "SELECT set_config('app.current_correlation_id', $1, true)",
        [correlationId],
      );
      try {
        return {
          correlationId,
          data: await this.synchronize(client, context, branchId, input),
        };
      } catch (error) {
        if (error instanceof SaleSyncRejection)
          return { correlationId, data: rejection(input.eventId, error) };
        throw error;
      }
    });
  }

  private async synchronize(
    client: PoolClient,
    context: Context,
    branchId: string,
    input: SaleSyncInput,
  ): Promise<SaleSyncResult> {
    this.assertRouteScope(context, branchId, input);
    const digest = payloadDigest(input);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `${context.companyId}:pos-sale:${input.eventId}`,
    ]);

    const existing = await client.query<ExistingSaleRow>(
      `SELECT id, branch_id, device_id, cashier_user_id, local_receipt_id,
              journal_entry_id, stock_exception, payload_digest,
              to_char(accepted_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS accepted_at
         FROM pos.sale_event WHERE id = $1`,
      [input.eventId],
    );
    if (existing.rowCount === 1)
      return this.duplicate(existing.rows[0], input, digest);

    const receipt = await client.query<ExistingEventRow>(
      "SELECT id, payload_digest FROM pos.sale_event WHERE local_receipt_id = $1",
      [input.localReceiptId],
    );
    if (receipt.rowCount === 1)
      throw new SaleSyncRejection(
        "RECEIPT_ID_REUSED",
        "The local receipt ID is already linked to another sale event.",
      );
    const sequence = await client.query<ExistingEventRow>(
      `SELECT id, payload_digest FROM pos.sale_event
       WHERE device_id = $1 AND cashier_user_id = $2 AND local_sequence = $3`,
      [input.deviceId, input.cashierUserId, input.localSequence],
    );
    if (sequence.rowCount === 1)
      throw new SaleSyncRejection(
        "LOCAL_SEQUENCE_REUSED",
        "The local device sequence is already linked to another sale event.",
      );

    const device = await this.assertDevice(client, branchId, input.deviceId);
    const signatureValid = await this.verifyDeviceSignature(
      device.public_key_jwk,
      input,
    );
    if (!signatureValid)
      throw new SaleSyncRejection(
        "EVENT_SIGNATURE_INVALID",
        "The sale event signature could not be verified for this POS device.",
      );
    await this.assertGrantAndShift(client, context, branchId, input);
    const products = await this.assertReferences(client, input);
    this.assertAmounts(input);

    const [period, accounts] = await Promise.all([
      this.openFiscalPeriod(client, context.companyId, input.occurredAt),
      this.postingAccounts(client, moneyUnits(input.totals.taxAmount) > 0n),
    ]);
    const stockException = await this.stockException(
      client,
      context.companyId,
      branchId,
      input,
      products,
    );
    const journalEntryId = await this.createPostedJournal(
      client,
      context,
      input,
      period,
      accounts,
    );
    await this.insertSale(client, context.companyId, branchId, input, {
      digest,
      journalEntryId,
      products,
      stockException,
    });
    await client.query(
      "UPDATE platform.pos_device SET last_synced_at = clock_timestamp() WHERE id = $1",
      [input.deviceId],
    );
    await client.query("SELECT audit.write_event($1, $2, $3, $4, $5)", [
      context.companyId,
      "pos.sale.accepted",
      "pos.sale_event",
      input.eventId,
      {
        branchId,
        deviceId: input.deviceId,
        journalEntryId,
        localReceiptId: input.localReceiptId,
        stockException,
        totalAmount: input.totals.totalAmount,
      },
    ]);
    const acceptedAt = (
      await client.query<{ accepted_at: string }>(
        `SELECT to_char(accepted_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS accepted_at
         FROM pos.sale_event WHERE id = $1`,
        [input.eventId],
      )
    ).rows[0].accepted_at;
    return {
      acknowledgedAt: acceptedAt,
      eventId: input.eventId,
      journalEntryId,
      localReceiptId: input.localReceiptId,
      saleId: input.eventId,
      status: stockException ? "accepted_with_stock_exception" : "accepted",
      stockException,
    };
  }

  private assertRouteScope(
    context: Context,
    branchId: string,
    input: SaleSyncInput,
  ): void {
    if (
      input.companyId !== context.companyId ||
      input.branchId !== branchId ||
      input.cashierUserId !== context.actorUserId
    )
      throw new SaleSyncRejection(
        "EVENT_SCOPE_MISMATCH",
        "The sale event does not match this authenticated POS scope.",
      );
  }

  private duplicate(
    existing: ExistingSaleRow,
    input: SaleSyncInput,
    digest: Buffer,
  ): SaleSyncResult {
    if (
      existing.branch_id !== input.branchId ||
      existing.device_id !== input.deviceId ||
      existing.cashier_user_id !== input.cashierUserId ||
      existing.local_receipt_id !== input.localReceiptId ||
      !sameDigest(existing.payload_digest, digest)
    )
      throw new SaleSyncRejection(
        "EVENT_ID_PAYLOAD_MISMATCH",
        "This event ID was already accepted with different sale content.",
      );
    return {
      acknowledgedAt: existing.accepted_at,
      eventId: existing.id,
      journalEntryId: existing.journal_entry_id,
      localReceiptId: existing.local_receipt_id,
      saleId: existing.id,
      status: "duplicate_accepted",
      stockException: existing.stock_exception,
    };
  }

  private async assertDevice(
    client: PoolClient,
    branchId: string,
    deviceId: string,
  ): Promise<DeviceRow> {
    const device = await client.query<DeviceRow>(
      `SELECT id, branch_id, public_key_jwk, status
         FROM platform.pos_device
        WHERE id = $1 AND branch_id = $2 FOR KEY SHARE`,
      [deviceId, branchId],
    );
    if (device.rowCount !== 1 || device.rows[0].status !== "registered")
      throw new SaleSyncRejection(
        "EVENT_SCOPE_MISMATCH",
        "The sale event does not belong to an active registered POS device.",
      );
    return device.rows[0];
  }

  private async assertGrantAndShift(
    client: PoolClient,
    context: Context,
    branchId: string,
    input: SaleSyncInput,
  ): Promise<void> {
    const grant = await client.query<GrantRow>(
      `SELECT branch_id, device_id, cashier_user_id, policy_id, policy_version,
              capabilities,
              to_char(issued_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS issued_at,
              to_char(expires_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS expires_at,
              to_char(revoked_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS revoked_at
         FROM pos.offline_operational_grant
        WHERE id = $1 FOR KEY SHARE`,
      [input.authorityGrantId],
    );
    if (grant.rowCount !== 1)
      throw new SaleSyncRejection(
        "OFFLINE_GRANT_INVALID",
        "The offline authority grant was not found.",
      );
    const authority = grant.rows[0];
    const occurredAt = timestamp(input.occurredAt);
    if (
      authority.branch_id !== branchId ||
      authority.device_id !== input.deviceId ||
      authority.cashier_user_id !== context.actorUserId ||
      authority.policy_id !== input.authorityPolicyId ||
      authority.policy_version !== input.authorityPolicyVersion ||
      !authority.capabilities.includes("pos.sale.create") ||
      occurredAt < timestamp(authority.issued_at) ||
      occurredAt > timestamp(authority.expires_at) ||
      (authority.revoked_at !== null &&
        occurredAt > timestamp(authority.revoked_at))
    )
      throw new SaleSyncRejection(
        "OFFLINE_GRANT_INVALID",
        "The offline authority grant is not valid for this sale event.",
      );

    const shift = await client.query<ShiftRow>(
      `SELECT branch_id, device_id, cashier_user_id, status, policy_id, policy_version
         FROM pos.cash_shift WHERE id = $1`,
      [input.shiftId],
    );
    if (shift.rowCount !== 1)
      throw new SaleSyncRejection(
        "POS_SHIFT_CLOSED",
        "The cash shift captured by this sale was not found.",
      );
    const captured = shift.rows[0];
    if (
      captured.status !== "open" ||
      captured.branch_id !== branchId ||
      captured.device_id !== input.deviceId ||
      captured.cashier_user_id !== context.actorUserId ||
      captured.policy_id !== input.authorityPolicyId ||
      captured.policy_version !== input.authorityPolicyVersion
    )
      throw new SaleSyncRejection(
        "POS_SHIFT_CLOSED",
        "The cash shift is not an open match for this sale event.",
      );
  }

  private async assertReferences(
    client: PoolClient,
    input: SaleSyncInput,
  ): Promise<ReadonlyMap<string, ProductRow>> {
    const productIds = [...new Set(input.lines.map((line) => line.productId))];
    const products = await client.query<ProductRow>(
      "SELECT id, product_kind FROM catalog.product WHERE id = ANY($1::uuid[])",
      [productIds],
    );
    if (products.rowCount !== productIds.length)
      throw new SaleSyncRejection(
        "EVENT_SCOPE_MISMATCH",
        "A sale line does not reference a product in this company.",
      );
    const taxIds = [
      ...new Set(
        input.lines.flatMap((line) => (line.taxCode ? [line.taxCode.id] : [])),
      ),
    ];
    if (taxIds.length > 0) {
      const taxes = await client.query<{ id: string }>(
        "SELECT id FROM catalog.tax_code WHERE id = ANY($1::uuid[])",
        [taxIds],
      );
      if (taxes.rowCount !== taxIds.length)
        throw new SaleSyncRejection(
          "EVENT_SCOPE_MISMATCH",
          "A sale line does not reference a tax code in this company.",
        );
    }
    return new Map(products.rows.map((product) => [product.id, product]));
  }

  private assertAmounts(input: SaleSyncInput): void {
    let netAmount = 0n;
    let taxAmount = 0n;
    let totalAmount = 0n;
    for (const line of input.lines) {
      const quantity = BigInt(line.quantity);
      const unitPrice = moneyUnits(line.unitPrice);
      const lineAmount = unitPrice * quantity;
      const rate = line.taxCode ? moneyUnits(line.taxCode.rate) : 0n;
      const expectedTax =
        line.taxTreatment === "inclusive"
          ? roundedDivide(lineAmount * rate, decimalScale + rate)
          : roundedDivide(lineAmount * rate, decimalScale);
      const expectedNet =
        line.taxTreatment === "inclusive"
          ? lineAmount - expectedTax
          : lineAmount;
      const expectedTotal =
        line.taxTreatment === "inclusive"
          ? lineAmount
          : lineAmount + expectedTax;
      if (
        moneyUnits(line.netAmount) !== expectedNet ||
        moneyUnits(line.taxAmount) !== expectedTax ||
        moneyUnits(line.totalAmount) !== expectedTotal
      )
        throw new SaleSyncRejection(
          "SALE_TOTAL_INVALID",
          "A sale line does not match its price, tax, and quantity snapshot.",
        );
      netAmount += expectedNet;
      taxAmount += expectedTax;
      totalAmount += expectedTotal;
    }
    if (
      moneyUnits(input.totals.netAmount) !== netAmount ||
      moneyUnits(input.totals.taxAmount) !== taxAmount ||
      moneyUnits(input.totals.totalAmount) !== totalAmount ||
      moneyUnits(input.payment.amount) !== totalAmount
    )
      throw new SaleSyncRejection(
        "SALE_TOTAL_INVALID",
        "The sale totals or cash payment do not match its lines.",
      );
  }

  private async openFiscalPeriod(
    client: PoolClient,
    companyId: string,
    occurredAt: string,
  ): Promise<PeriodRow> {
    const period = await client.query<PeriodRow>(
      `SELECT period.id,
              to_char($2::timestamptz AT TIME ZONE company.time_zone,
                'YYYY-MM-DD') AS journal_date
         FROM platform.company AS company
         JOIN accounting.fiscal_period AS period
           ON period.company_id = company.id
          AND period.status = 'open'
          AND period.starts_on <= ($2::timestamptz AT TIME ZONE company.time_zone)::date
          AND period.ends_on > ($2::timestamptz AT TIME ZONE company.time_zone)::date
        WHERE company.id = $1
        FOR KEY SHARE OF period`,
      [companyId, occurredAt],
    );
    if (period.rowCount !== 1)
      throw new SaleSyncRejection(
        "ACCOUNTING_CONFIGURATION_REQUIRED",
        "No open fiscal period covers the sale date.",
      );
    return period.rows[0];
  }

  private async postingAccounts(
    client: PoolClient,
    requiresVat: boolean,
  ): Promise<ReadonlyMap<string, string>> {
    const requiredCodes = requiresVat
      ? ["1000", "2000", "4000"]
      : ["1000", "4000"];
    const accounts = await client.query<AccountRow>(
      `SELECT code, id FROM accounting.account
        WHERE code = ANY($1::text[]) AND is_active AND is_posting`,
      [requiredCodes],
    );
    if (accounts.rowCount !== requiredCodes.length)
      throw new SaleSyncRejection(
        "ACCOUNTING_CONFIGURATION_REQUIRED",
        "Active cash, retail sales, and VAT payable accounts are required.",
      );
    return new Map(accounts.rows.map((account) => [account.code, account.id]));
  }

  private async stockException(
    client: PoolClient,
    companyId: string,
    branchId: string,
    input: SaleSyncInput,
    products: ReadonlyMap<string, ProductRow>,
  ): Promise<boolean> {
    const quantities = new Map<string, bigint>();
    for (const line of input.lines) {
      if (products.get(line.productId)?.product_kind !== "stock") continue;
      quantities.set(
        line.productId,
        (quantities.get(line.productId) ?? 0n) + BigInt(line.quantity),
      );
    }
    let exception = false;
    for (const [productId, quantity] of [...quantities.entries()].sort()) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `${companyId}:stock:${branchId}:${productId}`,
      ]);
      const current = await client.query<{ quantity: string }>(
        "SELECT inventory.stock_on_hand($1, $2)::text AS quantity",
        [branchId, productId],
      );
      if (moneyUnits(current.rows[0].quantity) - quantity * decimalScale < 0n)
        exception = true;
    }
    return exception;
  }

  private async createPostedJournal(
    client: PoolClient,
    context: Context,
    input: SaleSyncInput,
    period: PeriodRow,
    accounts: ReadonlyMap<string, string>,
  ): Promise<string> {
    const entry = await client.query<{ id: string }>(
      `INSERT INTO accounting.journal_entry
         (company_id, fiscal_period_id, journal_date, entry_type, description,
          source_type, source_id, created_by_user_id)
       VALUES ($1, $2, $3::date, 'system', $4, 'pos.sale', $5, $6)
       RETURNING id`,
      [
        context.companyId,
        period.id,
        period.journal_date,
        `POS cash sale ${input.localReceiptId}`,
        input.eventId,
        context.actorUserId,
      ],
    );
    const journalEntryId = entry.rows[0].id;
    const lines: Array<readonly [string, string, string]> = [
      [accounts.get("1000")!, input.totals.totalAmount, "0"],
      [accounts.get("4000")!, "0", input.totals.netAmount],
    ];
    if (moneyUnits(input.totals.taxAmount) > 0n)
      lines.splice(1, 0, [accounts.get("2000")!, "0", input.totals.taxAmount]);
    for (const [index, line] of lines.entries()) {
      await client.query(
        `INSERT INTO accounting.journal_line
           (company_id, journal_entry_id, account_id, line_number,
            debit_amount, credit_amount)
         VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric)`,
        [
          context.companyId,
          journalEntryId,
          line[0],
          index + 1,
          line[1],
          line[2],
        ],
      );
    }
    await client.query("SELECT accounting.post_journal_entry($1)", [
      journalEntryId,
    ]);
    return journalEntryId;
  }

  private async insertSale(
    client: PoolClient,
    companyId: string,
    branchId: string,
    input: SaleSyncInput,
    details: Readonly<{
      digest: Buffer;
      journalEntryId: string;
      products: ReadonlyMap<string, ProductRow>;
      stockException: boolean;
    }>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO pos.sale_event
         (id, company_id, branch_id, device_id, cashier_user_id, cash_shift_id,
          offline_grant_id, policy_id, policy_version, schema_version, event_type,
          local_receipt_id, local_sequence, occurred_at, currency_code,
          payment_method, net_amount, tax_amount, total_amount, payment_amount,
          payload_digest, device_signature, stock_exception, journal_entry_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               $14::timestamptz, $15, $16, $17::numeric, $18::numeric,
               $19::numeric, $20::numeric, $21, $22, $23, $24)`,
      [
        input.eventId,
        companyId,
        branchId,
        input.deviceId,
        input.cashierUserId,
        input.shiftId,
        input.authorityGrantId,
        input.authorityPolicyId,
        input.authorityPolicyVersion,
        input.schemaVersion,
        input.eventType,
        input.localReceiptId,
        input.localSequence,
        input.occurredAt,
        input.currency,
        input.payment.method,
        input.totals.netAmount,
        input.totals.taxAmount,
        input.totals.totalAmount,
        input.payment.amount,
        details.digest,
        Buffer.from(base64UrlBytes(input.deviceSignature)),
        details.stockException,
        details.journalEntryId,
      ],
    );
    for (const [index, line] of input.lines.entries()) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO pos.sale_line
           (company_id, sale_event_id, line_number, product_id, product_name, sku,
            quantity, unit_price, tax_treatment, tax_code_id, tax_code, tax_name,
            tax_rate, net_amount, tax_amount, total_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8::numeric, $9, $10,
                 $11, $12, $13::numeric, $14::numeric, $15::numeric, $16::numeric)
         RETURNING id`,
        [
          companyId,
          input.eventId,
          index + 1,
          line.productId,
          line.productName,
          line.sku,
          line.quantity,
          line.unitPrice,
          line.taxTreatment,
          line.taxCode?.id ?? null,
          line.taxCode?.code ?? null,
          line.taxCode?.name ?? null,
          line.taxCode?.rate ?? null,
          line.netAmount,
          line.taxAmount,
          line.totalAmount,
        ],
      );
      if (details.products.get(line.productId)?.product_kind !== "stock")
        continue;
      await client.query(
        `INSERT INTO inventory.stock_movement
           (company_id, branch_id, product_id, sale_line_id, movement_type,
            quantity_delta, occurred_at)
         VALUES ($1, $2, $3, $4, 'sale', $5::numeric, $6::timestamptz)`,
        [
          companyId,
          branchId,
          line.productId,
          inserted.rows[0].id,
          -line.quantity,
          input.occurredAt,
        ],
      );
    }
  }

  private async verifyDeviceSignature(
    publicKeyJwk: JsonWebKey,
    input: SaleSyncInput,
  ): Promise<boolean> {
    try {
      const publicKey = await webcrypto.subtle.importKey(
        "jwk",
        publicKeyJwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      return webcrypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        arrayBuffer(base64UrlBytes(input.deviceSignature)),
        arrayBuffer(posCashSaleSignaturePayload(unsignedEvent(input))),
      );
    } catch {
      return false;
    }
  }

  private async withTenant<T>(
    context: Context,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.current_company_id', $1, true)",
        [context.companyId],
      );
      await client.query(
        "SELECT set_config('app.current_actor_id', $1, true)",
        [context.actorUserId],
      );
      await client.query("SET LOCAL ROLE ledgerlite_app");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
