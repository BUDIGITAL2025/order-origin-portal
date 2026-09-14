import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type StaffLevel = "owner" | "collaborator" | "reader";

/**
 * The caller's internal staff level, or null when they are not staff.
 * `staff_level` is a security-definer function returning only ACTIVE rows,
 * so deactivated members read as "not staff".
 */
export async function getStaffLevel(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<StaffLevel | null> {
  const { data } = await supabase.rpc("staff_level", { _user_id: userId });
  return (data as StaffLevel | null) ?? null;
}

/** Read access to the admin console — any active staff level. */
export async function requireStaffRead(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<StaffLevel> {
  const level = await getStaffLevel(supabase, userId);
  if (!level) throw new Error("Forbidden: admin access required");
  return level;
}

/**
 * Day-to-day admin mutations: owners and collaborators. Readers are stopped
 * here, server-side — hiding buttons is only cosmetic on top of this.
 * Kept under the historical name so every existing call site is covered.
 */
export async function requireAdmin(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const level = await requireStaffRead(supabase, userId);
  if (level === "reader") {
    throw new Error("Your role is read-only — ask an owner for collaborator access.");
  }
}

/** Owner-only: team management, deletes/archives, module grants, pricing config. */
export async function requireOwner(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const level = await requireStaffRead(supabase, userId);
  if (level !== "owner") {
    throw new Error("Owners only — this action is restricted to account owners.");
  }
}

/** Staff with write access and active sourcing collaborators share the catalog import desk. */
export async function requireAdminOrSourcing(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const level = await getStaffLevel(supabase, userId);
  if (level === "owner" || level === "collaborator") return;
  const { data: sourcing } = await supabase.rpc("is_sourcing", { _user_id: userId });
  if (sourcing === true) return;
  if (level === "reader") {
    throw new Error("Your role is read-only — ask an owner for collaborator access.");
  }
  throw new Error("Forbidden: admin access required");
}

export async function getAdminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Round to 2 decimals for currency. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
