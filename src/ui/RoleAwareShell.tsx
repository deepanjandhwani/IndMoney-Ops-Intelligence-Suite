import Link from "next/link";
import { ReactNode } from "react";

import { getNavigationForRole } from "@/services/access-control";
import { AppRole } from "@/models/navigation";

type RoleAwareShellProps = {
  children: ReactNode;
};

const roles: AppRole[] = ["customer", "admin"];

export function RoleAwareShell({ children }: RoleAwareShellProps) {
  return (
    <div className="app-shell">
      <header className="shell-header">
        <Link className="brand" href="/">
          INDmoney Ops Intelligence Suite
        </Link>
        <p>Phase 0 scaffold: empty module pages, role-aware navigation, no external API calls.</p>
      </header>

      <nav className="role-nav" aria-label="Role-aware module navigation">
        {roles.map((role) => (
          <section className="role-card" key={role} aria-labelledby={`${role}-nav`}>
            <h2 id={`${role}-nav`}>{role === "customer" ? "Customer" : "Admin"}</h2>
            <ul>
              {getNavigationForRole(role).map((item) => (
                <li key={`${role}-${item.href}`}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>

      <main className="shell-main">{children}</main>
    </div>
  );
}
