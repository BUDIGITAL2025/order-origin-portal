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
      .select("id, endpoint, credits_cost, cached, rows_returned, ok, error, duration_ms, created_at")
      .eq("provider", "winninghunter")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
