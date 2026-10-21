/**
 * Browser (client-component) Supabase client.
 *
 * Uses the public anon key — safe to ship to the browser because RLS
 * on the database enforces all data-access rules.
 *
 * Import this in any "use client" file.
 */
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Copy .env.example to .env.local and fill in your Supabase project values."
    );
  }
  if (!client) {
    client = createBrowserClient<Database>(url, key);
  }
  return client;
}
