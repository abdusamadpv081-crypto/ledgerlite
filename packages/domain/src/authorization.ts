export const ROLE_TEMPLATES = [
  "owner",
  "accountant",
  "branch_manager",
  "cashier",
] as const;

export type RoleTemplate = (typeof ROLE_TEMPLATES)[number];

export const CAPABILITIES = [
  "company.read",
  "company.manage",
  "branch.read",
  "branch.manage",
  "access.manage",
  "catalog.read",
  "catalog.manage",
  "inventory.read",
  "inventory.manage",
  "inventory.override",
  "pos.shift.operate",
  "pos.shift.review",
  "pos.sale.create",
  "pos.sale.refund",
  "pos.sale.approve",
  "pos.policy.read",
  "pos.policy.manage",
  "pos.device.manage",
  "accounting.journal.read",
  "accounting.journal.post",
  "accounting.period.manage",
  "reporting.read",
  "audit.read",
] as const;

export type Capability = (typeof CAPABILITIES)[number];
export type CapabilityScope = "company" | "branch";

export type CapabilityGrant = Readonly<{
  capability: Capability;
  scope: CapabilityScope;
}>;

const companyCapabilities: readonly Capability[] = [
  "company.read",
  "company.manage",
  "branch.read",
  "branch.manage",
  "access.manage",
  "catalog.read",
  "catalog.manage",
  "inventory.read",
  "inventory.manage",
  "inventory.override",
  "pos.shift.review",
  "pos.sale.refund",
  "pos.sale.approve",
  "pos.policy.read",
  "pos.policy.manage",
  "pos.device.manage",
  "accounting.journal.read",
  "accounting.journal.post",
  "accounting.period.manage",
  "reporting.read",
  "audit.read",
];

const accountantCapabilities: readonly Capability[] = [
  "company.read",
  "branch.read",
  "catalog.read",
  "pos.policy.read",
  "accounting.journal.read",
  "accounting.journal.post",
  "accounting.period.manage",
  "reporting.read",
  "audit.read",
];

const branchManagerCapabilities: readonly Capability[] = [
  "branch.read",
  "branch.manage",
  "catalog.read",
  "catalog.manage",
  "inventory.read",
  "inventory.manage",
  "inventory.override",
  "pos.shift.operate",
  "pos.shift.review",
  "pos.sale.create",
  "pos.sale.refund",
  "pos.sale.approve",
  "pos.policy.read",
  "pos.device.manage",
  "audit.read",
];

const cashierCapabilities: readonly Capability[] = [
  "branch.read",
  "catalog.read",
  "pos.shift.operate",
  "pos.sale.create",
  "pos.sale.refund",
];

const capabilitiesByRole: Readonly<
  Record<RoleTemplate, readonly Capability[]>
> = {
  owner: companyCapabilities,
  accountant: accountantCapabilities,
  branch_manager: branchManagerCapabilities,
  cashier: cashierCapabilities,
};

export function capabilityGrantsForRole(
  role: RoleTemplate,
): readonly CapabilityGrant[] {
  const scope: CapabilityScope =
    role === "owner" || role === "accountant" ? "company" : "branch";

  return capabilitiesByRole[role].map((capability) => ({ capability, scope }));
}

export function roleGrantsCapability(
  role: RoleTemplate,
  capability: Capability,
): boolean {
  return capabilitiesByRole[role].includes(capability);
}
