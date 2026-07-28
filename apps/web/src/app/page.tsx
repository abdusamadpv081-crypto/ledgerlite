"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  MonitorSmartphone,
  PackagePlus,
  Plus,
  RefreshCw,
  Store,
  Tags,
  WifiOff,
} from "lucide-react";
import { commandHeaders, loginUrl, request } from "../lib/api";
type Company = {
  companyId: string;
  legalName: string;
  tradeName: string | null;
  roles: string[];
};
type Tax = { id: string; code: string; name: string; rate: string };
type Product = {
  id: string;
  sku: string | null;
  name: string;
  productKind: "stock" | "service";
  isActive: boolean;
  barcodes: string[];
  unitPrice: string;
  currency: string;
  taxTreatment: "inclusive" | "exclusive";
  taxCode: Tax | null;
  updatedAt: string;
};
type Catalogue = { taxCodes: Tax[]; products: Product[] };
type Branch = {
  id: string;
  code: string;
  name: string;
  status: "active" | "inactive" | "closed";
};
type ProductDraft = {
  id: string;
  updatedAt: string;
  sku: string;
  name: string;
  productKind: Product["productKind"];
  taxCodeId: string;
  unitPrice: string;
  isActive: boolean;
  barcodes: string[];
};

function draft(product: Product): ProductDraft {
  return {
    id: product.id,
    updatedAt: product.updatedAt,
    sku: product.sku ?? "",
    name: product.name,
    productKind: product.productKind,
    taxCodeId: product.taxCode?.id ?? "",
    unitPrice: product.unitPrice,
    isActive: product.isActive,
    barcodes: product.barcodes,
  };
}

function money(product: Product) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: product.currency,
  }).format(Number(product.unitPrice));
}

export default function HomePage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [catalogue, setCatalogue] = useState<Catalogue>({
    taxCodes: [],
    products: [],
  });
  const [branches, setBranches] = useState<Branch[]>([]);
  const [productDraft, setProductDraft] = useState<ProductDraft | null>(null);
  const [message, setMessage] = useState("Checking your signed-in workspace…");
  const [loading, setLoading] = useState(true);
  const [signInRequired, setSignInRequired] = useState(false);
  const company = useMemo(
    () => companies.find((item) => item.companyId === companyId),
    [companies, companyId],
  );
  const canManage = company?.roles.includes("owner") ?? false;
  function selectProduct(productId: string, products = catalogue.products) {
    const selected = products.find((product) => product.id === productId);
    setProductDraft(selected ? draft(selected) : null);
  }
  function changeProductDraft(change: Partial<ProductDraft>) {
    setProductDraft((current) => (current ? { ...current, ...change } : null));
  }
  async function loadCatalog(id = companyId) {
    if (!id) return;
    setLoading(true);
    try {
      const [nextCatalogue, nextBranches] = await Promise.all([
        request<Catalogue>(`/companies/${id}/catalog`),
        request<Branch[]>(`/companies/${id}/branches`),
      ]);
      setCatalogue(nextCatalogue);
      setBranches(nextBranches.filter((branch) => branch.status === "active"));
      selectProduct(
        productDraft?.id ?? nextCatalogue.products[0]?.id ?? "",
        nextCatalogue.products,
      );
      setMessage("Catalogue is up to date.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not load the catalogue.",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void (async () => {
      try {
        const contexts = await request<Company[]>("/auth/companies");
        setSignInRequired(false);
        setCompanies(contexts);
        const initial = contexts[0]?.companyId ?? "";
        setCompanyId(initial);
        if (!initial)
          setMessage(
            "No active company workspace is assigned to this account.",
          );
        else await loadCatalog(initial);
      } catch {
        setSignInRequired(true);
        setMessage("Sign in to access an assigned Ledger Lite workspace.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  async function createTax(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await request(`/companies/${companyId}/catalog/tax-codes`, {
        method: "POST",
        headers: commandHeaders(),
        body: JSON.stringify({
          code: form.get("code"),
          name: form.get("name"),
          rate: String(Number(form.get("rate")) / 100),
        }),
      });
      event.currentTarget.reset();
      await loadCatalog();
      setMessage("Tax code created.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not create tax code.",
      );
    }
  }
  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await request(`/companies/${companyId}/catalog/products`, {
        method: "POST",
        headers: commandHeaders(),
        body: JSON.stringify({
          sku: form.get("sku"),
          name: form.get("name"),
          productKind: form.get("productKind"),
          defaultTaxCodeId: form.get("taxCodeId") || undefined,
          unitPrice: form.get("unitPrice"),
        }),
      });
      event.currentTarget.reset();
      await loadCatalog();
      setMessage("Product created with its first retail price.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not create product.",
      );
    }
  }
  async function updateProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!productDraft) return;
    try {
      await request(
        `/companies/${companyId}/catalog/products/${productDraft.id}`,
        {
          method: "PATCH",
          headers: commandHeaders(),
          body: JSON.stringify({
            expectedUpdatedAt: productDraft.updatedAt,
            sku: productDraft.sku,
            name: productDraft.name,
            productKind: productDraft.productKind,
            defaultTaxCodeId: productDraft.taxCodeId || null,
            unitPrice: productDraft.unitPrice,
            isActive: productDraft.isActive,
          }),
        },
      );
      await loadCatalog();
      setMessage(
        productDraft.isActive
          ? "Product changes saved."
          : "Product deactivated and kept for audit history.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not update product.",
      );
    }
  }
  async function createBarcode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!productDraft) return;
    const form = new FormData(event.currentTarget);
    try {
      await request(
        `/companies/${companyId}/catalog/products/${productDraft.id}/barcodes`,
        {
          method: "POST",
          headers: commandHeaders(),
          body: JSON.stringify({
            barcode: form.get("barcode"),
            symbology: form.get("symbology") || undefined,
          }),
        },
      );
      event.currentTarget.reset();
      await loadCatalog();
      setMessage("Barcode added to the product.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not add barcode.",
      );
    }
  }
  async function setAvailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!productDraft) return;
    const form = new FormData(event.currentTarget);
    const branchId = String(form.get("branchId") ?? "");
    try {
      await request(
        `/companies/${companyId}/catalog/branches/${branchId}/products/${productDraft.id}/availability`,
        {
          method: "POST",
          headers: commandHeaders(),
          body: JSON.stringify({
            isSellable: form.get("isSellable") === "true",
            reorderPoint: form.get("reorderPoint") || null,
          }),
        },
      );
      setMessage("Branch product controls saved.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not update branch controls.",
      );
    }
  }
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">LL</span>
          <span>Ledger Lite</span>
        </div>
        <nav aria-label="Primary">
          <a className="nav-active" href="#catalogue">
            <Store size={18} />
            Catalogue
          </a>
          <a href="#products">
            <PackagePlus size={18} />
            Products
          </a>
          <a href="#taxes">
            <Tags size={18} />
            Tax settings
          </a>
          <a href="/finance">
            <Store size={18} />
            Finance
          </a>
          <a href="/devices">
            <MonitorSmartphone size={18} />
            POS devices
          </a>
          <a href="/pos">
            <WifiOff size={18} />
            POS access
          </a>
        </nav>
        <p className="sidebar-note">
          UAE retail pilot
          <br />
          Online back office
        </p>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Back office</p>
            <h1>Product catalogue</h1>
          </div>
          <label className="company-select">
            Company
            <select
              value={companyId}
              onChange={(event) => {
                setCompanyId(event.target.value);
                void loadCatalog(event.target.value);
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
        {signInRequired ? (
          <a className="primary button-link" href={loginUrl("/")}>
            Sign in to Ledger Lite
          </a>
        ) : null}
        {!canManage && companyId ? (
          <section className="notice">
            <strong>Read-only access.</strong> Your role can view catalogue data
            but cannot change it.
          </section>
        ) : null}
        <section id="catalogue" className="summary-grid">
          <article>
            <span>Active products</span>
            <strong>{catalogue.products.length}</strong>
          </article>
          <article>
            <span>Tax codes</span>
            <strong>{catalogue.taxCodes.length}</strong>
          </article>
          <article>
            <span>Price display</span>
            <strong>Tax inclusive</strong>
            <small>Default retail list</small>
          </article>
        </section>
        <section className="content-grid">
          <article className="panel" id="products">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Create</p>
                <h2>New product</h2>
              </div>
              <PackagePlus aria-hidden="true" />
            </div>
            <form className="stack" onSubmit={createProduct}>
              <label>
                Product name
                <input
                  name="name"
                  required
                  placeholder="e.g. Arabic coffee"
                  disabled={!canManage}
                />
              </label>
              <div className="two-columns">
                <label>
                  SKU
                  <input
                    name="sku"
                    placeholder="Optional"
                    disabled={!canManage}
                  />
                </label>
                <label>
                  Type
                  <select
                    name="productKind"
                    defaultValue="stock"
                    disabled={!canManage}
                  >
                    <option value="stock">Stock item</option>
                    <option value="service">Service</option>
                  </select>
                </label>
              </div>
              <div className="two-columns">
                <label>
                  Retail price (AED)
                  <input
                    name="unitPrice"
                    inputMode="decimal"
                    pattern="\d+(\.\d{1,6})?"
                    required
                    placeholder="0.00"
                    disabled={!canManage}
                  />
                </label>
                <label>
                  VAT code
                  <select name="taxCodeId" disabled={!canManage}>
                    <option value="">No VAT</option>
                    {catalogue.taxCodes.map((tax) => (
                      <option key={tax.id} value={tax.id}>
                        {tax.code} · {tax.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button className="primary" disabled={!canManage}>
                <Plus size={18} />
                Create product
              </button>
            </form>
          </article>
          <article className="panel" id="taxes">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Tax</p>
                <h2>VAT codes</h2>
              </div>
              <Tags aria-hidden="true" />
            </div>
            <form className="stack compact" onSubmit={createTax}>
              <div className="two-columns">
                <label>
                  Code
                  <input
                    name="code"
                    required
                    placeholder="VAT5"
                    disabled={!canManage}
                  />
                </label>
                <label>
                  Rate (%)
                  <input
                    name="rate"
                    inputMode="decimal"
                    required
                    placeholder="5"
                    disabled={!canManage}
                  />
                </label>
              </div>
              <label>
                Name
                <input
                  name="name"
                  required
                  placeholder="VAT 5%"
                  disabled={!canManage}
                />
              </label>
              <button className="secondary" disabled={!canManage}>
                <Plus size={18} />
                Add VAT code
              </button>
            </form>
          </article>
        </section>
        <section className="content-grid" aria-label="Product controls">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Maintain</p>
                <h2>Product details</h2>
              </div>
            </div>
            <form className="stack" onSubmit={updateProduct}>
              <label>
                Product
                <select
                  value={productDraft?.id ?? ""}
                  onChange={(event) => selectProduct(event.target.value)}
                  disabled={!canManage || catalogue.products.length === 0}
                >
                  {catalogue.products.length === 0 ? (
                    <option value="">Create a product first</option>
                  ) : (
                    catalogue.products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                        {product.sku ? ` · ${product.sku}` : ""}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <div className="two-columns">
                <label>
                  Product name
                  <input
                    value={productDraft?.name ?? ""}
                    onChange={(event) =>
                      changeProductDraft({ name: event.target.value })
                    }
                    required
                    disabled={!canManage || !productDraft}
                  />
                </label>
                <label>
                  SKU
                  <input
                    value={productDraft?.sku ?? ""}
                    onChange={(event) =>
                      changeProductDraft({ sku: event.target.value })
                    }
                    disabled={!canManage || !productDraft}
                  />
                </label>
              </div>
              <div className="two-columns">
                <label>
                  Type
                  <select
                    value={productDraft?.productKind ?? "stock"}
                    onChange={(event) =>
                      changeProductDraft({
                        productKind: event.target
                          .value as Product["productKind"],
                      })
                    }
                    disabled={!canManage || !productDraft}
                  >
                    <option value="stock">Stock item</option>
                    <option value="service">Service</option>
                  </select>
                </label>
                <label>
                  VAT code
                  <select
                    value={productDraft?.taxCodeId ?? ""}
                    onChange={(event) =>
                      changeProductDraft({ taxCodeId: event.target.value })
                    }
                    disabled={!canManage || !productDraft}
                  >
                    <option value="">No VAT</option>
                    {catalogue.taxCodes.map((tax) => (
                      <option key={tax.id} value={tax.id}>
                        {tax.code} · {tax.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="two-columns">
                <label>
                  Retail price (AED)
                  <input
                    value={productDraft?.unitPrice ?? ""}
                    onChange={(event) =>
                      changeProductDraft({ unitPrice: event.target.value })
                    }
                    inputMode="decimal"
                    pattern="\d+(\.\d{1,6})?"
                    required
                    disabled={!canManage || !productDraft}
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={productDraft?.isActive ?? false}
                    onChange={(event) =>
                      changeProductDraft({ isActive: event.target.checked })
                    }
                    disabled={!canManage || !productDraft}
                  />
                  Available at POS
                </label>
              </div>
              <p className="form-help">
                Price changes retain the earlier price for accounting and audit.
              </p>
              <button
                className="primary"
                disabled={!canManage || !productDraft}
              >
                Save product changes
              </button>
            </form>
          </article>
          <div className="panel-stack">
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Scan</p>
                  <h2>Barcode</h2>
                </div>
              </div>
              <form className="stack compact" onSubmit={createBarcode}>
                <label>
                  Barcode value
                  <input
                    name="barcode"
                    required
                    placeholder="e.g. 629100000001"
                    disabled={!canManage || !productDraft}
                  />
                </label>
                <label>
                  Symbology
                  <input
                    name="symbology"
                    placeholder="Optional, e.g. EAN-13"
                    disabled={!canManage || !productDraft}
                  />
                </label>
                <button
                  className="secondary"
                  disabled={!canManage || !productDraft}
                >
                  Add barcode
                </button>
                {productDraft?.barcodes.length ? (
                  <p className="form-help">
                    Current: {productDraft.barcodes.join(", ")}
                  </p>
                ) : null}
              </form>
            </article>
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Branch</p>
                  <h2>POS availability</h2>
                </div>
              </div>
              <form className="stack compact" onSubmit={setAvailability}>
                <label>
                  Branch
                  <select
                    name="branchId"
                    required
                    disabled={
                      !canManage || !productDraft || branches.length === 0
                    }
                  >
                    {branches.length === 0 ? (
                      <option value="">No active branches</option>
                    ) : (
                      branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.code} · {branch.name}
                        </option>
                      ))
                    )}
                  </select>
                </label>
                <div className="two-columns">
                  <label>
                    Sell at this branch
                    <select
                      name="isSellable"
                      defaultValue="true"
                      disabled={
                        !canManage || !productDraft || branches.length === 0
                      }
                    >
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  </label>
                  <label>
                    Reorder point
                    <input
                      name="reorderPoint"
                      inputMode="decimal"
                      pattern="\d+(\.\d{1,6})?"
                      placeholder="Optional"
                      disabled={
                        !canManage || !productDraft || branches.length === 0
                      }
                    />
                  </label>
                </div>
                <button
                  className="secondary"
                  disabled={
                    !canManage || !productDraft || branches.length === 0
                  }
                >
                  Save branch controls
                </button>
              </form>
            </article>
          </div>
        </section>
        <section className="panel table-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Current retail list</p>
              <h2>Products ready for POS</h2>
            </div>
            <button
              className="icon-button"
              onClick={() => void loadCatalog()}
              aria-label="Refresh catalogue"
              disabled={loading}
            >
              <RefreshCw size={18} />
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Barcodes</th>
                  <th>Status</th>
                  <th>Tax</th>
                  <th className="numeric">Retail price</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6}>Loading catalogue…</td>
                  </tr>
                ) : catalogue.products.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      No products yet. Create the first item above.
                    </td>
                  </tr>
                ) : (
                  catalogue.products.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.name}</strong>
                        <small>
                          {item.productKind === "stock"
                            ? "Stock item"
                            : "Service"}
                        </small>
                      </td>
                      <td>{item.sku ?? "—"}</td>
                      <td>{item.barcodes.join(", ") || "—"}</td>
                      <td>{item.isActive ? "Active" : "Inactive"}</td>
                      <td>
                        {item.taxCode
                          ? `${item.taxCode.code} (${Number(item.taxCode.rate) * 100}%)`
                          : "No VAT"}
                      </td>
                      <td className="numeric">
                        <strong>{money(item)}</strong>
                        <small>
                          {item.taxTreatment === "inclusive"
                            ? "VAT inclusive"
                            : "VAT added"}
                        </small>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}
