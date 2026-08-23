/**
 * Server-only scraping pipeline for quote-form URL previews.
 * Primary: Firecrawl v2. Fallback 1: direct HTML fetch + meta extraction.
 * Fallback 2: Perplexity sonar. Every stage returns null on failure so the
 * caller tries the next one; an overall null becomes a neutral UI card and
 * never blocks quote submission.
 */

export interface PreviewData {
  title: string | null;
  description: string | null;
  imageUrls: string[];
  priceHint: string | null;
  source: "firecrawl" | "fetch" | "perplexity";
}

export interface ScrapeKeys {
  firecrawlKey?: string;
  perplexityKey?: string;
}

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "igsh",
  "spm",
  "scm",
  "ref",
  "ref_",
  "cmpid",
  "campaignid",
  "gad_source",
]);

/** Canonical cache key: lowercase scheme+host, tracking params stripped, remaining params sorted, hash dropped. */
export function normalizeUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  const kept = [...u.searchParams.entries()]
    .filter(([k]) => {
      const key = k.toLowerCase();
      return !key.startsWith("utm_") && !TRACKING_PARAMS.has(key);
    })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const out = new URL(
    `${u.protocol}//${u.hostname.toLowerCase()}${u.port ? `:${u.port}` : ""}${u.pathname}`,
  );
  for (const [k, v] of kept) out.searchParams.append(k, v);

  let s = out.toString();
  if (out.pathname === "/" && kept.length === 0) s = s.replace(/\/$/, "");
  return s;
}

/** Run the pipeline: Firecrawl → direct fetch → Perplexity. */
export async function scrapePreview(url: string, keys: ScrapeKeys): Promise<PreviewData | null> {
  if (keys.firecrawlKey) {
    const hit = await scrapeWithFirecrawl(url, keys.firecrawlKey);
    if (hit) return hit;
  }
  const direct = await scrapeWithFetch(url);
  if (direct) return direct;
  if (keys.perplexityKey) {
    const hit = await scrapeWithPerplexity(url, keys.perplexityKey);
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Primary: Firecrawl v2 (markdown + LLM JSON extraction in one call)
// ---------------------------------------------------------------------------

async function scrapeWithFirecrawl(url: string, apiKey: string): Promise<PreviewData | null> {
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: [
          "markdown",
          {
            type: "json",
            prompt:
              "Extract the product sold on this page: its title, a one-sentence description, the listed price (with currency symbol) if one is visible, and absolute URLs of the main product images.",
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                price: { type: ["string", "null"] },
                images: { type: "array", items: { type: "string" } },
              },
            },
          },
        ],
        onlyMainContent: false,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown>;
    if (body.success !== true) return null;

    const doc = (body.data ?? body) as Record<string, unknown>;
    const meta = (doc.metadata ?? {}) as Record<string, unknown>;
    const json = (doc.json ?? {}) as Record<string, unknown>;
    const markdown = asString(doc.markdown);

    const title =
      asString(json.title) ?? asString(meta.title) ?? asString(meta.ogTitle) ?? null;
    const description =
      asString(json.description) ??
      asString(meta.description) ??
      asString(meta.ogDescription) ??
      null;
    const imageUrls = unique(
      [
        ...asStringArray(json.images),
        asString(meta.ogImage),
        ...markdownImages(markdown),
      ].filter((v): v is string => typeof v === "string"),
    )
      .map((src) => absolutize(src, url))
      .filter((v): v is string => v != null)
      .slice(0, 6);
    const priceHint = asString(json.price) ?? findPriceInText(markdown);

    if (!title && imageUrls.length === 0) return null;
    return { title, description, imageUrls, priceHint, source: "firecrawl" };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fallback 1: direct fetch + basic meta/JSON-LD extraction
// ---------------------------------------------------------------------------

async function scrapeWithFetch(url: string): Promise<PreviewData | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    if (!(res.headers.get("content-type") ?? "").includes("text/html")) return null;
    const html = (await res.text()).slice(0, 2_000_000);

    const jsonLd = extractJsonLdProduct(html);

    const title =
      metaContent(html, "og:title", "twitter:title") ??
      asString(jsonLd?.name) ??
      tagContent(html, "title");
    const description =
      metaContent(html, "og:description", "twitter:description", "description") ??
      asString(jsonLd?.description);
    const imageUrls = unique(
      [
        ...allMetaContents(html, "og:image"),
        ...allMetaContents(html, "twitter:image"),
        ...asStringArray(jsonLd?.image),
      ].filter((v): v is string => typeof v === "string"),
    )
      .map((src) => absolutize(src, url))
      .filter((v): v is string => v != null)
      .slice(0, 6);
    const priceHint =
      formatPrice(
        metaContent(html, "product:price:amount", "og:price:amount"),
        metaContent(html, "product:price:currency", "og:price:currency"),
      ) ?? jsonLdPrice(jsonLd) ?? findPriceInText(html.replace(/<[^>]+>/g, " ").slice(0, 50_000));

    if (!title && imageUrls.length === 0) return null;
    return { title, description, imageUrls, priceHint, source: "fetch" };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fallback 2: Perplexity sonar
// ---------------------------------------------------------------------------

async function scrapeWithPerplexity(url: string, apiKey: string): Promise<PreviewData | null> {
  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content:
              'You extract product information from shopping URLs. Reply with ONLY a raw JSON object, no markdown fences: {"title": string|null, "description": string|null, "price": string|null, "images": string[]}. description is one sentence; price includes the currency symbol; images are absolute URLs of product photos (empty array if unknown).',
          },
          { role: "user", content: `Product page: ${url}` },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    const json = parseJsonObject(content);
    if (!json) return null;

    const title = asString(json.title);
    const imageUrls = asStringArray(json.images)
      .map((src) => absolutize(src, url))
      .filter((v): v is string => v != null)
      .slice(0, 6);
    if (!title && imageUrls.length === 0) return null;
    return {
      title,
      description: asString(json.description),
      imageUrls,
      priceHint: asString(json.price),
      source: "perplexity",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function absolutize(src: string, base: string): string | null {
  try {
    const u = new URL(src, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** First <meta> content for any of the given property/name values (either attribute order). */
function metaContent(html: string, ...names: string[]): string | null {
  for (const name of names) {
    const n = escapeRegExp(name);
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]+content=["']([^"']+)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${n}["']`, "i"),
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m?.[1]?.trim()) return decodeEntities(m[1].trim());
    }
  }
  return null;
}

/** Every <meta> content for a given property/name (e.g. several og:image tags). */
function allMetaContents(html: string, name: string): string[] {
  const n = escapeRegExp(name);
  const out: string[] = [];
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]+content=["']([^"']+)["']`, "gi"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${n}["']`, "gi"),
  ];
  for (const re of patterns) {
    for (const m of html.matchAll(re)) {
      if (m[1]?.trim()) out.push(decodeEntities(m[1].trim()));
    }
  }
  return out;
}

function tagContent(html: string, tag: string): string | null {
  const m = html.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, "i"));
  return m?.[1]?.trim() ? decodeEntities(m[1].trim()) : null;
}

interface JsonLdProduct {
  name?: unknown;
  description?: unknown;
  image?: unknown;
  offers?: unknown;
}

/** First JSON-LD node typed Product (walks arrays and @graph). */
function extractJsonLdProduct(html: string): JsonLdProduct | null {
  for (const m of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const parsed = parseJsonObject(m[1] ?? "");
    if (!parsed) continue;
    const found = findProductNode(parsed);
    if (found) return found;
  }
  return null;
}

function findProductNode(node: unknown): JsonLdProduct | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findProductNode(item);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const type = obj["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((t) => typeof t === "string" && t.toLowerCase() === "product")) {
      return obj as JsonLdProduct;
    }
    if (obj["@graph"]) return findProductNode(obj["@graph"]);
  }
  return null;
}

function jsonLdPrice(product: JsonLdProduct | null): string | null {
  if (!product?.offers) return null;
  const offers = Array.isArray(product.offers) ? product.offers : [product.offers];
  for (const offer of offers) {
    if (!offer || typeof offer !== "object") continue;
    const o = offer as Record<string, unknown>;
    const price = o.price ?? o.lowPrice;
    if (price == null) continue;
    const amount = typeof price === "number" ? String(price) : asString(price);
    if (!amount) continue;
    const currency = asString(o.priceCurrency) ?? "";
    return formatPrice(amount, currency);
  }
  return null;
}

function formatPrice(amount: string | null, currency: string | null): string | null {
  if (!amount) return null;
  const symbols: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };
  const symbol = currency ? (symbols[currency.toUpperCase()] ?? `${currency.toUpperCase()} `) : "";
  return `${symbol}${amount}`;
}

/** Weak last-resort price hint: first currency-looking amount in the text. */
function findPriceInText(text: string | null): string | null {
  if (!text) return null;
  const m = text.match(/(?:US?\$|€|£)\s?\d[\d,]*(?:\.\d{1,2})?/);
  return m ? m[0].replace(/\s+/, "") : null;
}

function markdownImages(markdown: string | null): string[] {
  if (!markdown) return [];
  const out: string[] = [];
  for (const m of markdown.matchAll(/!\[[^\]]*\]\((https?:[^)\s]+)\)/g)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

/** Parse a JSON object from a string that may be wrapped in markdown fences or prose. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
