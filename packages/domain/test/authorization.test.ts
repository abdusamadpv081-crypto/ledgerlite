import { describe, expect, it } from "vitest";
import {
  capabilityGrantsForRole,
  roleGrantsCapability,
} from "../src/authorization.js";

describe("role capability templates", () => {
  it("keeps financial configuration company-scoped", () => {
    expect(roleGrantsCapability("owner", "accounting.period.manage")).toBe(
      true,
    );
    expect(roleGrantsCapability("accountant", "accounting.chart.manage")).toBe(
      true,
    );
    expect(
      roleGrantsCapability("branch_manager", "accounting.period.manage"),
    ).toBe(false);
    expect(
      roleGrantsCapability("branch_manager", "accounting.chart.manage"),
    ).toBe(false);
  });

  it("limits cashiers to operational POS and catalogue capabilities", () => {
    expect(roleGrantsCapability("cashier", "pos.sale.create")).toBe(true);
    expect(roleGrantsCapability("cashier", "catalog.read")).toBe(true);
    expect(roleGrantsCapability("cashier", "catalog.manage")).toBe(false);
    expect(roleGrantsCapability("cashier", "audit.read")).toBe(false);
  });

  it("marks operational roles as branch-scoped", () => {
    const grants = capabilityGrantsForRole("branch_manager");

    expect(grants).toContainEqual({
      capability: "inventory.override",
      scope: "branch",
    });
  });
});
