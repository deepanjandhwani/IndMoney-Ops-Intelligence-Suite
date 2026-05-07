"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { User, AlertCircle } from "lucide-react";
import { createSupabaseBrowserClient } from "@/adapters/supabase/browser-client";

export function CustomerLoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [signupSuccess, setSignupSuccess] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createSupabaseBrowserClient();

      if (mode === "signup") {
        const trimmedName = displayName.trim();
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: trimmedName || undefined } }
        });
        if (signUpError) {
          setError(signUpError.message);
          return;
        }
        if (signUpData.user && trimmedName) {
          await supabase.from("profiles").upsert({
            id: signUpData.user.id,
            display_name: trimmedName
          }, { onConflict: "id" });
        }
        setSignupSuccess(true);
        return;
      }

      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      if (authError) {
        setError(authError.message);
        return;
      }

      const next = searchParams.get("next") ?? "/customer/my-bookings";
      router.push(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  if (signupSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <User className="w-10 h-10 text-success mx-auto mb-3" />
          <h1
            className="text-2xl font-[520] tracking-[-0.02em]"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif", color: "var(--ink-soft)" }}
          >
            Check your email
          </h1>
          <p className="text-sm text-muted mt-2">
            We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account, then sign in.
          </p>
          <button
            type="button"
            onClick={() => { setSignupSuccess(false); setMode("login"); }}
            className="mt-4 !bg-accent !text-white !font-bold !px-5 !py-2.5 !rounded-full !text-sm hover:!opacity-90"
          >
            Back to Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <User className="w-10 h-10 text-accent mx-auto mb-3" />
          <h1
            className="text-2xl font-[520] tracking-[-0.02em]"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif", color: "var(--ink-soft)" }}
          >
            {mode === "login" ? "Customer Sign In" : "Create Account"}
          </h1>
          <p className="text-sm text-muted mt-1">Groww Ops Intelligence Suite</p>
        </div>

        {error && (
          <div className="bg-danger/5 border border-danger/20 text-danger rounded-xl p-3 text-sm font-semibold flex items-center gap-2 mb-4">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          {mode === "signup" ? (
            <div>
              <label htmlFor="customer-name" className="text-xs font-semibold text-muted block mb-1">
                Your Name
              </label>
              <input
                id="customer-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full !bg-card-soft !border !border-border !rounded-lg !px-3 !py-2.5 !text-sm !text-foreground"
                placeholder="e.g. Deepanjan"
              />
            </div>
          ) : null}
          <div>
            <label htmlFor="customer-email" className="text-xs font-semibold text-muted block mb-1">
              Email
            </label>
            <input
              id="customer-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full !bg-card-soft !border !border-border !rounded-lg !px-3 !py-2.5 !text-sm !text-foreground"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label htmlFor="customer-password" className="text-xs font-semibold text-muted block mb-1">
              Password
            </label>
            <input
              id="customer-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full !bg-card-soft !border !border-border !rounded-lg !px-3 !py-2.5 !text-sm !text-foreground"
              placeholder="Min 6 characters"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full !bg-accent !text-white !font-bold !px-5 !py-2.5 !rounded-full !text-sm hover:!opacity-90"
          >
            {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <p className="text-center text-xs text-muted mt-4">
          {mode === "login" ? (
            <>
              No account?{" "}
              <button type="button" onClick={() => { setMode("signup"); setError(null); }} className="!bg-transparent !p-0 !text-accent !font-bold !shadow-none !text-xs">
                Create one
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button type="button" onClick={() => { setMode("login"); setError(null); }} className="!bg-transparent !p-0 !text-accent !font-bold !shadow-none !text-xs">
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
