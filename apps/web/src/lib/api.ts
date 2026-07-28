const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

export function loginUrl(returnTo: string): string {
  if (!returnTo.startsWith("/") || returnTo.startsWith("//"))
    throw new Error("A login return path must be a safe relative path.");
  return `${apiUrl}/auth/login?${new URLSearchParams({ returnTo }).toString()}`;
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    credentials: "include",
    ...init,
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok)
    throw new Error(
      typeof body === "object" &&
        body !== null &&
        "message" in body &&
        typeof body.message === "string"
        ? body.message
        : `Request failed (${response.status}).`,
    );
  return body as T;
}

export function commandHeaders() {
  return {
    "content-type": "application/json",
    "idempotency-key": crypto.randomUUID(),
  };
}
