import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { getCurrentStoreId } from "@/components/store-switcher";
import { UrlPreviewCard, type UrlPreviewData } from "@/components/url-preview-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { COUNTRIES } from "@/lib/countries";
import { PLANS, planQuota, quotaResetDate } from "@/lib/plans";
import { quoteRequestSchema } from "@/lib/schemas";
import { createQuoteRequest } from "@/lib/quotes.functions";
import { getUrlPreview } from "@/lib/previews.functions";
import { createSubscriptionCheckout } from "@/lib/billing.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { useMyContext } from "../../_client";

export const Route = createFileRoute("/_authenticated/_client/quotes/new")({
  // Stripe substitutes {CHECKOUT_SESSION_ID} server-side; sub=success/cancel
  // is a display hint only — activation comes from the webhook.
  validateSearch: (search: Record<string, unknown>): { sub?: string } => {
    const sub = search["sub"];
    return typeof sub === "string" ? { sub } : {};
  },
  head: () => ({
    meta: [
      { title: "Request a quote — FlySales" },
      { name: "description", content: "Submit a product for sourcing and pricing." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NewQuotePageInner,
});

const MAX_PRODUCTS = 5;

type EntryPreview = { kind: "idle" } | { kind: "loading" } | ({ kind: "ok"; id: string } & UrlPreviewData) | { kind: "unavailable" };

interface Entry {
  key: string;
  url: string;
  name: string;
  /** Once the client edits the name, scraped titles no longer overwrite it. */
  nameTouched: boolean;
  preview: EntryPreview;
  /** Scraped images still attached to this request (removable in the card). */
  attachedImages: string[];
}

let entryCounter = 0;
function emptyEntry(): Entry {
  return {
    key: `entry-${++entryCounter}`,
    url: "",
    name: "",
    nameTouched: false,
    preview: { kind: "idle" },
    attachedImages: [],
  };
}

function isValidHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function NewQuotePageInner() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const callCreate = useServerFn(createQuoteRequest);
  const callPreview = useServerFn(getUrlPreview);
  const { data: ctx } = useMyContext();

  const [entries, setEntries] = useState<Entry[]>([emptyEntry()]);
  const [notes, setNotes] = useState("");
  const [volume, setVolume] = useState("");
  const [countries, setCountries] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [quotaBlocked, setQuotaBlocked] = useState(false);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);

  // Return from Stripe checkout: sub=success/cancel. Activation arrives via
  // webhook — refresh the context so the paywall lifts as soon as it lands.
  const { sub } = Route.useSearch();
  useEffect(() => {
    if (sub === "success") {
      toast.success("Subscription received — it activates as soon as the payment confirms.");
      void queryClient.invalidateQueries({ queryKey: ["my-context"] });
      const poll = setInterval(
        () => void queryClient.invalidateQueries({ queryKey: ["my-context"] }),
        3000,
      );
      const stop = setTimeout(() => clearInterval(poll), 30000);
      void navigate({ to: "/quotes/new", replace: true, search: {} });
      return () => {
        clearInterval(poll);
        clearTimeout(stop);
      };
    }
    if (sub === "cancel") {
      toast.info("Checkout canceled — nothing was charged.");
      void navigate({ to: "/quotes/new", replace: true, search: {} });
    }
    return undefined;
  }, [sub, navigate, queryClient]);

  // Quota and plan live on the current workspace (localStorage selection,
  // resolved after hydration; falls back to the first workspace).
  const [currentStoreId, setCurrentStoreId] = useState<string | null>(null);
  useEffect(() => {
    setCurrentStoreId(getCurrentStoreId());
  }, []);
  const allStores = ctx?.entities?.flatMap((e) => e.stores) ?? [];
  const currentStore = allStores.find((s) => s.id === currentStoreId) ?? allStores[0] ?? null;

  const plan = currentStore?.subscription_plan ?? "basic";
  const quota = planQuota(plan);
  const quotesUsed = currentStore?.quotes_used_this_month ?? 0;
  const limitReached = quota != null && quotesUsed >= quota;

  // Subscribe straight from the paywall: opens Stripe checkout for the chosen
  // plan without leaving the form. No workspace yet → the server creates the
  // draft workspace itself. Return URL points back here (?sub=success) so the
  // client lands unblocked where they started.
  const callSubscribe = useServerFn(createSubscriptionCheckout);
  const subscribe = useMutation({
    mutationFn: async (planKey: "basic" | "unlimited") => {
      const result = await callSubscribe({
        data: {
          plan: planKey,
          storeId: currentStore?.id,
          returnUrl: `${window.location.origin}/quotes/new`,
          environment: getStripeEnvironment(),
        },
      });
      if ("error" in result) throw new Error(result.error);
      if (!result.url) throw new Error("Stripe did not return a checkout URL");
      return result.url;
    },
    onSuccess: (url) => window.location.assign(url),
    onError: (err) =>
      setSubscribeError(err instanceof Error ? err.message : "Could not start checkout"),
  });

  // Paywall: quote requests need an active subscription on the current
  // workspace (or a fee waiver). Without one the plan picker replaces the
  // form entirely — a client never sees a form they cannot submit. A
  // storeless account can't be subscribed (plans live on workspaces), so it
  // counts as needing one; the subscribe checkout creates the draft workspace.
  const needsSubscription =
    currentStore == null ||
    (currentStore.subscription_status !== "active" &&
      currentStore.subscription_status !== "past_due" &&
      !currentStore.fee_waived);

  // ------------------------------------------------------------------
  // Live URL previews: one debounced scrape per product entry, only when
  // the text parses as a valid http(s) URL, 800ms after the last change.
  // A failed/limited preview never blocks submission.
  // ------------------------------------------------------------------
  const previewTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    const timers = previewTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const patchEntry = (key: string, patch: Partial<Entry>) => {
    setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  };

  const runPreview = async (key: string, url: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.key === key ? { ...e, preview: { kind: "loading" } } : e)),
    );
    try {
      const res = await callPreview({ data: { url } });
      setEntries((prev) =>
        prev.map((e) => {
          if (e.key !== key || e.url !== url) return e; // stale response
          if (res.status === "ok") {
            return {
              ...e,
              preview: {
                kind: "ok",
                id: res.preview.id,
                title: res.preview.title,
                description: res.preview.description,
                imageUrls: res.preview.imageUrls,
                priceHint: res.preview.priceHint,
              },
              attachedImages: res.preview.imageUrls.slice(0, 5),
              name: e.nameTouched ? e.name : (res.preview.title ?? e.name),
            };
          }
          // Rate-limited or invalid: skip the preview silently.
          if (res.status === "rate_limited" || res.status === "invalid") {
            return { ...e, preview: { kind: "idle" } };
          }
          return { ...e, preview: { kind: "unavailable" } };
        }),
      );
    } catch {
      setEntries((prev) =>
        prev.map((e) =>
          e.key === key && e.url === url ? { ...e, preview: { kind: "unavailable" } } : e,
        ),
      );
    }
  };

  const handleUrlChange = (key: string, url: string) => {
    patchEntry(key, { url });
    const existing = previewTimers.current.get(key);
    if (existing) clearTimeout(existing);
    if (!isValidHttpUrl(url)) {
      patchEntry(key, { preview: { kind: "idle" }, attachedImages: [] });
      return;
    }
    previewTimers.current.set(
      key,
      setTimeout(() => {
        void runPreview(key, url);
      }, 800),
    );
  };

  const addEntry = () => {
    setEntries((prev) => (prev.length >= MAX_PRODUCTS ? prev : [...prev, emptyEntry()]));
  };

  const removeEntry = (key: string) => {
    const timer = previewTimers.current.get(key);
    if (timer) clearTimeout(timer);
    previewTimers.current.delete(key);
    setEntries((prev) => (prev.length > 1 ? prev.filter((e) => e.key !== key) : prev));
  };

  // ------------------------------------------------------------------

  const submit = useMutation({
    mutationFn: async () => {
      // Unreachable in practice — the paywall replaces the form — but the
      // server enforces the same gate, so keep the guard as a backstop.
      if (needsSubscription) {
        throw new Error("Pick a plan to send quote requests — your request has not been submitted.");
      }
      const filled = entries.filter((e) => e.url.trim() !== "");
      if (filled.length === 0) throw new Error("Add at least one product URL");
      if (countries.length === 0) {
        throw new Error("Pick at least one destination country — shipping cost depends on it.");
      }

      // Upload shared reference images once to the private bucket under the
      // caller's own folder; the paths attach to every request in this batch.
      let uploadedPaths: string[] = [];
      if (files.length > 0) {
        if (!ctx?.userId) throw new Error("Session not ready");
        setUploading(true);
        try {
          uploadedPaths = await Promise.all(
            files.map(async (file) => {
              const safeName = file.name.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
              const path = `${ctx.userId}/${crypto.randomUUID()}-${safeName}`;
              const { error } = await supabase.storage.from("quote-images").upload(path, file);
              if (error) throw new Error(`Upload failed: ${error.message}`);
              return path;
            }),
          );
        } finally {
          setUploading(false);
        }
      }

      // One quote request per product URL — sequential so quota errors surface
      // per product instead of racing.
      const createdIds: string[] = [];
      const failures: string[] = [];
      for (const entry of filled) {
        const parsed = quoteRequestSchema.safeParse({
          product_url: entry.url.trim(),
          product_name: entry.name,
          notes,
          target_monthly_volume: volume ? Number(volume) : null,
          target_countries: countries,
          store_id: currentStore?.id ?? undefined,
          image_urls: [...uploadedPaths, ...entry.attachedImages].slice(0, 10),
          preview_id: entry.preview.kind === "ok" ? entry.preview.id : undefined,
        });
        if (!parsed.success) {
          failures.push(parsed.error.issues[0]?.message ?? "Check your input");
          continue;
        }
        try {
          const r = await callCreate({ data: parsed.data });
          if (r.quote_id) createdIds.push(r.quote_id);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Submission failed";
          if (message.includes("used all")) setQuotaBlocked(true);
          failures.push(message);
        }
      }
      return { createdIds, failures };
    },
    onSuccess: async ({ createdIds, failures }) => {
      for (const f of failures.slice(0, 2)) toast.error(f);
      if (createdIds.length === 0) return;
      toast.success(
        createdIds.length === 1
          ? "Quote request submitted"
          : `${createdIds.length} quote requests submitted`,
      );
      await queryClient.invalidateQueries({ queryKey: ["my-quotes"] });
      await queryClient.invalidateQueries({ queryKey: ["my-context"] });
      // Land on the request detail page, which tracks the 48h sourcing target.
      if (createdIds.length === 1 && createdIds[0]) {
        await navigate({ to: "/quotes/$id", params: { id: createdIds[0] } });
      } else {
        await navigate({ to: "/quotes" });
      }
    },
    onError: (err) => {
      if (err.message.includes("used all")) {
        setQuotaBlocked(true);
      }
      toast.error(err.message);
    },
  });

  // Upgrades go through Stripe checkout on the Billing page — the webhook
  // flips the plan after payment confirms.

  // Wait for the account context before choosing between paywall and form —
  // otherwise subscribed clients see a paywall flash while it loads.
  if (!ctx) {
    return (
      <div className="max-w-2xl">
        <PageHeader
          title="Request a quote"
          description="Send us a product link and we'll come back with a price, MOQ and lead time."
        />
        <Card>
          <CardContent className="p-8 text-sm text-muted-foreground">Loading…</CardContent>
        </Card>
      </div>
    );
  }

  if (quotaBlocked || limitReached) {
    return (
      <div className="max-w-2xl">
        <PageHeader
          title="Request a quote"
          description="Send us a product link and we'll come back with a price, MOQ and lead time."
        />
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-8">
            <ArrowUpCircle className="h-8 w-8 text-warning" />
            <h2 className="text-lg font-semibold">Monthly quote allowance reached</h2>
            <p className="text-sm text-muted-foreground">
              You've used all {quota ?? PLANS.basic.quoteQuota} quote requests included in your{" "}
              {PLANS.basic.label} plan this month. Your allowance resets on{" "}
              {quotaResetDate(currentStore?.quotes_period_start)}.
            </p>
            <p className="text-sm text-muted-foreground">
              Upgrade to {PLANS.unlimited.label} for ${PLANS.unlimited.priceUsd}/month and send
              unlimited quote requests. You'll go through secure checkout on the Billing
              page and your plan changes as soon as the payment confirms — your request
              has not been submitted; resubmit it after upgrading.
            </p>
            <div className="flex gap-2">
              <Button asChild size="sm">
                <Link to="/billing">Upgrade to {PLANS.unlimited.label}</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/dashboard">Back to dashboard</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Plan paywall replaces the form entirely when the current workspace has
  // no active subscription (or there is no workspace yet). Picking a plan
  // opens Stripe checkout directly; the webhook lifts the paywall.
  if (needsSubscription) {
    return (
      <div className="max-w-2xl">
        <PageHeader
          title="Request a quote"
          description="Send us a product link and we'll come back with a price, MOQ and lead time."
        />
        <Card className="border-primary/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowUpCircle className="h-5 w-5 text-primary" />
              Pick a plan to request quotes
            </CardTitle>
            <CardDescription>
              Quote requests are part of a workspace subscription — no shop connection needed.
              Subscribe and you'll land back here, ready to send your first request.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {(["basic", "unlimited"] as const).map((key) => (
              <div key={key} className="rounded-xl border border-border p-4">
                <p className="text-sm font-semibold">{PLANS[key].label}</p>
                <p className="tnum text-xl font-semibold">
                  ${PLANS[key].priceUsd}
                  <span className="text-xs font-normal text-muted-foreground">/month</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {key === "basic"
                    ? `${PLANS.basic.quoteQuota} quote requests per month`
                    : "Unlimited quote requests"}
                </p>
                <Button
                  size="sm"
                  className="mt-3 w-full"
                  disabled={subscribe.isPending}
                  onClick={() => {
                    setSubscribeError(null);
                    subscribe.mutate(key);
                  }}
                >
                  {subscribe.isPending ? "Opening checkout…" : `Subscribe to ${PLANS[key].label}`}
                </Button>
              </div>
            ))}
            {subscribeError && (
              <p className="text-sm text-destructive sm:col-span-2">
                Could not start checkout: {subscribeError}. If this keeps happening, contact
                support.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const previewed = entries.filter((e) => e.preview.kind !== "idle");

  return (
    <div>
      <PageHeader
        title="Request a quote"
        description="Send us a product link and we'll come back with a price, MOQ and lead time."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Product details</CardTitle>
              <CardDescription>All sourcing communication happens on this request.</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submit.mutate();
                }}
                className="space-y-4"
              >
                {entries.map((entry, idx) => (
                  <div
                    key={entry.key}
                    className={
                      entries.length > 1
                        ? "space-y-3 rounded-xl border border-border p-3"
                        : "space-y-4"
                    }
                  >
                    {entries.length > 1 && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Product {idx + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeEntry(entry.key)}
                          aria-label={`Remove product ${idx + 1}`}
                          className="rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label htmlFor={`q-url-${entry.key}`}>Product URL *</Label>
                      <Input
                        id={`q-url-${entry.key}`}
                        type="url"
                        required={entries.length === 1}
                        placeholder="https://…"
                        value={entry.url}
                        onChange={(e) => handleUrlChange(entry.key, e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`q-name-${entry.key}`}>Product name</Label>
                      <Input
                        id={`q-name-${entry.key}`}
                        placeholder="e.g. Stainless steel thermos 750ml"
                        value={entry.name}
                        onChange={(e) =>
                          setEntries((prev) =>
                            prev.map((en) =>
                              en.key === entry.key
                                ? { ...en, name: e.target.value, nameTouched: true }
                                : en,
                            ),
                          )
                        }
                      />
                    </div>
                  </div>
                ))}
                {entries.length < MAX_PRODUCTS && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={addEntry}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add another product
                  </Button>
                )}
                <div className="space-y-1.5">
                  <Label>Destination countries *</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {COUNTRIES.map((c) => {
                      const selected = countries.includes(c.code);
                      return (
                        <button
                          key={c.code}
                          type="button"
                          aria-pressed={selected}
                          onClick={() =>
                            setCountries((prev) =>
                              selected ? prev.filter((v) => v !== c.code) : [...prev, c.code],
                            )
                          }
                          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                            selected
                              ? "border-primary bg-primary/10 font-medium text-primary"
                              : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                          }`}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {countries.length === 0
                      ? "Pick every country you sell into."
                      : `${countries.length} ${countries.length === 1 ? "country" : "countries"} selected — each country adds its own priced line per variant.`}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="q-volume">Expected monthly volume (units)</Label>
                  <Input
                    id="q-volume"
                    type="number"
                    min={1}
                    placeholder="e.g. 300"
                    value={volume}
                    onChange={(e) => setVolume(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="q-notes">Notes</Label>
                  <Textarea
                    id="q-notes"
                    rows={4}
                    placeholder="Variants, target price, packaging requirements…"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="q-images">Images (optional, max 5)</Label>
                  <Input
                    id="q-images"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                      const list = Array.from(e.target.files ?? []).slice(0, 5);
                      setFiles(list);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    {files.length > 0
                      ? `${files.length} file${files.length > 1 ? "s" : ""} selected. `
                      : ""}
                    Images found in the preview are attached automatically — remove any directly on
                    the preview card.
                  </p>
                </div>
                <Button type="submit" disabled={submit.isPending || uploading}>
                  {submit.isPending
                    ? uploading
                      ? "Uploading images…"
                      : "Submitting…"
                    : entries.filter((e) => e.url.trim() !== "").length > 1
                      ? "Submit requests"
                      : "Submit request"}
                </Button>
                {entries.filter((e) => e.url.trim() !== "").length > 1 && (
                  <p className="text-xs text-muted-foreground">
                    Each product creates its own quote request and counts toward your monthly
                    allowance.
                  </p>
                )}
              </form>
            </CardContent>
          </Card>
        </div>

        {previewed.length > 0 && (
          <div className="space-y-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Live preview
            </p>
            {previewed.map((entry) => (
              <UrlPreviewCard
                key={entry.key}
                url={entry.url}
                preview={
                  entry.preview.kind === "loading"
                    ? { status: "loading" }
                    : entry.preview.kind === "ok"
                      ? {
                          status: "ok",
                          title: entry.preview.title,
                          description: entry.preview.description,
                          imageUrls: entry.attachedImages,
                          priceHint: entry.preview.priceHint,
                        }
                      : { status: "unavailable" }
                }
                onRemoveImage={(img) =>
                  setEntries((prev) =>
                    prev.map((e) =>
                      e.key === entry.key
                        ? { ...e, attachedImages: e.attachedImages.filter((i) => i !== img) }
                        : e,
                    ),
                  )
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
