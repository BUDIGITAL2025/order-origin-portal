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
