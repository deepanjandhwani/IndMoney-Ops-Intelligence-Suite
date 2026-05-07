"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Home, LogIn, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/adapters/supabase/browser-client";

const navItems = [
  { href: "/customer/faq", label: "Mutual Fund FAQ" },
  { href: "/customer/scheduler", label: "Speak to an Advisor" },
  { href: "/customer/my-bookings", label: "My Bookings" },
];

export function CustomerTopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    try {
      const supabase = createSupabaseBrowserClient();
      supabase.auth.getUser().then(({ data }) => {
        setLoggedIn(Boolean(data.user));
      });
    } catch {
      /* Supabase env vars may not be set */
    }
  }, [pathname]);

  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-20">
      <Link href="/" className="flex items-center gap-2.5 no-underline">
        <Home className="w-4 h-4 text-accent" />
        <span className="text-sm font-bold tracking-tight" style={{ color: "var(--ink-soft)" }}>
          Groww Ops
        </span>
      </Link>
      <nav className="flex items-center gap-1.5">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`text-xs font-semibold px-4 py-1.5 rounded-full no-underline transition-all ${
                active
                  ? "bg-accent/10 text-accent"
                  : "border border-border text-muted hover:border-accent/40 hover:text-accent"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center gap-2">
        <span className="text-[0.68rem] font-extrabold tracking-[0.1em] uppercase text-accent">
          Customer
        </span>
        {loggedIn ? (
          <button
            type="button"
            onClick={async () => {
              try {
                const supabase = createSupabaseBrowserClient();
                await supabase.auth.signOut();
              } catch { /* ignore */ }
              setLoggedIn(false);
              router.refresh();
            }}
            className="!bg-transparent !p-1 !text-muted hover:!text-danger !shadow-none"
            title="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        ) : (
          <Link
            href="/customer/login"
            className="!bg-transparent !p-1 !text-muted hover:!text-accent no-underline"
            title="Sign in"
          >
            <LogIn className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>
    </header>
  );
}
