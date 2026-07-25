"use client";

import { FormEvent, useEffect, useState } from "react";

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

type Tax = { id: string; code: string; name: string; rate: number };
type Product = {
  id: string;
  sku: string | null;
  name: string;
  unit_price: string | null;
};
type Catalog = { taxes: Tax[]; products: Product[] };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, init);
  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string"
        ? body.message
        : `Request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return body as T;
}

export default function HomePage() {
  const [companyId, setCompanyId] = useState("");
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [message, setMessage] = useState("Preparing development catalogue...");

  async function refresh(tenantId = companyId) {
    const data = await request<Catalog>(
      `/development/catalog?companyId=${tenantId}`,
    );
    setTaxes(data.taxes);
    setProducts(data.products);
  }

  useEffect(() => {
    void (async () => {
      const data = await request<{ companyId: string; branchId: string }>(
        "/development/catalog/bootstrap",
        { method: "POST" },
      );
      setCompanyId(data.companyId);
      await refresh(data.companyId);
      setMessage("Development tenant ready.");
    })().catch(() =>
      setMessage(
        "Could not reach the local development API. Enable the catalogue demo and start the API on port 3001.",
      ),
    );
  }, []);

  async function createTax(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await request("/development/catalog/taxes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId,
          code: form.get("code"),
          name: form.get("name"),
          rate: Number(form.get("rate")) / 100,
        }),
      });
      event.currentTarget.reset();
      await refresh();
      setMessage("Tax code saved.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save tax code.",
      );
    }
  }

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await request("/development/catalog/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId,
          sku: form.get("sku") || undefined,
          name: form.get("name"),
          taxCodeId: form.get("taxCodeId") || undefined,
        }),
      });
      event.currentTarget.reset();
      await refresh();
      setMessage("Product saved.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save product.",
      );
    }
  }

  return (
    <main>
      <p className="eyebrow">Development catalogue</p>
      <h1>Products ready for POS setup</h1>
      <p aria-live="polite" role="status">
        {message}
      </p>
      <section>
        <h2>Tax codes</h2>
        <form onSubmit={createTax}>
          <input
            aria-label="Tax code"
            name="code"
            placeholder="VAT5"
            required
          />
          <input
            aria-label="Tax name"
            name="name"
            placeholder="VAT 5%"
            required
          />
          <input
            aria-label="Tax rate percentage"
            name="rate"
            type="number"
            step="0.001"
            placeholder="5"
            required
          />
          <button>Add tax code</button>
        </form>
        <ul>
          {taxes.map((tax) => (
            <li key={tax.id}>
              {tax.code} - {tax.name} ({Number(tax.rate) * 100}%)
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Products</h2>
        <form onSubmit={createProduct}>
          <input aria-label="SKU" name="sku" placeholder="SKU" />
          <input
            aria-label="Product name"
            name="name"
            placeholder="Product name"
            required
          />
          <select aria-label="Default tax code" name="taxCodeId">
            <option value="">No tax code</option>
            {taxes.map((tax) => (
              <option key={tax.id} value={tax.id}>
                {tax.code}
              </option>
            ))}
          </select>
          <button>Add product</button>
        </form>
        <ul>
          {products.map((product) => (
            <li key={product.id}>
              {product.sku ? `${product.sku} - ` : ""}
              {product.name}
              {product.unit_price ? ` - AED ${product.unit_price}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
