import { Suspense } from "react";
import { AdminLoginClient } from "@/ui/AdminLoginClient";

export default function AdminLoginPage() {
  return (
    <Suspense>
      <AdminLoginClient />
    </Suspense>
  );
}
