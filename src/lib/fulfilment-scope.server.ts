/**
 * Who may read the shared Fulfilment section, and for which workspaces.
 *
 * Staff (owner / collaborator / reader) see every workspace. A sourcing
 * collaborator sees only the workspaces that are really theirs, read from the
 * explicit assignment fields — `quote_requests.assigned_sourcer` and
 * `quote_lines.sourced_by` — never from a guess.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type FulfilmentScope = {
  isAdmin: boolean;
  /** null = every workspace; a list = only these workspace ids. */
  storeIds: string[] | null;
};

/** Workspaces a sourcing collaborator is assigned to, directly or by pricing. */
export async function sourcingStoreIds(
  admin: SupabaseClient<Database>,
  userId: string,
): Promise<string[]> {
  const [{ data: assigned }, { data: priced }] = await Promise.all([
    admin.from("quote_requests").select("store_id").eq("assigned_sourcer", userId),
    admin
      .from("quote_lines")
      .select("quote_requests!inner(store_id)")
      .eq("sourced_by", userId)
      .limit(2000),
  ]);

  const ids = new Set<string>();
  for (const row of assigned ?? []) if (row.store_id) ids.add(row.store_id);
  for (const row of priced ?? []) {
    const store = (row as { quote_requests?: { store_id?: string | null } | null }).quote_requests;
    if (store?.store_id) ids.add(store.store_id);
  }
  return [...ids];
}

/**
 * Resolve the caller's fulfilment scope. Throws when they are neither staff
 * nor an active sourcing collaborator.
 */
export async function fulfilmentScope(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<FulfilmentScope> {
  const { getStaffLevel, getAdminClient } = await import("./admin.server");
  const level = await getStaffLevel(supabase, userId);
  if (level) return { isAdmin: true, storeIds: null };

  const { data: sourcing } = await supabase.rpc("is_sourcing", { _user_id: userId });
  if (sourcing !== true) throw new Error("Forbidden: admin access required");

  const admin = await getAdminClient();
  return { isAdmin: false, storeIds: await sourcingStoreIds(admin, userId) };
}

/** Keep only the stores the scope allows. */
export function withinScope<T extends { id: string }>(scope: FulfilmentScope, stores: T[]): T[] {
  if (scope.storeIds === null) return stores;
  const allowed = new Set(scope.storeIds);
  return stores.filter((s) => allowed.has(s.id));
}
