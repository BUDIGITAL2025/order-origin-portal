/**
 * Multi-offer quotes — server-only helpers.
 *
 * A quote holds up to three publishable offers. Clients only ever see them as
 * anonymous "Option A/B/C": the supplier behind an option, its cost chain and
 * our margin never cross into a client-facing payload.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

/** Minimum order history behind a supplier before a dispute rate means anything. */
const DISPUTE_RATE_MIN_ORDERS = 5;

export type ClientOfferLine = {
  variant_label: string;
  country_code: string;
  unit_price: number | null;
  moq: number | null;
  lead_time_days: number | null;
  status: string;
};

export type ClientOffer = {
  id: string;
  letter: string;
  quality: number;
  recommended: boolean;
  moq: number | null;
  production_lead_days: number | null;
  shipping_lead_days: number | null;
  accepted_at: string | null;
  /** Share of this supplier's delivered orders that opened a dispute, or null. */
  dispute_rate: number | null;
  lines: ClientOfferLine[];
};

/**
 * Dispute rate for one supplier, from our own history: orders that contain a
 * product sourced from that supplier, against disputes opened on them. Returns
 * null while the history is too thin to be honest about.
 */
export async function supplierDisputeRate(
  admin: Admin,
  supplierId: string | null,
): Promise<number | null> {
  if (!supplierId) return null;
  const { data: lines } = await admin
    .from("quote_lines")
    .select("id")
    .eq("supplier_id", supplierId);
  const lineIds = (lines ?? []).map((l) => l.id);
  if (lineIds.length === 0) return null;

  const { data: products } = await admin
    .from("products")
    .select("id")
    .in("quote_line_id", lineIds);
  const productIds = (products ?? []).map((p) => p.id);
  if (productIds.length === 0) return null;

  const { data: items } = await admin
    .from("order_items")
    .select("order_id")
    .in("product_id", productIds);
  const orderIds = [...new Set((items ?? []).map((i) => i.order_id).filter(Boolean))] as string[];
  if (orderIds.length < DISPUTE_RATE_MIN_ORDERS) return null;

  const { data: disputes } = await admin
    .from("disputes")
    .select("order_id")
    .in("order_id", orderIds);
  const disputed = new Set((disputes ?? []).map((d) => d.order_id)).size;
  return Math.round((disputed / orderIds.length) * 1000) / 10;
}

/** Next free letter on a quote, or null when all three are taken. */
export async function nextOptionLetter(
  admin: Admin,
  quoteId: string,
): Promise<"A" | "B" | "C" | null> {
  const { data } = await admin
    .from("quote_options")
    .select("letter")
    .eq("quote_request_id", quoteId);
  const used = new Set((data ?? []).map((o) => o.letter));
  return (["A", "B", "C"] as const).find((l) => !used.has(l)) ?? null;
}
