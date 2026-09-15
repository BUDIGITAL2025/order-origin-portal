/**
 * The workspace list behind the Fulfilment client selector. Admin gets every
 * workspace; a sourcing collaborator gets only their own assigned ones.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type FulfilmentWorkspace = {
  id: string;
  name: string;
  company: string | null;
};

export const listFulfilmentWorkspaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { fulfilmentScope, withinScope } = await import("./fulfilment-scope.server");
    const { getAdminClient } = await import("./admin.server");
    const scope = await fulfilmentScope(context.supabase, context.userId);
    const admin = await getAdminClient();

    const { data, error } = await admin
      .from("stores")
      .select("id, store_name, entities(legal_name)")
      .order("store_name")
      .limit(300);
    if (error) throw new Error(error.message);

    const rows = withinScope(scope, (data ?? []) as { id: string }[]) as {
      id: string;
      store_name: string | null;
      entities: { legal_name: string | null } | null;
    }[];

    return {
      isAdmin: scope.isAdmin,
      workspaces: rows.map<FulfilmentWorkspace>((s) => ({
        id: s.id,
        name: s.entities?.legal_name || s.store_name || "Workspace",
        company: s.entities?.legal_name ?? null,
      })),
    };
  });
