/**
 * The deal view — one product's life from request to delivery.
 *
 * Every stage is derived from timestamps we already store on quote_requests,
 * quote_lines, stock_purchases and inbound_shipments. Nothing new is written;
 * the timeline is a read model shared by the quote page, the purchase page and
 * the client detail panel so all three entry points tell the same story.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type StageKey =
  | "requested"
  | "sourced"
  | "priced"
  | "published"
  | "accepted"
  | "paid"
  | "po_sent"
  | "invoice_verified"
  | "supplier_paid"
  | "in_production"
  | "shipped"
  | "received";

export interface LifecycleStage {
  key: StageKey;
  label: string;
  /** When it happened, when we have a timestamp for it. */
  at: string | null;
  /** True once the stage has been reached, even without a stored timestamp. */
  done: boolean;
  /** Who acted, in plain words ("Ayness Lee", "FlySales admin", the client). */
  by: string | null;
  /** Short context: variants accepted, units, amounts. */
  detail: string | null;
}

export interface LifecycleDeal {
  quote_id: string;
  product_name: string;
  quote_ref: string | null;
  client_label: string | null;
  store_id: string | null;
  status: string;
  /** Latest purchase tied to this quote, when the client already paid. */
  purchase_id: string | null;
  stages: LifecycleStage[];
}

const STAGE_LABELS: Record<StageKey, string> = {
  requested: "Requested",
  sourced: "Sourced (agent)",
  priced: "Priced",
  published: "Published to client",
  accepted: "Accepted",
  paid: "Paid",
  po_sent: "PO sent (agent)",
  invoice_verified: "Invoice verified",
  supplier_paid: "Supplier paid",
  in_production: "In production",
  shipped: "Shipped",
  received: "Received / delivered",
};

const ORDER: StageKey[] = [
  "requested",
  "sourced",
  "priced",
  "published",
  "accepted",
  "paid",
  "po_sent",
  "invoice_verified",
  "supplier_paid",
  "in_production",
  "shipped",
  "received",
];

function stage(
  key: StageKey,
  at: string | null,
  extra?: { by?: string | null; detail?: string | null; done?: boolean },
): LifecycleStage {
  return {
    key,
    label: STAGE_LABELS[key],
    at,
    done: extra?.done ?? at != null,
    by: extra?.by ?? null,
    detail: extra?.detail ?? null,
  };
}

/** Human names for the user ids that appear as actors on a timeline. */
async function actorNames(admin: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  const [profiles, collaborators] = await Promise.all([
    admin.from("profiles").select("id, contact_name").in("id", unique),
    admin
      .from("sourcing_collaborators")
      .select("user_id, display_name, email")
      .in("user_id", unique),
  ]);
  for (const p of (profiles.data ?? []) as Array<{ id: string; contact_name: string | null }>) {
    if (p.contact_name) names.set(p.id, p.contact_name);
  }
  for (const c of (collaborators.data ?? []) as Array<{
    user_id: string;
    display_name: string | null;
    email: string;
  }>) {
    names.set(c.user_id, c.display_name || c.email);
  }
  return names;
}

/** Build the full timeline for a set of quote requests. */
export async function buildLifecycle(
  admin: SupabaseClient,
  quoteIds: string[],
): Promise<LifecycleDeal[]> {
  if (quoteIds.length === 0) return [];

  const [quotesRes, linesRes, purchasesRes] = await Promise.all([
    admin
      .from("quote_requests")
      .select(
        "id, product_name, status, created_at, quoted_at, quoted_by, sourcing_submitted_at, assigned_sourcer, store_id, stores!quote_requests_store_id_fkey(store_name, entities(legal_name))",
      )
      .in("id", quoteIds),
    admin
      .from("quote_lines")
      .select(
        "id, quote_request_id, sku, status, unit_price, accepted_quantity, responded_at, sourced_at, sourced_by",
      )
      .in("quote_request_id", quoteIds),
    admin
      .from("stock_purchases")
      .select(
        "id, quote_request_id, quantity, total_amount, created_at, paid_at, po_sent_at, supplier_invoice_state, supplier_invoice_uploaded_at, supplier_paid_at, in_production_at, shipped_at, delivered_at, inbound_shipment_id, status",
      )
      .in("quote_request_id", quoteIds)
      .order("created_at", { ascending: false }),
  ]);

  const quotes = quotesRes.data ?? [];
  const lines = linesRes.data ?? [];
  const purchases = purchasesRes.data ?? [];

  const inboundIds = purchases.map((p) => p.inbound_shipment_id).filter(Boolean) as string[];
  const inbound = inboundIds.length
    ? ((
        await admin.from("inbound_shipments").select("id, status, received_at").in("id", inboundIds)
      ).data ?? [])
    : [];
  const inboundById = new Map(inbound.map((i) => [i.id as string, i]));

  const names = await actorNames(admin, [
    ...quotes.map((q) => q.quoted_by as string),
    ...quotes.map((q) => q.assigned_sourcer as string),
    ...lines.map((l) => l.sourced_by as string),
  ]);

  const earliest = (values: Array<string | null | undefined>) =>
    values.filter((v): v is string => !!v).sort()[0] ?? null;
  const latest = (values: Array<string | null | undefined>) =>
    values
      .filter((v): v is string => !!v)
      .sort()
      .slice(-1)[0] ?? null;

  return quotes.map((q) => {
    const myLines = lines.filter((l) => l.quote_request_id === q.id);
    const accepted = myLines.filter((l) => l.status === "accepted");
    const myPurchases = purchases.filter((p) => p.quote_request_id === q.id);
    const units = accepted.reduce((n, l) => n + Number(l.accepted_quantity ?? 0), 0);
    const chain = q.stores as {
      store_name?: string | null;
      entities?: { legal_name?: string | null } | null;
    } | null;

    // A quote line is one variant × country, so counting rows double-counts a
    // variant quoted to several destinations. Variants are counted by SKU.
    const variantCount = new Set(myLines.map((l) => (l.sku as string | null) ?? (l.id as string)))
      .size;
    const acceptedVariants = new Set(
      accepted.map((l) => (l.sku as string | null) ?? (l.id as string)),
    ).size;
    const sourcedAt = latest(myLines.map((l) => l.sourced_at as string | null));
    const sourcerId = (myLines.find((l) => l.sourced_by)?.sourced_by ?? q.assigned_sourcer) as
      string | null;
    const pricedDone = myLines.some((l) => l.unit_price != null);
    const paidAt = earliest(myPurchases.map((p) => p.paid_at as string | null));
    const invoiceVerified = myPurchases.find((p) => p.supplier_invoice_state === "verified");
    const inboundRow = myPurchases
      .map((p) => (p.inbound_shipment_id ? inboundById.get(p.inbound_shipment_id as string) : null))
      .find(Boolean) as { status?: string; received_at?: string | null } | undefined;

    const stages: LifecycleStage[] = [
      stage("requested", q.created_at as string, { by: chain?.entities?.legal_name ?? null }),
      stage("sourced", sourcedAt ?? (q.sourcing_submitted_at as string | null), {
        by: sourcerId ? (names.get(sourcerId) ?? "Sourcing agent") : null,
      }),
      stage("priced", null, {
        done: pricedDone,
        by: q.quoted_by ? (names.get(q.quoted_by as string) ?? "FlySales admin") : null,
        detail: pricedDone ? `${variantCount} variant${variantCount === 1 ? "" : "s"}` : null,
      }),
      stage("published", q.quoted_at as string | null, {
        by: q.quoted_by ? (names.get(q.quoted_by as string) ?? "FlySales admin") : null,
      }),
      stage("accepted", latest(accepted.map((l) => l.responded_at as string | null)), {
        done: accepted.length > 0,
        by: chain?.entities?.legal_name ?? null,
        detail: acceptedVariants
          ? `${acceptedVariants} variant${acceptedVariants === 1 ? "" : "s"}, ${units} units`
          : null,
      }),
      stage("paid", paidAt, {
        detail: myPurchases.length
          ? `$${myPurchases.reduce((s, p) => s + Number(p.total_amount ?? 0), 0).toFixed(2)}`
          : null,
      }),
      stage("po_sent", earliest(myPurchases.map((p) => p.po_sent_at as string | null))),
      stage(
        "invoice_verified",
        (invoiceVerified?.supplier_invoice_uploaded_at as string | null) ?? null,
        { done: !!invoiceVerified },
      ),
      stage("supplier_paid", earliest(myPurchases.map((p) => p.supplier_paid_at as string | null))),
      stage("in_production", earliest(myPurchases.map((p) => p.in_production_at as string | null))),
      stage("shipped", earliest(myPurchases.map((p) => p.shipped_at as string | null))),
      stage(
        "received",
        earliest([
          ...myPurchases.map((p) => p.delivered_at as string | null),
          (inboundRow?.received_at as string | null) ?? null,
        ]),
        { done: inboundRow?.status === "received" || inboundRow?.status === "completed" },
      ),
    ];

    return {
      quote_id: q.id as string,
      product_name: (q.product_name as string) ?? "Product",
      quote_ref: myLines.map((l) => l.sku as string).filter(Boolean)[0] ?? null,
      client_label: chain?.entities?.legal_name ?? chain?.store_name ?? null,
      store_id: (q.store_id as string) ?? null,
      status: q.status as string,
      purchase_id: (myPurchases[0]?.id as string) ?? null,
      stages: stages.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key)),
    };
  });
}
