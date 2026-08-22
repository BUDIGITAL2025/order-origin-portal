import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  adminQuoteLinesSchema,
  adminQuoteStatusSchema,
  quoteRequestSchema,
  respondLinesSchema,
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
      ...(data.product_name ? { p_product_name: data.product_name } : {}),
      ...(data.notes ? { p_notes: data.notes } : {}),
      ...(data.target_monthly_volume != null
        ? { p_target_monthly_volume: data.target_monthly_volume }
        : {}),
      p_image_urls: data.image_urls ?? [],
      p_target_countries: data.target_countries,
    });
    if (error) throw toSubmitError(error.message);
    return { ok: true };
  });

/** Client: my quote requests. The base table no longer carries any pricing. */
export const listMyQuotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("quote_requests")
      .select(
        "id, product_url, product_name, notes, target_monthly_volume, target_countries, status, quote_valid_until, quoted_at, created_at, supersedes_quote_id",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { quotes: data ?? [] };
  });

/** Client: one of my requests with its variant lines (safe columns only, via the restricted view). */
export const getMyQuote = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ quote_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: quote, error } = await context.supabase
      .from("quote_requests")
      .select(
        "id, product_url, product_name, notes, target_monthly_volume, target_countries, image_urls, status, quote_valid_until, quoted_at, created_at, supersedes_quote_id",
      )
      .eq("id", data.quote_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!quote) throw new Error("Quote request not found");

    const { data: lines, error: linesError } = await context.supabase
      .from("quote_lines_client")
      .select("*")
      .eq("quote_request_id", data.quote_id)
      .order("created_at", { ascending: true });
    if (linesError) throw new Error(linesError.message);

    return { quote, lines: lines ?? [] };
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
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const CLIENT_COLS =
      "company_name, contact_name, platform, store_url, integration_mode, country, pricing_tier, tier_override, avg_daily_units_30d, subscription_plan";

    let query = admin
      .from("quote_requests")
      .select(`*, profiles!quote_requests_client_id_fkey(${CLIENT_COLS})`)
      .order("created_at", { ascending: true });
    if (data.status) query = query.eq("status", data.status);

    const { data: quotes, error } = await query;
    if (error) throw new Error(error.message);
    return { quotes: quotes ?? [] };
  });

/** Admin: single quote with client profile and all variant lines (full costing). */
export const adminGetQuote = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ quote_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const { data: quote, error } = await admin
      .from("quote_requests")
      .select(
        "*, profiles!quote_requests_client_id_fkey(company_name, contact_name, platform, store_url, integration_mode, country, pricing_tier, tier_override, avg_daily_units_30d, subscription_plan)",
      )
      .eq("id", data.quote_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!quote) throw new Error("Quote request not found");

    const { data: lines, error: linesError } = await admin
      .from("quote_lines")
      .select("*")
      .eq("quote_request_id", data.quote_id)
      .order("created_at", { ascending: true });
    if (linesError) throw new Error(linesError.message);

    return { quote, lines: lines ?? [] };
  });

/** Admin: save variant lines (SKUs generated server-side), move the request to 'quoted'. */
export const adminSaveQuoteLines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => adminQuoteLinesSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);

    // Nullable params let the admin clear a previously set value; the generated
    // types mark defaulted args as optional strings, so cast the explicit nulls.
    const { data: lines, error } = await context.supabase.rpc("admin_save_quote_lines", {
      p_quote_id: data.quote_id,
      p_lines: data.lines,
      p_internal_reference: (data.internal_reference || null) as string,
      p_quote_valid_until: (data.quote_valid_until ?? null) as string,
      p_admin_notes: (data.admin_notes || null) as string,
    });
    if (error) throw new Error(error.message);
    return { ok: true, lines: lines ?? [] };
  });

/** Admin: requote a closed/expired quote — new row, original untouched, no quota cost. */
export const adminRequote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => requoteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);

    const { data: quote, error: quoteError } = await context.supabase
      .from("quote_requests")
      .select("client_id, status")
      .eq("id", data.quote_id)
      .maybeSingle();
    if (quoteError) throw new Error(quoteError.message);
    if (!quote) throw new Error("Quote request not found");
    if (quote.status !== "closed" && quote.status !== "expired") {
      throw new Error("Only closed or expired quotes can be requoted");
    }

    const { data: created, error } = await context.supabase.rpc("submit_quote_request", {
      p_supersedes_quote_id: data.quote_id,
      p_on_behalf_of: quote.client_id,
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
