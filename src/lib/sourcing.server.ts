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
import { closedPrice, sourcingCostOf } from "./pricing";
import { parseFeeTiers, rateForCount, tierProgress, type TierProgress } from "./fee-tiers";

type Admin = SupabaseClient<Database>;

export type Collaborator = Database["public"]["Tables"]["sourcing_collaborators"]["Row"];

/** Opening rate of the standard tier table — used when no agent is involved. */
export const DEFAULT_FEE_RATE = 0.08;

/**
 * The rate that applies to this agent's next quote: read from their tier table
 * against their cumulative paid-transaction count. Frozen onto the quote line
 * at save time, so crossing a tier never repriced anything already quoted.
 */
export function collaboratorFeeRate(c: Collaborator): number {
  return rateForCount(parseFeeTiers(c.fee_tiers), Number(c.paid_transactions ?? 0));
}

export function collaboratorTier(c: Collaborator): TierProgress {
  return tierProgress(parseFeeTiers(c.fee_tiers), Number(c.paid_transactions ?? 0));
}
/** Default owner margin on the sourcing cost, in percent. */
export const DEFAULT_MARGIN_PCT = 15;
/** Minimum units when stock ships into the FlySales warehouse. */
export const WAREHOUSE_MIN_UNITS = 10;

/** supplier price (goods + supplier shipping) + the collaborator's commission. */
export function sourcingCost(
  supplierUnitPrice: number,
  feeRate: number,
  feeIncluded = false,
): number {
  return sourcingCostOf({ cogs: supplierUnitPrice, shipping: 0, feeRate, feeIncluded });
}

/** what the client pays per unit: goods + margin + the tax passthrough at cost. */
export function clientPrice(cost: number, marginPct: number, importTax = 0): number {
  return closedPrice(cost, marginPct, importTax);
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

export type SourcingLineInput = {
  id?: string | undefined;
  variant_label: string;
  country_code: string;
  supplier_name: string;
  supplier_unit_price: number;
  supplier_shipping?: number | undefined;
  supplier_tax?: number | undefined;
  moq: number;
  production_lead_days: number;
  sourcing_notes?: string | undefined;
  sourcing_image_urls?: string[] | undefined;
};

export type SavedSourcingLine = {
  id: string;
  variant_label: string;
  country_code: string;
  sku: string | null;
  status: string;
};

/**
 * Write the sourcing layer of a quote: COGS, supplier shipping, the import-tax
 * passthrough and the derived sourcing cost. Shared by the collaborator desk
 * and by an admin sourcing a request themselves, so both produce identical
 * rows. Lines a client already responded to are never touched.
 */
export async function writeSourcingLines(
  admin: Admin,
  args: {
    quoteId: string;
    lines: SourcingLineInput[];
    feeRate: number;
    sourcedBy: string | null;
    /** When set, only this option's lines are written and pruned. */
    optionId?: string | null;
  },
): Promise<SavedSourcingLine[]> {
  let existingQuery = admin
    .from("quote_lines")
    .select("id, status, fee_included")
    .eq("quote_request_id", args.quoteId);
  if (args.optionId) existingQuery = existingQuery.eq("option_id", args.optionId);
  const { data: existing } = await existingQuery;
  const existingIds = new Set((existing ?? []).map((l) => l.id));
  // A line whose entered cost already contains the sourcing fee keeps that
  // flag across re-saves, so the fee is never applied a second time.
  const feeIncludedById = new Map((existing ?? []).map((l) => [l.id, l.fee_included === true]));

  const now = new Date().toISOString();
  const saved: SavedSourcingLine[] = [];

  for (const line of args.lines) {
    const supplier = await upsertSupplierByName(
      admin,
      line.supplier_name,
      line.production_lead_days,
    );
    const cogs = line.supplier_unit_price;
    const shipping = line.supplier_shipping ?? 0;
    const feeIncluded = line.id ? (feeIncludedById.get(line.id) ?? false) : false;
    const cost = sourcingCostOf({ cogs, shipping, feeRate: args.feeRate, feeIncluded });
    const payload = {
      supplier_id: supplier.id,
      supplier_unit_price: round2(cogs + shipping),
      supplier_cogs: cogs,
      supplier_shipping: shipping,
      supplier_tax: line.supplier_tax ?? 0,
      fee_included: feeIncluded,
      moq: line.moq,
      production_lead_days: line.production_lead_days,
      lead_time_days: line.production_lead_days,
      sourcing_notes: line.sourcing_notes || null,
      sourcing_image_urls: line.sourcing_image_urls ?? [],
      sourcing_fee_rate: args.feeRate,
      sourcing_cost: cost,
      sourced_at: now,
      variant_label: line.variant_label,
      country_code: line.country_code,
      ...(args.optionId ? { option_id: args.optionId } : {}),
      ...(args.sourcedBy ? { sourced_by: args.sourcedBy } : {}),
    };

    if (line.id && existingIds.has(line.id)) {
      const { data: updated, error } = await admin
        .from("quote_lines")
        .update(payload)
        .eq("id", line.id)
        .select("id, variant_label, country_code, sku, status")
        .single();
      if (error) throw new Error(error.message);
      saved.push(updated);
    } else {
      const { data: sku } = await admin.rpc("generate_sku", { p_prefix: "FS" });
      const { data: created, error } = await admin
        .from("quote_lines")
        .insert({
          quote_request_id: args.quoteId,
          sku: sku ?? `FS-${Date.now()}`,
          status: "pending",
          ...payload,
        })
        .select("id, variant_label, country_code, sku, status")
        .single();
      if (error) throw new Error(error.message);
      saved.push(created);
    }
  }

  // Remove lines that were deleted in the form, but never one a client has
  // already accepted or rejected.
  const keep = new Set(saved.map((l) => l.id));
  const toDelete = [...existingIds].filter((id) => !keep.has(id));
  if (toDelete.length) {
    await admin.from("quote_lines").delete().in("id", toDelete).eq("status", "pending");
  }
  return saved;
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
  // Same anchor as the money: one settled transaction, one step towards the
  // next fee tier. Replays hit the unique reference above and never count.
  await admin.rpc("bump_sourcing_transactions", { p_user_id: args.collaboratorUserId });
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

/**
 * Generate a sign-in link server-side and deliver it through OUR branded
 * Resend template — Supabase's native invite mail is never used, so the
 * invitation looks and logs like every other transactional email.
 */
export async function sendCollaboratorInvite(
  admin: Admin,
  args: {
    email: string;
    displayName: string | null;
    feeTiers: import("./fee-tiers").FeeTier[];
    /** true when the auth account already exists (resend / existing user). */
    existing: boolean;
    collaboratorId?: string;
  },
): Promise<{ sent: boolean; id?: string; error?: string; userId?: string }> {
  const { appBaseUrl } = await import("./email-layout.server");
  const { sourcingInviteEmail } = await import("./email-templates.server");
  const { sendLoggedEmail } = await import("./email.server");

  const redirectTo = `${appBaseUrl()}/reset-password`;
  const { data, error } = await admin.auth.admin.generateLink({
    type: args.existing ? "magiclink" : "invite",
    email: args.email,
    options: { redirectTo },
  });
  if (error || !data?.properties?.action_link) {
    const message = error?.message ?? "Could not generate the invitation link";
    console.error("[sourcing:invite] link generation failed:", message);
    return { sent: false, error: message };
  }

  const expires = new Date(Date.now() + 24 * 3600 * 1000);
  const built = sourcingInviteEmail({
    inviteUrl: data.properties.action_link,
    displayName: args.displayName,
    feeTiers: args.feeTiers,
    expiresLabel: expires.toUTCString().replace(" GMT", " UTC"),
  });
  const result = await sendLoggedEmail(admin, {
    to: args.email,
    subject: built.subject,
    text: built.text,
    html: built.html,
    kind: "sourcing_invite",
    ...(args.collaboratorId ? { relatedId: args.collaboratorId } : {}),
  });
  return { ...result, ...(data.user?.id ? { userId: data.user.id } : {}) };
}
