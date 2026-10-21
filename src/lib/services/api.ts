/**
 * Same-origin API client for the browser.
 *
 * Reads go through the Next.js proxy so the browser never needs the
 * server-only FASTAPI_BASE_URL. The proxy calls FastAPI, which reads from
 * Supabase/Postgres using the backend credentials.
 */
export async function apiGet<T>(path: string): Promise<T> {
  const normalized = path.replace(/^\/+|\/+$/g, "");
  const response = await fetch(`/api/backend/${normalized}`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `API request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

export async function apiPost<T>(path: string, payload: unknown): Promise<T> {
  const normalized = path.replace(/^\/+|\/+$/g, "");
  const response = await fetch(`/api/backend/${normalized}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `API request failed (${response.status})`);
  }

  return (await response.json()) as T;
}
