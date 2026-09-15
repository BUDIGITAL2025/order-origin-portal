/**
 * "My clients" — the sourcing agent's daily cockpit.
 *
 * One card per client the agent manages, built from the quotes assigned to
 * them plus their per-client tier counters. Names only: company and contact
 * first name. No email, phone, address, store URL, fiscal data, client price,
 * margin, wallet or subscription value is ever selected here.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DeskClientQuote = {
  id: string;
  product_name: string | null;
  status: string;
  unread: number;
};

export type DeskClientCard = {
  entity_id: string | null;
  company: string;
  contact_first_name: string | null;
  open_quotes: number;
  purchases_in_progress: number;
  unread_messages: number;
  paid_units: number;
  fee_rate: number | null;
  next_at: number | null;
  next_rate: number | null;
  quotes: DeskClientQuote[];
  purchase_ids: string[];
};

const OPEN_QUOTE_STATUSES = ["submitted", "sourcing", "quoted"];
const PURCHASE_IN_PROGRESS = [
  "paid",
  "po_sent",
  "invoice_uploaded",
  "invoice_verified",
  "invoice_discrepancy",
  "supplier_paid",
  "in_production",
  "shipped",
];

export const deskListClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ clients: DeskClientCard[] }> => {
    const { getAdminClient } = await import("./admin.server");
    const { requireCollaborator } = await import("./sourcing.server");
    const admin = await getAdminClient();
    const me = await requireCollaborator(admin, context.userId);

    const { data: quotes } = await admin
      .from("quote_requests")
      .select("id, store_id, product_name, status, created_at")
      .eq("assigned_sourcer", context.userId)
      .order("created_at", { ascending: false })
      .limit(400);

    const { data: purchases } = await admin
      .from("stock_purchases")
      .select("id, store_id, status")
      .eq("sourced_by", context.userId)
      .limit(400);

    const quoteIds = (quotes ?? []).map((q) => q.id);
    const { data: unreadRows } = quoteIds.length
      ? await admin
          .from("quote_messages")
          .select("quote_request_id")
          .in("quote_request_id", quoteIds)
          .eq("author_role", "client")
          .is("read_by_sourcer_at", null)
      : { data: [] as Array<{ quote_request_id: string }> };
    const unreadByQuote = new Map<string, number>();
    for (const row of unreadRows ?? []) {
      unreadByQuote.set(row.quote_request_id, (unreadByQuote.get(row.quote_request_id) ?? 0) + 1);
    }

    const storeIds = [
      ...new Set([
        ...(quotes ?? []).map((q) => q.store_id),
        ...(purchases ?? []).map((p) => p.store_id),
      ]),
    ].filter(Boolean) as string[];

    const { clientIdentityByStore } = await import("./client-identity.server");
    const identities = await clientIdentityByStore(admin, storeIds);

    const { parseFeeTiers, tierProgress } = await import("./fee-tiers");
    const { data: tierRows } = await admin
      .from("sourcing_client_tiers")
      .select("entity_id, paid_units, fee_tiers")
      .eq("collaborator_user_id", context.userId);
    const tierByEntity = new Map(
      (tierRows ?? []).map((r) => [
        r.entity_id,
        tierProgress(
          parseFeeTiers(r.fee_tiers ?? me.fee_tiers),
          Number((r as { paid_units?: number }).paid_units ?? 0),
        ),
      ]),
    );
    const unitsByEntity = new Map(
      (tierRows ?? []).map((r) => [
        r.entity_id,
        Number((r as { paid_units?: number }).paid_units ?? 0),
      ]),
    );

    // Group by the client company (entity), falling back to the workspace.
    const cards = new Map<string, DeskClientCard>();
    const keyOf = (storeId: string | null) => {
      const identity = storeId ? identities.get(storeId) : undefined;
      return identity?.entity_id ?? storeId ?? "unknown";
    };
    const ensure = (storeId: string | null): DeskClientCard => {
      const key = keyOf(storeId);
      const existing = cards.get(key);
      if (existing) return existing;
      const identity = storeId ? identities.get(storeId) : undefined;
      const entityId = identity?.entity_id ?? null;
      const tier = entityId ? tierByEntity.get(entityId) : undefined;
      const card: DeskClientCard = {
        entity_id: entityId,
        company: identity?.company ?? "Client",
        contact_first_name: identity?.contact_first_name ?? null,
        open_quotes: 0,
        purchases_in_progress: 0,
        unread_messages: 0,
        paid_units: entityId ? (unitsByEntity.get(entityId) ?? 0) : 0,
        fee_rate: tier?.rate ?? null,
        next_at: tier?.nextAt ?? null,
        next_rate: tier?.nextRate ?? null,
        quotes: [],
        purchase_ids: [],
      };
      cards.set(key, card);
      return card;
    };

    for (const q of quotes ?? []) {
      const card = ensure(q.store_id);
      const unread = unreadByQuote.get(q.id) ?? 0;
      card.unread_messages += unread;
      if (OPEN_QUOTE_STATUSES.includes(q.status)) card.open_quotes += 1;
      if (card.quotes.length < 12) {
        card.quotes.push({
          id: q.id,
          product_name: q.product_name,
          status: q.status,
          unread,
        });
      }
    }
    for (const p of purchases ?? []) {
      const card = ensure(p.store_id);
      if (PURCHASE_IN_PROGRESS.includes(p.status)) {
        card.purchases_in_progress += 1;
        if (card.purchase_ids.length < 12) card.purchase_ids.push(p.id);
      }
    }

    const clients = [...cards.values()].sort(
      (a, b) =>
        b.unread_messages - a.unread_messages ||
        b.open_quotes - a.open_quotes ||
        a.company.localeCompare(b.company),
    );
    return { clients };
  });
