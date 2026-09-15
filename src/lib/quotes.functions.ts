import { createServerFn } from "@tanstack/react-start";
import { assertNotSourcing } from "./profiles.functions";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  adminQuoteLinesSchema,
  adminQuoteStatusSchema,
  createRevisionSchema,
  quoteDeliverySchema,
  quoteRequestSchema,
  respondLinesSchema,
  requoteSchema,
  signedUrlsSchema,
} from "./schemas";
import { flagBreachedQuotes, mapQuoteForAdmin } from "./quotes.server";
import { quoteRefFromSkus } from "./quote-ref";
import { closedPrice, sourcingCostOf } from "./pricing";

export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

function toSubmitError(message: string): Error {
  if (message.includes("ACCOUNT_SUSPENDED")) {
    return new Error(
      "Your account is suspended — contact your account manager. Paid orders and disputes are unaffected.",
    );
  }
  if (message.includes("QUOTE_LIMIT_REACHED")) {
    return new QuotaExceededError(
      "You've used all 5 quote requests in your Basic plan this month. Upgrade to Unlimited for uncapped requests.",
    );
  }
  return new Error(message);
}

/** Client: submit a new quote request. Quota enforced atomically in Postgres. */
export const createQuoteRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quoteRequestSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertNotSourcing(supabase, userId);

    const { data: profile } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", userId)
      .maybeSingle();
    if (!profile) throw new Error("Complete your company profile first");
    if (profile.status === "suspended") {
      throw new Error(
        "Your account is suspended — contact your account manager. Paid orders and disputes are unaffected.",
      );
    }
    if (profile.status !== "active") {
      throw new Error("Your account is not active yet");
    }

    const { data: created, error } = await supabase.rpc("submit_quote_request", {
      p_product_url: data.product_url,
      ...(data.product_name ? { p_product_name: data.product_name } : {}),
      ...(data.notes ? { p_notes: data.notes } : {}),
      ...(data.target_monthly_volume != null
        ? { p_target_monthly_volume: data.target_monthly_volume }
        : {}),
      p_image_urls: data.image_urls ?? [],
      p_target_countries: data.target_countries,
      ...(data.store_id ? { p_store_id: data.store_id } : {}),
      ...(data.preview_id ? { p_preview_id: data.preview_id } : {}),
      p_delivery_mode: data.delivery_mode,
      ...(data.delivery_address ? { p_delivery_address: data.delivery_address } : {}),
    });
    if (error) throw toSubmitError(error.message);

    // Tell the admin queue a new request landed. Best-effort: the request is
    // already saved, a failed notification must never fail the submission.
    try {
      const { getAdminClient } = await import("./admin.server");
      const { notify } = await import("./billing.server");
      await notify(await getAdminClient(), {
        kind: "quote_request_submitted",
        title: "New quote request",
        body: `A client submitted a quote request${
          data.product_name ? ` for ${data.product_name}` : ""
        }.`,
      });
    } catch (e) {
      console.error("quote submit notification failed", e);
    }
    return { ok: true, quote_id: created?.id ?? null };
  });

/** Client: my quote requests. The base table no longer carries any pricing. */
export const listMyQuotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("quote_requests")
      .select(
        "id, product_url, product_name, notes, target_monthly_volume, target_countries, image_urls, status, quote_valid_until, quoted_at, created_at, supersedes_quote_id, delivery_mode, delivery_address, revision_number",
      )
      .is("archived_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const quotes = data ?? [];
    // Item references live on quote_lines, which clients cannot read directly.
    // RLS already limited the ids above to this client's own quotes.
    const ids = quotes.map((q) => q.id);
    const refs = new Map<string, string[]>();
    if (ids.length) {
      const { getAdminClient } = await import("./admin.server");
      const admin = await getAdminClient();
      const { data: skuRows } = await admin
        .from("quote_lines")
        .select("quote_request_id, sku")
        .in("quote_request_id", ids);
      for (const row of skuRows ?? []) {
        if (!row.sku) continue;
        refs.set(row.quote_request_id, [...(refs.get(row.quote_request_id) ?? []), row.sku]);
      }
    }
    return {
      quotes: quotes.map((q) => ({ ...q, quote_ref: quoteRefFromSkus(refs.get(q.id) ?? []) })),
    };
  });

/**
 * Client: my open quote requests (submitted/sourcing/quoted) for the dashboard
 * widget. Prices come exclusively from the ownership-checked safe RPC, so no
 * supplier costing can leak. Sorted quoted-first, then by least time remaining.
 */
export const listMyOpenQuotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("quote_requests")
      .select("id, product_url, product_name, status, created_at, quote_due_at")
      .in("status", ["submitted", "sourcing", "quoted"]);
    if (error) throw new Error(error.message);
    const quotes = data ?? [];

    // Lowest client-facing unit price per quoted request (safe RPC only).
    const priceByQuote = new Map<string, number>();
    await Promise.all(
      quotes
        .filter((q) => q.status === "quoted")
        .map(async (q) => {
          const { data: lines } = await context.supabase.rpc("get_client_quote_lines", {
            p_quote_request_id: q.id,
          });
          const prices = (lines ?? [])
            .map((l) => l.unit_price)
            .filter((p): p is number => typeof p === "number" && p > 0);
          if (prices.length > 0) priceByQuote.set(q.id, Math.min(...prices));
        }),
    );

    const rows = quotes.map((q) => ({
      ...q,
      from_price: priceByQuote.get(q.id) ?? null,
    }));
    rows.sort((a, b) => {
      const aq = a.status === "quoted" ? 0 : 1;
      const bq = b.status === "quoted" ? 0 : 1;
      if (aq !== bq) return aq - bq;
      const ad = a.quote_due_at ? new Date(a.quote_due_at).getTime() : Number.POSITIVE_INFINITY;
      const bd = b.quote_due_at ? new Date(b.quote_due_at).getTime() : Number.POSITIVE_INFINITY;
      return ad - bd;
    });
    return { quotes: rows };
  });

/** Client: one of my requests with its variant lines (safe columns only, via the restricted view). */
export const getMyQuote = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ quote_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: quote, error } = await context.supabase
      .from("quote_requests")
      .select(
        "id, product_url, product_name, notes, target_monthly_volume, target_countries, image_urls, status, quote_valid_until, quoted_at, created_at, supersedes_quote_id, quote_due_at, delivery_mode, delivery_address, revision_number",
      )
      .eq("id", data.quote_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!quote) throw new Error("Quote request not found");

    // Safe columns only, via an ownership-checked function (replaces the old view).
    const { data: lines, error: linesError } = await context.supabase.rpc(
      "get_client_quote_lines",
      { p_quote_request_id: data.quote_id },
    );
    if (linesError) throw new Error(linesError.message);

    // The revision this one replaces, kept read-only in the client's history
    // so they can see what changed before approving again.
    let previous: {
      id: string;
      revision_number: number;
      delivery_mode: string;
      quoted_at: string | null;
    } | null = null;
    const supersedes = (quote as { supersedes_quote_id?: string | null }).supersedes_quote_id;
    if (supersedes) {
      const { data: prev } = await context.supabase
        .from("quote_requests")
        .select("id, revision_number, delivery_mode, quoted_at")
        .eq("id", supersedes)
        .maybeSingle();
      previous = prev ?? null;
    }

    return { quote, lines: lines ?? [], previous };
  });

/** Client: accept/reject individual lines. Accepted lines become catalogue products (DB-enforced). */
export const respondToQuoteLines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => respondLinesSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: accepted, error } = await context.supabase.rpc("respond_to_quote_lines", {
      p_quote_id: data.quote_id,
      p_product_name: data.product_name ?? "",
      p_decisions: data.decisions,
    });
    if (error) {
      if (error.message.includes("PRODUCT_NAME_REQUIRED")) {
        throw new Error("Name the product — accepted variants become catalogue products.");
      }
      if (error.message.includes("QUOTE_EXPIRED")) {
        throw new Error("This quote has expired. Ask for a requote.");
      }
      throw new Error(error.message);
    }
    return { ok: true, accepted: accepted ?? 0 };
  });

const quoteStatusFilterSchema = z.object({
  status: z.enum(["submitted", "sourcing", "quoted", "closed", "expired"]).optional(),
});

/** Admin: the quote queue, oldest first, optionally filtered by status. */
export const adminListQuotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quoteStatusFilterSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { requireStaffRead, getAdminClient } = await import("./admin.server");
    await requireStaffRead(context.supabase, context.userId);
    const admin = await getAdminClient();

    // Lazily flag requests that breached their 48h target so the admin is
    // notified even if the cron sweep hasn't run yet.
    await flagBreachedQuotes(admin);

    // Hierarchy: quote_requests.store_id → stores → entities → profiles.
    // The rows are mapped back to the flat `profiles` shape the admin pages
    // render, with company_name carrying the entity's legal name.
    const CHAIN_COLS =
      "stores!quote_requests_store_id_fkey(store_name, store_url, platform, integration_mode, pricing_tier, tier_override, avg_daily_units_30d, subscription_plan, entities(legal_name, country, profiles!entities_account_id_fkey(contact_name)))";

    let query = admin
      .from("quote_requests")
      .select(`*, ${CHAIN_COLS}`)
      .order("created_at", { ascending: true });
    if (data.status) query = query.eq("status", data.status);

    const { data: quotes, error } = await query;
    if (error) throw new Error(error.message);

    // Internal fields live in the admin-only table now; merge them back in.
    const ids = (quotes ?? []).map((q) => q.id as string);
    const { data: internals } = ids.length
      ? await admin
          .from("quote_request_internal")
          .select("quote_request_id, admin_notes, internal_reference")
          .in("quote_request_id", ids)
      : {
          data: [] as Array<{
            quote_request_id: string;
            admin_notes: string | null;
            internal_reference: string | null;
          }>,
        };
    const internalByQuote = new Map((internals ?? []).map((r) => [r.quote_request_id, r]));

    // Quote-level ranges keep the queue dense while still exposing every
    // variant's saved economics. supplier_cogs is already the frozen USD
    // conversion; client price is computed only after a positive margin exists.
    const { data: pricingLines, error: pricingError } = ids.length
      ? await admin
          .from("quote_lines")
          .select(
            "quote_request_id, sku, supplier_cogs, supplier_shipping, sourcing_fee_rate, fee_included, sourcing_cost, supplier_tax, margin_pct",
          )
          .in("quote_request_id", ids)
      : { data: [], error: null };
    if (pricingError) throw new Error(pricingError.message);

    const pricingByQuote = new Map<
      string,
      { cogs: number[]; clientPrices: number[]; hasUnpricedMargin: boolean; skus: string[] }
    >();
    for (const line of pricingLines ?? []) {
      const quoteId = line.quote_request_id;
      const aggregate = pricingByQuote.get(quoteId) ?? {
        cogs: [],
        clientPrices: [],
        hasUnpricedMargin: false,
        skus: [],
      };
      if (line.sku) aggregate.skus.push(line.sku);
      const cogs = Number(line.supplier_cogs ?? 0);
      const marginPct = Number(line.margin_pct ?? 0);
      if (cogs > 0) {
        aggregate.cogs.push(cogs);
        if (marginPct > 0) {
          const sourcingCost =
            line.sourcing_cost != null
              ? Number(line.sourcing_cost)
              : sourcingCostOf({
                  cogs,
                  shipping: Number(line.supplier_shipping ?? 0),
                  feeRate: Number(line.sourcing_fee_rate ?? 0.08),
                  feeIncluded: line.fee_included === true,
                });
          aggregate.clientPrices.push(
            closedPrice(sourcingCost, cogs, marginPct, Number(line.supplier_tax ?? 0)),
          );
        } else {
          aggregate.hasUnpricedMargin = true;
        }
      }
      pricingByQuote.set(quoteId, aggregate);
    }

    // Unread client messages per conversation, cleared when the thread opens.
    const { data: unreadRows } = ids.length
      ? await admin
          .from("quote_messages")
          .select("quote_request_id")
          .in("quote_request_id", ids)
          .eq("author_role", "client")
          .is("read_by_admin_at", null)
      : { data: [] as Array<{ quote_request_id: string }> };
    const unreadByQuote = new Map<string, number>();
    for (const r of unreadRows ?? []) {
      unreadByQuote.set(r.quote_request_id, (unreadByQuote.get(r.quote_request_id) ?? 0) + 1);
    }

    return {
      quotes: (quotes ?? []).map((q) => {
        const mapped = mapQuoteForAdmin(q, internalByQuote.get(q.id as string));
        const pricing = pricingByQuote.get(q.id as string);
        return {
          ...mapped,
          unread_messages: unreadByQuote.get(q.id as string) ?? 0,
          cogs_min: pricing?.cogs.length ? Math.min(...pricing.cogs) : null,
          cogs_max: pricing?.cogs.length ? Math.max(...pricing.cogs) : null,
          client_price_min: pricing?.clientPrices.length ? Math.min(...pricing.clientPrices) : null,
          client_price_max: pricing?.clientPrices.length ? Math.max(...pricing.clientPrices) : null,
          awaiting_pricing: pricing?.hasUnpricedMargin ?? false,
          quote_ref: quoteRefFromSkus(pricing?.skus ?? []),
        };
      }),
    };
  });

/** Admin: single quote with client profile and all variant lines (full costing). */
export const adminGetQuote = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ quote_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireStaffRead, getAdminClient } = await import("./admin.server");
    await requireStaffRead(context.supabase, context.userId);
    const admin = await getAdminClient();

    const { data: quote, error } = await admin
      .from("quote_requests")
      .select(
        "*, stores!quote_requests_store_id_fkey(store_name, store_url, platform, integration_mode, pricing_tier, tier_override, avg_daily_units_30d, subscription_plan, entities(legal_name, country, profiles!entities_account_id_fkey(contact_name)))",
      )
      .eq("id", data.quote_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!quote) throw new Error("Quote request not found");

    const { data: internal, error: internalError } = await admin
      .from("quote_request_internal")
      .select("admin_notes, internal_reference")
      .eq("quote_request_id", data.quote_id)
      .maybeSingle();
    if (internalError) throw new Error(internalError.message);
    const mappedQuote = mapQuoteForAdmin(quote, internal);

    // The preview card the client saw when submitting (shared cache row), so
    // the admin sourcing this request sees the product, not just a raw link.
    const previewId = (quote as { preview_id?: string | null }).preview_id;
    let preview: {
      id: string;
      url_normalized: string;
      title: string | null;
      description: string | null;
      image_urls: string[];
      price_hint: string | null;
      variants: string[];
      source: "firecrawl" | "fetch" | "perplexity";
    } | null = null;
    if (previewId) {
      const { data: p } = await admin
        .from("url_previews")
        .select("id, url_normalized, title, description, image_urls, price_hint, variants, source")
        .eq("id", previewId)
        .maybeSingle();
      // `variants` exists in the DB but not yet in the generated types.
      preview = p
        ? {
            ...(p as Omit<typeof p, "variants">),
            variants: (p as { variants?: string[] | null }).variants ?? [],
          }
        : null;
    }

    const { data: lines, error: linesError } = await admin
      .from("quote_lines")
      .select("*")
      .eq("quote_request_id", data.quote_id)
      .order("created_at", { ascending: true });
    if (linesError) throw new Error(linesError.message);

    // Tier context for the fee field: the agent who sourced (or is assigned to)
    // this request, with the rate their next quote would carry.
    const agentId =
      (quote as { assigned_sourcer?: string | null }).assigned_sourcer ??
      (lines ?? []).find((l) => l.sourced_by)?.sourced_by ??
      null;
    let agent: {
      rate: number;
      count: number;
      nextAt: number | null;
      remaining: number | null;
      nextRate: number | null;
    } | null = null;
    if (agentId) {
      const { parseFeeTiers, tierProgress } = await import("./fee-tiers");
      const { data: collaborator } = await admin
        .from("sourcing_collaborators")
        .select("fee_tiers, paid_transactions")
        .eq("user_id", agentId)
        .maybeSingle();
      if (collaborator) {
        // Tiers are per agent AND per client account.
        const { entityForQuote, clientTierProgress } = await import("./client-tiers.server");
        const entityId = await entityForQuote(admin, data.quote_id);
        const p = entityId
          ? await clientTierProgress(admin, agentId, entityId, collaborator.fee_tiers)
          : tierProgress(
              parseFeeTiers(collaborator.fee_tiers),
              Number(collaborator.paid_transactions ?? 0),
            );
        agent = {
          rate: p.rate,
          count: p.count,
          nextAt: p.nextAt,
          remaining: p.remaining,
          nextRate: p.nextRate,
        };
      }
    }

    return { quote: mappedQuote, lines: lines ?? [], preview, agent };
  });

/**
 * Admin: save the sourcing layer of a quote (supplier costs, shipping, tax
 * passthrough, MOQ, lead time) plus the internal reference and notes. Margin
 * and publishing live in adminPublishQuote — this never sets a client price.
 */
export const adminSaveQuoteLines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => adminQuoteLinesSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    const { DEFAULT_FEE_RATE, writeSourcingLines } = await import("./sourcing.server");
    const { ensureDefaultOption } = await import("./quote-offers.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    // Supplier-currency lines need today's rates; an unchanged currency keeps
    // the rate already frozen on the line.
    const needsFx = data.lines.some((l) => l.supplier_currency && l.supplier_currency !== "USD");
    const fx = needsFx ? await (await import("./fx.server")).ensureDailyRates(admin) : undefined;

    const lines = await writeSourcingLines(admin, {
      quoteId: data.quote_id,
      lines: data.lines.map((l) => ({
        ...(l.id ? { id: l.id } : {}),
        variant_label: l.variant_label,
        country_code: l.country_code,
        supplier_name: l.supplier_name || "Unassigned supplier",
        supplier_unit_price: l.supplier_cogs,
        supplier_shipping: l.supplier_shipping,
        supplier_tax: l.supplier_tax,
        ...(l.supplier_currency ? { supplier_currency: l.supplier_currency } : {}),
        moq: l.moq ?? 1,
        production_lead_days: l.lead_time_days ?? 0,
        ...(l.sourcing_notes ? { sourcing_notes: l.sourcing_notes } : {}),
      })),
      ...(fx ? { fx } : {}),
      feeRate: DEFAULT_FEE_RATE,
      sourcedBy: null,
      optionId: data.option_id ?? (await ensureDefaultOption(admin, data.quote_id)),
    });

    // Saving a draft persists the owner's margin and fee on the line, but never
    // writes unit_price and never publishes — only publishing reaches the client.
    const byKey = new Map(
      lines.map((l) => [`${l.variant_label}::${l.country_code}`, l.id] as const),
    );
    const drafts = data.lines.filter((l) => l.margin_pct != null || l.fee_rate_pct != null);
    if (drafts.length > 0) {
      const { data: stored } = await admin
        .from("quote_lines")
        .select("id, supplier_cogs, supplier_shipping, fee_included")
        .eq("quote_request_id", data.quote_id);
      const storedById = new Map((stored ?? []).map((l) => [l.id, l] as const));
      for (const input of drafts) {
        const lineId = byKey.get(`${input.variant_label}::${input.country_code}`);
        const saved = lineId ? storedById.get(lineId) : undefined;
        if (!lineId || !saved) continue;
        const patch: {
          margin_pct?: number;
          sourcing_fee_rate?: number;
          sourcing_cost?: number;
        } = {};
        if (input.margin_pct != null) patch.margin_pct = input.margin_pct;
        if (input.fee_rate_pct != null) {
          const feeRate = input.fee_rate_pct / 100;
          patch.sourcing_fee_rate = feeRate;
          patch.sourcing_cost = sourcingCostOf({
            cogs: Number(saved.supplier_cogs ?? 0),
            shipping: Number(saved.supplier_shipping ?? 0),
            feeRate,
            feeIncluded: saved.fee_included === true,
          });
        }
        const { error: patchError } = await admin
          .from("quote_lines")
          .update(patch)
          .eq("id", lineId);
        if (patchError) throw new Error(patchError.message);
      }
    }

    if (data.quote_valid_until !== undefined) {
      await admin
        .from("quote_requests")
        .update({ quote_valid_until: data.quote_valid_until ?? null })
        .eq("id", data.quote_id);
    }
    await admin.from("quote_request_internal").upsert(
      {
        quote_request_id: data.quote_id,
        internal_reference: data.internal_reference || null,
        admin_notes: data.admin_notes || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "quote_request_id" },
    );

    return { ok: true, lines };
  });

/** Admin: requote a closed/expired quote — new row, original untouched, no quota cost. */
export const adminRequote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => requoteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);

    const admin = await getAdminClient();
    const { data: quote, error: quoteError } = await admin
      .from("quote_requests")
      .select("store_id, status, stores(entities(account_id))")
      .eq("id", data.quote_id)
      .maybeSingle();
    if (quoteError) throw new Error(quoteError.message);
    if (!quote) throw new Error("Quote request not found");
    if (quote.status !== "closed" && quote.status !== "expired") {
      throw new Error("Only closed or expired quotes can be requoted");
    }
    // p_on_behalf_of expects the owning ACCOUNT id, resolved via store → entity.
    const accountId = (quote.stores as { entities?: { account_id?: string | null } | null } | null)
      ?.entities?.account_id;
    if (!accountId) throw new Error("Quote workspace has no owning account");

    const { data: created, error } = await context.supabase.rpc("submit_quote_request", {
      p_supersedes_quote_id: data.quote_id,
      p_on_behalf_of: accountId,
    });
    if (error) throw new Error(error.message);
    return { ok: true, quote_id: created?.id ?? null };
  });

/** Admin: move a request between queue states. */
export const adminSetQuoteStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => adminQuoteStatusSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("quote_requests")
      .update({ status: data.status })
      .eq("id", data.quote_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin: short-lived signed URLs for quote images (private bucket). */
export const adminGetQuoteImageUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => signedUrlsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { data: signed, error } = await admin.storage
      .from("quote-images")
      .createSignedUrls(data.paths, 300);
    if (error) throw new Error(error.message);
    return {
      urls: (signed ?? [])
        .filter((s) => s.signedUrl)
        .map((s) => ({ path: s.path ?? "", url: s.signedUrl! })),
    };
  });

/** Admin: set the delivery mode (and address) on a quote — drives freight. */
export const adminSetQuoteDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quoteDeliverySchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { error } = await admin
      .from("quote_requests")
      .update({
        delivery_mode: data.delivery_mode,
        delivery_address: data.delivery_address || null,
      })
      .eq("id", data.quote_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Admin: open a revision of a published or accepted quote.
 *
 * The current pricing is cloned into a new editable request (revision N+1):
 * quantity, delivery mode, shipping and every supplier field can change there.
 * Frozen FX and the agent fee tier carry over untouched, and the previous
 * revision stays read-only — a price the client already agreed to never
 * changes silently.
 */
export const adminCreateQuoteRevision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createRevisionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    const { writeAuditLine } = await import("./cleanup.server");
    const { postSystemEvent } = await import("./quote-thread.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const { data: quote, error } = await admin
      .from("quote_requests")
      .select("*")
      .eq("id", data.quote_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!quote) throw new Error("Quote request not found");

    const { data: existing } = await admin
      .from("quote_requests")
      .select("id")
      .eq("supersedes_quote_id", data.quote_id)
      .in("status", ["submitted", "sourcing"])
      .maybeSingle();
    if (existing) {
      return { ok: true, quote_id: existing.id, existing: true };
    }

    const q = quote as Record<string, unknown>;
    const { data: created, error: insertError } = await admin
      .from("quote_requests")
      .insert({
        store_id: q["store_id"] as string,
        product_url: (q["product_url"] as string | null) ?? "",
        product_name: q["product_name"] as string | null,
        notes: q["notes"] as string | null,
        target_monthly_volume: q["target_monthly_volume"] as number | null,
        image_urls: (q["image_urls"] as string[] | null) ?? [],
        target_countries: (q["target_countries"] as string[] | null) ?? [],
        preview_id: q["preview_id"] as string | null,
        assigned_sourcer: q["assigned_sourcer"] as string | null,
        delivery_mode: q["delivery_mode"] as never,
        delivery_address: q["delivery_address"] as string | null,
        supersedes_quote_id: data.quote_id,
        revision_number: Number(q["revision_number"] ?? 1) + 1,
        status: "sourcing",
      })
      .select("id, revision_number")
      .single();
    if (insertError) throw new Error(insertError.message);

    // Clone the options, then the lines that hang off them, so the revision
    // opens with exactly today's chain and stays editable end to end.
    const { data: options } = await admin
      .from("quote_options")
      .select("*")
      .eq("quote_request_id", data.quote_id)
      .is("archived_at", null);
    const optionMap = new Map<string, string>();
    for (const o of options ?? []) {
      const src = o as Record<string, unknown>;
      const { data: newOption } = await admin
        .from("quote_options")
        .insert({
          quote_request_id: created.id,
          letter: src["letter"] as string,
          supplier_id: src["supplier_id"] as string | null,
          quality: src["quality"] as never,
          recommended: src["recommended"] as boolean,
          moq: src["moq"] as number | null,
          production_lead_days: src["production_lead_days"] as number | null,
          shipping_lead_days: src["shipping_lead_days"] as number | null,
          internal_notes: src["internal_notes"] as string | null,
          published: false,
        })
        .select("id")
        .single();
      if (newOption) optionMap.set(o.id, newOption.id);
    }

    const { data: lines } = await admin
      .from("quote_lines")
      .select("*")
      .eq("quote_request_id", data.quote_id)
      .order("created_at", { ascending: true });
    for (const l of lines ?? []) {
      const src = l as Record<string, unknown>;
      const copy: Record<string, unknown> = { ...src };
      delete copy["id"];
      delete copy["created_at"];
      delete copy["responded_at"];
      copy["quote_request_id"] = created.id;
      copy["status"] = "pending";
      copy["accepted_quantity"] = src["accepted_quantity"] ?? null;
      copy["option_id"] = src["option_id"]
        ? (optionMap.get(src["option_id"] as string) ?? null)
        : null;
      await admin.from("quote_lines").insert(copy as never);
    }

    await postSystemEvent(
      admin,
      data.quote_id,
      "revision_opened",
      `Revision ${created.revision_number} is being prepared. Your current terms stay in force until you approve it.`,
    );
    await writeAuditLine(admin, {
      actorId: context.userId,
      action: "quote_revision_created",
      entityType: "quote_request",
      entityId: created.id,
      summary: `Revision ${created.revision_number} opened from quote ${data.quote_id}`,
    });

    return { ok: true, quote_id: created.id, existing: false };
  });
