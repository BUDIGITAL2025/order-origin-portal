import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  adminQuoteSchema,
  adminQuoteStatusSchema,
  quoteRequestSchema,
  quoteResponseSchema,
  requoteSchema,
  signedUrlsSchema,
} from "./schemas";

export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

function toSubmitError(message: string): Error {
  if (message.includes("QUOTE_LIMIT_REACHED")) {
    return new QuotaExceededError(
      "You've used all quote requests in your current plan this month. Upgrade to Pro for a higher allowance.",
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

    const { data: profile } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", userId)
      .maybeSingle();
    if (!profile) throw new Error("Complete your company profile first");
    if (profile.status !== "active") {
      throw new Error("Your account is not active yet");
    }

    const { error } = await supabase.rpc("submit_quote_request", {
      p_product_url: data.product_url,
      p_product_name: data.product_name || null,
      p_notes: data.notes || null,
      p_target_monthly_volume: data.target_monthly_volume ?? null,
      p_image_urls: data.image_urls ?? [],
    });
    if (error) throw toSubmitError(error.message);
    return { ok: true };
  });

/** Client: my quotes via the column-restricted view (no admin-only fields exist here). */
export const listMyQuotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("quote_requests_client")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { quotes: data ?? [] };
  });

/** Client: accept or reject one of my quoted, unexpired quotes (DB-enforced). */
export const respondToQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quoteResponseSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("respond_to_quote", {
      p_quote_id: data.quote_id,
      p_accept: data.accept,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const quoteStatusFilterSchema = z.object({
  status: z
    .enum(["submitted", "sourcing", "quoted", "accepted", "rejected", "expired"])
    .optional(),
});

/** Admin: the quote queue, oldest first, optionally filtered by status. */
export const adminListQuotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quoteStatusFilterSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    let query = admin
      .from("quote_requests")
      .select("*, profiles!quote_requests_client_id_fkey(company_name, contact_name, markup_tier, shopify_domain)")
      .order("created_at", { ascending: true });
    if (data.status) query = query.eq("status", data.status);

    const { data: quotes, error } = await query;
    if (error) throw new Error(error.message);
    return { quotes: quotes ?? [] };
  });

/** Admin: single quote with client profile. */
export const adminGetQuote = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ quote_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const { data: quote, error } = await admin
      .from("quote_requests")
      .select("*, profiles!quote_requests_client_id_fkey(company_name, contact_name, markup_tier, shopify_domain, country)")
      .eq("id", data.quote_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!quote) throw new Error("Quote request not found");
    return { quote };
  });

/** Admin: price a request — saves the quote and moves status to 'quoted'. */
export const adminSaveQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => adminQuoteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, round2 } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);

    // Recompute the quoted price server-side; manual override is honored only
    // when the caller explicitly flags it.
    const computed = round2((data.cost_price + data.shipping_cost) * (1 + data.markup_percent / 100));
    const quotedPrice = data.price_overridden ? round2(data.quoted_price) : computed;

    const { error } = await context.supabase
      .from("quote_requests")
      .update({
        cost_price: data.cost_price,
        shipping_cost: data.shipping_cost,
        markup_percent: data.markup_percent,
        quoted_price: quotedPrice,
        moq: data.moq ?? null,
        lead_time_days: data.lead_time_days ?? null,
        quote_valid_until: data.quote_valid_until ?? null,
        admin_notes: data.admin_notes || null,
        status: "quoted",
        quoted_at: new Date().toISOString(),
      })
      .eq("id", data.quote_id);
    if (error) throw new Error(error.message);
    return { ok: true, quoted_price: quotedPrice };
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
