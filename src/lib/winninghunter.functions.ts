/**
 * Admin-only server functions for the WinningHunter side of SpyMarket.
 * Thin wrappers: verify the admin role, then delegate to winninghunter.server,
 * the only module that talks to the provider. Nothing here fires on render —
 * every metered call is triggered by an explicit user action.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const platform = z.enum(["meta", "tiktok", "pinterest", "google"]);

/** Header chips. `live=true` costs 1 credit (their balance probe), cached 15m. */
export const getWhStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ live: z.boolean().default(false) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const mod = await import("./winninghunter.server");
    return mod.getWhStatus(context.userId, data.live);
  });

/** Metered: 1 credit per page, any platform, whatever the page size. */
export const whSearchAds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        platform,
        keyword: z.string().trim().max(200).optional(),
        searchScope: z.string().trim().max(40).optional(),
        countries: z.string().trim().max(200).optional(),
        storeBasedIn: z.string().trim().max(200).optional(),
        sorting: z.string().trim().max(40).optional(),
        sortDirection: z.enum(["asc", "desc"]).optional(),
        mediaType: z.string().trim().max(40).optional(),
        activeStatus: z.string().trim().max(40).optional(),
        minAdSpend: z.number().min(0).optional(),
        maxAdSpend: z.number().min(0).optional(),
        minAdSets: z.number().int().min(0).optional(),
        maxAdSets: z.number().int().min(0).optional(),
        minDaysRunning: z.number().int().min(0).optional(),
        maxDaysRunning: z.number().int().min(0).optional(),
        minActiveAds: z.number().int().min(0).optional(),
        createdFrom: z.string().trim().max(20).optional(),
        createdTo: z.string().trim().max(20).optional(),
        lastSeenFrom: z.string().trim().max(20).optional(),
        lastSeenTo: z.string().trim().max(20).optional(),
        limit: z.number().int().min(1).max(50).default(24),
        page: z.number().int().min(0).max(200).optional(),
        scroll: z.string().max(4000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const mod = await import("./winninghunter.server");
    return mod.whSearchAds(context.userId, data);
  });

/** Free: our own call log for the WinningHunter provider (no provider call). */
export const getWhRecentCalls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("spy_api_calls")
      .select(
        "id, endpoint, credits_cost, cached, rows_returned, ok, error, duration_ms, created_at",
      )
      .eq("provider", "winninghunter")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ---------------------------------------------------------------------------
// Phase 2 — stores, brands, trends, TikTok Shop. Same rule as above: every one
// of these is an explicit user action, 1 credit per uncached call.
// ---------------------------------------------------------------------------

const admin = async (context: { supabase: unknown; userId: string }) => {
  const { requireAdmin } = await import("./admin.server");
  await requireAdmin(context.supabase as never, context.userId);
  return import("./winninghunter.server");
};

const optNum = z.number().min(0).optional();

export const whSearchStores = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        search: z.string().trim().max(200).optional(),
        country: z.string().trim().max(10).optional(),
        sortingKey: z.string().trim().max(40).optional(),
        sortingDirection: z.enum(["asc", "desc"]).optional(),
        page: z.number().int().min(1).max(200).optional(),
        pageSize: z.number().int().min(1).max(50).optional(),
        includeWlads: z.boolean().optional(),
        category: z.string().trim().max(60).optional(),
        minRevenue: optNum,
        maxRevenue: optNum,
        monthlyVisitsMin: optNum,
        monthlyVisitsMax: optNum,
        aovMin: optNum,
        aovMax: optNum,
        productCountMin: optNum,
        productCountMax: optNum,
        storeCreatedFrom: z.string().trim().max(20).optional(),
        storeCreatedTo: z.string().trim().max(20).optional(),
        language: z.string().trim().max(10).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) =>
    (await admin(context)).whSearchStores(context.userId, data),
  );

export const whStoreTracker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await admin(context)).whStoreTracker(context.userId));

export const whListBrands = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        search: z.string().trim().max(200).optional(),
        sort: z.string().trim().max(40).optional(),
        dir: z.enum(["asc", "desc"]).optional(),
        page: z.number().int().min(1).max(200).optional(),
        limit: z.number().int().min(1).max(50).optional(),
        revenuePeriod: z.enum(["1d", "30d"]).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => (await admin(context)).whListBrands(context.userId, data));

const brandTab = z.enum([
  "overview-cards",
  "personas",
  "themes",
  "angles",
  "desires",
  "emotions",
  "awareness-stages",
  "funnel-stages",
  "usps",
  "ad-hooks",
  "ad-headlines",
  "ad-copies",
  "landing-pages",
  "associated-domains",
  "ads",
]);

export const whBrandTab = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().trim().min(1).max(80),
        tab: brandTab,
        dateRange: z.string().trim().max(20).optional(),
        page: z.number().int().min(0).max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => (await admin(context)).whBrandTab(context.userId, data));

export const whFollowBrandByDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ domain: z.string().trim().min(3).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) =>
    (await admin(context)).whFollowBrandByDomain(context.userId, data.domain),
  );

export const whTrendsSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        query: z.string().trim().max(120).optional(),
        category: z.string().trim().max(60).optional(),
        timeframe: z.string().trim().max(10).optional(),
        sorting: z.string().trim().max(30).optional(),
        offset: z.number().int().min(0).max(2000).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) =>
    (await admin(context)).whTrendsSearch(context.userId, data),
  );

export const whTrendDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ topic: z.string().trim().min(1).max(160) }).parse(input),
  )
  .handler(async ({ data, context }) =>
    (await admin(context)).whTrendDetail(context.userId, data.topic),
  );

export const whTikTokExplore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        resource: z.enum(["products", "shops", "creators", "videos"]),
        name: z.string().trim().max(160).optional(),
        country: z.string().trim().max(10).optional(),
        period: z.string().trim().max(10).optional(),
        sort: z.string().trim().max(40).optional(),
        order: z.enum(["asc", "desc"]).optional(),
        page: z.number().int().min(1).max(200).optional(),
        limit: z.number().int().min(1).max(50).optional(),
        minRevenue: optNum,
        minSold: optNum,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    (await admin(context)).whTikTokExplore(context.userId, data),
  );

export const whTikTokProductDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().trim().min(1).max(80),
        period: z.string().trim().max(10).default("30d"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    (await admin(context)).whTikTokProductDetail(context.userId, data.id, data.period),
  );
