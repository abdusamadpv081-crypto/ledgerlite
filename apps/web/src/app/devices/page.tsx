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
  Laptop,
  MonitorSmartphone,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { commandHeaders, request } from "../../lib/api";
import {
  POS_DEVICE_APP_VERSION,
  POS_DEVICE_LOCAL_SCHEMA_VERSION,
  canUseDeviceCrypto,
  completeDeviceRegistration,
  localDevice,
  prepareDeviceRegistration,
  publicKeyFingerprint,
  type LocalPosDevice,
} from "../../lib/pos-device";

type Company = {
  companyId: string;
  legalName: string;
  tradeName: string | null;
  roles: string[];
};
type Branch = {
  id: string;
  companyId: string;
  code: string;
  name: string;
  status: "active" | "inactive" | "closed";
};
type AssignedBranch = {
  companyId: string;
  branchId: string;
  code: string;
  name: string;
};
type Device = {
  id: string;
  companyId: string;
  branchId: string;
  displayName: string;
  publicKeyFingerprint: string;
  status: "registered" | "suspended" | "retired";
  appVersion: string | null;
  localSchemaVersion: number | null;
  policyVersion: number | null;
  lastSyncedAt: string | null;
  updatedAt: string;
};
type CommandResponse<T> = { data: T; correlationId: string };

function canManageDevices(company: Company | undefined) {
  return (
    company?.roles.includes("owner") ||
    company?.roles.includes("branch_manager")
  );
}

function shortFingerprint(value: string) {
  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

function branchKey(branch: AssignedBranch) {
  return `${branch.companyId}:${branch.branchId}`;
}

export default function DevicesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<AssignedBranch[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [storedDevice, setStoredDevice] = useState<LocalPosDevice>();
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState(
    "Checking your signed-in workspace...",
  );
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [secureBrowser, setSecureBrowser] = useState(false);
  const company = useMemo(
    () => companies.find((item) => item.companyId === companyId),
    [companies, companyId],
  );
  const canManage = canManageDevices(company);
  const selectableBranches = useMemo(
    () => branches.filter((branch) => branch.companyId === companyId),
    [branches, companyId],
  );

  const loadDeviceState = useCallback(
    async (nextCompanyId: string, nextBranchId: string) => {
      if (!nextCompanyId || !nextBranchId) return;
      setLoading(true);
      try {
        const serverDevices = await request<Device[]>(
          `/companies/${nextCompanyId}/branches/${nextBranchId}/devices`,
        );
        setDevices(serverDevices);
        try {
          const stored = await localDevice(nextCompanyId, nextBranchId);
          setStoredDevice(stored);
          if (stored?.state === "pending") setDisplayName(stored.displayName);
        } catch (error) {
          setStoredDevice(undefined);
          setMessage(
            error instanceof Error
              ? error.message
              : "This browser cannot open secure POS device storage.",
          );
          return;
        }
        setMessage("POS device records are up to date.");
      } catch (error) {
        setDevices([]);
        setStoredDevice(undefined);
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not load POS device records.",
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
        const [contexts, assigned] = await Promise.all([
          request<Company[]>("/auth/companies"),
          request<AssignedBranch[]>("/auth/branches"),
        ]);
        const ownerBranches = await Promise.all(
          contexts
            .filter((context) => context.roles.includes("owner"))
            .map(async (context) => {
              try {
                const owned = await request<Branch[]>(
                  `/companies/${context.companyId}/branches`,
                );
                return owned
                  .filter((branch) => branch.status === "active")
                  .map((branch) => ({
                    companyId: branch.companyId,
                    branchId: branch.id,
                    code: branch.code,
                    name: branch.name,
                  }));
              } catch {
                return [];
              }
            }),
        );
        const availableBranches = [...assigned, ...ownerBranches.flat()].filter(
          (branch, index, all) =>
            all.findIndex((item) => branchKey(item) === branchKey(branch)) ===
            index,
        );
        setCompanies(contexts);
        setBranches(availableBranches);
        const initialCompany = contexts.find(canManageDevices);
        const initialBranch = availableBranches.find(
          (branch) => branch.companyId === initialCompany?.companyId,
        );
        setCompanyId(initialCompany?.companyId ?? "");
        setBranchId(initialBranch?.branchId ?? "");
        if (!initialCompany)
          setMessage("Your assigned role cannot manage POS devices.");
        else if (!initialBranch)
          setMessage("No active branch is assigned for POS device management.");
        else
          await loadDeviceState(
            initialCompany.companyId,
            initialBranch.branchId,
          );
      } catch {
        setMessage("Sign in to access an assigned Ledger Lite workspace.");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadDeviceState]);

  async function registerDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!companyId || !branchId || storedDevice?.state === "registered") return;
    if (!secureBrowser) {
      setMessage(
        "Use HTTPS (or localhost) and a browser with Web Crypto support before registering a POS device.",
      );
      return;
    }
    setSubmitting("register");
    let pending: LocalPosDevice | undefined;
    try {
      pending =
        storedDevice ??
        (await prepareDeviceRegistration({
          companyId,
          branchId,
          displayName: displayName.trim(),
        }));
      setStoredDevice(pending);
      const response = await request<CommandResponse<Device>>(
        `/companies/${companyId}/branches/${branchId}/devices`,
        {
          method: "POST",
          headers: {
            ...commandHeaders(),
            "idempotency-key": pending.registrationIdempotencyKey,
          },
          body: JSON.stringify({
            displayName: pending.displayName,
            publicKeyJwk: pending.publicKeyJwk,
            appVersion: POS_DEVICE_APP_VERSION,
            localSchemaVersion: POS_DEVICE_LOCAL_SCHEMA_VERSION,
          }),
        },
      );
      await completeDeviceRegistration(pending, response.data);
      setDisplayName(pending.displayName);
      await loadDeviceState(companyId, branchId);
      setMessage("This browser is registered as a POS device for the branch.");
    } catch (error) {
      try {
        if (pending) {
          const fingerprint = await publicKeyFingerprint(pending.publicKeyJwk);
          const current = await request<Device[]>(
            `/companies/${companyId}/branches/${branchId}/devices`,
          );
          const matching = current.find(
            (device) => device.publicKeyFingerprint === fingerprint,
          );
          if (matching) {
            await completeDeviceRegistration(pending, matching);
            await loadDeviceState(companyId, branchId);
            setMessage(
              "Recovered the completed device registration from the server.",
            );
            return;
          }
        }
      } catch {
        // Preserve the pending key and idempotency key for a safe later retry.
      }
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not register this browser as a POS device.",
      );
    } finally {
      setSubmitting(null);
    }
  }

  async function changeDeviceStatus(
    device: Device,
    status: "registered" | "suspended" | "retired",
  ) {
    const action =
      status === "suspended"
        ? "suspend"
        : status === "retired"
          ? "retire"
          : "reinstate";
    if (
      !window.confirm(
        `${action[0].toUpperCase()}${action.slice(1)} ${device.displayName}?`,
      )
    )
      return;
    setSubmitting(device.id);
    try {
      await request(
        `/companies/${companyId}/branches/${branchId}/devices/${device.id}`,
        {
          method: "PATCH",
          headers: commandHeaders(),
          body: JSON.stringify({
            expectedUpdatedAt: device.updatedAt,
            status,
          }),
        },
      );
      await loadDeviceState(companyId, branchId);
      setMessage(`${device.displayName} is now ${status}.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not update the device status.",
      );
    } finally {
      setSubmitting(null);
    }
  }

  function selectCompany(nextCompanyId: string) {
    const nextBranch = branches.find(
      (branch) => branch.companyId === nextCompanyId,
    );
    setCompanyId(nextCompanyId);
    setBranchId(nextBranch?.branchId ?? "");
    setDevices([]);
    setStoredDevice(undefined);
    setDisplayName("");
    if (nextBranch) void loadDeviceState(nextCompanyId, nextBranch.branchId);
  }

  function selectBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    setDevices([]);
    setStoredDevice(undefined);
    setDisplayName("");
    void loadDeviceState(companyId, nextBranchId);
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
          <a className="nav-active" href="#devices">
            <MonitorSmartphone size={18} />
            POS devices
          </a>
        </nav>
        <p className="sidebar-note">
          UAE retail pilot
          <br />
          Device trust setup
        </p>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">POS foundation</p>
            <h1>Device registration</h1>
          </div>
          <div className="device-scope-selectors">
            <label className="company-select">
              Company
              <select
                value={companyId}
                onChange={(event) => selectCompany(event.target.value)}
              >
                {companies.filter(canManageDevices).map((item) => (
                  <option key={item.companyId} value={item.companyId}>
                    {item.tradeName ?? item.legalName}
                  </option>
                ))}
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
                  <option value="">No assigned active branch</option>
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
        {!canManage && companyId ? (
          <section className="notice">
            <strong>Device management is restricted.</strong> Only an owner or
            branch manager assigned to this branch can register a POS device.
          </section>
        ) : null}
        {!secureBrowser ? (
          <section className="notice notice-danger">
            <CircleAlert aria-hidden="true" size={18} />
            <div>
              <strong>Secure browser context required.</strong> Open Ledger Lite
              over HTTPS (or localhost) in a modern browser before registering a
              POS device. The browser must be able to protect a non-exportable
              signing key.
            </div>
          </section>
        ) : null}

        <section className="summary-grid" aria-label="Device summary">
          <article>
            <span>Server devices</span>
            <strong>{devices.length}</strong>
            <small>
              {branchId ? "For the selected branch" : "Choose a branch"}
            </small>
          </article>
          <article>
            <span>This browser</span>
            <strong>
              {storedDevice?.state === "registered"
                ? "Trusted"
                : "Not registered"}
            </strong>
            <small>
              {storedDevice?.state === "pending"
                ? "Registration can be safely retried"
                : "Private signing key stays in browser storage"}
            </small>
          </article>
          <article>
            <span>Local schema</span>
            <strong>v{POS_DEVICE_LOCAL_SCHEMA_VERSION}</strong>
            <small>Offline cache foundation</small>
          </article>
        </section>

        <section className="content-grid device-grid" id="devices">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">This browser</p>
                <h2>Register a POS device</h2>
              </div>
              <KeyRound aria-hidden="true" />
            </div>
            {storedDevice?.state === "registered" ? (
              <div className="device-trust-state">
                <ShieldCheck aria-hidden="true" size={24} />
                <div>
                  <strong>{storedDevice.displayName} is registered.</strong>
                  <p>
                    Its non-exportable private signing key is stored only in
                    this browser profile. Clearing browser storage requires a
                    new device registration.
                  </p>
                  <code>
                    {shortFingerprint(storedDevice.publicKeyFingerprint ?? "")}
                  </code>
                </div>
              </div>
            ) : (
              <form className="stack" onSubmit={registerDevice}>
                <label>
                  Device name
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    required
                    maxLength={120}
                    placeholder="e.g. Main counter till"
                    disabled={
                      !canManage ||
                      !branchId ||
                      !secureBrowser ||
                      submitting !== null ||
                      storedDevice?.state === "pending"
                    }
                  />
                </label>
                {storedDevice?.state === "pending" ? (
                  <section className="inline-alert">
                    <CircleAlert aria-hidden="true" size={18} />
                    <span>
                      A signing key and retry key already exist for this device.
                      Retrying preserves the same registration command.
                    </span>
                  </section>
                ) : null}
                <p className="form-help">
                  Ledger Lite creates an ECDSA P-256 key pair in Web Crypto.
                  Only the public key leaves the browser; the private key is
                  generated as non-exportable and retained for future POS
                  signatures.
                </p>
                <button
                  className="primary"
                  disabled={
                    !canManage ||
                    !branchId ||
                    !secureBrowser ||
                    submitting !== null
                  }
                >
                  <KeyRound size={18} />
                  {storedDevice?.state === "pending"
                    ? "Retry device registration"
                    : "Register this browser"}
                </button>
              </form>
            )}
          </article>
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Trust model</p>
                <h2>What registration means</h2>
              </div>
              <Laptop aria-hidden="true" />
            </div>
            <ol className="trust-steps">
              <li>This browser makes a non-exportable P-256 signing key.</li>
              <li>
                The server records only the public key and its fingerprint.
              </li>
              <li>
                Future offline grants and POS events will be bound to this
                device.
              </li>
              <li>
                Suspended or retired devices cannot receive a new operational
                grant.
              </li>
            </ol>
            <p className="form-help">
              A browser profile is intentionally treated as a device boundary;
              it is not a shared employee login.
            </p>
          </article>
        </section>

        <section className="panel table-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Branch inventory</p>
              <h2>Registered POS devices</h2>
            </div>
            <button
              className="icon-button"
              onClick={() => void loadDeviceState(companyId, branchId)}
              aria-label="Refresh device records"
              disabled={loading || submitting !== null || !branchId}
            >
              <RefreshCw size={18} />
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Key fingerprint</th>
                  <th>App / cache</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5}>Loading device records...</td>
                  </tr>
                ) : devices.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      No POS devices are registered for this branch.
                    </td>
                  </tr>
                ) : (
                  devices.map((device) => (
                    <tr key={device.id}>
                      <td>
                        <strong>{device.displayName}</strong>
                        <small>{device.id}</small>
                      </td>
                      <td>
                        <code>
                          {shortFingerprint(device.publicKeyFingerprint)}
                        </code>
                      </td>
                      <td>
                        {device.appVersion ?? "Unknown app"}
                        <small>
                          Schema {device.localSchemaVersion ?? "unknown"}
                        </small>
                      </td>
                      <td>
                        <span
                          className={
                            device.status === "registered"
                              ? "badge badge-positive"
                              : "badge"
                          }
                        >
                          {device.status}
                        </span>
                      </td>
                      <td className="numeric device-actions">
                        {device.status === "registered" ? (
                          <button
                            className="tertiary destructive"
                            onClick={() =>
                              void changeDeviceStatus(device, "suspended")
                            }
                            disabled={!canManage || submitting !== null}
                          >
                            Suspend
                          </button>
                        ) : null}
                        {device.status === "suspended" ? (
                          <button
                            className="tertiary"
                            onClick={() =>
                              void changeDeviceStatus(device, "registered")
                            }
                            disabled={!canManage || submitting !== null}
                          >
                            Reinstate
                          </button>
                        ) : null}
                        {device.status !== "retired" ? (
                          <button
                            className="tertiary destructive"
                            onClick={() =>
                              void changeDeviceStatus(device, "retired")
                            }
                            disabled={!canManage || submitting !== null}
                          >
                            Retire
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="notice device-next-step">
          <Settings2 aria-hidden="true" size={18} />
          <span>
            Device registration is the trust prerequisite. The next POS slice
            adds its encrypted local cache, operational grant, cashier unlock,
            and cash-shift controls.
          </span>
        </section>
      </section>
    </main>
  );
}
