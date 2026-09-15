/**
 * Admin command centre — "what needs me, and where is everything?".
 *
 * Two reads: the action counters (each one clicks through to its filtered
 * list) and the activity feed, a reverse-chronological stream of what happened
 * across the platform. Everything is derived from existing tables.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { LifecycleDeal } from "./lifecycle.server";

export interface CommandCounters {
  unread_messages: number;
  unread_message_quotes: number;
  awaiting_pricing: number;
  awaiting_payment: number;
  awaiting_payment_days: number | null;
  supplier_payments_due: number;
  to_receive: number;
  discrepancies_open: number;
  claims_open: number;
  needs_review: number;
}

export interface ActivityItem {
  id: string;
  at: string;
  /** Plain sentence the admin reads in the morning. */
  text: string;
  /** Deep link target. */
  to: string;
  params?: Record<string, string>;
}

/** Counters for the "needs you now" band. */
export const adminCommandCounters = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CommandCounters> => {
    const { requireStaffRead } = await import("./admin.server");
    await requireStaffRead(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [messages, quotes, purchases, shipments, disputes, orders] = await Promise.all([
      supabaseAdmin
        .from("quote_messages")
        .select("quote_request_id")
        .eq("author_role", "client")
        .is("read_by_admin_at", null)
        .limit(2000),
      supabaseAdmin
        .from("quote_requests")
        .select("id, sourcing_submitted_at, quoted_at, archived_at")
        .is("archived_at", null)
        .not("sourcing_submitted_at", "is", null)
        .is("quoted_at", null)
        .limit(2000),
      supabaseAdmin
        .from("stock_purchases")
        .select("id, status, created_at, archived_at")
        .in("status", ["awaiting_payment", "invoice_verified"])
        .limit(2000),
      supabaseAdmin
        .from("inbound_shipments")
        .select("id, status, has_discrepancy, archived_at")
        .limit(2000),
      supabaseAdmin.from("disputes").select("id, status").limit(2000),
      supabaseAdmin.from("orders").select("id, status").eq("status", "needs_review").limit(2000),
    ]);

    const unread = messages.data ?? [];
    const purchaseRows = (purchases.data ?? []).filter((p) => !p.archived_at);
    const unpaid = purchaseRows.filter((p) => p.status === "awaiting_payment");
    const oldest = unpaid
      .map((p) => p.created_at)
      .filter((d): d is string => !!d)
      .sort()[0];
    const shipRows = (shipments.data ?? []).filter((s) => !s.archived_at);

    return {
      unread_messages: unread.length,
      unread_message_quotes: new Set(unread.map((m) => m.quote_request_id)).size,
      awaiting_pricing: (quotes.data ?? []).length,
      awaiting_payment: unpaid.length,
      awaiting_payment_days: oldest
        ? Math.floor((Date.now() - new Date(oldest).getTime()) / 86_400_000)
        : null,
      supplier_payments_due: purchaseRows.filter((p) => p.status === "invoice_verified").length,
      to_receive: shipRows.filter((s) => s.status === "received").length,
      discrepancies_open: shipRows.filter((s) => s.has_discrepancy && s.status !== "refused")
        .length,
      claims_open: (disputes.data ?? []).filter(
        (d) => d.status === "open" || d.status === "investigating",
      ).length,
      needs_review: (orders.data ?? []).length,
    };
  });

/** The heartbeat: everything that happened, newest first. */
export const adminActivityFeed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ items: ActivityItem[] }> => {
    const { requireStaffRead } = await import("./admin.server");
    await requireStaffRead(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [msgs, quotes, lines, purchases, disputes] = await Promise.all([
      supabaseAdmin
        .from("quote_messages")
        .select("id, quote_request_id, author_role, body, created_at")
        .eq("kind", "message")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(30),
      supabaseAdmin
        .from("quote_requests")
        .select(
          "id, product_name, created_at, quoted_at, sourcing_submitted_at, store_id, stores!quote_requests_store_id_fkey(entities(legal_name))",
        )
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(40),
      supabaseAdmin
        .from("quote_lines")
        .select("id, quote_request_id, variant_label, accepted_quantity, responded_at, status")
        .eq("status", "accepted")
        .gte("responded_at", since)
        .order("responded_at", { ascending: false })
        .limit(40),
      supabaseAdmin
        .from("stock_purchases")
        .select(
          "id, po_number, product_name, total_amount, quantity, paid_at, po_sent_at, supplier_paid_at, shipped_at, created_at",
        )
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(40),
      supabaseAdmin
        .from("disputes")
        .select("id, reason, status, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const quoteRows = quotes.data ?? [];
    const quoteById = new Map(quoteRows.map((q) => [q.id as string, q]));
    const clientOf = (quoteId: string | null) => {
      const q = quoteId ? quoteById.get(quoteId) : null;
      const chain = q?.stores as { entities?: { legal_name?: string | null } | null } | null;
      return chain?.entities?.legal_name ?? "A client";
    };
    const productOf = (quoteId: string | null) =>
      (quoteId ? (quoteById.get(quoteId)?.product_name as string | undefined) : undefined) ??
      "a quote";

    const items: ActivityItem[] = [];
    const quoteLink = (id: string) => ({ to: "/admin/quotes/$id", params: { id } });

    for (const m of msgs.data ?? []) {
      const who =
        m.author_role === "client"
          ? clientOf(m.quote_request_id as string)
          : m.author_role === "sourcing"
            ? "the sourcing agent"
            : "FlySales";
      items.push({
        id: `msg-${m.id}`,
        at: m.created_at as string,
        text: `New message on ${productOf(m.quote_request_id as string)} from ${who}`,
        ...quoteLink(m.quote_request_id as string),
      });
    }
    for (const q of quoteRows) {
      items.push({
        id: `req-${q.id}`,
        at: q.created_at as string,
        text: `${clientOf(q.id as string)} requested a quote for ${q.product_name}`,
        ...quoteLink(q.id as string),
      });
      if (q.sourcing_submitted_at) {
        items.push({
          id: `src-${q.id}`,
          at: q.sourcing_submitted_at as string,
          text: `Sourcing agent submitted pricing on ${q.product_name}`,
          ...quoteLink(q.id as string),
        });
      }
      if (q.quoted_at) {
        items.push({
          id: `pub-${q.id}`,
          at: q.quoted_at as string,
          text: `Quote published to ${clientOf(q.id as string)} — ${q.product_name}`,
          ...quoteLink(q.id as string),
        });
      }
    }
    for (const l of lines.data ?? []) {
      items.push({
        id: `acc-${l.id}`,
        at: l.responded_at as string,
        text: `${clientOf(l.quote_request_id as string)} accepted ${productOf(
          l.quote_request_id as string,
        )} — ${l.variant_label}${l.accepted_quantity ? `, ${l.accepted_quantity} units` : ""}`,
        ...quoteLink(l.quote_request_id as string),
      });
    }
    for (const p of purchases.data ?? []) {
      const ref = (p.po_number as string) ?? (p.id as string).slice(0, 8);
      const push = (at: string | null, text: string, tag: string) => {
        if (at) items.push({ id: `${tag}-${p.id}`, at, text, to: "/admin/stock-purchases" });
      };
      push(
        p.paid_at as string | null,
        `Payment settled $${Number(p.total_amount ?? 0).toFixed(2)} — purchase ${ref} released to the agent`,
        "paid",
      );
      push(p.po_sent_at as string | null, `PO ${ref} sent to the supplier`, "po");
      push(p.supplier_paid_at as string | null, `Supplier paid on ${ref}`, "sup");
      push(p.shipped_at as string | null, `${p.product_name} shipped (${ref})`, "shp");
    }
    for (const d of disputes.data ?? []) {
      items.push({
        id: `dis-${d.id}`,
        at: d.created_at as string,
        text: `Claim opened (${String(d.reason).replace(/_/g, " ")})`,
        to: "/admin/disputes",
      });
    }

    items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return { items: items.slice(0, 40) };
  });

/** The deal view, from any entry point: a quote, a purchase or a whole client. */
export const adminLifecycle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        quote_id: z.string().uuid().optional(),
        purchase_id: z.string().uuid().optional(),
        store_id: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ deals: LifecycleDeal[] }> => {
    const { requireStaffRead } = await import("./admin.server");
    await requireStaffRead(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { buildLifecycle } = await import("./lifecycle.server");

    let ids: string[] = [];
    if (data.quote_id) ids = [data.quote_id];
    else if (data.purchase_id) {
      const { data: p } = await supabaseAdmin
        .from("stock_purchases")
        .select("quote_request_id")
        .eq("id", data.purchase_id)
        .maybeSingle();
      ids = p?.quote_request_id ? [p.quote_request_id] : [];
    } else if (data.store_id) {
      const { data: rows } = await supabaseAdmin
        .from("quote_requests")
        .select("id")
        .eq("store_id", data.store_id)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(50);
      ids = (rows ?? []).map((r) => r.id as string);
    }
    return { deals: await buildLifecycle(supabaseAdmin, ids) };
  });
