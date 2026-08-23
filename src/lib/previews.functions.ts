import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { normalizeUrl, scrapePreview } from "./previews.server";

/**
 * Client: live preview for a pasted product URL.
 *
 * Cost guards: results are cached in url_previews (30-day TTL, normalized URL
 * key) and fresh scrapes are rate-limited per account per hour. Cache hits
 * make zero external calls. Scraping secrets are read here, server-side only.
 */
export const getUrlPreview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ url: z.string().trim().max(2000) }).parse(input))
  .handler(async ({ data, context }) => {
    const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
    const RATE_LIMIT_PER_HOUR = 20;

    const normalized = normalizeUrl(data.url);
    if (!normalized) return { status: "invalid" as const };

    // The cache table is service-role only (RLS locked for clients) — previews
    // are shared, public scraped data and reach the browser via this response.
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const { data: cached, error: cacheError } = await db
      .from("url_previews")
      .select("*")
      .eq("url_normalized", normalized)
      .maybeSingle();
    if (cacheError) throw new Error(cacheError.message);

    if (cached && Date.now() - new Date(cached.scraped_at).getTime() < CACHE_TTL_MS) {
      return {
        status: "ok" as const,
        cached: true,
        preview: {
          id: cached.id,
          url: cached.url_normalized,
          title: cached.title,
          description: cached.description,
          imageUrls: cached.image_urls ?? [],
          priceHint: cached.price_hint,
          source: cached.source,
        },
      };
    }

    // Rate limit fresh scrapes per account; cache hits are always free.
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await db
      .from("url_previews")
      .select("id", { count: "exact", head: true })
      .eq("requested_by", context.userId)
      .gte("scraped_at", since);
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) return { status: "rate_limited" as const };

    const scraped = await scrapePreview(data.url, {
      firecrawlKey: process.env["FIRECRAWL_API_KEY"],
      perplexityKey: process.env["PERPLEXITY_API_KEY"],
    });
    if (!scraped) return { status: "unavailable" as const };

    const { data: row, error: upsertError } = await db
      .from("url_previews")
      .upsert(
        {
          url_normalized: normalized,
          title: scraped.title,
          description: scraped.description,
          image_urls: scraped.imageUrls,
          price_hint: scraped.priceHint,
          source: scraped.source,
          scraped_at: new Date().toISOString(),
          requested_by: context.userId,
        },
        { onConflict: "url_normalized" },
      )
      .select("id")
      .single();
    if (upsertError) throw new Error(upsertError.message);

    return {
      status: "ok" as const,
      cached: false,
      preview: {
        id: row.id,
        url: normalized,
        title: scraped.title,
        description: scraped.description,
        imageUrls: scraped.imageUrls,
        priceHint: scraped.priceHint,
        source: scraped.source,
      },
    };
  });
