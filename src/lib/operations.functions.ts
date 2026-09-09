/**
 * Operations Today — the daily admin control view for the fulfilment area.
 *
 * Every number is derived from data we already store: orders, inbound
 * shipments, disputes and the computed inventory view. No new tables.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface OperationsToday {
  orders_to_release: number;
  needs_review: number;
  inbounds_arriving: number;
  /** Soonest expected arrival among in-transit shipments, if declared. */
  next_arrival: string | null;
  to_receive: number;
  discrepancies_open: number;
  low_stock: number;
  claims_open: number;
}

export const adminOperationsToday = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OperationsToday> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [orders, shipments, disputes, stores] = await Promise.all([
      supabaseAdmin.from("orders").select("id, status").limit(5000),
      supabaseAdmin
        .from("inbound_shipments")
        .select("id, status, has_discrepancy, expected_arrival_date, archived_at")
        .limit(2000),
      supabaseAdmin.from("disputes").select("id, status").limit(2000),
      supabaseAdmin.from("stores").select("id, store_name").limit(200),
    ]);

    const orderRows = orders.data ?? [];
    const shipRows = (shipments.data ?? []).filter((s) => !s.archived_at);
    const disputeRows = disputes.data ?? [];

    const inTransit = shipRows.filter((s) => s.status === "in_transit");
    const nextArrival =
      inTransit
        .map((s) => s.expected_arrival_date)
        .filter((d): d is string => !!d)
        .sort()[0] ?? null;

    // Low stock needs the computed inventory view (sellable-based states).
    let lowStock = 0;
    const { computeWorkspaceInventory } = await import("./inventory.server");
    for (const store of stores.data ?? []) {
      const view = await computeWorkspaceInventory(supabaseAdmin, store);
      lowStock += view.rows.filter((r) => r.state === "red" || r.state === "amber").length;
    }

    return {
      orders_to_release: orderRows.filter((o) => o.status === "paid" || o.status === "processing")
        .length,
      needs_review: orderRows.filter((o) => o.status === "needs_review").length,
      inbounds_arriving: inTransit.length,
      next_arrival: nextArrival,
      to_receive: shipRows.filter((s) => s.status === "received").length,
      discrepancies_open: shipRows.filter((s) => s.has_discrepancy && s.status !== "refused")
        .length,
      low_stock: lowStock,
      claims_open: disputeRows.filter((d) => d.status === "open" || d.status === "investigating")
        .length,
    };
  });
