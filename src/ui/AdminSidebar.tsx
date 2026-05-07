"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  TrendingUp,
  ShieldCheck,
  ClipboardCheck,
  Home,
  PanelLeftClose,
  PanelLeft,
  LogOut
} from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/adapters/supabase/browser-client";

const adminNav = [
  { href: "/admin/review-pulse", label: "Review Pulse", icon: BarChart3 },
  { href: "/admin/review-trends", label: "Review Trends", icon: TrendingUp },
  { href: "/admin/hitl", label: "HITL Center", icon: ShieldCheck },
  { href: "/admin/evals", label: "Evaluations", icon: ClipboardCheck }
];

export function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    setCollapsed(!mq.matches);
    const handler = (e: MediaQueryListEvent) => setCollapsed(!e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return (
    <aside
      className={`fixed top-0 left-0 h-screen z-30 flex flex-col border-r border-border bg-card/95 backdrop-blur-md transition-[width] duration-200 ${collapsed ? "w-[68px]" : "w-[240px]"}`}
    >
      <div className="flex items-center justify-between px-4 py-4 border-b border-border">
        {!collapsed && (
          <Link href="/" className="flex items-center gap-2 min-w-0">
            <Home className="w-4 h-4 text-accent shrink-0" />
            <span className="text-sm font-bold tracking-tight text-ink-soft truncate">
              Groww Ops
            </span>
          </Link>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="!bg-transparent !p-1.5 !text-muted hover:!text-foreground !shadow-none"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>

      {!collapsed && (
        <div className="px-4 pt-3 pb-1">
          <span className="text-[0.65rem] font-extrabold tracking-[0.12em] uppercase text-accent">
            Admin
          </span>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-1">
        {adminNav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors no-underline ${
                active
                  ? "bg-accent/10 text-accent-strong"
                  : "text-muted hover:bg-card-soft hover:text-foreground"
              } ${collapsed ? "justify-center" : ""}`}
              title={collapsed ? item.label : undefined}
            >
              <item.icon className="w-[18px] h-[18px] shrink-0" strokeWidth={2} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-3 py-3 space-y-2">
        <Link
          href="/"
          className={`flex items-center gap-2 text-xs font-semibold text-muted hover:text-foreground transition-colors no-underline ${collapsed ? "justify-center" : ""}`}
        >
          <Home className="w-3.5 h-3.5" />
          {!collapsed && "Back to Home"}
        </Link>
        <button
          type="button"
          onClick={async () => {
            try {
              const supabase = createSupabaseBrowserClient();
              await supabase.auth.signOut();
            } catch { /* ignore */ }
            router.push("/admin/login");
            router.refresh();
          }}
          className={`flex items-center gap-2 text-xs font-semibold text-muted hover:text-danger transition-colors !bg-transparent !shadow-none !p-0 w-full ${collapsed ? "justify-center" : ""}`}
        >
          <LogOut className="w-3.5 h-3.5" />
          {!collapsed && "Sign Out"}
        </button>
      </div>
    </aside>
  );
}
