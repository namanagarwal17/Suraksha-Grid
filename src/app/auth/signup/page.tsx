"use client";
import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { AuthForm } from "@/components/auth/auth-form";
import { getUser } from "@/lib/services/auth";

function SignupFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") ?? searchParams.get("next") ?? "/";

  useEffect(() => {
    getUser().then((user) => {
      if (user) {
        router.replace(redirect);
      }
    });
  }, [redirect, router]);

  const handleSuccess = () => {
    router.push(redirect);
    router.refresh();
  };

  return (
    <>
      <AuthForm mode="signup" onSuccess={handleSuccess} />
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link
          href={
            redirect && redirect !== "/"
              ? `/auth/login?redirect=${encodeURIComponent(redirect)}`
              : "/auth/login"
          }
          className="font-semibold text-brand"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}

export default function SignupPage() {
  return (
    <div className="mx-auto max-w-sm space-y-6 p-6 pt-12">
      <div className="text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand text-white">
          <ShieldCheck className="h-7 w-7" />
        </span>
        <h1 className="mt-4 text-2xl font-bold">Create your account</h1>
        <p className="mt-1 text-sm text-muted">
          Join Suraksha Grid and help keep your community safer
        </p>
      </div>
      <Suspense fallback={<div className="h-48 rounded-xl bg-surface animate-pulse" />}>
        <SignupFormContent />
      </Suspense>
    </div>
  );
}