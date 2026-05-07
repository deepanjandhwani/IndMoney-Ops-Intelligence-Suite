import { createSupabaseAdminClient } from "../../adapters/supabase/admin-client";
import { createSupabaseSchedulerRepository } from "../../adapters/supabase/scheduler-repository";
import { createGoogleSchedulerIntegrations } from "./integrations";
import { SchedulerLifecycleDeps } from "./booking-lifecycle";

export function createSchedulerDeps(): SchedulerLifecycleDeps {
  const client = createSupabaseAdminClient();
  return {
    repository: createSupabaseSchedulerRepository(client),
    integrations: createGoogleSchedulerIntegrations(),
    appUrl: process.env.NEXT_PUBLIC_APP_URL
  };
}
