import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { getCurrentStoreId } from "@/components/store-switcher";
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
import { useMyContext } from "../../_client";

export const Route = createFileRoute("/_authenticated/_client/quotes/new")({
  head: () => ({
    meta: [
      { title: "Request a quote — FlySales" },
      { name: "description", content: "Submit a product for sourcing and pricing." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NewQuotePageInner,
});

function NewQuotePageInner() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const callCreate = useServerFn(createQuoteRequest);
  const { data: ctx } = useMyContext();

  const [productUrl, setProductUrl] = useState("");
  const [productName, setProductName] = useState("");
  const [notes, setNotes] = useState("");
  const [volume, setVolume] = useState("");
  const [countries, setCountries] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [quotaBlocked, setQuotaBlocked] = useState(false);
  const [plansBlocked, setPlansBlocked] = useState(false);

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

  // Paywall: submitting needs an active subscription on this workspace (or a
  // fee waiver). The form stays visible and fillable; the plan options only
  // appear when an unsubscribed client tries to submit.
  const needsSubscription =
    currentStore != null &&
    currentStore.subscription_status !== "active" &&
    currentStore.subscription_status !== "past_due" &&
    !currentStore.fee_waived;

  const submit = useMutation({
    mutationFn: async () => {
      if (needsSubscription) {
        setPlansBlocked(true);
        throw new Error("Pick a plan to send quote requests — your request has not been submitted.");
      }
      const parsed = quoteRequestSchema.safeParse({
        product_url: productUrl,
        product_name: productName,
        notes,
        target_monthly_volume: volume ? Number(volume) : null,
        target_countries: countries,
      });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Check your input");
      }

      // Upload images to the private bucket under the caller's own folder.
      let imageUrls: string[] = [];
      if (files.length > 0) {
        if (!ctx?.userId) throw new Error("Session not ready");
        setUploading(true);
        try {
          const uploads = await Promise.all(
            files.map(async (file) => {
              const safeName = file.name.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
              const path = `${ctx.userId}/${crypto.randomUUID()}-${safeName}`;
              const { error } = await supabase.storage.from("quote-images").upload(path, file);
              if (error) throw new Error(`Upload failed: ${error.message}`);
              return path;
            }),
          );
          imageUrls = uploads;
        } finally {
          setUploading(false);
        }
      }

      await callCreate({ data: { ...parsed.data, image_urls: imageUrls } });
    },
    onSuccess: async () => {
      toast.success("Quote request submitted");
      await queryClient.invalidateQueries({ queryKey: ["my-quotes"] });
      await queryClient.invalidateQueries({ queryKey: ["my-context"] });
      await navigate({ to: "/quotes" });
    },
    onError: (err) => {
      if (err.message.includes("used all quote requests")) {
        setQuotaBlocked(true);
      }
      toast.error(err.message);
    },
  });

  // Upgrades go through Stripe checkout on the Billing page — the webhook
  // flips the plan after payment confirms.

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

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Request a quote"
        description="Send us a product link and we'll come back with a price, MOQ and lead time."
      />
      {plansBlocked && needsSubscription && (
        <Card className="mb-4 border-primary/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowUpCircle className="h-5 w-5 text-primary" />
              Pick a plan to send this request
            </CardTitle>
            <CardDescription>
              Your request above is safe — nothing was submitted. Quote requests are part of a
              workspace subscription; no shop connection needed.
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
                <Button asChild size="sm" className="mt-3 w-full">
                  <Link to="/billing">Subscribe to {PLANS[key].label}</Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
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
            <div className="space-y-1.5">
              <Label htmlFor="q-url">Product URL *</Label>
              <Input
                id="q-url"
                type="url"
                required
                placeholder="https://…"
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
              />
            </div>
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
              <Label htmlFor="q-name">Product name</Label>
              <Input
                id="q-name"
                placeholder="e.g. Stainless steel thermos 750ml"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
              />
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
              {files.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {files.length} file{files.length > 1 ? "s" : ""} selected
                </p>
              )}
            </div>
            <Button type="submit" disabled={submit.isPending || uploading}>
              {submit.isPending ? (uploading ? "Uploading images…" : "Submitting…") : "Submit request"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
