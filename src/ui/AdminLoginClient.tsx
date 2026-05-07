"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck, AlertCircle } from "lucide-react";
import { createSupabaseBrowserClient } from "@/adapters/supabase/browser-client";

const HARDCODED_ADMIN_EMAIL = "admin@gmail.com";
const HARDCODED_ADMIN_PASSWORD = "admin";

export function AdminLoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(HARDCODED_ADMIN_EMAIL);
  const [password, setPassword] = useState(HARDCODED_ADMIN_PASSWORD);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    searchParams.get("error") === "not_admin" ? "This account does not have admin access." : null
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      const next = searchParams.get("next") ?? "/admin";
      router.push(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <ShieldCheck className="w-10 h-10 text-accent mx-auto mb-3" />
          <h1
            className="text-2xl font-[520] tracking-[-0.02em]"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif", color: "var(--ink-soft)" }}
          >
            Admin Login
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
          <div>
            <label htmlFor="admin-email" className="text-xs font-semibold text-muted block mb-1">
              Email
            </label>
            <input
              id="admin-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full !bg-card-soft !border !border-border !rounded-lg !px-3 !py-2.5 !text-sm !text-foreground"
              placeholder="admin@example.com"
            />
          </div>
          <div>
            <label htmlFor="admin-password" className="text-xs font-semibold text-muted block mb-1">
              Password
            </label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full !bg-card-soft !border !border-border !rounded-lg !px-3 !py-2.5 !text-sm !text-foreground"
              placeholder="Enter password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full !bg-accent !text-white !font-bold !px-5 !py-2.5 !rounded-full !text-sm hover:!opacity-90"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
