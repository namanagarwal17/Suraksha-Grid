/**
 * Auth service — thin wrapper over Supabase Auth.
 * Called from "use client" components only. Not itself a component.
 */
import { type User, type Session, AuthError } from "@supabase/supabase-js";

function configured() {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

async function getClient() {
  const { createClient } = await import("@/lib/supabase/client");
  return createClient();
}

export interface AuthResult {
  user: User | null;
  session?: Session | null;
  error: AuthError | null;
}

export async function signUp(
  email: string,
  password: string,
  fullName: string
): Promise<AuthResult> {
  if (!configured()) {
    return {
      user: null,
      session: null,
      error: new AuthError(
        "Supabase is not configured. Please provide NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
      ),
    };
  }
  const sb = await getClient();
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://suraksha-gridx.vercel.app";
  const emailRedirectTo = `${origin}/auth/callback`;

  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo,
    },
  });
  return { user: data.user ?? null, session: data.session ?? null, error };
}

export async function resendConfirmation(
  email: string
): Promise<{ error: AuthError | null }> {
  if (!configured()) {
    return {
      error: new AuthError(
        "Supabase is not configured. Please provide NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
      ),
    };
  }
  const sb = await getClient();
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://suraksha-gridx.vercel.app";
  const emailRedirectTo = `${origin}/auth/callback`;

  const { error } = await sb.auth.resend({
    type: "signup",
    email,
    options: {
      emailRedirectTo,
    },
  });
  return { error };
}

export async function signIn(
  email: string,
  password: string
): Promise<AuthResult> {
  if (!configured()) {
    return {
      user: null,
      session: null,
      error: new AuthError(
        "Supabase is not configured. Please provide NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
      ),
    };
  }
  const sb = await getClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  return { user: data.user ?? null, session: data.session ?? null, error };
}

export async function signOut(): Promise<{ error: AuthError | null }> {
  if (!configured()) return { error: null };
  const sb = await getClient();
  return sb.auth.signOut();
}

export async function getUser(): Promise<User | null> {
  if (!configured()) return null;
  try {
    const sb = await getClient();
    const { data } = await sb.auth.getUser();
    return data.user;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  if (!configured()) return null;
  try {
    const sb = await getClient();
    const { data } = await sb.auth.getSession();
    return data.session;
  } catch {
    return null;
  }
}

export async function onAuthStateChange(
  callback: (event: string, session: Session | null) => void
) {
  if (!configured()) {
    return {
      data: {
        subscription: {
          unsubscribe: () => {},
        },
      },
    };
  }
  const sb = await getClient();
  return sb.auth.onAuthStateChange(callback);
}