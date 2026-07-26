import "reflect-metadata";

import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { JournalManagementController } from "../src/accounting/journal-management.controller.js";
import type { JournalManagementService } from "../src/accounting/journal-management.service.js";

const companyId = "c22ff1c3-253f-4457-bcc5-3098d827de20";
const periodId = "d556b3b8-fdbc-4ea6-9c0b-531dd8e704ed";
const cashAccountId = "f0fd3509-4724-4b95-86c8-d2a4a6f0a204";
const salesAccountId = "dcebc785-a5d1-474b-a5d1-2b27d04e6668";
const actor = { userId: "d22fc785-a5d1-474b-a5d1-2b27d04e6668" };

describe("JournalManagementController", () => {
  it("validates a balanced manual journal command", () => {
    const calls: unknown[] = [];
    const controller = new JournalManagementController({
      post: (...args: unknown[]) => {
        calls.push(args);
        return { accepted: true };
      },
    } as unknown as JournalManagementService);

    controller.post(
      companyId,
      {
        fiscalPeriodId: periodId,
        journalDate: "2026-07-26",
        description: "Cash sale correction",
        lines: [
          { accountId: cashAccountId, debitAmount: "10" },
          { accountId: salesAccountId, creditAmount: "10" },
        ],
      },
      "journal-post-1",
      actor,
    );

    expect(calls).toEqual([
      [
        { companyId, actorUserId: actor.userId },
        {
          fiscalPeriodId: periodId,
          journalDate: "2026-07-26",
          description: "Cash sale correction",
          lines: [
            {
              accountId: cashAccountId,
              debitAmount: "10",
              creditAmount: "0",
            },
            {
              accountId: salesAccountId,
              debitAmount: "0",
              creditAmount: "10",
            },
          ],
        },
        "journal-post-1",
      ],
    ]);
  });

  it("rejects unbalanced or invalid journal input", () => {
    const controller = new JournalManagementController(
      {} as JournalManagementService,
    );

    expect(() =>
      controller.post(
        companyId,
        {
          fiscalPeriodId: periodId,
          journalDate: "2026-02-30",
          description: "Invalid",
          lines: [
            { accountId: cashAccountId, debitAmount: "10" },
            { accountId: salesAccountId, creditAmount: "9" },
          ],
        },
        "journal-post-1",
        actor,
      ),
    ).toThrow(BadRequestException);
  });
});
