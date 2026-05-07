"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AdminSidebar } from "@/ui/AdminSidebar";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      <AdminSidebar />
      <main className="flex-1 ml-[68px] md:ml-[240px] p-4 md:p-8 max-w-6xl transition-[margin] duration-200">
        {children}
      </main>
    </div>
  );
}
