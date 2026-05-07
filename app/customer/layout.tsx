"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CustomerSidebar } from "@/ui/CustomerSidebar";

export default function CustomerLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/customer/login") {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex">
      <CustomerSidebar />
      <main className="flex-1 ml-[68px] md:ml-[240px] transition-[margin-left] duration-200">
        {children}
      </main>
    </div>
  );
}
