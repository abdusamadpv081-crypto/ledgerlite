import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import {
  CurrentActor,
  RequireCapability,
} from "../auth/authorization.decorators.js";
import { ScopedCapabilityGuard } from "../auth/scoped-capability.guard.js";
import { SessionAuthenticationGuard } from "../auth/session-authentication.guard.js";
import type { AuthenticatedActor } from "../auth/session.service.js";
import {
  JournalManagementService,
  type PostJournalInput,
} from "./journal-management.service.js";

const id = z.string().uuid();
const key = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._~-]+$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const decimal = z.string().regex(/^\d+(?:\.\d{1,6})?$/);
const localDate = z.string().refine(
  (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  },
  { message: "A valid ISO local date is required." },
);
const line = z
  .object({
    accountId: id,
    debitAmount: decimal.default("0"),
    creditAmount: decimal.default("0"),
    description: text(500).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const debit = Number(value.debitAmount);
    const credit = Number(value.creditAmount);
    if (!((debit > 0 && credit === 0) || (credit > 0 && debit === 0)))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A journal line must have exactly one positive debit or credit amount.",
      });
  });
const journal = z
  .object({
    fiscalPeriodId: id,
    journalDate: localDate,
    description: text(500),
    lines: z.array(line).min(2).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    const debit = value.lines.reduce(
      (sum, item) => sum + Number(item.debitAmount),
      0,
    );
    const credit = value.lines.reduce(
      (sum, item) => sum + Number(item.creditAmount),
      0,
    );
    if (Math.abs(debit - credit) > 0.0000001)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Journal debits and credits must balance.",
      });
  });
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}
function idempotency(value: unknown): string {
  if (Array.isArray(value))
    throw new BadRequestException(
      "Only one Idempotency-Key header is allowed.",
    );
  return parse(key, value);
}

@Controller("companies/:companyId/accounting/journals")
@UseGuards(SessionAuthenticationGuard, ScopedCapabilityGuard)
export class JournalManagementController {
  constructor(private readonly journals: JournalManagementService) {}

  @Get()
  @RequireCapability("accounting.journal.read")
  list(
    @Param("companyId") companyId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.journals.list({
      companyId: parse(id, companyId),
      actorUserId: actor.userId,
    });
  }

  @Post()
  @RequireCapability("accounting.journal.post")
  post(
    @Param("companyId") companyId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") header: unknown,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.journals.post(
      { companyId: parse(id, companyId), actorUserId: actor.userId },
      parse(journal, body) as PostJournalInput,
      idempotency(header),
    );
  }
}
