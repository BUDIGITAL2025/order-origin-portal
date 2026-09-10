/**
 * Module activation — server-only helpers.
 *
 * A workspace holds a module when it has an active row in `workspace_modules`
 * for the current Stripe environment, OR an admin grant (grants are
 * environment-independent, so live stock is never stranded behind a paywall).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ModuleKey } from "./modules";

type Admin = SupabaseClient<Database>;
export type StripeEnv = "sandbox" | "live";

export type ModuleActivation = {
  module_key: string;
  status: string;
  source: string;
  environment: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

const ACTIVE = ["active", "past_due"];

/** Every active module of one workspace, in the given environment. */
export async function listWorkspaceModules(
  client: Admin,
  storeId: string,
  environment: StripeEnv,
): Promise<ModuleActivation[]> {
  const { data, error } = await client
    .from("workspace_modules")
    .select("module_key, status, source, environment, current_period_end, cancel_at_period_end")
    .eq("store_id", storeId)
    .in("status", ACTIVE);
  if (error) throw new Error(error.message);
  return (data ?? []).filter((m) => m.source === "admin_grant" || m.environment === environment);
}

export async function hasModule(
  client: Admin,
  storeId: string,
  key: ModuleKey,
  environment: StripeEnv,
): Promise<boolean> {
  const rows = await listWorkspaceModules(client, storeId, environment);
  return rows.some((m) => m.module_key === key);
}

/**
 * Server-side wall. The UI shows a paywall, but this is what actually stops
 * the action — checked in both environments so a locked workspace can never
 * use the warehouse service by calling the endpoint directly.
 */
export async function requireModule(
  client: Admin,
  storeId: string,
  key: ModuleKey,
): Promise<void> {
  const sandbox = await hasModule(client, storeId, key, "sandbox");
  const live = sandbox ? true : await hasModule(client, storeId, key, "live");
  if (!sandbox && !live) {
    throw new Error(
      "MODULE_REQUIRED: activate FlySales Fulfilment ($49/month) to use our fulfilment center.",
    );
  }
}
