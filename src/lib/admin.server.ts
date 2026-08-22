import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Verify the caller holds the admin role using their OWN authenticated client
 * (RLS-respecting). Only after this passes may a handler use the service role.
 */
export async function requireAdmin(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error || data !== true) {
    throw new Error("Forbidden: admin access required");
  }
}

export async function getAdminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Round to 2 decimals for currency. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
