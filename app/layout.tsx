import type { Metadata } from "next";
import { ReactNode } from "react";

import "./globals.css";
import { RoleAwareShell } from "@/ui/RoleAwareShell";

export const metadata: Metadata = {
  title: "INDmoney Ops Intelligence Suite",
  description: "Phase 0 scaffold for the INDmoney Ops Intelligence Suite capstone"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <RoleAwareShell>{children}</RoleAwareShell>
      </body>
    </html>
  );
}
