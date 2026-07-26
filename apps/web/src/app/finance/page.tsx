"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  BookOpen,
  CalendarDays,
  Landmark,
  Plus,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { commandHeaders, request } from "../../lib/api";

type Company = {
  companyId: string;
  legalName: string;
  tradeName: string | null;
  roles: string[];
};
type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
type Account = {
  id: string;
  code: string;
  name: string;
  accountType: AccountType;
  normalBalance: "debit" | "credit";
  parentAccountId: string | null;
  isPosting: boolean;
  isActive: boolean;
};
type Chart = {
  id: string;
  name: string;
  version: number;
  effectiveFrom: string;
  accounts: Account[];
};
type FiscalPeriod = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  status: "open" | "closing" | "closed";
  closedAt: string | null;
  updatedAt: string;
};
type JournalLine = {
  id: string;
  lineNumber: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  debitAmount: string;
  creditAmount: string;
  description: string | null;
};
type Journal = {
  id: string;
  fiscalPeriodId: string;
  journalDate: string;
  description: string;
  status: "draft" | "posted";
  postedAt: string | null;
  lines: JournalLine[];
};
type JournalDraftLine = {
  id: string;
  accountId: string;
  debitAmount: string;
  creditAmount: string;
  description: string;
};

const initialJournalLines: JournalDraftLine[] = [
  {
    id: "journal-line-1",
    accountId: "",
    debitAmount: "",
    creditAmount: "",
    description: "",
  },
  {
    id: "journal-line-2",
    accountId: "",
    debitAmount: "",
    creditAmount: "",
    description: "",
  },
];
const microUnits = 1_000_000n;

function canUseFinance(company: Company | undefined) {
  return (
    company?.roles.includes("owner") || company?.roles.includes("accountant")
  );
}

function parseAmount(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match) return null;
  return (
    BigInt(match[1]) * microUnits + BigInt((match[2] ?? "").padEnd(6, "0"))
  );
}

function formatAmount(value: bigint): string {
  const whole = value / microUnits;
  const fractional = (value % microUnits)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0");
  return `AED ${whole.toLocaleString("en-AE")}.${fractional}`;
}

function newJournalLine(): JournalDraftLine {
  return {
    id: crypto.randomUUID(),
    accountId: "",
    debitAmount: "",
    creditAmount: "",
    description: "",
  };
}

function localDate(value: string) {
  return new Intl.DateTimeFormat("en-AE", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export default function FinancePage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [chart, setChart] = useState<Chart | null>(null);
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [journalLines, setJournalLines] =
    useState<JournalDraftLine[]>(initialJournalLines);
  const [message, setMessage] = useState(
    "Checking your signed-in workspace...",
  );
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const company = useMemo(
    () => companies.find((item) => item.companyId === companyId),
    [companies, companyId],
  );
  const canManage = canUseFinance(company);
  const postableAccounts = useMemo(
    () =>
      chart?.accounts.filter(
        (account) => account.isActive && account.isPosting,
      ) ?? [],
    [chart],
  );
  const openPeriods = useMemo(
    () => periods.filter((period) => period.status === "open"),
    [periods],
  );
  const journalTotals = useMemo(
    () =>
      journalLines.reduce(
        (totals, line) => ({
          debit: totals.debit + (parseAmount(line.debitAmount) ?? 0n),
          credit: totals.credit + (parseAmount(line.creditAmount) ?? 0n),
        }),
        { debit: 0n, credit: 0n },
      ),
    [journalLines],
  );
  const journalLinesValid = journalLines.every((line) => {
    const debit = parseAmount(line.debitAmount || "0");
    const credit = parseAmount(line.creditAmount || "0");
    return (
      Boolean(line.accountId) &&
      debit !== null &&
      credit !== null &&
      ((debit > 0n && credit === 0n) || (credit > 0n && debit === 0n))
    );
  });
  const journalIsBalanced =
    journalLines.length >= 2 &&
    journalLinesValid &&
    journalTotals.debit > 0n &&
    journalTotals.debit === journalTotals.credit;

  const loadFinance = useCallback(
    async (id: string, successMessage?: string) => {
      if (!id) return;
      setLoading(true);
      try {
        const [nextChart, nextPeriods, nextJournals] = await Promise.all([
          request<Chart | null>(`/companies/${id}/accounting/chart`),
          request<FiscalPeriod[]>(`/companies/${id}/accounting/periods`),
          request<Journal[]>(`/companies/${id}/accounting/journals`),
        ]);
        setChart(nextChart);
        setPeriods(nextPeriods);
        setJournals(nextJournals);
        setMessage(successMessage ?? "Finance data is up to date.");
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not load finance data.",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void (async () => {
      try {
        const contexts = await request<Company[]>("/auth/companies");
        setCompanies(contexts);
        const initial = contexts[0];
        setCompanyId(initial?.companyId ?? "");
        if (!initial)
          setMessage(
            "No active company workspace is assigned to this account.",
          );
        else if (!canUseFinance(initial))
          setMessage("Your assigned role does not have access to Finance.");
        else await loadFinance(initial.companyId);
      } catch {
        setMessage("Sign in to access an assigned Ledger Lite workspace.");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadFinance]);

  async function createStarterChart() {
    if (!companyId) return;
    setSubmitting("starter-chart");
    try {
      await request(`/companies/${companyId}/accounting/chart/starter`, {
        method: "POST",
        headers: commandHeaders(),
        body: JSON.stringify({}),
      });
      await loadFinance(companyId, "UAE retail starter chart created.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not create the chart.",
      );
    } finally {
      setSubmitting(null);
    }
  }

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting("account");
    try {
      await request(`/companies/${companyId}/accounting/chart/accounts`, {
        method: "POST",
        headers: commandHeaders(),
        body: JSON.stringify({
          code: form.get("code"),
          name: form.get("name"),
          accountType: form.get("accountType"),
          parentAccountId: form.get("parentAccountId") || undefined,
          isPosting: form.get("isPosting") === "on",
        }),
      });
      event.currentTarget.reset();
      await loadFinance(companyId, "Account added to the active chart.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not create the account.",
      );
    } finally {
      setSubmitting(null);
    }
  }

  async function createPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting("period");
    try {
      await request(`/companies/${companyId}/accounting/periods`, {
        method: "POST",
        headers: commandHeaders(),
        body: JSON.stringify({
          name: form.get("name"),
          startsOn: form.get("startsOn"),
          endsOn: form.get("endsOn"),
        }),
      });
      event.currentTarget.reset();
      await loadFinance(companyId, "Fiscal period created.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not create the period.",
      );
    } finally {
      setSubmitting(null);
    }
  }

  async function postJournal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!journalIsBalanced) {
      setMessage(
        "Enter at least two valid lines with equal debits and credits.",
      );
      return;
    }
    const form = new FormData(event.currentTarget);
    setSubmitting("journal");
    try {
      await request(`/companies/${companyId}/accounting/journals`, {
        method: "POST",
        headers: commandHeaders(),
        body: JSON.stringify({
          fiscalPeriodId: form.get("fiscalPeriodId"),
          journalDate: form.get("journalDate"),
          description: form.get("description"),
          lines: journalLines.map((line) => ({
            accountId: line.accountId,
            debitAmount: line.debitAmount || "0",
            creditAmount: line.creditAmount || "0",
            description: line.description || undefined,
          })),
        }),
      });
      event.currentTarget.reset();
      setJournalLines(initialJournalLines);
      await loadFinance(companyId, "Balanced journal posted to the ledger.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not post the journal.",
      );
    } finally {
      setSubmitting(null);
    }
  }

  async function closePeriod(period: FiscalPeriod) {
    if (
      !window.confirm(
        `Close ${period.name}? Posted journals will remain immutable and no further journals can be posted to this period.`,
      )
    )
      return;
    setSubmitting(`period-${period.id}`);
    try {
      await request(
        `/companies/${companyId}/accounting/periods/${period.id}/close`,
        {
          method: "POST",
          headers: commandHeaders(),
          body: JSON.stringify({ expectedUpdatedAt: period.updatedAt }),
        },
      );
      await loadFinance(companyId, `${period.name} is now closed.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not close the period.",
      );
    } finally {
      setSubmitting(null);
    }
  }

  function changeJournalLine(
    id: string,
    change: Partial<Omit<JournalDraftLine, "id">>,
  ) {
    setJournalLines((current) =>
      current.map((line) => (line.id === id ? { ...line, ...change } : line)),
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">LL</span>
          <span>Ledger Lite</span>
        </div>
        <nav aria-label="Primary">
          <a href="/">
            <Landmark size={18} />
            Catalogue
          </a>
          <a className="nav-active" href="#chart">
            <BookOpen size={18} />
            Finance
          </a>
          <a href="#periods">
            <CalendarDays size={18} />
            Fiscal periods
          </a>
          <a href="#journals">
            <ReceiptText size={18} />
            Journals
          </a>
        </nav>
        <p className="sidebar-note">
          UAE retail pilot
          <br />
          Accounting workspace
        </p>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Back office</p>
            <h1>Finance</h1>
          </div>
          <label className="company-select">
            Company
            <select
              value={companyId}
              onChange={(event) => {
                const nextId = event.target.value;
                const nextCompany = companies.find(
                  (item) => item.companyId === nextId,
                );
                setCompanyId(nextId);
                if (!canUseFinance(nextCompany)) {
                  setChart(null);
                  setPeriods([]);
                  setJournals([]);
                  setMessage(
                    "Your assigned role does not have access to Finance.",
                  );
                } else void loadFinance(nextId);
              }}
              aria-label="Active company"
            >
              {companies.map((item) => (
                <option key={item.companyId} value={item.companyId}>
                  {item.tradeName ?? item.legalName}
                </option>
              ))}
            </select>
          </label>
        </header>
        <p className="status" role="status" aria-live="polite">
          {message}
        </p>
        {!canManage && companyId ? (
          <section className="notice">
            <strong>Finance access is restricted.</strong> Ask a company owner
            to assign the accountant role through the assisted pilot workflow.
          </section>
        ) : null}

        <section className="summary-grid" aria-label="Finance summary">
          <article>
            <span>Active accounts</span>
            <strong>
              {chart?.accounts.filter((account) => account.isActive).length ??
                0}
            </strong>
            <small>{chart ? chart.name : "Starter chart not configured"}</small>
          </article>
          <article>
            <span>Open periods</span>
            <strong>{openPeriods.length}</strong>
            <small>Posting is permitted only in an open period</small>
          </article>
          <article>
            <span>Posted journals</span>
            <strong>
              {journals.filter((journal) => journal.status === "posted").length}
            </strong>
            <small>Immutable double-entry records</small>
          </article>
        </section>

        {canManage && !chart ? (
          <section className="panel empty-state" id="chart">
            <ShieldCheck aria-hidden="true" size={28} />
            <div>
              <p className="eyebrow">Step 1</p>
              <h2>Set up the UAE starter chart</h2>
              <p>
                This adds the standard cash, bank, inventory, VAT, sales, and
                cost accounts. You can add accounts afterwards; the system never
                silently changes a posted journal.
              </p>
            </div>
            <button
              className="primary"
              onClick={() => void createStarterChart()}
              disabled={submitting !== null || loading}
            >
              <Plus size={18} />
              Create UAE starter chart
            </button>
          </section>
        ) : null}

        {chart ? (
          <>
            <section className="content-grid" id="chart">
              <article className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Chart of accounts</p>
                    <h2>{chart.name}</h2>
                  </div>
                  <BookOpen aria-hidden="true" />
                </div>
                <p className="form-help">
                  Version {chart.version} is active from{" "}
                  {localDate(chart.effectiveFrom)}. Account type determines the
                  normal debit or credit balance.
                </p>
                <div className="table-wrap finance-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Account</th>
                        <th>Type</th>
                        <th>Posting</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chart.accounts.map((account) => (
                        <tr key={account.id}>
                          <td className="account-code">{account.code}</td>
                          <td>
                            <strong>{account.name}</strong>
                            <small>
                              {account.normalBalance} normal balance
                            </small>
                          </td>
                          <td>{account.accountType}</td>
                          <td>
                            <span
                              className={
                                account.isPosting
                                  ? "badge badge-positive"
                                  : "badge"
                              }
                            >
                              {account.isPosting ? "Posting" : "Header"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
              <article className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Extend</p>
                    <h2>Add account</h2>
                  </div>
                  <Plus aria-hidden="true" />
                </div>
                <form className="stack" onSubmit={createAccount}>
                  <div className="two-columns">
                    <label>
                      Account code
                      <input
                        name="code"
                        required
                        pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,31}"
                        placeholder="e.g. 6100"
                        disabled={!canManage || submitting !== null}
                      />
                    </label>
                    <label>
                      Type
                      <select
                        name="accountType"
                        defaultValue="expense"
                        disabled={!canManage || submitting !== null}
                      >
                        <option value="asset">Asset</option>
                        <option value="liability">Liability</option>
                        <option value="equity">Equity</option>
                        <option value="revenue">Revenue</option>
                        <option value="expense">Expense</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    Account name
                    <input
                      name="name"
                      required
                      placeholder="e.g. Rent expense"
                      disabled={!canManage || submitting !== null}
                    />
                  </label>
                  <label>
                    Parent account
                    <select
                      name="parentAccountId"
                      defaultValue=""
                      disabled={!canManage || submitting !== null}
                    >
                      <option value="">No parent account</option>
                      {chart.accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.code} - {account.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="checkbox-label">
                    <input
                      name="isPosting"
                      type="checkbox"
                      defaultChecked
                      disabled={!canManage || submitting !== null}
                    />
                    Accept journal postings to this account
                  </label>
                  <button
                    className="secondary"
                    disabled={!canManage || submitting !== null}
                  >
                    <Plus size={18} />
                    Add account
                  </button>
                </form>
              </article>
            </section>

            <section className="content-grid" id="periods">
              <article className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Step 2</p>
                    <h2>Fiscal periods</h2>
                  </div>
                  <CalendarDays aria-hidden="true" />
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th>Range</th>
                        <th>Status</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {periods.length === 0 ? (
                        <tr>
                          <td colSpan={4}>
                            Create an open fiscal period before posting a
                            journal.
                          </td>
                        </tr>
                      ) : (
                        periods.map((period) => (
                          <tr key={period.id}>
                            <td>
                              <strong>{period.name}</strong>
                            </td>
                            <td>
                              {localDate(period.startsOn)} to{" "}
                              {localDate(period.endsOn)}
                              <small>End date is exclusive</small>
                            </td>
                            <td>
                              <span
                                className={
                                  period.status === "closed"
                                    ? "badge badge-positive"
                                    : "badge"
                                }
                              >
                                {period.status}
                              </span>
                            </td>
                            <td className="numeric">
                              {period.status === "open" ? (
                                <button
                                  className="tertiary destructive"
                                  onClick={() => void closePeriod(period)}
                                  disabled={!canManage || submitting !== null}
                                >
                                  Close period
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </article>
              <article className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Create</p>
                    <h2>Open fiscal period</h2>
                  </div>
                  <Plus aria-hidden="true" />
                </div>
                <form className="stack" onSubmit={createPeriod}>
                  <label>
                    Period name
                    <input
                      name="name"
                      required
                      placeholder="FY 2027"
                      disabled={!canManage || submitting !== null}
                    />
                  </label>
                  <div className="two-columns">
                    <label>
                      Start date
                      <input
                        name="startsOn"
                        type="date"
                        required
                        disabled={!canManage || submitting !== null}
                      />
                    </label>
                    <label>
                      End date
                      <input
                        name="endsOn"
                        type="date"
                        required
                        disabled={!canManage || submitting !== null}
                      />
                    </label>
                  </div>
                  <p className="form-help">
                    The end date is exclusive. For a 2027 financial year, use 01
                    Jan 2027 to 01 Jan 2028.
                  </p>
                  <button
                    className="secondary"
                    disabled={!canManage || submitting !== null}
                  >
                    <Plus size={18} />
                    Create period
                  </button>
                </form>
              </article>
            </section>

            <section className="content-grid journal-grid" id="journals">
              <article className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Step 3</p>
                    <h2>Post manual journal</h2>
                  </div>
                  <ReceiptText aria-hidden="true" />
                </div>
                <form className="stack" onSubmit={postJournal}>
                  <div className="two-columns">
                    <label>
                      Open fiscal period
                      <select
                        name="fiscalPeriodId"
                        required
                        disabled={
                          !canManage ||
                          submitting !== null ||
                          openPeriods.length === 0
                        }
                      >
                        <option value="">Select a period</option>
                        {openPeriods.map((period) => (
                          <option key={period.id} value={period.id}>
                            {period.name} ({period.startsOn} to {period.endsOn})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Journal date
                      <input
                        name="journalDate"
                        type="date"
                        required
                        disabled={
                          !canManage ||
                          submitting !== null ||
                          openPeriods.length === 0
                        }
                      />
                    </label>
                  </div>
                  <label>
                    Description
                    <input
                      name="description"
                      required
                      maxLength={500}
                      placeholder="e.g. Record rent paid for July"
                      disabled={
                        !canManage ||
                        submitting !== null ||
                        openPeriods.length === 0
                      }
                    />
                  </label>
                  <div className="journal-lines" aria-label="Journal lines">
                    <div className="journal-line-labels" aria-hidden="true">
                      <span>Account</span>
                      <span>Debit (AED)</span>
                      <span>Credit (AED)</span>
                      <span>Description</span>
                      <span />
                    </div>
                    {journalLines.map((line, index) => (
                      <div className="journal-line" key={line.id}>
                        <label>
                          <span className="sr-only">
                            Account for line {index + 1}
                          </span>
                          <select
                            value={line.accountId}
                            onChange={(event) =>
                              changeJournalLine(line.id, {
                                accountId: event.target.value,
                              })
                            }
                            disabled={
                              !canManage ||
                              submitting !== null ||
                              postableAccounts.length === 0
                            }
                          >
                            <option value="">Select account</option>
                            {postableAccounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.code} - {account.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span className="sr-only">
                            Debit amount for line {index + 1}
                          </span>
                          <input
                            value={line.debitAmount}
                            onChange={(event) =>
                              changeJournalLine(line.id, {
                                debitAmount: event.target.value,
                              })
                            }
                            inputMode="decimal"
                            pattern="\d+(\.\d{1,6})?"
                            placeholder="0.00"
                            disabled={!canManage || submitting !== null}
                          />
                        </label>
                        <label>
                          <span className="sr-only">
                            Credit amount for line {index + 1}
                          </span>
                          <input
                            value={line.creditAmount}
                            onChange={(event) =>
                              changeJournalLine(line.id, {
                                creditAmount: event.target.value,
                              })
                            }
                            inputMode="decimal"
                            pattern="\d+(\.\d{1,6})?"
                            placeholder="0.00"
                            disabled={!canManage || submitting !== null}
                          />
                        </label>
                        <label>
                          <span className="sr-only">
                            Line description for line {index + 1}
                          </span>
                          <input
                            value={line.description}
                            onChange={(event) =>
                              changeJournalLine(line.id, {
                                description: event.target.value,
                              })
                            }
                            maxLength={500}
                            placeholder="Optional"
                            disabled={!canManage || submitting !== null}
                          />
                        </label>
                        <button
                          className="icon-button destructive"
                          type="button"
                          aria-label={`Remove journal line ${index + 1}`}
                          title="Remove line"
                          onClick={() =>
                            setJournalLines((current) =>
                              current.filter((item) => item.id !== line.id),
                            )
                          }
                          disabled={
                            !canManage ||
                            submitting !== null ||
                            journalLines.length <= 2
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="tertiary add-line"
                    onClick={() =>
                      setJournalLines((current) => [
                        ...current,
                        newJournalLine(),
                      ])
                    }
                    disabled={!canManage || submitting !== null}
                  >
                    <Plus size={16} />
                    Add line
                  </button>
                  <div className="journal-totals" aria-live="polite">
                    <span>
                      Debits{" "}
                      <strong>{formatAmount(journalTotals.debit)}</strong>
                    </span>
                    <span>
                      Credits{" "}
                      <strong>{formatAmount(journalTotals.credit)}</strong>
                    </span>
                    <span
                      className={
                        journalIsBalanced ? "balance-ok" : "balance-pending"
                      }
                    >
                      {journalIsBalanced ? "Balanced" : "Needs balance"}
                    </span>
                  </div>
                  <p className="form-help">
                    Posting is atomic. The server independently checks the
                    period, account status, and exact debit-credit balance
                    before it posts.
                  </p>
                  <button
                    className="primary"
                    disabled={
                      !canManage ||
                      submitting !== null ||
                      !journalIsBalanced ||
                      openPeriods.length === 0
                    }
                  >
                    <ShieldCheck size={18} />
                    Post balanced journal
                  </button>
                </form>
              </article>
              <article className="panel table-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Ledger</p>
                    <h2>Recent posted journals</h2>
                  </div>
                  <button
                    className="icon-button"
                    onClick={() => void loadFinance(companyId)}
                    aria-label="Refresh finance data"
                    disabled={loading || submitting !== null || !canManage}
                  >
                    <RefreshCw size={18} />
                  </button>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Description and lines</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr>
                          <td colSpan={3}>Loading journals...</td>
                        </tr>
                      ) : journals.length === 0 ? (
                        <tr>
                          <td colSpan={3}>No journals have been posted yet.</td>
                        </tr>
                      ) : (
                        journals.map((journal) => (
                          <tr key={journal.id}>
                            <td>{localDate(journal.journalDate)}</td>
                            <td>
                              <details>
                                <summary>{journal.description}</summary>
                                <ul className="journal-detail-list">
                                  {journal.lines.map((line) => (
                                    <li key={line.id}>
                                      <span>
                                        {line.accountCode} - {line.accountName}
                                      </span>
                                      <span className="numeric">
                                        {line.debitAmount !== "0"
                                          ? `Dr ${formatAmount(parseAmount(line.debitAmount) ?? 0n)}`
                                          : `Cr ${formatAmount(parseAmount(line.creditAmount) ?? 0n)}`}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            </td>
                            <td>
                              <span className="badge badge-positive">
                                {journal.status}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </article>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
