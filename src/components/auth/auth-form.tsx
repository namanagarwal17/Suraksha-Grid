"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Eye, EyeOff, AlertCircle, Loader2, Mail, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { signIn, signUp, resendConfirmation } from "@/lib/services/auth";
import { cn } from "@/lib/utils";

interface Props {
  mode: "login" | "signup";
  onSuccess?: () => void;
  initialError?: string | null;
  initialEmail?: string | null;
}

export function AuthForm({ mode, onSuccess, initialError, initialEmail }: Props) {
  const [email, setEmail] = useState(initialEmail ?? "");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [signupState, setSignupState] = useState<"idle" | "confirmation_sent" | "already_registered">("idle");
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  async function handleResend() {
    if (!email || resendCooldown > 0) return;
    setResendLoading(true);
    setResendSuccess(null);
    setError(null);
    try {
      const { error: resendErr } = await resendConfirmation(email);
      if (resendErr) throw resendErr;
      setResendSuccess("Confirmation link sent! Please check your inbox and spam folder.");
      setResendCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend confirmation email");
    } finally {
      setResendLoading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResendSuccess(null);
    try {
      if (mode === "signup") {
        const result = await signUp(email, password, name);
        if (result.error) throw result.error;

        if (result.session) {
          // If auto-authenticated, proceed to success handler
          onSuccess?.();
        } else if (result.user && result.user.identities && result.user.identities.length === 0) {
          // User already exists in Supabase Auth (email enumeration protection)
          setSignupState("already_registered");
        } else {
          // Genuine new signup requiring email confirmation
          setSignupState("confirmation_sent");
        }
      } else {
        const result = await signIn(email, password);
        if (result.error) throw result.error;
        onSuccess?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (signupState === "already_registered" && mode === "signup") {
    return (
      <Card className="py-8 text-center space-y-4">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-amber-500/10 text-amber-600">
          <Mail className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <p className="text-lg font-bold">Account already exists</p>
          <p className="text-sm text-muted max-w-xs mx-auto">
            An account with <strong className="text-foreground">{email}</strong> already exists.
          </p>
          <p className="text-xs text-muted max-w-xs mx-auto pt-1">
            If your email is not yet confirmed, you can request a new confirmation email below. Otherwise, please sign in.
          </p>
        </div>

        {resendSuccess && (
          <p className="flex items-center justify-center gap-1.5 text-xs text-safer font-medium">
            <CheckCircle2 className="h-4 w-4" />
            {resendSuccess}
          </p>
        )}

        {error && (
          <p className="text-xs text-concern">{error}</p>
        )}

        <div className="pt-2 space-y-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleResend}
            disabled={resendLoading || resendCooldown > 0}
            className="w-full text-xs"
          >
            {resendLoading ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Sending…
              </>
            ) : resendCooldown > 0 ? (
              `Resend in ${resendCooldown}s`
            ) : (
              "Resend confirmation email"
            )}
          </Button>

          <Link
            href={`/auth/login?email=${encodeURIComponent(email)}`}
            className="block text-sm font-semibold text-brand pt-1"
          >
            Sign in with your password
          </Link>
        </div>
      </Card>
    );
  }

  if (signupState === "confirmation_sent" && mode === "signup") {
    return (
      <Card className="py-8 text-center space-y-4">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand/10 text-brand">
          <Mail className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <p className="text-lg font-bold">Check your email</p>
          <p className="text-sm text-muted max-w-xs mx-auto">
            We sent a verification link to <strong className="text-foreground">{email}</strong>.
          </p>
          <p className="text-xs text-muted max-w-xs mx-auto pt-1">
            Please check your inbox and <strong>spam/junk folder</strong>, then click the link to confirm your account and sign in.
          </p>
        </div>

        {resendSuccess && (
          <p className="flex items-center justify-center gap-1.5 text-xs text-safer font-medium">
            <CheckCircle2 className="h-4 w-4" />
            {resendSuccess}
          </p>
        )}

        {error && (
          <p className="text-xs text-concern">{error}</p>
        )}

        <div className="pt-2 space-y-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleResend}
            disabled={resendLoading || resendCooldown > 0}
            className="w-full text-xs"
          >
            {resendLoading ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Sending…
              </>
            ) : resendCooldown > 0 ? (
              `Resend in ${resendCooldown}s`
            ) : (
              "Resend confirmation email"
            )}
          </Button>

          <Link
            href="/auth/login"
            className="block text-sm font-semibold text-brand pt-1"
          >
            Return to sign in
          </Link>
        </div>
      </Card>
    );
  }

  const field = cn(
    "h-11 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-brand"
  );

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        {mode === "signup" && (
          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-semibold">
              Full name
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className={field}
            />
          </div>
        )}
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-semibold">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={field}
            autoComplete="email"
          />
        </div>
        <div>
          <label
            htmlFor="password"
            className="mb-1 block text-sm font-semibold"
          >
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              type={show ? "text" : "password"}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={cn(field, "pr-11")}
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
            />
            <button
              type="button"
              onClick={() => setShow(!show)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted"
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
        {error && (
          <div className="space-y-2">
            <p className="flex items-center gap-2 rounded-xl bg-concern/10 p-3 text-sm text-concern">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </p>
            {email && (error.toLowerCase().includes("confirm") || error.toLowerCase().includes("verif")) && (
              <div className="flex items-center justify-between rounded-xl border border-line bg-surface p-2.5 text-xs">
                <span className="text-muted">Need a new confirmation link?</span>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendLoading || resendCooldown > 0}
                  className="font-semibold text-brand hover:underline disabled:opacity-50"
                >
                  {resendLoading ? "Sending…" : resendCooldown > 0 ? `Resend (${resendCooldown}s)` : "Resend email"}
                </button>
              </div>
            )}
            {resendSuccess && (
              <p className="flex items-center gap-1.5 text-xs text-safer font-medium">
                <CheckCircle2 className="h-4 w-4" />
                {resendSuccess}
              </p>
            )}
          </div>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {mode === "signup" ? "Creating account…" : "Signing in…"}
            </>
          ) : mode === "signup" ? (
            "Create account"
          ) : (
            "Sign in"
          )}
        </Button>
      </form>
    </Card>
  );
}
