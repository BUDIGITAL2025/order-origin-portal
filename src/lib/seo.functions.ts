/**
 * Admin-only server functions for the FlySales SEO module (DataForSEO).
 * Thin wrappers: every handler verifies the admin role, then delegates to
 * seo.server.ts — the only module that talks to DataForSEO.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const locale = z.object({
  locationCode: z.number().int().default(2620), // Portugal
  languageCode: z.string().min(2).max(8).default("pt"),
});

/** Free: credentials state, balance, spend today and the pre-flight prices. */
export const getSeoStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const seo = await import("./seo.server");
    if (!seo.hasCredentials()) {
      return {
        configured: false,
        balance: null,
        spentToday: 0,
        dailyLimit: seo.DAILY_SOFT_LIMIT_USD,
        prices: {} as Record<string, number>,
      };
    }
    const [balance, spentToday, learned] = await Promise.all([
      seo.getBalance(),
      seo.getUserDaySpend(context.userId),
      seo.getLearnedCosts(),
    ]);
    const prices: Record<string, number> = {};
    for (const key of Object.keys(seo.PUBLISHED_PRICE)) {
      prices[key] = learned[key] ?? seo.PUBLISHED_PRICE[key] ?? 0;
    }
    return {
      configured: true,
      balance,
      spentToday,
      dailyLimit: seo.DAILY_SOFT_LIMIT_USD,
      prices,
    };
  });

/** Free: country-level location codes, cached permanently. */
export const seoLocations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const seo = await import("./seo.server");
    return seo.getLocations(context.userId);
  });

/** Paid: DataForSEO Labs domain rank overview for one domain. */
export const seoDomainOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    locale
      .extend({
        target: z
          .string()
          .trim()
          .min(3)
          .max(200)
          .transform((v) => v.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "").toLowerCase()),
        confirmOverage: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const seo = await import("./seo.server");
    const endpoint = "dataforseo_labs/google/domain_rank_overview/live";
    return seo.dataforseoCall({
      userId: context.userId,
      endpoint,
      path: `/v3/${endpoint}`,
      task: {
        target: data.target,
        location_code: data.locationCode,
        language_code: data.languageCode,
      },
      summary: { target: data.target, location: data.locationCode },
      ttlMs: seo.TTL.domain,
      estimatedCost: await seo.priceFor(endpoint),
      ...(data.confirmOverage ? { confirmOverage: true } : {}),
    });
  });

/** Paid: Google Ads search volume — up to 1000 keywords in ONE call. */
export const seoKeywordVolume = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    locale
      .extend({
        keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(1000),
        confirmOverage: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const seo = await import("./seo.server");
    const endpoint = "keywords_data/google_ads/search_volume/live";
    const keywords = [...new Set(data.keywords.map((k) => k.toLowerCase()))];
    return seo.dataforseoCall({
      userId: context.userId,
      endpoint,
      path: `/v3/${endpoint}`,
      task: {
        keywords,
        location_code: data.locationCode,
        language_code: data.languageCode,
      },
      summary: { count: keywords.length, location: data.locationCode },
      ttlMs: seo.TTL.keywords,
      estimatedCost: await seo.priceFor(endpoint),
      ...(data.confirmOverage ? { confirmOverage: true } : {}),
    });
  });

/** Paid: keyword ideas expanded from up to 20 seeds. */
export const seoKeywordIdeas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    locale
      .extend({
        keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
        confirmOverage: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const seo = await import("./seo.server");
    const endpoint = "keywords_data/google_ads/keywords_for_keywords/live";
    const keywords = [...new Set(data.keywords.map((k) => k.toLowerCase()))];
    return seo.dataforseoCall({
      userId: context.userId,
      endpoint,
      path: `/v3/${endpoint}`,
      task: {
        keywords,
        location_code: data.locationCode,
        language_code: data.languageCode,
        sort_by: "search_volume",
      },
      summary: { seeds: keywords.length, location: data.locationCode },
      ttlMs: seo.TTL.keywords,
      estimatedCost: await seo.priceFor(endpoint),
      ...(data.confirmOverage ? { confirmOverage: true } : {}),
    });
  });

/** Paid: live Google organic SERP, advanced. */
export const seoSerp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    locale
      .extend({
        keyword: z.string().trim().min(1).max(700),
        device: z.enum(["desktop", "mobile"]).default("desktop"),
        confirmOverage: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const seo = await import("./seo.server");
    const endpoint = "serp/google/organic/live/advanced";
    return seo.dataforseoCall({
      userId: context.userId,
      endpoint,
      path: `/v3/${endpoint}`,
      task: {
        keyword: data.keyword,
        location_code: data.locationCode,
        language_code: data.languageCode,
        device: data.device,
        depth: 20,
      },
      summary: { keyword: data.keyword, location: data.locationCode, device: data.device },
      ttlMs: seo.TTL.serp,
      estimatedCost: await seo.priceFor(endpoint),
      ...(data.confirmOverage ? { confirmOverage: true } : {}),
    });
  });

/** Free: our own call log, cache-hit rate and spend breakdown. */
export const seoUsageDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const seo = await import("./seo.server");
    return seo.getUsageDashboard(context.userId);
  });

// ---------------------------------------------------------------------------
// Phase 2 — competitor intelligence and backlinks
// ---------------------------------------------------------------------------

const domainField = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .transform((v) =>
    v
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/.*$/, "")
      .toLowerCase(),
  );

/** Paid: Labs competitors_domain — domains competing for the same keywords. */
export const seoCompetitors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    locale
      .extend({
        target: domainField,
        limit: z.number().int().min(1).max(1000).default(100),
        confirmOverage: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const seo = await import("./seo.server");
    const endpoint = "dataforseo_labs/google/competitors_domain/live";
    return seo.dataforseoCall({
      userId: context.userId,
      endpoint,
      path: `/v3/${endpoint}`,
      task: {
        target: data.target,
        location_code: data.locationCode,
        language_code: data.languageCode,
        limit: data.limit,
        order_by: ["intersections,desc"],
      },
      summary: { target: data.target, location: data.locationCode, limit: data.limit },
      ttlMs: seo.TTL.domain,
      estimatedCost: await seo.estimateFor(endpoint, data.limit),
      ...(data.confirmOverage ? { confirmOverage: true } : {}),
    });
  });

/**
 * Paid: Labs domain_intersection — the keyword gap. One call compares two
 * domains; the UI runs one call per competitor (max 3), never a loop over
 * keywords.
 */
export const seoKeywordGap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    locale
      .extend({
        target1: domainField,
        target2: domainField,
        /** false = keywords target2 ranks for and target1 does not (the gap). */
        intersections: z.boolean().default(false),
        limit: z.number().int().min(1).max(1000).default(200),
        minVolume: z.number().int().min(0).max(1_000_000).default(0),
        maxPosition: z.number().int().min(1).max(100).default(100),
        confirmOverage: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const seo = await import("./seo.server");
    const endpoint = "dataforseo_labs/google/domain_intersection/live";
    const filters: unknown[] = [];
    if (data.minVolume > 0) {
      filters.push(["keyword_data.keyword_info.search_volume", ">=", data.minVolume]);
    }
    if (data.maxPosition < 100) {
      if (filters.length) filters.push("and");
      filters.push(["first_domain_serp_element.rank_group", "<=", data.maxPosition]);
    }
    return seo.dataforseoCall({
      userId: context.userId,
      endpoint,
      path: `/v3/${endpoint}`,
      task: {
        // target1 is the competitor: with intersections=false we get the
        // keywords it ranks for and we do not.
        target1: data.target1,
        target2: data.target2,
        intersections: data.intersections,
        location_code: data.locationCode,
        language_code: data.languageCode,
        limit: data.limit,
        order_by: ["keyword_data.keyword_info.search_volume,desc"],
        ...(filters.length ? { filters } : {}),
      },
      summary: {
        competitor: data.target1,
        you: data.target2,
        mode: data.intersections ? "overlap" : "gap",
        minVolume: data.minVolume,
        limit: data.limit,
      },
      ttlMs: seo.TTL.domain,
      estimatedCost: await seo.estimateFor(endpoint, data.limit),
      ...(data.confirmOverage ? { confirmOverage: true } : {}),
    });
  });

/** Paid: Labs ranked_keywords — everything a domain ranks for, paginated. */
export const seoRankedKeywords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    locale
      .extend({
        target: domainField,
        limit: z.number().int().min(1).max(1000).default(100),
        offset: z.number().int().min(0).max(20_000).default(0),
        confirmOverage: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const seo = await import("./seo.server");
    const endpoint = "dataforseo_labs/google/ranked_keywords/live";
    return seo.dataforseoCall({
      userId: context.userId,
      endpoint,
      path: `/v3/${endpoint}`,
      task: {
        target: data.target,
        location_code: data.locationCode,
        language_code: data.languageCode,
        limit: data.limit,
        offset: data.offset,
        order_by: ["ranked_serp_element.serp_item.etv,desc"],
      },
      summary: { target: data.target, limit: data.limit, offset: data.offset },
      ttlMs: seo.TTL.domain,
      estimatedCost: await seo.estimateFor(endpoint, data.limit),
      ...(data.confirmOverage ? { confirmOverage: true } : {}),
    });
  });

const backlinksTarget = z.object({
  target: domainField,
  confirmOverage: z.boolean().optional(),
});

/** Paid (cheap, per request): backlinks summary KPIs for one domain. */
export const seoBacklinksSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => backlinksTarget.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const seo = await import("./seo.server");
    const endpoint = "backlinks/summary/live";
    return seo.dataforseoCall({
      userId: context.userId,
      endpoint,
      path: `/v3/${endpoint}`,
      task: { target: data.target, internal_list_limit: 10, backlinks_status_type: "live" },
      summary: { target: data.target },
      ttlMs: seo.TTL.backlinks,
      estimatedCost: await seo.estimateFor(endpoint),
      ...(data.confirmOverage ? { confirmOverage: true } : {}),
    });
  });

/** Paid drill-downs on the backlink profile — one explicit button each. */
export const seoBacklinksDrilldown = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        target: domainField,
        kind: z.enum(["referring_domains", "backlinks", "anchors"]),
        limit: z.number().int().min(1).max(1000).default(100),
        confirmOverage: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const seo = await import("./seo.server");
    const endpoint = `backlinks/${data.kind}/live`;
    const orderBy =
      data.kind === "backlinks" ? ["rank,desc"] : ["backlinks,desc"];
    return seo.dataforseoCall({
      userId: context.userId,
      endpoint,
      path: `/v3/${endpoint}`,
      task: {
        target: data.target,
        limit: data.limit,
        backlinks_status_type: "live",
        order_by: orderBy,
        ...(data.kind === "backlinks" ? { mode: "one_per_domain" } : {}),
      },
      summary: { target: data.target, kind: data.kind, limit: data.limit },
      ttlMs: seo.TTL.backlinks,
      estimatedCost: await seo.estimateFor(endpoint, data.limit),
      ...(data.confirmOverage ? { confirmOverage: true } : {}),
    });
  });
