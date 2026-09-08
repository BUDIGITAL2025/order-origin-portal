/**
 * SpyMarket — WinningHunter Ad Library (phase 1 of the provider migration).
 * ADMIN-ONLY. Runs alongside the TrendTrack tabs, which are untouched.
 *
 * Discipline (same as the TrendTrack side):
 *  - Nothing fires on render. Every paid call needs a click.
 *  - The cost is shown BEFORE the call: WinningHunter charges a flat 1 credit
 *    per page whatever the page size, so we always request the biggest page
 *    the endpoint allows.
 *  - One call per action, never a loop: paging is a manual "Next page" click.
 *  - Repeats inside 24h are served from our cache and cost nothing.
 */
import * as React from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Download,
  ExternalLink,
  Loader2,
  Maximize2,
  Play,
  RefreshCw,
  Search,
  Wallet,
} from "lucide-react";
import { getWhStatus, whSearchAds } from "@/lib/winninghunter.functions";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// Defensive accessors — WinningHunter cards are legacy dashboard payloads with
// inconsistent key casing, and the shape differs per network.
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const pickStr = (rec: Rec, keys: string[]): string | null => {
  for (const k of keys) {
    const v = str(rec[k]);
    if (v) return v;
  }
  return null;
};
const pickNum = (rec: Rec, keys: string[]): number | null => {
  for (const k of keys) {
    const v = num(rec[k]);
    if (v != null) return v;
  }
  return null;
};
const fmtInt = (v: number | null): string => (v == null ? "—" : v.toLocaleString("en"));
const fmtCompact = (v: number | null): string =>
  v == null ? "—" : new Intl.NumberFormat("en", { notation: "compact" }).format(v);

/** Rows across the shapes their four ad endpoints return. */
function rowsOf(payload: unknown): Rec[] {
  if (Array.isArray(payload)) return payload.map(asRec);
  const rec = asRec(payload);
  for (const key of ["data", "results", "items"]) {
    const v = rec[key];
    if (Array.isArray(v)) return v.map(asRec);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Platforms
// ---------------------------------------------------------------------------

type Platform = "meta" | "tiktok" | "pinterest" | "google";

const PLATFORMS: ReadonlyArray<{ id: Platform; label: string; maxLimit: number }> = [
  { id: "meta", label: "Meta", maxLimit: 50 },
  { id: "tiktok", label: "TikTok", maxLimit: 50 },
  { id: "pinterest", label: "Pinterest", maxLimit: 50 },
  { id: "google", label: "Google", maxLimit: 48 },
];

const SORTS: Record<Platform, ReadonlyArray<{ value: string; label: string }>> = {
  meta: [
    { value: "relevance", label: "Best match" },
    { value: "mostrecent", label: "Newest" },
    { value: "longestrunning", label: "Longest running" },
    { value: "adspend", label: "Highest ad spend" },
    { value: "adsetamount", label: "Most ad sets" },
    { value: "reach", label: "Most reach" },
    { value: "pageactiveads", label: "Most active ads on page" },
    { value: "toprank", label: "Top ad rank" },
    { value: "lastseen", label: "Last seen" },
  ],
  tiktok: [
    { value: "likes", label: "Most likes" },
    { value: "shares", label: "Most shares" },
    { value: "comments", label: "Most comments" },
    { value: "adspend", label: "Highest ad spend" },
    { value: "adsetamount", label: "Most ad sets" },
    { value: "daysrunning", label: "Longest running" },
    { value: "datefound", label: "Newest" },
    { value: "lastseen", label: "Last seen" },
  ],
  pinterest: [
    { value: "datefound", label: "Newest" },
    { value: "likes", label: "Most saves" },
    { value: "shares", label: "Most repins" },
    { value: "comments", label: "Most comments" },
    { value: "daysrunning", label: "Longest running" },
    { value: "lastseen", label: "Last seen" },
  ],
  google: [
    { value: "lastseen", label: "Last seen" },
    { value: "firstseen", label: "First seen" },
    { value: "reach", label: "Most reach" },
    { value: "adspend", label: "Highest ad spend" },
    { value: "days_running", label: "Longest running" },
  ],
};

const SCOPES: Record<Platform, ReadonlyArray<{ value: string; label: string }>> = {
  meta: [
    { value: "All", label: "Everything" },
    { value: "adtext", label: "Ad text" },
    { value: "pagename", label: "Page name" },
    { value: "productname", label: "Product name" },
    { value: "landingurl", label: "Landing URL" },
  ],
  tiktok: [
    { value: "All", label: "Everything" },
    { value: "adtext", label: "Ad text" },
    { value: "pagename", label: "Page name" },
    { value: "productname", label: "Product name" },
    { value: "landingurl", label: "Landing URL" },
  ],
  pinterest: [
    { value: "All", label: "Everything" },
    { value: "adtext", label: "Ad text" },
    { value: "pagename", label: "Page name" },
    { value: "productname", label: "Product name" },
    { value: "storeurl", label: "Store URL" },
  ],
  google: [
    { value: "All", label: "Everything" },
    { value: "adtext", label: "Ad text" },
    { value: "landingurl", label: "Landing URL" },
  ],
};

const MEDIA_TYPES: Record<Platform, ReadonlyArray<{ value: string; label: string }>> = {
  meta: [
    { value: "all", label: "Any media" },
    { value: "video", label: "Video" },
    { value: "image", label: "Image" },
    { value: "carousel", label: "Carousel" },
  ],
  tiktok: [{ value: "all", label: "Any media" }],
  pinterest: [{ value: "all", label: "Any media" }],
  google: [
    { value: "all", label: "Any media" },
    { value: "video", label: "Video" },
    { value: "image", label: "Image" },
    { value: "text", label: "Text" },
  ],
};

// ---------------------------------------------------------------------------
// Normalised card
// ---------------------------------------------------------------------------

interface WhAd {
  key: string;
  advertiser: string | null;
  logo: string | null;
  copy: string | null;
  headline: string | null;
  thumb: string | null;
  video: string | null;
  isVideo: boolean;
  landingUrl: string | null;
  domain: string | null;
  daysRunning: number | null;
  activeAds: number | null;
  adSpend: number | null;
  adRank: number | null;
  adScore: string | null;
  started: string | null;
  lastSeen: string | null;
  engagement: Array<{ label: string; value: number }>;
}

function normalise(row: Rec, platform: Platform, index: number): WhAd {
  const video = pickStr(row, ["video", "video_url", "videoUrl", "media_url_video"]);
  const image = pickStr(row, [
    "image",
    "image_url",
    "poster",
    "thumbnail",
    "thumbnail_url",
    "creative_image",
  ]);
  const media = pickStr(row, ["media_url", "mediaUrl"]);
  const mediaType = pickStr(row, ["media_type", "mediaType", "format"]);
  const isVideo = !!video || mediaType === "video" || (media != null && /\.mp4(\?|$)/i.test(media));
  const engagement: Array<{ label: string; value: number }> = [];
  const push = (label: string, keys: string[]) => {
    const v = pickNum(row, keys);
    if (v != null) engagement.push({ label, value: v });
  };
  if (platform === "tiktok") {
    push("likes", ["likes", "like_count", "digg_count"]);
    push("comments", ["comments", "comment_count"]);
    push("shares", ["shares", "share_count"]);
  }
  if (platform === "pinterest") {
    push("saves", ["save_count", "likes"]);
    push("repins", ["repin_count", "shares"]);
    push("comments", ["comments", "comment_count"]);
  }
  if (platform === "meta" || platform === "google") {
    push("reach", ["reach", "total_reach", "estimated_reach"]);
  }

  return {
    key:
      pickStr(row, ["productid", "ad_id", "id", "doc_id", "creative_id", "pin_url"]) ??
      `${platform}-${index}`,
    advertiser: pickStr(row, [
      "pageName",
      "page_name",
      "promoter_username",
      "advertiser_name",
      "advertiser",
      "brand_name",
    ]),
    logo: pickStr(row, ["page_logo", "pageLogo", "logo", "logo_url", "avatar", "page_image"]),
    copy: pickStr(row, ["copy", "caption", "text", "ad_text", "description", "body"]),
    headline: pickStr(row, ["title", "headline", "ad_title", "product_name", "productName"]),
    thumb: image ?? (isVideo ? pickStr(row, ["poster"]) : media) ?? media,
    video: video ?? (isVideo ? media : null),
    isVideo,
    landingUrl: pickStr(row, ["urlStore", "url_store", "landing_url", "pin_url", "page_url", "url"]),
    domain: pickStr(row, ["domain", "store_domain", "shop_domain", "advertiser_domain"]),
    daysRunning: pickNum(row, ["daysrunning", "days_running", "daysRunning"]),
    activeAds: pickNum(row, ["total_active_ads_on_page", "countActive", "active_ads"]),
    adSpend: pickNum(row, ["total_adspend", "adspend", "ad_spend", "estimated_spend"]),
    adRank: pickNum(row, ["ad_rank", "adrank"]),
    adScore: pickStr(row, ["adscore", "ad_score"]),
    started: pickStr(row, ["started", "start_date", "first_seen", "datefound"]),
    lastSeen: pickStr(row, ["lastSeen", "last_seen", "lastseen"]),
    engagement,
  };
}

// ---------------------------------------------------------------------------
// Filters state
// ---------------------------------------------------------------------------

interface WhFilters {
  platform: Platform;
  keyword: string;
  scope: string;
  countries: string;
  sorting: string;
  mediaType: string;
  activeStatus: string;
  minAdSpend: string;
  minAdSets: string;
  minDays: string;
  createdFrom: string;
  limit: number;
}

function defaultFilters(platform: Platform): WhFilters {
  return {
    platform,
    keyword: "",
    scope: "All",
    countries: "",
    sorting: SORTS[platform][0]?.value ?? "",
    mediaType: "all",
    activeStatus: "all",
    minAdSpend: "",
    minAdSets: "",
    minDays: "",
    createdFrom: "",
    limit: platform === "google" ? 24 : 24,
  };
}

type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "ok";
      ads: WhAd[];
      raw: unknown;
      creditsCost: number;
      cacheHit: boolean;
      creditsRemaining: number | null;
      scroll: string | null;
      page: number;
    }
  | { kind: "exhausted"; message: string; remaining: number | null; purchaseUrl: string | null }
  | { kind: "rate_limited"; message: string }
  | { kind: "error"; message: string };

interface CreativeTarget {
  label: string;
  thumb: string | null;
  video: string | null;
  isVideo: boolean;
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

export function WhAdLibraryTab({
  url,
  go,
}: {
  url: Record<string, string | undefined>;
  go: (patch: Record<string, string | undefined>, opts?: { push?: boolean }) => void;
}) {
  const initialPlatform = (PLATFORMS.find((p) => p.id === url["whp"])?.id ?? "meta") as Platform;
  const [filters, setFilters] = React.useState<WhFilters>(() => ({
    ...defaultFilters(initialPlatform),
    keyword: url["whq"] ?? "",
  }));
  const [state, setState] = React.useState<SearchState>({ kind: "idle" });
  const [preview, setPreview] = React.useState<CreativeTarget | null>(null);
  const searchFn = useServerFn(whSearchAds);
  const queryClient = useQueryClient();

  const platformSpec = PLATFORMS.find((p) => p.id === filters.platform) ?? PLATFORMS[0]!;
  const set = <K extends keyof WhFilters>(key: K, value: WhFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const switchPlatform = (platform: Platform) => {
    setFilters((f) => ({ ...defaultFilters(platform), keyword: f.keyword, countries: f.countries }));
    setState({ kind: "idle" });
    go({ whp: platform });
  };

  /** ONE page per click — never a loop. */
  const run = React.useCallback(
    async (opts: { page: number; scroll: string | null }) => {
      setState({ kind: "loading" });
      const numeric = (v: string): number | undefined => {
        const n = Number(v);
        return v.trim() !== "" && Number.isFinite(n) ? n : undefined;
      };
      try {
        const result = await searchFn({
          data: {
            platform: filters.platform,
            keyword: filters.keyword.trim() || undefined,
            searchScope: filters.scope !== "All" ? filters.scope : undefined,
            countries: filters.countries.trim() || undefined,
            sorting: filters.sorting || undefined,
            sortDirection: "desc" as const,
            mediaType: filters.mediaType !== "all" ? filters.mediaType : undefined,
            activeStatus: filters.activeStatus !== "all" ? filters.activeStatus : undefined,
            minAdSpend: numeric(filters.minAdSpend),
            minAdSets: numeric(filters.minAdSets),
            minDaysRunning: numeric(filters.minDays),
            createdFrom: filters.createdFrom || undefined,
            limit: filters.limit,
            page: opts.page,
            scroll: opts.scroll ?? undefined,
          },
        });
        void queryClient.invalidateQueries({ queryKey: ["wh-status"] });
        if (result.status === "exhausted") {
          setState({
            kind: "exhausted",
            message: result.message,
            remaining: result.remaining,
            purchaseUrl: result.purchaseUrl,
          });
          return;
        }
        if (result.status === "rate_limited") {
          setState({ kind: "rate_limited", message: result.message });
          return;
        }
        const rows = rowsOf(result.data);
        setState({
          kind: "ok",
          ads: rows.map((r, i) => normalise(r, filters.platform, i)),
          raw: result.data,
          creditsCost: result.creditsCost,
          cacheHit: result.cacheHit,
          creditsRemaining: result.creditsRemaining,
          scroll: str(asRec(result.data)["scroll"]),
          page: opts.page,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Request failed";
        setState({
          kind: "error",
          message:
            message === "WINNINGHUNTER_NOT_CONFIGURED"
              ? "WINNINGHUNTER_API_KEY is not configured."
              : message === "WINNINGHUNTER_TIMEOUT"
                ? "WinningHunter did not answer within 30s. No credits were charged — try again."
                : message,
        });
      }
    },
    [filters, searchFn, queryClient],
  );

  const total = state.kind === "ok" ? num(asRec(state.raw)["total"]) : null;

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <Search className="h-4 w-4 text-primary" />
            Ad library — WinningHunter
            <Badge variant="secondary" className="rounded-full text-[10px]">
              4 networks
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Platform selector — the coverage TrendTrack never had. */}
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <Button
                key={p.id}
                size="sm"
                variant={filters.platform === p.id ? "default" : "outline"}
                className="rounded-full"
                onClick={() => switchPlatform(p.id)}
              >
                {p.label}
              </Button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <Label className="text-xs">Keyword</Label>
              <Input
                value={filters.keyword}
                placeholder="product, brand, angle…"
                onChange={(e) => set("keyword", e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void run({ page: filters.platform === "google" ? 1 : 0, scroll: null });
                }}
              />
            </div>
            <div>
              <Label className="text-xs">Search in</Label>
              <Select value={filters.scope} onValueChange={(v) => set("scope", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPES[filters.platform].map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Sort by</Label>
              <Select value={filters.sorting} onValueChange={(v) => set("sorting", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORTS[filters.platform].map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">
                Countries {filters.platform === "meta" ? "(ad targeting)" : ""}
              </Label>
              <Input
                value={filters.countries}
                placeholder="US,GB,PT"
                onChange={(e) => set("countries", e.target.value.toUpperCase())}
              />
            </div>
            {MEDIA_TYPES[filters.platform].length > 1 && (
              <div>
                <Label className="text-xs">Media type</Label>
                <Select value={filters.mediaType} onValueChange={(v) => set("mediaType", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEDIA_TYPES[filters.platform].map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={filters.activeStatus} onValueChange={(v) => set("activeStatus", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any status</SelectItem>
                  <SelectItem value="active">Active only</SelectItem>
                  <SelectItem value="inactive">Inactive only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Min ad spend</Label>
              <Input
                inputMode="numeric"
                value={filters.minAdSpend}
                placeholder="e.g. 5000"
                onChange={(e) => set("minAdSpend", e.target.value.replace(/[^\d]/g, ""))}
              />
            </div>
            <div>
              <Label className="text-xs">Min ad sets</Label>
              <Input
                inputMode="numeric"
                value={filters.minAdSets}
                placeholder="e.g. 3"
                onChange={(e) => set("minAdSets", e.target.value.replace(/[^\d]/g, ""))}
              />
            </div>
            <div>
              <Label className="text-xs">Min days running</Label>
              <Input
                inputMode="numeric"
                value={filters.minDays}
                placeholder="e.g. 30"
                onChange={(e) => set("minDays", e.target.value.replace(/[^\d]/g, ""))}
              />
            </div>
            <div>
              <Label className="text-xs">Created after</Label>
              <Input
                type="date"
                value={filters.createdFrom}
                onChange={(e) => set("createdFrom", e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Rows per page</Label>
              <Select
                value={String(filters.limit)}
                onValueChange={(v) => set("limit", Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[12, 24, platformSpec.maxLimit].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} rows
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Cost shown BEFORE firing. */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-xs">
            <Badge variant="secondary" className="rounded-full">
              This search costs 1 credit
            </Badge>
            <span className="text-muted-foreground">
              WinningHunter bills per call, not per row — {filters.limit} rows cost the same as 1.
              Repeats of the exact same search within 24h are served from cache and cost nothing.
            </span>
            <Button
              size="sm"
              className="ml-auto rounded-full"
              disabled={state.kind === "loading"}
              onClick={() => void run({ page: filters.platform === "google" ? 1 : 0, scroll: null })}
            >
              {state.kind === "loading" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="mr-1.5 h-3.5 w-3.5" />
              )}
              Search — 1 credit
            </Button>
          </div>
        </CardContent>
      </Card>

      {state.kind === "exhausted" && (
        <Alert variant="destructive">
          <Wallet className="h-4 w-4" />
          <AlertTitle>No WinningHunter credits left</AlertTitle>
          <AlertDescription>
            {state.message}
            {state.remaining != null && <> Remaining: {fmtInt(state.remaining)}.</>} The call was
            stopped and nothing was retried.
            {state.purchaseUrl && (
              <>
                {" "}
                <a
                  className="font-medium underline"
                  href={state.purchaseUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Buy an add-on
                </a>
              </>
            )}
          </AlertDescription>
        </Alert>
      )}
      {state.kind === "rate_limited" && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Rate limit reached</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>{state.message}</span>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => void run({ page: filters.platform === "google" ? 1 : 0, scroll: null })}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {state.kind === "error" && (
        <Alert variant="destructive">
          <AlertTitle>Call failed</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      {state.kind === "loading" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-72 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {state.kind === "ok" && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary" className="rounded-full">
              Cost: {fmtInt(state.creditsCost)} credit{state.creditsCost === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline" className="rounded-full">
              {fmtInt(state.ads.length)} ads
            </Badge>
            {total != null && (
              <Badge variant="outline" className="rounded-full">
                {fmtCompact(total)} matches
              </Badge>
            )}
            {state.creditsRemaining != null && (
              <Badge variant="outline" className="rounded-full">
                {fmtInt(state.creditsRemaining)} credits left
              </Badge>
            )}
            {state.cacheHit && (
              <Badge className="rounded-full bg-primary/15 text-primary hover:bg-primary/15">
                cache hit — free
              </Badge>
            )}
          </div>

          {state.ads.length === 0 ? (
            <Card className="rounded-2xl">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No ads matched these filters. Widen the keyword or drop a filter and search again.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {state.ads.map((ad) => (
                <WhAdCard
                  key={ad.key}
                  ad={ad}
                  platform={filters.platform}
                  onPreview={setPreview}
                />
              ))}
            </div>
          )}

          {/* Manual paging: one page per click, 1 credit each. */}
          {state.ads.length > 0 && (
            <div className="flex items-center justify-center">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() =>
                  void run({
                    page: state.page + 1,
                    scroll: filters.platform === "google" ? null : state.scroll,
                  })
                }
              >
                Next page — 1 credit
              </Button>
            </div>
          )}
        </>
      )}

      <CreativeLightbox target={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function WhAdCard({
  ad,
  platform,
  onPreview,
}: {
  ad: WhAd;
  platform: Platform;
  onPreview: (t: CreativeTarget) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const platformLabel = PLATFORMS.find((p) => p.id === platform)?.label ?? platform;

  return (
    <Card className="flex flex-col overflow-hidden rounded-2xl">
      <div className="flex min-h-8 flex-wrap items-center gap-1.5 border-b px-3 py-1.5 text-[11px]">
        <Badge variant="outline" className="rounded-full text-[10px]">
          {platformLabel}
        </Badge>
        {ad.daysRunning != null && (
          <Badge variant="secondary" className="rounded-full text-[10px]">
            {fmtInt(ad.daysRunning)}d running
          </Badge>
        )}
        {ad.adRank != null && (
          <Badge className="rounded-full bg-primary/15 text-[10px] text-primary hover:bg-primary/15">
            rank {fmtInt(ad.adRank)}
          </Badge>
        )}
        {ad.adSpend != null && (
          <span className="ml-auto text-muted-foreground">{fmtCompact(ad.adSpend)} spend</span>
        )}
      </div>

      {ad.advertiser && (
        <div className="flex items-center gap-2 px-3 pt-2">
          {ad.logo ? (
            <img
              src={ad.logo}
              alt={ad.advertiser}
              loading="lazy"
              className="h-8 w-8 shrink-0 rounded-full border object-cover"
            />
          ) : (
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold">
              {ad.advertiser.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{ad.advertiser}</p>
            {ad.activeAds != null && (
              <p className="text-[10px] text-muted-foreground">
                {fmtInt(ad.activeAds)} active ads on page
              </p>
            )}
          </div>
          {ad.adScore && (
            <Badge variant="outline" className="shrink-0 rounded-full text-[10px] capitalize">
              {ad.adScore}
            </Badge>
          )}
        </div>
      )}

      <div className="space-y-2 px-3 pt-2">
        {ad.copy && (
          <div>
            <p className={cn("text-xs text-muted-foreground", !expanded && "line-clamp-2")}>
              {ad.copy}
            </p>
            {ad.copy.length > 90 && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-0.5 text-[11px] font-medium text-foreground hover:underline"
              >
                {expanded ? "See less" : "See more"}
              </button>
            )}
          </div>
        )}

        {ad.thumb && (
          <button
            type="button"
            title="Open large preview"
            onClick={() =>
              onPreview({
                label: ad.headline ?? ad.advertiser ?? "Creative preview",
                thumb: ad.thumb,
                video: ad.video,
                isVideo: ad.isVideo,
              })
            }
            className={cn(
              "group relative mx-auto block w-full overflow-hidden rounded-xl bg-muted",
              ad.isVideo ? "aspect-[9/16] max-h-80" : "aspect-square",
            )}
          >
            <img
              src={ad.thumb}
              alt={ad.headline ?? "Ad creative"}
              loading="lazy"
              className="h-full w-full object-cover"
            />
            {ad.isVideo && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="grid h-11 w-11 place-items-center rounded-full bg-background/85 shadow-md">
                  <Play className="ml-0.5 h-4 w-4 fill-foreground text-foreground" />
                </div>
              </div>
            )}
            <span className="pointer-events-none absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-background/85 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
              <Maximize2 className="h-3.5 w-3.5" />
            </span>
          </button>
        )}

        {ad.engagement.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {ad.engagement.map((e) => (
              <Badge key={e.label} variant="outline" className="rounded-full text-[10px]">
                {fmtCompact(e.value)} {e.label}
              </Badge>
            ))}
          </div>
        )}

        {(ad.domain ?? ad.headline ?? ad.landingUrl) && (
          <a
            href={ad.landingUrl ?? "#"}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              if (!ad.landingUrl) e.preventDefault();
            }}
            className="flex items-center gap-2 rounded-xl border bg-muted/40 px-2.5 py-2 transition-colors hover:bg-muted"
          >
            <div className="min-w-0 flex-1">
              {(ad.domain ?? ad.landingUrl) && (
                <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                  {ad.domain ?? ad.landingUrl}
                </p>
              )}
              {ad.headline && <p className="truncate text-xs font-medium">{ad.headline}</p>}
            </div>
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </a>
        )}
      </div>

      <div className="mt-auto flex items-center gap-2 p-3">
        {ad.lastSeen && (
          <span className="text-[10px] text-muted-foreground">last seen {ad.lastSeen}</span>
        )}
        {(ad.video ?? ad.thumb) && (
          <Button asChild variant="outline" size="sm" className="ml-auto rounded-full">
            <a href={(ad.video ?? ad.thumb)!} target="_blank" rel="noreferrer" download>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Creative
            </a>
          </Button>
        )}
      </div>
    </Card>
  );
}

function CreativeLightbox({
  target,
  onClose,
}: {
  target: CreativeTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate text-sm">{target?.label ?? "Creative"}</DialogTitle>
        </DialogHeader>
        {target && (
          <div className="space-y-3">
            {target.isVideo && target.video ? (
              <video
                src={target.video}
                poster={target.thumb ?? undefined}
                controls
                className="max-h-[70vh] w-full rounded-xl bg-black"
              />
            ) : (
              target.thumb && (
                <img
                  src={target.thumb}
                  alt={target.label}
                  className="max-h-[70vh] w-full rounded-xl object-contain"
                />
              )
            )}
            <div className="flex justify-end">
              <Button asChild variant="outline" size="sm" className="rounded-full">
                <a
                  href={(target.video ?? target.thumb) ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  download
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Download creative
                </a>
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Header chips (live alongside the TrendTrack chips)
// ---------------------------------------------------------------------------

export function WhHeaderChips() {
  const statusFn = useServerFn(getWhStatus);
  const queryClient = useQueryClient();
  // Cheap read on mount: our own log only, no provider call.
  const { data } = useQuery({
    queryKey: ["wh-status"],
    staleTime: 30_000,
    queryFn: () => statusFn({ data: { live: false } }),
  });

  if (!data?.configured) return null;

  return (
    <>
      <Badge variant="secondary" className="rounded-full">
        WH:{" "}
        {data.creditsRemaining != null
          ? `${fmtInt(data.creditsRemaining)} credits left`
          : "balance not checked"}
      </Badge>
      <Badge variant="outline" className="rounded-full">
        WH spent today: {fmtInt(data.spentToday)}
      </Badge>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 rounded-full px-2 text-[11px]"
        title="Refresh the WinningHunter balance (their check costs 1 credit, cached 15 min)"
        onClick={async () => {
          await statusFn({ data: { live: true } });
          void queryClient.invalidateQueries({ queryKey: ["wh-status"] });
        }}
      >
        <RefreshCw className="mr-1 h-3 w-3" />
        check (1 credit)
      </Button>
    </>
  );
}

export const WH_AD_PLATFORMS = PLATFORMS;
export type { Platform as WhAdPlatform };
export const whUnusedGuard = asArr;
