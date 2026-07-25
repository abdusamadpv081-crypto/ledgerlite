"use client";

import { FormEvent, useEffect, useState } from "react";

const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

type Tax = { id: string; code: string; name: string; rate: number };
type Product = { id: string; sku: string | null; name: string };

export default function HomePage() {
  const [companyId, setCompanyId] = useState("");
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [message, setMessage] = useState("Preparing development catalogue…");

  async function refresh(tenantId = companyId) {
    const response = await fetch(
      `${apiUrl}/development/catalog?companyId=${tenantId}`,
    );
    const data = await response.json();
    setTaxes(data.taxes);
    setProducts(data.products);
  }

  useEffect(() => {
    void (async () => {
      const response = await fetch(`${apiUrl}/development/catalog/bootstrap`, {
        method: "POST",
      });
      const data = await response.json();
      setCompanyId(data.companyId);
      await refresh(data.companyId);
      setMessage("Development tenant ready.");
    })().catch(() =>
      setMessage("Could not reach the local API. Start the API on port 3001."),
    );
  }, []);

  async function createTax(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await fetch(`${apiUrl}/development/catalog/taxes`, {
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
  }

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await fetch(`${apiUrl}/development/catalog/products`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyId,
        sku: form.get("sku"),
        name: form.get("name"),
        taxCodeId: form.get("taxCodeId") || undefined,
      }),
    });
    event.currentTarget.reset();
    await refresh();
  }

  return (
    <main>
      <p className="eyebrow">Development catalogue</p>
      <h1>Products ready for POS setup</h1>
      <p>{message}</p>
      <section>
        <h2>Tax codes</h2>
        <form onSubmit={createTax}>
          <input name="code" placeholder="VAT5" required />
          <input name="name" placeholder="VAT 5%" required />
          <input
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
              {tax.code} — {tax.name} ({Number(tax.rate) * 100}%)
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Products</h2>
        <form onSubmit={createProduct}>
          <input name="sku" placeholder="SKU" />
          <input name="name" placeholder="Product name" required />
          <select name="taxCodeId">
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
              {product.sku ? `${product.sku} — ` : ""}
              {product.name}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
