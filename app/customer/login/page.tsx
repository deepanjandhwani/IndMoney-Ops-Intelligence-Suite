import { Suspense } from "react";
import { CustomerLoginClient } from "@/ui/CustomerLoginClient";

export default function CustomerLoginPage() {
  return (
    <Suspense>
      <CustomerLoginClient />
    </Suspense>
  );
}
