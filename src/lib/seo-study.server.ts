/**
 * FLYSALES SEO Phase 3 — the Full SEO study (server-only).
 *
 * One button produces a complete dossier for a domain. The work is a
 * background job on the generic Data Lake runner (jobs + artifacts): a cron
 * tick advances one phase at a time, writing each phase's result into the
 * artifact payload as it lands, so the dossier is readable while it builds and
 * a crashed run resumes without paying twice.
 *
 * Every API call still goes through the DataForSEO gateway in seo.server.ts —
 * same cache, same seo_api_calls log, same real cost from the API envelope.
 * The job row accumulates that cost.
 */
import type {
  Admin,
  ArtifactRow,
  JobRow,
  Json,
  PhaseDef,
  PhaseOutcome,
  TickResult,
} from "./jobs.server";

export const SEO_MODULE = "seo";
export const SEO_STUDY_KIND = "seo_study";
export const SEO_DOSSIER_KIND = "seo_study_dossier";
export const STUDY_BUCKET = "artifacts";

/** Scope caps — these are the cost levers, fixed so the estimate is honest. */
export const STUDY_LIMITS = {
  rankedKeywords: 200,
  competitors: 10,
  gapCompetitors: 3,
  gapRows: 200,
  gapMinVolume: 50,
  crawlPages: 50,
  issuePages: 100,
} as const;

export interface StudyParams {
  target: string;
  locationCode: number;
  languageCode: string;
  marketLabel: string;
}

// ---------------------------------------------------------------------------
// pre-flight estimate
// ---------------------------------------------------------------------------

/** Worst-case total: every phase fires live (nothing served from cache). */
export async function estimateStudyCost(): Promise<{
  total: number;
  lines: Array<{ label: string; cost: number }>;
}> {
  const seo = await import("./seo.server");
  const L = STUDY_LIMITS;
  const lines = [
    { label: "Domain overview", cost: await seo.estimateFor(seo_endpoints.overview, 1) },
    {
      label: `Ranked keywords (${L.rankedKeywords})`,
      cost: await seo.estimateFor(seo_endpoints.ranked, L.rankedKeywords),
    },
    {
      label: `Competitors (${L.competitors})`,
      cost: await seo.estimateFor(seo_endpoints.competitors, L.competitors),
    },
    {
      label: `Keyword gap (${L.gapCompetitors} competitors)`,
      cost:
        Math.round((await seo.estimateFor(seo_endpoints.gap, L.gapRows)) * L.gapCompetitors * 1e6) /
        1e6,
    },
    { label: "Backlinks summary", cost: await seo.estimateFor(seo_endpoints.backlinks) },
    {
      label: `Site crawl (${L.crawlPages} pages)`,
      cost: await seo.estimateFor(seo_endpoints.crawl),
    },
  ];
  const total = Math.round(lines.reduce((s, l) => s + l.cost, 0) * 1e6) / 1e6;
  return { total, lines };
}

const seo_endpoints = {
  overview: "dataforseo_labs/google/domain_rank_overview/live",
  ranked: "dataforseo_labs/google/ranked_keywords/live",
  competitors: "dataforseo_labs/google/competitors_domain/live",
  gap: "dataforseo_labs/google/domain_intersection/live",
  backlinks: "backlinks/summary/live",
  crawl: "on_page/task_post",
  crawlSummary: "on_page/summary",
  crawlPages: "on_page/pages",
} as const;

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function normaliseDomain(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

/** Gateway wrapper: forces the confirm-overage path (the total was approved). */
async function call<T>(args: {
  userId: string;
  endpoint: string;
  path: string;
  method?: "GET" | "POST";
  task?: Rec;
  summary?: Rec;
  ttlMs: number;
  metered?: boolean;
  estimatedCost?: number;
  returnTaskEnvelope?: boolean;
}): Promise<{ data: T; cost: number }> {
  const seo = await import("./seo.server");
  const res = await seo.dataforseoCall<T>({
    userId: args.userId,
    endpoint: args.endpoint,
    path: args.path,
    ...(args.method ? { method: args.method } : {}),
    ...(args.task ? { task: args.task } : {}),
    summary: { study: true, ...(args.summary ?? {}) } as never,
    ttlMs: args.ttlMs,
    ...(args.metered === false ? { metered: false } : {}),
    estimatedCost: args.estimatedCost ?? 0,
    // The admin approved the study's total before it started; individual
    // phases must not stall on the per-user daily soft cap.
    confirmOverage: true,
    ...(args.returnTaskEnvelope ? { returnTaskEnvelope: true } : {}),
  });
  if (res.status !== "ok") throw new Error("Blocked by the daily spend cap.");
  return { data: res.data, cost: res.cost };
}

// ---------------------------------------------------------------------------
// the phases
// ---------------------------------------------------------------------------

export interface OverviewData {
  organicKeywords: number | null;
  organicEtv: number | null;
  paidKeywords: number | null;
  pos1_3: number | null;
  pos4_10: number | null;
  pos11_100: number | null;
}

export interface KeywordRow {
  keyword: string;
  position: number | null;
  volume: number | null;
  etv: number | null;
  cpc: number | null;
  url: string | null;
}

export interface CompetitorRow {
  domain: string;
  intersections: number | null;
  avgPosition: number | null;
  keywords: number | null;
  etv: number | null;
}

export interface GapRow {
  competitor: string;
  keyword: string;
  volume: number | null;
  cpc: number | null;
  competitorPosition: number | null;
  yourPosition: number | null;
}

export interface BacklinksData {
  rank: number | null;
  backlinks: number | null;
  referringDomains: number | null;
  referringMainDomains: number | null;
  brokenBacklinks: number | null;
  spamScore: number | null;
  firstSeen: string | null;
}

export interface OnPageIssue {
  check: string;
  label: string;
  pages: number;
  severity: "high" | "medium" | "low";
}

export interface OnPageData {
  pagesCrawled: number | null;
  pagesInQueue: number | null;
  onPageScore: number | null;
  brokenPages: number | null;
  brokenResources: number | null;
  duplicateTitle: number | null;
  duplicateDescription: number | null;
  issues: OnPageIssue[];
  slowestPages: Array<{ url: string; ms: number | null }>;
  strongestPages: Array<{ url: string; words: number | null; internalLinks: number | null }>;
}

export interface SynthesisData {
  headline: string[];
  trafficEstimate: number | null;
  topOpportunities: Array<{
    keyword: string;
    volume: number | null;
    competitor: string;
    cpc: number | null;
  }>;
  topIssues: Array<{ label: string; pages: number; severity: string }>;
  strongestPages: Array<{ url: string; note: string }>;
  weakestPages: Array<{ url: string; note: string }>;
}

/** The checks we surface, with a human label and a severity weight. */
const ISSUE_CHECKS: Array<{ key: string; label: string; severity: "high" | "medium" | "low" }> = [
  { key: "no_title", label: "Pages with no title", severity: "high" },
  { key: "no_description", label: "Pages with no meta description", severity: "high" },
  { key: "duplicate_title", label: "Duplicate titles", severity: "high" },
  { key: "duplicate_description", label: "Duplicate meta descriptions", severity: "medium" },
  { key: "duplicate_content", label: "Duplicate content", severity: "high" },
  { key: "no_h1_tag", label: "Pages without an H1", severity: "medium" },
  { key: "title_too_long", label: "Titles too long", severity: "low" },
  { key: "title_too_short", label: "Titles too short", severity: "low" },
  { key: "is_broken", label: "Broken pages (4xx/5xx)", severity: "high" },
  { key: "is_4xx_code", label: "Pages returning 4xx", severity: "high" },
  { key: "is_5xx_code", label: "Pages returning 5xx", severity: "high" },
  { key: "is_redirect", label: "Redirecting pages", severity: "low" },
  { key: "canonical_to_broken", label: "Canonical pointing to a broken page", severity: "high" },
  { key: "no_image_alt", label: "Images without alt text", severity: "medium" },
  { key: "low_content_rate", label: "Thin content pages", severity: "medium" },
  { key: "high_loading_time", label: "Slow pages", severity: "medium" },
  { key: "large_page_size", label: "Oversized pages", severity: "low" },
  { key: "no_favicon", label: "Missing favicon", severity: "low" },
  { key: "irrelevant_description", label: "Description not matching content", severity: "low" },
  { key: "seo_friendly_url", label: "Non SEO-friendly URLs", severity: "low" },
];

export function studyPhases(userId: string, params: StudyParams): PhaseDef[] {
  const L = STUDY_LIMITS;
  const locale = { location_code: params.locationCode, language_code: params.languageCode };

  return [
    // ---------------- p1 domain overview ----------------
    {
      key: "overview",
      label: "Domain overview",
      run: async () => {
        const seo = await import("./seo.server");
        const { data, cost } = await call<unknown>({
          userId,
          endpoint: seo_endpoints.overview,
          path: `/v3/${seo_endpoints.overview}`,
          task: { target: params.target, ...locale },
          summary: { target: params.target },
          ttlMs: seo.TTL.domain,
          estimatedCost: await seo.estimateFor(seo_endpoints.overview, 1),
        });
        const item = rec(arr(rec(arr(data)[0])["items"])[0]);
        const organic = rec(rec(item["metrics"])["organic"]);
        const paid = rec(rec(item["metrics"])["paid"]);
        const out: OverviewData = {
          organicKeywords: num(organic["count"]),
          organicEtv: num(organic["etv"]),
          paidKeywords: num(paid["count"]),
          pos1_3: (num(organic["pos_1"]) ?? 0) + (num(organic["pos_2_3"]) ?? 0) || null,
          pos4_10: num(organic["pos_4_10"]),
          pos11_100:
            (num(organic["pos_11_20"]) ?? 0) +
              (num(organic["pos_21_30"]) ?? 0) +
              (num(organic["pos_31_40"]) ?? 0) +
              (num(organic["pos_41_50"]) ?? 0) +
              (num(organic["pos_51_60"]) ?? 0) +
              (num(organic["pos_61_70"]) ?? 0) +
              (num(organic["pos_71_80"]) ?? 0) +
              (num(organic["pos_81_90"]) ?? 0) +
              (num(organic["pos_91_100"]) ?? 0) || null,
        };
        return { kind: "done", data: out as unknown as Json, cost };
      },
    },

    // ---------------- p2 ranked keywords ----------------
    {
      key: "keywords",
      label: "Ranked keywords",
      run: async () => {
        const seo = await import("./seo.server");
        const { data, cost } = await call<unknown>({
          userId,
          endpoint: seo_endpoints.ranked,
          path: `/v3/${seo_endpoints.ranked}`,
          task: {
            target: params.target,
            ...locale,
            limit: L.rankedKeywords,
            order_by: ["ranked_serp_element.serp_item.etv,desc"],
          },
          summary: { target: params.target, limit: L.rankedKeywords },
          ttlMs: seo.TTL.domain,
          estimatedCost: await seo.estimateFor(seo_endpoints.ranked, L.rankedKeywords),
        });
        const result = rec(arr(data)[0]);
        const rows: KeywordRow[] = arr(result["items"]).map((raw) => {
          const it = rec(raw);
          const kd = rec(it["keyword_data"]);
          const info = rec(kd["keyword_info"]);
          const serp = rec(rec(it["ranked_serp_element"])["serp_item"]);
          return {
            keyword: str(kd["keyword"]) ?? "",
            position: num(serp["rank_group"]),
            volume: num(info["search_volume"]),
            etv: num(serp["etv"]),
            cpc: num(info["cpc"]),
            url: str(serp["url"]),
          };
        });
        return {
          kind: "done",
          data: { totalCount: num(result["total_count"]), rows } as unknown as Json,
          cost,
        };
      },
    },

    // ---------------- p3 competitors ----------------
    {
      key: "competitors",
      label: "Competitors",
      run: async () => {
        const seo = await import("./seo.server");
        const { data, cost } = await call<unknown>({
          userId,
          endpoint: seo_endpoints.competitors,
          path: `/v3/${seo_endpoints.competitors}`,
          task: {
            target: params.target,
            ...locale,
            limit: L.competitors,
            order_by: ["intersections,desc"],
          },
          summary: { target: params.target, limit: L.competitors },
          ttlMs: seo.TTL.domain,
          estimatedCost: await seo.estimateFor(seo_endpoints.competitors, L.competitors),
        });
        const rows: CompetitorRow[] = arr(rec(arr(data)[0])["items"])
          .map((raw) => {
            const it = rec(raw);
            const organic = rec(rec(it["full_domain_metrics"])["organic"]);
            return {
              domain: str(it["domain"]) ?? "",
              intersections: num(it["intersections"]),
              avgPosition: num(it["avg_position"]),
              keywords: num(organic["count"]),
              etv: num(organic["etv"]),
            };
          })
          .filter((r) => r.domain && r.domain !== params.target);
        return { kind: "done", data: { rows } as unknown as Json, cost };
      },
    },

    // ---------------- p4 keyword gap ----------------
    {
      key: "gap",
      label: "Keyword gap",
      run: async ({ artifact }) => {
        const seo = await import("./seo.server");
        const competitors = (
          rec(artifact.payload.sections["competitors"]?.data)["rows"] as CompetitorRow[] | undefined
        )?.slice(0, L.gapCompetitors);
        if (!competitors || competitors.length === 0) {
          throw new Error("No competitors available to compare against.");
        }
        let cost = 0;
        const rows: GapRow[] = [];
        // One call per competitor — the API compares two domains at a time.
        // Never a loop over keywords.
        for (const competitor of competitors) {
          const res = await call<unknown>({
            userId,
            endpoint: seo_endpoints.gap,
            path: `/v3/${seo_endpoints.gap}`,
            task: {
              // target1 ranks, target2 does not → the opportunities.
              target1: competitor.domain,
              target2: params.target,
              intersections: false,
              ...locale,
              limit: L.gapRows,
              order_by: ["keyword_data.keyword_info.search_volume,desc"],
              filters: [["keyword_data.keyword_info.search_volume", ">=", L.gapMinVolume]],
            },
            summary: { competitor: competitor.domain, you: params.target },
            ttlMs: seo.TTL.domain,
            estimatedCost: await seo.estimateFor(seo_endpoints.gap, L.gapRows),
          });
          cost += res.cost;
          for (const raw of arr(rec(arr(res.data)[0])["items"])) {
            const it = rec(raw);
            const kd = rec(it["keyword_data"]);
            const info = rec(kd["keyword_info"]);
            rows.push({
              competitor: competitor.domain,
              keyword: str(kd["keyword"]) ?? "",
              volume: num(info["search_volume"]),
              cpc: num(info["cpc"]),
              competitorPosition: num(rec(it["first_domain_serp_element"])["rank_group"]),
              yourPosition: num(rec(it["second_domain_serp_element"])["rank_group"]),
            });
          }
        }
        rows.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
        return {
          kind: "done",
          data: {
            minVolume: L.gapMinVolume,
            competitors: competitors.map((c) => c.domain),
            rows,
          } as unknown as Json,
          cost: Math.round(cost * 1e6) / 1e6,
        };
      },
    },

    // ---------------- p5 backlinks ----------------
    {
      key: "backlinks",
      label: "Backlinks",
      run: async () => {
        const seo = await import("./seo.server");
        const { data, cost } = await call<unknown>({
          userId,
          endpoint: seo_endpoints.backlinks,
          path: `/v3/${seo_endpoints.backlinks}`,
          task: { target: params.target, internal_list_limit: 10, backlinks_status_type: "live" },
          summary: { target: params.target },
          ttlMs: seo.TTL.backlinks,
          estimatedCost: await seo.estimateFor(seo_endpoints.backlinks),
        });
        const it = rec(arr(data)[0]);
        const out: BacklinksData = {
          rank: num(it["rank"]),
          backlinks: num(it["backlinks"]),
          referringDomains: num(it["referring_domains"]),
          referringMainDomains: num(it["referring_main_domains"]),
          brokenBacklinks: num(it["broken_backlinks"]),
          spamScore: num(it["backlinks_spam_score"]),
          firstSeen: str(it["first_seen"]),
        };
        return { kind: "done", data: out as unknown as Json, cost };
      },
    },

    // ---------------- p6 OnPage crawl (async, resumes across ticks) --------
    {
      key: "onpage",
      label: "Technical crawl",
      run: async ({ state }) => {
        const seo = await import("./seo.server");
        let taskId = typeof state["taskId"] === "string" ? state["taskId"] : null;
        let cost = 0;

        // Step 1 — post the crawl once. The id lives in the section state, so
        // a resumed job never posts (and never pays for) a second crawl.
        if (!taskId) {
          const posted = await call<unknown>({
            userId,
            endpoint: seo_endpoints.crawl,
            path: "/v3/on_page/task_post",
            task: {
              target: params.target,
              max_crawl_pages: L.crawlPages,
              load_resources: false,
              enable_javascript: false,
              respect_sitemap: true,
              tag: "flysales-seo-study",
            },
            summary: { target: params.target, pages: L.crawlPages },
            ttlMs: 0,
            estimatedCost: await seo.estimateFor(seo_endpoints.crawl),
            returnTaskEnvelope: true,
          });
          cost += posted.cost;
          taskId = str(rec(posted.data)["id"]);
          if (!taskId) throw new Error("DataForSEO did not return a crawl task id.");
          return { kind: "wait", state: { taskId, postedAt: new Date().toISOString() }, cost };
        }

        // How long we have been waiting; the crawl is abandoned after 20 min
        // rather than holding the job forever.
        const postedAt = typeof state["postedAt"] === "string" ? Date.parse(state["postedAt"]) : 0;
        const timedOut = postedAt > 0 && Date.now() - postedAt > 20 * 60_000;
        const keepWaiting = (extra: Record<string, Json>): PhaseOutcome => {
          if (timedOut) throw new Error("The site crawl did not finish within 20 minutes.");
          return { kind: "wait", state: { ...state, taskId: taskId!, ...extra }, cost };
        };

        // Step 2 — poll the (free) summary until the crawl finishes. While the
        // task sits in DataForSEO's queue the endpoint answers with a "task in
        // queue" status rather than data: that is waiting, not a failure.
        let summary: { data: unknown };
        try {
          summary = await call<unknown>({
            userId,
            endpoint: seo_endpoints.crawlSummary,
            path: `/v3/on_page/summary/${taskId}`,
            method: "GET",
            metered: false,
            ttlMs: 0,
            summary: { taskId },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/in queue|handed|in progress|not ready/i.test(message)) return keepWaiting({});
          throw error;
        }
        const result = rec(arr(summary.data)[0]);
        const progress = str(result["crawl_progress"]);
        const crawlStatus = rec(result["crawl_status"]);

        if (progress !== "finished") {
          return keepWaiting({
            pagesCrawled: num(crawlStatus["pages_crawled"]),
            pagesInQueue: num(crawlStatus["pages_in_queue"]),
          });
        }

        // Step 3 — the crawl is done: aggregate checks (free) + page list (free).
        const metrics = rec(rec(result["page_metrics"]));
        const checks = rec(metrics["checks"]);
        const issues: OnPageIssue[] = ISSUE_CHECKS.map((c) => ({
          check: c.key,
          label: c.label,
          pages: num(checks[c.key]) ?? 0,
          severity: c.severity,
        }))
          .filter((i) => i.pages > 0)
          .sort((a, b) => {
            const weight = { high: 0, medium: 1, low: 2 } as const;
            return weight[a.severity] - weight[b.severity] || b.pages - a.pages;
          });

        const pages = await call<unknown>({
          userId,
          endpoint: seo_endpoints.crawlPages,
          path: "/v3/on_page/pages",
          task: { id: taskId, limit: L.issuePages },
          metered: false,
          ttlMs: 0,
          summary: { taskId },
        });
        const pageItems = arr(rec(arr(pages.data)[0])["items"]).map((raw) => {
          const p = rec(raw);
          const meta = rec(p["meta"]);
          const content = rec(meta["content"]);
          return {
            url: str(p["url"]) ?? "",
            ms: num(rec(p["page_timing"])["duration_time"]),
            words: num(content["plain_text_word_count"]),
            internalLinks: num(meta["internal_links_count"]),
            score: num(p["onpage_score"]),
          };
        });

        const out: OnPageData = {
          pagesCrawled: num(crawlStatus["pages_crawled"]),
          pagesInQueue: num(crawlStatus["pages_in_queue"]),
          onPageScore: num(metrics["onpage_score"]),
          brokenPages: num(metrics["broken_pages"]),
          brokenResources: num(metrics["broken_resources"]),
          duplicateTitle: num(metrics["duplicate_title"]),
          duplicateDescription: num(metrics["duplicate_description"]),
          issues,
          slowestPages: [...pageItems]
            .filter((p) => p.ms != null)
            .sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0))
            .slice(0, 5)
            .map((p) => ({ url: p.url, ms: p.ms })),
          strongestPages: [...pageItems]
            .sort((a, b) => (b.words ?? 0) - (a.words ?? 0))
            .slice(0, 5)
            .map((p) => ({ url: p.url, words: p.words, internalLinks: p.internalLinks })),
        };
        return { kind: "done", data: out as unknown as Json, cost };
      },
    },

    // ---------------- p7 synthesis (free, local) ----------------
    {
      key: "synthesis",
      label: "Synthesis",
      run: async ({ artifact }) => {
        const s = artifact.payload.sections;
        const overview = (s["overview"]?.data ?? null) as OverviewData | null;
        const keywords = rec(s["keywords"]?.data)["rows"] as KeywordRow[] | undefined;
        const competitors = rec(s["competitors"]?.data)["rows"] as CompetitorRow[] | undefined;
        const gap = rec(s["gap"]?.data)["rows"] as GapRow[] | undefined;
        const backlinks = (s["backlinks"]?.data ?? null) as BacklinksData | null;
        const onpage = (s["onpage"]?.data ?? null) as OnPageData | null;

        const topOpportunities = (gap ?? [])
          .filter((g) => g.yourPosition == null)
          .slice(0, 15)
          .map((g) => ({
            keyword: g.keyword,
            volume: g.volume,
            competitor: g.competitor,
            cpc: g.cpc,
          }));

        const topIssues = (onpage?.issues ?? [])
          .slice(0, 10)
          .map((i) => ({ label: i.label, pages: i.pages, severity: i.severity }));

        const ranked = [...(keywords ?? [])];
        const strongestPages = Object.entries(
          ranked.reduce<Record<string, number>>((acc, k) => {
            if (!k.url) return acc;
            acc[k.url] = (acc[k.url] ?? 0) + (k.etv ?? 0);
            return acc;
          }, {}),
        )
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([url, etv]) => ({
            url,
            note: `~${Math.round(etv)} estimated visits/month from organic`,
          }));

        const weakestPages = (onpage?.slowestPages ?? [])
          .slice(0, 5)
          .map((p) => ({ url: p.url, note: `slow to load (${p.ms ?? "?"} ms)` }));

        const headline: string[] = [];
        if (overview?.organicKeywords != null) {
          headline.push(
            `${params.target} ranks for ${overview.organicKeywords.toLocaleString("en-US")} organic keywords in ${params.marketLabel}.`,
          );
        }
        if (overview?.organicEtv != null) {
          headline.push(
            `Estimated organic traffic: ~${Math.round(overview.organicEtv).toLocaleString("en-US")} visits/month.`,
          );
        }
        if (competitors?.length) {
          headline.push(
            `Top competing domains: ${competitors
              .slice(0, 3)
              .map((c) => c.domain)
              .join(", ")}.`,
          );
        }
        if (topOpportunities.length) {
          const volume = topOpportunities.reduce((sum, o) => sum + (o.volume ?? 0), 0);
          headline.push(
            `${topOpportunities.length} high-volume keywords competitors rank for and ${params.target} does not — ~${volume.toLocaleString("en-US")} searches/month unclaimed.`,
          );
        }
        if (backlinks?.referringDomains != null) {
          headline.push(
            `${backlinks.referringDomains.toLocaleString("en-US")} referring domains, ${(backlinks.backlinks ?? 0).toLocaleString("en-US")} backlinks.`,
          );
        }
        if (topIssues.length) {
          headline.push(
            `Largest technical issue: ${topIssues[0]!.label} on ${topIssues[0]!.pages} pages.`,
          );
        }

        const out: SynthesisData = {
          headline,
          trafficEstimate: overview?.organicEtv ?? null,
          topOpportunities,
          topIssues,
          strongestPages,
          weakestPages,
        };
        return { kind: "done", data: out as unknown as Json, cost: 0 };
      },
    },
  ];
}

export const STUDY_PHASE_COUNT = 7;

// ---------------------------------------------------------------------------
// the tick — one unit of orchestration work
// ---------------------------------------------------------------------------

/**
 * Advance at most one study. Safe to call from the cron and from an open
 * dossier at the same time: the lease makes the second caller a no-op.
 */
export async function tickStudies(admin: Admin, jobId?: string): Promise<TickResult> {
  const jobs = await import("./jobs.server");
  const LEASE_MS = 5 * 60_000;

  const job = await jobs.claimNextJob(admin, {
    module: SEO_MODULE,
    kind: SEO_STUDY_KIND,
    leaseMs: LEASE_MS,
    ...(jobId ? { jobId } : {}),
  });
  if (!job) {
    return {
      jobId: null,
      status: "idle",
      phase: null,
      progress: 0,
      ranPhases: [],
      waiting: false,
      totalCost: 0,
    };
  }

  await jobs.incrementAttempts(admin, job.id, job.attempts);

  const params = job.params as unknown as StudyParams;
  const userId = job.created_by;
  if (!userId) {
    await jobs.updateJob(admin, job.id, {
      status: "failed",
      error: "The study has no owner to bill the API calls to.",
      finishedAt: new Date().toISOString(),
      releaseLease: true,
    });
    throw new Error("Study job has no created_by.");
  }

  const { logAppError } = await import("./ops.server");
  return jobs.runPhases(admin, job, studyPhases(userId, params), {
    // Well inside the platform request budget; the next tick picks up the rest.
    budgetMs: 40_000,
    leaseMs: LEASE_MS,
    onError: (phase, error) => {
      void logAppError(admin, { job: `seo-study:${phase}`, context: { jobId: job.id }, error });
    },
  });
}

// ---------------------------------------------------------------------------
// dossier read model
// ---------------------------------------------------------------------------

export interface StudySummary {
  id: string;
  target: string;
  market: string;
  status: JobRow["status"];
  phase: string | null;
  progress: number;
  totalCost: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  hasPdf: boolean;
}

export async function listStudies(admin: Admin, limit = 50): Promise<StudySummary[]> {
  const { data, error } = await admin
    .from("jobs")
    .select(
      "id, status, phase, progress_pct, total_cost, error, params, created_at, finished_at, artifacts(storage_ref)",
    )
    .eq("module", SEO_MODULE)
    .eq("kind", SEO_STUDY_KIND)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const params = rec(row.params);
    const artifacts = arr((row as unknown as Rec)["artifacts"]);
    return {
      id: row.id,
      target: str(params["target"]) ?? "—",
      market: str(params["marketLabel"]) ?? "—",
      status: row.status as JobRow["status"],
      phase: row.phase,
      progress: row.progress_pct,
      totalCost: Number(row.total_cost ?? 0),
      error: row.error,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
      hasPdf: artifacts.some((a) => Boolean(rec(a)["storage_ref"])),
    };
  });
}

export interface StudyDossier {
  job: StudySummary;
  artifactId: string;
  storageRef: string | null;
  sections: ArtifactRow["payload"]["sections"];
}

export async function getStudy(admin: Admin, jobId: string): Promise<StudyDossier | null> {
  const { data, error } = await admin
    .from("jobs")
    .select("id, status, phase, progress_pct, total_cost, error, params, created_at, finished_at")
    .eq("id", jobId)
    .eq("kind", SEO_STUDY_KIND)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const jobsLib = await import("./jobs.server");
  const artifact = await jobsLib.getArtifact(admin, jobId);
  const params = rec(data.params);
  return {
    job: {
      id: data.id,
      target: str(params["target"]) ?? "—",
      market: str(params["marketLabel"]) ?? "—",
      status: data.status as JobRow["status"],
      phase: data.phase,
      progress: data.progress_pct,
      totalCost: Number(data.total_cost ?? 0),
      error: data.error,
      createdAt: data.created_at,
      finishedAt: data.finished_at,
      hasPdf: Boolean(artifact?.storage_ref),
    },
    artifactId: artifact?.id ?? "",
    storageRef: artifact?.storage_ref ?? null,
    sections: artifact?.payload.sections ?? {},
  };
}
