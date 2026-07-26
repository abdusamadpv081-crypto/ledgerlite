"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Banknote,
  CircleAlert,
  CloudOff,
  KeyRound,
  Minus,
  MonitorSmartphone,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  WifiOff,
} from "lucide-react";
import { commandHeaders, request } from "../../lib/api";
import {
  cachedCashierPin,
  enrollCashierPin,
  unlockCashierPin,
  type CachedCashierPin,
  type CashierPinSetProfile,
} from "../../lib/pos-cashier-pin";
import {
  cachedOfflineAuthority,
  refreshOfflineAuthority,
  type CachedOfflineAuthority,
} from "../../lib/pos-offline-authority";
import {
  cacheCashShift,
  cachedCashShift,
  clearCachedCashShift,
  type CachedCashShift,
} from "../../lib/pos-cash-shift";
import {
  cachedPosCatalogue,
  refreshPosCatalogue,
  type CachedPosCatalogue,
} from "../../lib/pos-catalogue";
import {
  canUseDeviceCrypto,
  localDevice,
  type LocalPosDevice,
} from "../../lib/pos-device";
import {
  enqueueLocalCashSale,
  pendingLocalCashSales,
  type LocalCashSaleEvent,
} from "../../lib/pos-sale-outbox";

type Company = {
  companyId: string;
  legalName: string;
  tradeName: string | null;
  roles: string[];
};
type Branch = {
  companyId: string;
  branchId: string;
  code: string;
  name: string;
};
type CurrentUser = { userId: string };
type CommandResponse<T> = { data: T; correlationId: string };
type CartLine = Readonly<{ productId: string; quantity: number }>;

function canOperatePos(company: Company | undefined): boolean {
  return Boolean(
    company?.roles.includes("cashier") ||
    company?.roles.includes("branch_manager"),
  );
}
function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-AE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dubai",
  }).format(new Date(value));
}
function formatMoney(value: string | number, currency: string): string {
  return new Intl.NumberFormat("en-AE", {
    currency,
    style: "currency",
  }).format(Number(value));
}

export default function PosAccessPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [userId, setUserId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [device, setDevice] = useState<LocalPosDevice>();
  const [authority, setAuthority] = useState<CachedOfflineAuthority>();
  const [cashierPin, setCashierPin] = useState<CachedCashierPin>();
  const [cashShift, setCashShift] = useState<CachedCashShift>();
  const [catalogue, setCatalogue] = useState<CachedPosCatalogue>();
  const [cart, setCart] = useState<readonly CartLine[]>([]);
  const [pendingSales, setPendingSales] = useState<
    readonly LocalCashSaleEvent[]
  >([]);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [unlockPinValue, setUnlockPinValue] = useState("");
  const [openingFloat, setOpeningFloat] = useState("");
  const [localSessionExpiresAt, setLocalSessionExpiresAt] = useState("");
  const [message, setMessage] = useState(
    "Checking your assigned POS workspace...",
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingCatalogue, setRefreshingCatalogue] = useState(false);
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [shiftSubmitting, setShiftSubmitting] = useState(false);
  const [saleSubmitting, setSaleSubmitting] = useState(false);
  const [secureBrowser, setSecureBrowser] = useState(false);
  const company = useMemo(
    () => companies.find((item) => item.companyId === companyId),
    [companies, companyId],
  );
  const selectableCompanies = useMemo(
    () => companies.filter(canOperatePos),
    [companies],
  );
  const selectableBranches = useMemo(
    () => branches.filter((branch) => branch.companyId === companyId),
    [branches, companyId],
  );
  const cashierUnlocked =
    Boolean(localSessionExpiresAt) &&
    Date.parse(localSessionExpiresAt) > Date.now();
  const cashShiftOnThisDevice = Boolean(
    cashShift &&
    cashShift.deviceId === device?.deviceId &&
    (cashShift.status === "open" || cashShift.status === "close_requested"),
  );
  const cartItems = useMemo(
    () =>
      cart.flatMap((line) => {
        const product = catalogue?.products.find(
          (item) => item.id === line.productId,
        );
        return product ? [{ product, quantity: line.quantity }] : [];
      }),
    [cart, catalogue],
  );
  const cartTotal = useMemo(
    () =>
      cartItems.reduce(
        (total, item) => total + Number(item.product.unitPrice) * item.quantity,
        0,
      ),
    [cartItems],
  );

  const loadAuthority = useCallback(
    async (
      nextCompanyId: string,
      nextBranchId: string,
      currentUserId: string,
    ) => {
      if (!nextCompanyId || !nextBranchId || !currentUserId) return;
      setLoading(true);
      try {
        const storedDevice = await localDevice(nextCompanyId, nextBranchId);
        setDevice(storedDevice);
        if (storedDevice?.state !== "registered" || !storedDevice.deviceId) {
          setAuthority(undefined);
          setCashierPin(undefined);
          setCashShift(undefined);
          setCatalogue(undefined);
          setCart([]);
          setPendingSales([]);
          setMessage(
            "Register this browser as a POS device before refreshing offline authority.",
          );
          return;
        }
        const scope = {
          companyId: nextCompanyId,
          branchId: nextBranchId,
          deviceId: storedDevice.deviceId,
          cashierUserId: currentUserId,
        };
        const [cached, cachedPin, cachedShift, cachedCatalogue, cachedSales] =
          await Promise.all([
            cachedOfflineAuthority(scope),
            cachedCashierPin(scope),
            cachedCashShift(scope),
            cachedPosCatalogue(scope),
            pendingLocalCashSales(scope),
          ]);
        setAuthority(cached);
        setCashierPin(cachedPin);
        setCashShift(cachedShift);
        setCatalogue(cachedCatalogue);
        setPendingSales(cachedSales);
        setCart([]);
        try {
          const current = await request<CachedCashShift | null>(
            `/companies/${nextCompanyId}/branches/${nextBranchId}/pos/shifts/current`,
          );
          if (!current) {
            await clearCachedCashShift(scope);
            setCashShift(undefined);
          } else {
            setCashShift(current);
            if (current.deviceId === scope.deviceId)
              await cacheCashShift(scope, current);
          }
        } catch {
          // A cached server-confirmed shift remains available during an outage.
        }
        setMessage(
          cached
            ? `Offline authority is ready until ${formatTimestamp(cached.expiresAt)}.`
            : "No valid offline authority is cached for this cashier and device.",
        );
      } catch (error) {
        setDevice(undefined);
        setAuthority(undefined);
        setCashierPin(undefined);
        setCashShift(undefined);
        setCatalogue(undefined);
        setCart([]);
        setPendingSales([]);
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not inspect local POS authority.",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    setSecureBrowser(canUseDeviceCrypto());
    void (async () => {
      try {
        const [currentUser, nextCompanies, nextBranches] = await Promise.all([
          request<CurrentUser>("/auth/me"),
          request<Company[]>("/auth/companies"),
          request<Branch[]>("/auth/branches"),
        ]);
        setUserId(currentUser.userId);
        setCompanies(nextCompanies);
        setBranches(nextBranches);
        const initialCompany = nextCompanies.find(canOperatePos);
        const initialBranch = nextBranches.find(
          (branch) => branch.companyId === initialCompany?.companyId,
        );
        setCompanyId(initialCompany?.companyId ?? "");
        setBranchId(initialBranch?.branchId ?? "");
        if (!initialCompany)
          setMessage(
            "Your assigned role cannot refresh offline POS authority. Ask an owner to provision a cashier or branch-manager role for this branch.",
          );
        else if (!initialBranch)
          setMessage("No active branch is assigned for offline POS authority.");
        else
          await loadAuthority(
            initialCompany.companyId,
            initialBranch.branchId,
            currentUser.userId,
          );
      } catch {
        setMessage("Sign in to access an assigned POS workspace.");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadAuthority]);

  async function refreshAuthority() {
    if (!companyId || !branchId || !userId || !device) return;
    setRefreshing(true);
    try {
      const refreshed = await refreshOfflineAuthority({
        companyId,
        branchId,
        cashierUserId: userId,
        device,
      });
      setAuthority(refreshed);
      setMessage(
        `Offline authority is ready until ${formatTimestamp(refreshed.expiresAt)}. Cashier unlock and an open shift are required before sales.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `${error.message} Retry safely when connectivity returns.`
          : "Could not refresh offline authority. Retry safely when connectivity returns.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function refreshCatalogue() {
    const scope = offlineScope();
    if (!scope) return;
    setRefreshingCatalogue(true);
    try {
      const refreshed = await refreshPosCatalogue(scope);
      setCatalogue(refreshed);
      setCart((current) =>
        current.filter((line) =>
          refreshed.products.some((product) => product.id === line.productId),
        ),
      );
      setMessage(
        `${refreshed.products.length} sellable products are encrypted for offline checkout.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not refresh the POS catalogue.",
      );
    } finally {
      setRefreshingCatalogue(false);
    }
  }

  function addToCart(productId: string) {
    setCart((current) => {
      const existing = current.find((line) => line.productId === productId);
      if (!existing) return [...current, { productId, quantity: 1 }];
      if (existing.quantity >= 999_999) return current;
      return current.map((line) =>
        line.productId === productId
          ? { ...line, quantity: line.quantity + 1 }
          : line,
      );
    });
  }

  function changeCartQuantity(productId: string, amount: number) {
    setCart((current) =>
      current.flatMap((line) => {
        if (line.productId !== productId) return [line];
        const quantity = line.quantity + amount;
        return quantity > 0 ? [{ ...line, quantity }] : [];
      }),
    );
  }

  async function saveLocalCashSale() {
    const scope = offlineScope();
    if (
      !scope ||
      !authority ||
      !cashShift ||
      cashShift.status !== "open" ||
      !cashShiftOnThisDevice ||
      !cashierUnlocked ||
      !catalogue ||
      cartItems.length === 0 ||
      cartItems.length !== cart.length
    ) {
      setMessage(
        "Refresh the POS catalogue, unlock the cashier PIN, and open a cash shift before saving a local sale.",
      );
      return;
    }
    setSaleSubmitting(true);
    try {
      const sale = await enqueueLocalCashSale({
        context: {
          scope,
          authority,
          cashShift,
          localSessionExpiresAt,
        },
        products: catalogue.products,
        lines: cartItems.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
        })),
      });
      setCart([]);
      setPendingSales(await pendingLocalCashSales(scope));
      setMessage(
        `Cash sale ${sale.localReceiptId} is saved encrypted on this device and pending server synchronization. No journal, stock movement, or tax receipt has been created yet.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save the local sale.",
      );
    } finally {
      setSaleSubmitting(false);
    }
  }

  function offlineScope() {
    if (!companyId || !branchId || !userId || !device?.deviceId) return;
    return {
      companyId,
      branchId,
      deviceId: device.deviceId,
      cashierUserId: userId,
    };
  }

  async function setPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const scope = offlineScope();
    if (!scope || !device || newPin !== confirmPin) {
      if (newPin !== confirmPin)
        setMessage("The POS PIN entries do not match.");
      return;
    }
    setPinSubmitting(true);
    try {
      const response = await request<CommandResponse<CashierPinSetProfile>>(
        `/companies/${scope.companyId}/branches/${scope.branchId}/pos/pin`,
        {
          method: "POST",
          headers: commandHeaders(),
          body: JSON.stringify({ deviceId: scope.deviceId, pin: newPin }),
        },
      );
      const enrolled = await enrollCashierPin(scope, newPin, response.data);
      setCashierPin(enrolled);
      setNewPin("");
      setConfirmPin("");
      setMessage(
        "Cashier PIN is set. Its encrypted local verifier is ready for offline unlock.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not set the cashier PIN.",
      );
    } finally {
      setPinSubmitting(false);
    }
  }

  async function verifyCashierPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const scope = offlineScope();
    if (!scope || !authority) return;
    setPinSubmitting(true);
    try {
      const result = await unlockCashierPin(scope, unlockPinValue, authority);
      setUnlockPinValue("");
      if (result.status === "unlocked") {
        setLocalSessionExpiresAt(result.expiresAt);
        setCashierPin((current) =>
          current
            ? { ...current, failedAttempts: 0, lockedUntil: null }
            : current,
        );
        setMessage(
          `Cashier PIN verified locally until ${formatTimestamp(result.expiresAt)}. Open a cash shift online before sales.`,
        );
      } else if (result.status === "locked") {
        setCashierPin((current) =>
          current ? { ...current, lockedUntil: result.lockedUntil } : current,
        );
        setMessage(
          `Offline PIN unlock is locked until ${formatTimestamp(result.lockedUntil)}.`,
        );
      } else {
        setCashierPin((current) =>
          current
            ? {
                ...current,
                failedAttempts:
                  current.policy.maxFailedAttempts - result.remainingAttempts,
              }
            : current,
        );
        setMessage(
          `POS PIN was not accepted. ${result.remainingAttempts} attempts remain before local cool-off.`,
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not verify the local cashier PIN.",
      );
    } finally {
      setPinSubmitting(false);
    }
  }

  async function openCashShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const scope = offlineScope();
    if (!scope || !authority || !cashierUnlocked) {
      setMessage(
        "Refresh offline authority and verify the cashier PIN before opening a shift.",
      );
      return;
    }
    setShiftSubmitting(true);
    try {
      const response = await request<CommandResponse<CachedCashShift>>(
        `/companies/${scope.companyId}/branches/${scope.branchId}/pos/shifts`,
        {
          method: "POST",
          headers: commandHeaders(),
          body: JSON.stringify({
            deviceId: scope.deviceId,
            openingFloat,
          }),
        },
      );
      const opened = await cacheCashShift(scope, response.data);
      setCashShift(opened);
      setOpeningFloat("");
      setMessage(
        `Cash shift opened with ${opened.currencyCode} ${opened.openingFloat}. Refresh the POS catalogue, then save local cash sales for later synchronization.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not open the cash shift.",
      );
    } finally {
      setShiftSubmitting(false);
    }
  }

  function selectCompany(nextCompanyId: string) {
    const nextBranch = branches.find(
      (branch) => branch.companyId === nextCompanyId,
    );
    setCompanyId(nextCompanyId);
    setBranchId(nextBranch?.branchId ?? "");
    setDevice(undefined);
    setAuthority(undefined);
    setCashierPin(undefined);
    setCashShift(undefined);
    setCatalogue(undefined);
    setCart([]);
    setPendingSales([]);
    setLocalSessionExpiresAt("");
    if (nextBranch)
      void loadAuthority(nextCompanyId, nextBranch.branchId, userId);
  }

  function selectBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    setDevice(undefined);
    setAuthority(undefined);
    setCashierPin(undefined);
    setCashShift(undefined);
    setCatalogue(undefined);
    setCart([]);
    setPendingSales([]);
    setLocalSessionExpiresAt("");
    void loadAuthority(companyId, nextBranchId, userId);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">LL</span>
          <span>Ledger Lite</span>
        </div>
        <nav aria-label="Primary">
          <a href="/">Catalogue</a>
          <a href="/finance">Finance</a>
          <a href="/devices">POS devices</a>
          <a className="nav-active" href="#pos-access">
            <WifiOff size={18} />
            POS access
          </a>
        </nav>
        <p className="sidebar-note">
          UAE retail pilot
          <br />
          Offline authority setup
        </p>
      </aside>
      <section className="workspace" id="pos-access">
        <header className="topbar">
          <div>
            <p className="eyebrow">POS foundation</p>
            <h1>Offline POS access</h1>
          </div>
          <div className="device-scope-selectors">
            <label className="company-select">
              Company
              <select
                value={companyId}
                onChange={(event) => selectCompany(event.target.value)}
              >
                {selectableCompanies.length === 0 ? (
                  <option value="">No POS role</option>
                ) : (
                  selectableCompanies.map((item) => (
                    <option key={item.companyId} value={item.companyId}>
                      {item.tradeName ?? item.legalName}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="company-select">
              Branch
              <select
                value={branchId}
                onChange={(event) => selectBranch(event.target.value)}
                disabled={selectableBranches.length === 0}
              >
                {selectableBranches.length === 0 ? (
                  <option value="">No assigned branch</option>
                ) : (
                  selectableBranches.map((branch) => (
                    <option key={branch.branchId} value={branch.branchId}>
                      {branch.code} - {branch.name}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>
        </header>
        <p className="status" role="status" aria-live="polite">
          {message}
        </p>
        {!secureBrowser ? (
          <section className="notice notice-danger">
            <CircleAlert aria-hidden="true" size={18} />
            <div>
              <strong>Secure browser context required.</strong> Open Ledger Lite
              over HTTPS (or localhost) in a modern browser before using local
              POS authority.
            </div>
          </section>
        ) : null}

        <section className="summary-grid" aria-label="Offline POS status">
          <article>
            <span>This browser</span>
            <strong>
              {device?.state === "registered" ? "Registered" : "Not ready"}
            </strong>
            <small>
              {device?.state === "registered"
                ? "Device signing key available"
                : "Device registration is required"}
            </small>
          </article>
          <article>
            <span>Offline authority</span>
            <strong>{authority ? "Ready" : "Not cached"}</strong>
            <small>
              {authority
                ? "ES256 grant verified and encrypted locally"
                : "Refresh while online before an outage"}
            </small>
          </article>
          <article>
            <span>Authority expiry</span>
            <strong>
              {authority ? formatTimestamp(authority.expiresAt) : "—"}
            </strong>
            <small>
              {authority
                ? "New sales will be blocked after expiry"
                : "The configured policy controls grant duration"}
            </small>
          </article>
          <article>
            <span>Cashier unlock</span>
            <strong>
              {cashierUnlocked
                ? "Unlocked"
                : cashierPin
                  ? "PIN ready"
                  : "Not set"}
            </strong>
            <small>
              {cashierUnlocked
                ? `Session ends ${formatTimestamp(localSessionExpiresAt)}`
                : cashierPin
                  ? "Enter PIN to start a bounded local session"
                  : "Set a PIN online on this browser device"}
            </small>
          </article>
          <article>
            <span>Cash shift</span>
            <strong>
              {cashShiftOnThisDevice
                ? "Open"
                : cashShift
                  ? "Open elsewhere"
                  : "Not open"}
            </strong>
            <small>
              {cashShiftOnThisDevice && cashShift
                ? `${cashShift.currencyCode} ${cashShift.openingFloat} opening float`
                : cashShift
                  ? "Close the active shift on its registered device first"
                  : "Open online after local cashier unlock"}
            </small>
          </article>
        </section>

        <section className="content-grid device-grid">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Online refresh</p>
                <h2>Prepare this cashier for an outage</h2>
              </div>
              <KeyRound aria-hidden="true" />
            </div>
            <div className={authority ? "device-trust-state" : "inline-alert"}>
              {authority ? (
                <ShieldCheck aria-hidden="true" size={24} />
              ) : (
                <CircleAlert aria-hidden="true" size={18} />
              )}
              <div>
                <strong>
                  {authority
                    ? "Bound to this cashier, branch, and browser device."
                    : "Connect online to refresh a device-proof authority grant."}
                </strong>
                <p>
                  Ledger Lite verifies the browser’s registered P-256 signing
                  key, then encrypts the signed authority and retry state in
                  local browser storage. No session token or POS PIN is cached.
                </p>
                {authority ? (
                  <p>
                    Grant {authority.grantId} uses policy version{" "}
                    {authority.policyVersion}
                    and expires {formatTimestamp(authority.expiresAt)}.
                  </p>
                ) : null}
              </div>
            </div>
            <button
              className="primary"
              onClick={() => void refreshAuthority()}
              disabled={
                loading ||
                refreshing ||
                !secureBrowser ||
                !canOperatePos(company) ||
                device?.state !== "registered"
              }
            >
              <RefreshCw size={18} />
              {refreshing
                ? "Refreshing offline authority..."
                : "Refresh offline authority"}
            </button>
            <p className="form-help">
              If a network response is lost, retry this action. The device keeps
              the same encrypted proof and idempotency keys until the server
              response is recovered.
            </p>

            <div className="panel-stack">
              <div>
                <p className="eyebrow">Cashier PIN</p>
                <h3>{cashierPin ? "Local unlock" : "Set a cashier PIN"}</h3>
              </div>
              {!cashierPin ? (
                <form className="stack compact" onSubmit={setPin}>
                  <label>
                    New numeric PIN
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      value={newPin}
                      onChange={(event) => setNewPin(event.target.value)}
                      minLength={8}
                      maxLength={16}
                      pattern="[0-9]{8,16}"
                      required
                      disabled={
                        pinSubmitting ||
                        !authority ||
                        device?.state !== "registered"
                      }
                    />
                  </label>
                  <label>
                    Confirm numeric PIN
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      value={confirmPin}
                      onChange={(event) => setConfirmPin(event.target.value)}
                      minLength={8}
                      maxLength={16}
                      pattern="[0-9]{8,16}"
                      required
                      disabled={
                        pinSubmitting ||
                        !authority ||
                        device?.state !== "registered"
                      }
                    />
                  </label>
                  <button
                    className="secondary"
                    disabled={
                      pinSubmitting ||
                      !authority ||
                      device?.state !== "registered"
                    }
                  >
                    <KeyRound size={18} />
                    Set cashier PIN
                  </button>
                </form>
              ) : (
                <form className="stack compact" onSubmit={verifyCashierPin}>
                  <label>
                    Cashier PIN
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="current-password"
                      value={unlockPinValue}
                      onChange={(event) =>
                        setUnlockPinValue(event.target.value)
                      }
                      maxLength={cashierPin.policy.maxLength}
                      pattern="[0-9]+"
                      required
                      disabled={pinSubmitting || !authority}
                    />
                  </label>
                  {cashierPin.lockedUntil ? (
                    <p className="form-help">
                      Local unlock is unavailable until{" "}
                      {formatTimestamp(cashierPin.lockedUntil)}.
                    </p>
                  ) : (
                    <p className="form-help">
                      {cashierPin.policy.maxFailedAttempts -
                        cashierPin.failedAttempts}{" "}
                      attempts remain before a{" "}
                      {cashierPin.policy.coolOffMinutes}-minute local cool-off.
                    </p>
                  )}
                  <button
                    className="secondary"
                    disabled={pinSubmitting || !authority}
                  >
                    <KeyRound size={18} />
                    Verify cashier PIN
                  </button>
                </form>
              )}
            </div>

            <div className="panel-stack">
              <div>
                <p className="eyebrow">Cash shift</p>
                <h3>
                  {cashShiftOnThisDevice
                    ? "Cash accountability is active"
                    : "Open this device's cash shift"}
                </h3>
              </div>
              {cashShiftOnThisDevice && cashShift ? (
                <div className="device-trust-state">
                  <ShieldCheck aria-hidden="true" size={24} />
                  <div>
                    <strong>
                      Opened {formatTimestamp(cashShift.openedAt)} with{" "}
                      {cashShift.currencyCode} {cashShift.openingFloat}.
                    </strong>
                    <p>
                      This encrypted local copy identifies the active cash
                      shift. Its opening float is a custody amount, not a
                      journal entry or sale.
                    </p>
                  </div>
                </div>
              ) : cashShift ? (
                <div className="inline-alert">
                  <CircleAlert aria-hidden="true" size={18} />
                  <div>
                    <strong>An active shift exists on another device.</strong>
                    <p>
                      Close that shift before this cashier opens another. A
                      cashier cannot own two active tills.
                    </p>
                  </div>
                </div>
              ) : (
                <form className="stack compact" onSubmit={openCashShift}>
                  <label>
                    Opening float (company base currency)
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={openingFloat}
                      onChange={(event) => setOpeningFloat(event.target.value)}
                      pattern="(?:0|[1-9][0-9]{0,11})(?:\\.[0-9]{1,2})?"
                      placeholder="0.00"
                      required
                      disabled={
                        shiftSubmitting ||
                        !authority ||
                        !cashierUnlocked ||
                        device?.state !== "registered"
                      }
                    />
                  </label>
                  <p className="form-help">
                    Opens online in the company base currency. A new offline
                    shift cannot be started until the encrypted POS outbox is
                    implemented.
                  </p>
                  <button
                    className="secondary"
                    disabled={
                      shiftSubmitting ||
                      !authority ||
                      !cashierUnlocked ||
                      device?.state !== "registered"
                    }
                  >
                    <ShieldCheck size={18} />
                    {shiftSubmitting
                      ? "Opening cash shift..."
                      : "Open cash shift"}
                  </button>
                </form>
              )}
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Current boundary</p>
                <h2>What this enables</h2>
              </div>
              <MonitorSmartphone aria-hidden="true" />
            </div>
            <ol className="trust-steps">
              <li>
                Only a registered browser device can prove key possession.
              </li>
              <li>
                The authority is limited to the configured offline window.
              </li>
              <li>It is limited to the assigned cashier and branch.</li>
              <li>
                A verified cashier PIN and one server-recorded cash shift are
                required before checkout.
              </li>
            </ol>
            <p className="form-help">
              Shift opening is online and auditable. Local cash sales are
              encrypted first and remain pending until the later sync story can
              post their inventory and accounting effects atomically.
            </p>
          </article>
        </section>

        <section className="pos-checkout" aria-labelledby="checkout-heading">
          <header className="pos-checkout-heading">
            <div>
              <p className="eyebrow">Offline sale preparation</p>
              <h2 id="checkout-heading">Cash checkout</h2>
              <p>
                A completed sale is encrypted on this browser and marked pending
                sync. It is not yet a tax receipt or accounting entry.
              </p>
            </div>
            <div className="pos-sync-state">
              <CloudOff aria-hidden="true" size={18} />
              <span>
                {pendingSales.length === 1
                  ? "1 sale pending sync"
                  : `${pendingSales.length} sales pending sync`}
              </span>
            </div>
          </header>
          <div className="pos-checkout-grid">
            <article className="panel pos-products-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Branch catalogue</p>
                  <h3>Sellable products</h3>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => void refreshCatalogue()}
                  aria-label="Refresh POS catalogue"
                  disabled={
                    loading ||
                    refreshingCatalogue ||
                    device?.state !== "registered"
                  }
                >
                  <RefreshCw size={18} />
                </button>
              </div>
              {!catalogue ? (
                <div className="inline-alert">
                  <CircleAlert aria-hidden="true" size={18} />
                  <div>
                    <strong>No offline catalogue is cached.</strong>
                    <p>
                      While online, refresh the POS catalogue after products are
                      enabled for this branch.
                    </p>
                  </div>
                </div>
              ) : catalogue.products.length === 0 ? (
                <div className="inline-alert">
                  <CircleAlert aria-hidden="true" size={18} />
                  <div>
                    <strong>No products are sellable at this branch.</strong>
                    <p>
                      An owner must enable branch availability in the catalogue
                      workspace, then refresh this POS catalogue online.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="pos-product-grid">
                  {catalogue.products.map((product) => (
                    <button
                      className="pos-product-button"
                      key={product.id}
                      type="button"
                      onClick={() => addToCart(product.id)}
                    >
                      <span>{product.name}</span>
                      <small>{product.sku ?? "No SKU"}</small>
                      <strong>
                        {formatMoney(product.unitPrice, product.currency)}
                      </strong>
                    </button>
                  ))}
                </div>
              )}
              <p className="form-help">
                Only products explicitly enabled for this branch are cached.
                Prices and VAT treatment are snapshotted when the local sale is
                saved.
              </p>
            </article>

            <article className="panel pos-cart-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Cash sale</p>
                  <h3>
                    <ShoppingCart aria-hidden="true" size={18} /> Cart
                  </h3>
                </div>
                <span className="pos-cart-count">{cartItems.length}</span>
              </div>
              {cartItems.length === 0 ? (
                <p className="empty-cart">
                  Select a cached branch product to begin a cash sale.
                </p>
              ) : (
                <ul className="pos-cart-lines">
                  {cartItems.map((item) => (
                    <li key={item.product.id}>
                      <div>
                        <strong>{item.product.name}</strong>
                        <small>
                          {formatMoney(
                            item.product.unitPrice,
                            item.product.currency,
                          )}{" "}
                          each
                        </small>
                      </div>
                      <div className="pos-quantity-control">
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() =>
                            changeCartQuantity(item.product.id, -1)
                          }
                          aria-label={`Remove one ${item.product.name}`}
                        >
                          <Minus size={16} />
                        </button>
                        <output aria-label={`${item.product.name} quantity`}>
                          {item.quantity}
                        </output>
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() => changeCartQuantity(item.product.id, 1)}
                          aria-label={`Add one ${item.product.name}`}
                          disabled={item.quantity >= 999_999}
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="pos-cart-total">
                <span>Cash total</span>
                <strong>
                  {formatMoney(
                    cartTotal,
                    cashShift?.currencyCode ??
                      catalogue?.products[0]?.currency ??
                      "AED",
                  )}
                </strong>
                <small>
                  VAT detail is stored in the encrypted sale snapshot.
                </small>
              </div>
              <button
                className="primary pos-complete-sale"
                type="button"
                onClick={() => void saveLocalCashSale()}
                disabled={
                  saleSubmitting ||
                  cartItems.length === 0 ||
                  cartItems.length !== cart.length ||
                  !catalogue ||
                  !authority ||
                  !cashierUnlocked ||
                  !cashShiftOnThisDevice ||
                  cashShift?.status !== "open"
                }
              >
                <Banknote size={18} />
                {saleSubmitting
                  ? "Saving local cash sale..."
                  : "Save local cash sale"}
              </button>
              <p className="form-help">
                Requires cached authority, a verified cashier PIN, and an open
                cash shift. The sale remains pending until a future sync posts
                inventory and accounting effects atomically.
              </p>
            </article>
          </div>

          <article className="panel pos-outbox-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Encrypted local outbox</p>
                <h3>Pending sale events</h3>
              </div>
              <CloudOff aria-hidden="true" size={20} />
            </div>
            {pendingSales.length === 0 ? (
              <p className="empty-cart">
                No locally saved sales are waiting for synchronization.
              </p>
            ) : (
              <ul className="pos-outbox-list">
                {pendingSales.map((sale) => (
                  <li key={sale.eventId}>
                    <div>
                      <strong>
                        {formatMoney(sale.totals.totalAmount, sale.currency)}
                      </strong>
                      <small>
                        {sale.lines.length} line
                        {sale.lines.length === 1 ? "" : "s"} ·{" "}
                        {formatTimestamp(sale.occurredAt)}
                      </small>
                    </div>
                    <div>
                      <span className="status-badge status-pending">
                        Pending sync
                      </span>
                      <code>{sale.localReceiptId}</code>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </section>

        <section className="notice device-next-step">
          <ShieldCheck aria-hidden="true" size={18} />
          <span>
            Next: synchronize pending sales exactly once, then post inventory
            and accounting effects in one atomic server transaction.
          </span>
        </section>
      </section>
    </main>
  );
}
