"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  CircleAlert,
  KeyRound,
  MonitorSmartphone,
  RefreshCw,
  ShieldCheck,
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
  canUseDeviceCrypto,
  localDevice,
  type LocalPosDevice,
} from "../../lib/pos-device";

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

export default function PosAccessPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [userId, setUserId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [device, setDevice] = useState<LocalPosDevice>();
  const [authority, setAuthority] = useState<CachedOfflineAuthority>();
  const [cashierPin, setCashierPin] = useState<CachedCashierPin>();
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [unlockPinValue, setUnlockPinValue] = useState("");
  const [localSessionExpiresAt, setLocalSessionExpiresAt] = useState("");
  const [message, setMessage] = useState(
    "Checking your assigned POS workspace...",
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pinSubmitting, setPinSubmitting] = useState(false);
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
          setMessage(
            "Register this browser as a POS device before refreshing offline authority.",
          );
          return;
        }
        const cached = await cachedOfflineAuthority({
          companyId: nextCompanyId,
          branchId: nextBranchId,
          deviceId: storedDevice.deviceId,
          cashierUserId: currentUserId,
        });
        setAuthority(cached);
        const cachedPin = await cachedCashierPin({
          companyId: nextCompanyId,
          branchId: nextBranchId,
          deviceId: storedDevice.deviceId,
          cashierUserId: currentUserId,
        });
        setCashierPin(cachedPin);
        setMessage(
          cached
            ? `Offline authority is ready until ${formatTimestamp(cached.expiresAt)}.`
            : "No valid offline authority is cached for this cashier and device.",
        );
      } catch (error) {
        setDevice(undefined);
        setAuthority(undefined);
        setCashierPin(undefined);
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
        `Offline authority is ready until ${formatTimestamp(refreshed.expiresAt)}. Cashier unlock and cash shift are still required before sales.`,
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
          `Cashier PIN verified locally until ${formatTimestamp(result.expiresAt)}. A cash shift is still required before sales.`,
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

  function selectCompany(nextCompanyId: string) {
    const nextBranch = branches.find(
      (branch) => branch.companyId === nextCompanyId,
    );
    setCompanyId(nextCompanyId);
    setBranchId(nextBranch?.branchId ?? "");
    setDevice(undefined);
    setAuthority(undefined);
    setCashierPin(undefined);
    setLocalSessionExpiresAt("");
    if (nextBranch)
      void loadAuthority(nextCompanyId, nextBranch.branchId, userId);
  }

  function selectBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    setDevice(undefined);
    setAuthority(undefined);
    setCashierPin(undefined);
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
              {localSessionExpiresAt
                ? "Unlocked"
                : cashierPin
                  ? "PIN ready"
                  : "Not set"}
            </strong>
            <small>
              {localSessionExpiresAt
                ? `Session ends ${formatTimestamp(localSessionExpiresAt)}`
                : cashierPin
                  ? "Enter PIN to start a bounded local session"
                  : "Set a PIN online on this browser device"}
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
                      maxLength={12}
                      pattern="[0-9]{8,12}"
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
                      maxLength={12}
                      pattern="[0-9]{8,12}"
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
              <li>Cashier PIN unlock and a cash shift remain required.</li>
            </ol>
            <p className="form-help">
              This is a trust and recovery milestone, not a checkout screen.
              Offline sales stay unavailable until the cashier unlock and shift
              controls are implemented.
            </p>
          </article>
        </section>

        <section className="notice device-next-step">
          <ShieldCheck aria-hidden="true" size={18} />
          <span>
            Next: set and verify a cashier POS PIN, enforce local unlock limits,
            and create the cash-shift lifecycle before enabling sales.
          </span>
        </section>
      </section>
    </main>
  );
}
