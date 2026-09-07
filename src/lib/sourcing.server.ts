/**
 * Sourcing collaborator chain — server-only helpers.
 *
 * The pricing chain has three layers and each layer only ever sees its own:
 *   supplier_unit_price            → entered by the sourcing collaborator
 *   sourcing_cost = supplier × (1 + fee_rate)   → collaborator + owner
 *   client_price  = sourcing_cost × (1 + margin) → owner + client
 *
 * Clients never see the supplier, the supplier price, the fee or the margin.
 * Collaborators never see the client, the client price or the margin.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { round2 } from "./admin.server";

type Admin = SupabaseClient<Database>;

export type Collaborator = Database["public"]["Tables"]["sourcing_collaborators"]["Row"];

/** Default commission on the supplier price. */
export const DEFAULT_FEE_RATE = 0.08;
/** Default owner margin on the sourcing cost, in percent. */
export const DEFAULT_MARGIN_PCT = 15;
/** Minimum units when stock ships into the FlySales warehouse. */
export const WAREHOUSE_MIN_UNITS = 10;

/** supplier price + the collaborator's commission. */
export function sourcingCost(supplierUnitPrice: number, feeRate: number): number {
  return round2(supplierUnitPrice * (1 + feeRate));
}

/** what the client pays per unit, product only. */
export function clientPrice(cost: number, marginPct: number): number {
  return round2(cost * (1 + marginPct / 100));
}

/** the collaborator's commission on a number of units. */
export function feeAmount(supplierUnitPrice: number, feeRate: number, units = 1): number {
  return round2(supplierUnitPrice * feeRate * units);
}

/** Throws unless the caller is an active sourcing collaborator. */
export async function requireCollaborator(admin: Admin, userId: string): Promise<Collaborator> {
  const { data, error } = await admin
    .from("sourcing_collaborators")
    .select("*")
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: sourcing desk access required");
  return data;
}

/** True when the caller is an admin — used to allow both roles on a page. */
export async function callerIsAdmin(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  return data === true;
}

/** Find (case-insensitive) or create a supplier by name. */
export async function upsertSupplierByName(
  admin: Admin,
  name: string,
  productionLeadDays?: number | null,
): Promise<{ id: string; name: string }> {
  const clean = name.trim();
  const { data: existing } = await admin
    .from("suppliers")
    .select("id, name")
    .ilike("name", clean)
    .limit(1)
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await admin
    .from("suppliers")
    .insert({
      name: clean,
      active: true,
      ...(productionLeadDays != null ? { default_production_lead_days: productionLeadDays } : {}),
    })
    .select("id, name")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Accrue a collaborator's commission exactly once per reference. Replays
 * (webhook retries, a re-run payment) hit the unique reference and no-op.
 */
export async function accrueSourcingEarning(
  admin: Admin,
  args: {
    collaboratorUserId: string;
    reference: string;
    description: string;
    units: number;
    feeRate: number;
    supplierUnitPrice: number;
    quoteLineId?: string | null;
    stockPurchaseId?: string | null;
    orderId?: string | null;
  },
): Promise<boolean> {
  if (args.units <= 0 || args.supplierUnitPrice <= 0 || args.feeRate <= 0) return false;
  const { error } = await admin.from("sourcing_earnings").insert({
    collaborator_user_id: args.collaboratorUserId,
    reference: args.reference,
    description: args.description,
    units: args.units,
    fee_rate: args.feeRate,
    supplier_unit_price: args.supplierUnitPrice,
    amount: feeAmount(args.supplierUnitPrice, args.feeRate, args.units),
    quote_line_id: args.quoteLineId ?? null,
    stock_purchase_id: args.stockPurchaseId ?? null,
    order_id: args.orderId ?? null,
  });
  if (error) {
    if (error.code === "23505") return false;
    throw new Error(error.message);
  }
  return true;
}

/**
 * Accrue commission for a paid per_order order: every line whose product came
 * from a sourced quote line pays its collaborator on the units shipped.
 */
export async function accrueEarningsForOrder(admin: Admin, orderId: string): Promise<number> {
  const { data: items } = await admin
    .from("order_items")
    .select("id, quantity, products(quote_line_id)")
    .eq("order_id", orderId);
  let accrued = 0;
  for (const item of items ?? []) {
    const lineId = (item.products as { quote_line_id: string | null } | null)?.quote_line_id;
    if (!lineId) continue;
    const { data: line } = await admin
      .from("quote_lines")
      .select("id, sourced_by, sourcing_fee_rate, supplier_unit_price")
      .eq("id", lineId)
      .maybeSingle();
    if (!line?.sourced_by || !line.supplier_unit_price || !line.sourcing_fee_rate) continue;
    const ok = await accrueSourcingEarning(admin, {
      collaboratorUserId: line.sourced_by,
      reference: `order-item:${item.id}`,
      description: "Commission on a paid customer order",
      units: Math.max(1, Number(item.quantity ?? 1)),
      feeRate: Number(line.sourcing_fee_rate),
      supplierUnitPrice: Number(line.supplier_unit_price),
      quoteLineId: line.id,
      orderId,
    });
    if (ok) accrued += 1;
  }
  return accrued;
}
