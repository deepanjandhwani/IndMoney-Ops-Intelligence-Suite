import { createClient } from "@supabase/supabase-js";

export function createSupabaseAdminClient(env: NodeJS.ProcessEnv = process.env) {
  const supabaseUrl =
    env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? env.GH_SUPABASE_URL;
  const serviceRoleKey =
    env.SUPABASE_SERVICE_ROLE_KEY ?? env.GH_SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing Supabase URL. Set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.");
  }

  if (!serviceRoleKey) {
    throw new Error("Missing Supabase service role key. Set SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

/** Returns null when URL or service role key is missing (e.g. local dev without Supabase). */
export function tryCreateSupabaseAdminClient(env: NodeJS.ProcessEnv = process.env) {
  const supabaseUrl =
    env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? env.GH_SUPABASE_URL;
  const serviceRoleKey =
    env.SUPABASE_SERVICE_ROLE_KEY ?? env.GH_SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
