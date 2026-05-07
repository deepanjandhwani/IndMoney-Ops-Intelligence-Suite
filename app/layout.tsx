import type { Metadata } from "next";
import { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Groww Ops Intelligence Suite",
  description:
    "Grounded mutual fund and fee FAQ, advisor scheduling, Play Store review intelligence, and admin workflows for Groww operations."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
