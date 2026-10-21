import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/lib/supabase/types";

export type CookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = (searchParams.get("type") as EmailOtpType) || "signup";
  const next = searchParams.get("next") ?? searchParams.get("redirect") ?? "/";
  const errorParam = searchParams.get("error_description") || searchParams.get("error");

  if (errorParam) {
    const errorUrl = new URL("/auth/login", request.url);
    errorUrl.searchParams.set("error", errorParam);
    return NextResponse.redirect(errorUrl);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if ((code || token_hash) && url && key) {
    try {
      const cookieStore = await cookies();
      const sb = createServerClient<Database>(url, key, {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet: CookieToSet[]) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Route handler cookie set error fallback
            }
          },
        },
      });

      let authError = null;
      if (token_hash) {
        const { error } = await sb.auth.verifyOtp({ token_hash, type });
        authError = error;
      } else if (code) {
        const { error } = await sb.auth.exchangeCodeForSession(code);
        authError = error;
      }

      if (!authError) {
        const forwardedHost = request.headers.get("x-forwarded-host");
        const isLocalEnv = process.env.NODE_ENV === "development";
        const targetPath = next.startsWith("/") ? next : `/${next}`;
        if (isLocalEnv) {
          return NextResponse.redirect(`${origin}${targetPath}`);
        } else if (forwardedHost) {
          return NextResponse.redirect(`https://${forwardedHost}${targetPath}`);
        } else {
          return NextResponse.redirect(`${origin}${targetPath}`);
        }
      } else {
        console.error("[auth/callback] session exchange failed:", authError);
        const loginUrl = new URL("/auth/login", request.url);
        loginUrl.searchParams.set(
          "error",
          authError.message || "Email confirmation failed or link expired"
        );
        return NextResponse.redirect(loginUrl);
      }
    } catch (err) {
      console.error("[auth/callback] session exchange exception:", err);
    }
  }

  const targetPath = next.startsWith("/") ? next : `/${next}`;
  return NextResponse.redirect(new URL(targetPath, request.url));
}