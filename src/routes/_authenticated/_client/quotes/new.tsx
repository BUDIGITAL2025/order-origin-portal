import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { PLANS, planQuota, quotaResetDate } from "@/lib/plans";
import { quoteRequestSchema } from "@/lib/schemas";
import { createQuoteRequest } from "@/lib/quotes.functions";
import { upgradeToUnlimited } from "@/lib/profiles.functions";
import { useMyContext } from "../../_client";

export const Route = createFileRoute("/_authenticated/_client/quotes/new")({
  head: () => ({
    meta: [
      { title: "Request a quote — FlySales" },
      { name: "description", content: "Submit a product for sourcing and pricing." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NewQuotePage,
});

function NewQuotePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const callCreate = useServerFn(createQuoteRequest);
  const callUpgrade = useServerFn(upgradeToUnlimited);
  const { data: ctx } = useMyContext();

  const [productUrl, setProductUrl] = useState("");
  const [productName, setProductName] = useState("");
  const [notes, setNotes] = useState("");
  const [volume, setVolume] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [quotaBlocked, setQuotaBlocked] = useState(false);

  const submit = useMutation({
    mutationFn: async () => {
      const parsed = quoteRequestSchema.safeParse({
        product_url: productUrl,
        product_name: productName,
        notes,
        target_monthly_volume: volume ? Number(volume) : null,
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

  // Explicit upgrade — only ever triggered by the client clicking the button.
  const upgrade = useMutation({
    mutationFn: () => callUpgrade(),
    onSuccess: async () => {
      toast.success("You're now on Unlimited — resubmit your request below.");
      setQuotaBlocked(false);
      await queryClient.invalidateQueries({ queryKey: ["my-context"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const plan = ctx?.profile?.subscription_plan ?? "basic";
  const quota = planQuota(plan);
  const quotesUsed = ctx?.profile?.quotes_used_this_month ?? 0;
  const limitReached = quota != null && quotesUsed >= quota;

  if (quotaBlocked || limitReached) {
    return (
      <div className="max-w-2xl">
        <PageHeader
          title="Request a quote"
          description="Send us a product link and we'll come back with a price, MOQ and lead time."
        />
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-8">
            <ArrowUpCircle className="h-8 w-8 text-warning-foreground" />
            <h2 className="text-lg font-semibold">Monthly quote allowance reached</h2>
            <p className="text-sm text-muted-foreground">
              You've used all {quota ?? PLANS.basic.quoteQuota} quote requests included in your{" "}
              {PLANS.basic.label} plan this month. Your allowance resets on{" "}
              {quotaResetDate(ctx?.profile?.quotes_period_start)}.
            </p>
            <p className="text-sm text-muted-foreground">
              Upgrade to {PLANS.unlimited.label} for ${PLANS.unlimited.priceUsd}/month and send
              unlimited quote requests. Nothing is charged or changed until you click below — your
              request has not been submitted; resubmit it after upgrading.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={upgrade.isPending}
                onClick={() => upgrade.mutate()}
              >
                {upgrade.isPending ? "Upgrading…" : `Upgrade to ${PLANS.unlimited.label}`}
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
