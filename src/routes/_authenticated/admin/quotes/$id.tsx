import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { QuoteStatusBadge, TierBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MARKUP_BY_TIER, formatDate, formatEUR } from "@/lib/format";
import {
  adminGetQuote,
  adminGetQuoteImageUrls,
  adminSaveQuote,
  adminSetQuoteStatus,
} from "@/lib/quotes.functions";

export const Route = createFileRoute("/_authenticated/admin-tmp-mid/quotes/$id")({
  head: () => ({
    meta: [
      { title: "Quote request — Relay Sourcing Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminQuoteDetailPage,
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function AdminQuoteDetailPage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const fetchQuote = useServerFn(adminGetQuote);
  const fetchImages = useServerFn(adminGetQuoteImageUrls);
  const callSave = useServerFn(adminSaveQuote);
  const callSetStatus = useServerFn(adminSetQuoteStatus);

  const { data, isPending } = useQuery({
    queryKey: ["admin-quote", id],
    queryFn: () => fetchQuote({ data: { quote_id: id } }),
  });
  const quote = data?.quote;
  const client = (quote?.profiles ?? null) as {
    company_name?: string;
    contact_name?: string;
    markup_tier?: string;
    shopify_domain?: string;
    country?: string;
  } | null;

  const imagePaths = (quote?.image_urls ?? []).filter(Boolean) as string[];
  const { data: images } = useQuery({
    queryKey: ["admin-quote-images", id, imagePaths.join(",")],
    queryFn: () => fetchImages({ data: { paths: imagePaths } }),
    enabled: imagePaths.length > 0,
  });

  const [cost, setCost] = useState("");
  const [shipping, setShipping] = useState("");
  const [markup, setMarkup] = useState("");
  const [override, setOverride] = useState(false);
  const [manualPrice, setManualPrice] = useState("");
  const [moq, setMoq] = useState("");
  const [leadTime, setLeadTime] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!quote || hydrated) return;
    setCost(quote.cost_price != null ? String(quote.cost_price) : "");
    setShipping(quote.shipping_cost != null ? String(quote.shipping_cost) : "");
    setMarkup(
      quote.markup_percent != null
        ? String(quote.markup_percent)
        : String(MARKUP_BY_TIER[client?.markup_tier ?? "standard"] ?? 35),
    );
    setManualPrice(quote.quoted_price != null ? String(quote.quoted_price) : "");
    setMoq(quote.moq != null ? String(quote.moq) : "");
    setLeadTime(quote.lead_time_days != null ? String(quote.lead_time_days) : "");
    setValidUntil(quote.quote_valid_until ?? "");
    setAdminNotes(quote.admin_notes ?? "");
    setHydrated(true);
  }, [quote, hydrated, client?.markup_tier]);

  const computed =
    cost !== "" && shipping !== "" && markup !== ""
      ? round2((Number(cost) + Number(shipping)) * (1 + Number(markup) / 100))
      : null;

  const save = useMutation({
    mutationFn: () => {
      if (computed == null && !override) throw new Error("Enter cost, shipping and markup first");
      return callSave({
        data: {
          quote_id: id,
          cost_price: Number(cost || 0),
          shipping_cost: Number(shipping || 0),
          markup_percent: Number(markup || 0),
          quoted_price: override ? Number(manualPrice) : (computed ?? 0),
          price_overridden: override,
          moq: moq ? Number(moq) : null,
          lead_time_days: leadTime ? Number(leadTime) : null,
          quote_valid_until: validUntil || null,
          admin_notes: adminNotes,
        },
      });
    },
    onSuccess: (r) => {
      toast.success(`Quote saved — client sees ${formatEUR(r.quoted_price)}`);
      void queryClient.invalidateQueries({ queryKey: ["admin-quote", id] });
      void queryClient.invalidateQueries({ queryKey: ["admin-quotes"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const setStatus = useMutation({
    mutationFn: (status: "submitted" | "sourcing" | "expired") =>
      callSetStatus({ data: { quote_id: id, status } }),
    onSuccess: () => {
      toast.success("Status updated");
      void queryClient.invalidateQueries({ queryKey: ["admin-quote", id] });
      void queryClient.invalidateQueries({ queryKey: ["admin-quotes"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const copyBrief = async () => {
    if (!quote) return;
    const brief = [
      `Product URL: ${quote.product_url ?? ""}`,
      `Product: ${quote.product_name ?? "—"}`,
      `Client: ${client?.company_name ?? "—"} (${client?.contact_name ?? "—"})`,
      `Expected volume: ${quote.target_monthly_volume ?? "—"} units/month`,
      `Notes: ${quote.notes ?? "—"}`,
    ].join("\n");
    await navigator.clipboard.writeText(brief);
    toast.success("Sourcing brief copied to clipboard");
  };

  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!quote) return <p className="text-sm text-muted-foreground">Quote request not found.</p>;

  return (
    <div>
      <PageHeader
        title={quote.product_name || "Quote request"}
        description={`Submitted ${formatDate(quote.created_at)}`}
        actions={
          <>
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link to="/admin/quotes">
                <ArrowLeft className="h-3.5 w-3.5" /> Queue
              </Link>
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void copyBrief()}>
              <Copy className="h-3.5 w-3.5" /> Copy sourcing brief
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Request</CardTitle>
                <QuoteStatusBadge status={quote.status} validUntil={quote.quote_valid_until} />
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Product URL</div>
                <a
                  href={quote.product_url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all underline-offset-2 hover:underline"
                >
                  {quote.product_url}
                </a>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Notes</div>
                <p className="whitespace-pre-wrap">{quote.notes || "—"}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Volume / month</div>
                  <div className="font-mono">{quote.target_monthly_volume ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Client</div>
                  <div>
                    {client?.company_name ?? "—"} <TierBadge tier={client?.markup_tier ?? null} />
                  </div>
                  <div className="text-xs text-muted-foreground">{client?.shopify_domain ?? ""}</div>
                </div>
              </div>
              {images && images.urls.length > 0 && (
                <div>
                  <div className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">Images</div>
                  <div className="flex flex-wrap gap-2">
                    {images.urls.map((img) => (
                      <a key={img.path} href={img.url} target="_blank" rel="noreferrer">
                        <img
                          src={img.url}
                          alt="Quote attachment"
                          className="h-16 w-16 rounded-md border border-border object-cover"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {(quote.status === "submitted" || quote.status === "sourcing") && (
                <div className="flex gap-2 pt-1">
                  {quote.status === "submitted" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate("sourcing")}
                    >
                      Mark as sourcing
                    </Button>
                  )}
                  {quote.status === "sourcing" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate("submitted")}
                    >
                      Back to submitted
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pricing</CardTitle>
            <CardDescription>
              Cost and margin are never visible to the client. Saving moves the request to "quoted".
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="aq-cost">Cost price (EUR)</Label>
                  <Input id="aq-cost" type="number" step="0.01" min="0" required value={cost} onChange={(e) => setCost(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aq-ship">Shipping cost (EUR)</Label>
                  <Input id="aq-ship" type="number" step="0.01" min="0" required value={shipping} onChange={(e) => setShipping(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="aq-markup">Markup %</Label>
                  <Input id="aq-markup" type="number" step="0.1" min="0" required value={markup} onChange={(e) => setMarkup(e.target.value)} />
                  <p className="text-xs text-muted-foreground">
                    Tier default: {MARKUP_BY_TIER[client?.markup_tier ?? "standard"] ?? 35}%
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Quoted price (EUR)</Label>
                  <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3 font-mono text-sm">
                    {override ? "manual" : computed != null ? formatEUR(computed) : "—"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="aq-override"
                  checked={override}
                  onCheckedChange={(v) => setOverride(v === true)}
                />
                <Label htmlFor="aq-override" className="text-sm font-normal">
                  Override final price manually
                </Label>
              </div>
              {override && (
                <div className="space-y-1.5">
                  <Label htmlFor="aq-manual">Manual quoted price (EUR)</Label>
                  <Input id="aq-manual" type="number" step="0.01" min="0.01" required value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} />
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="aq-moq">MOQ</Label>
                  <Input id="aq-moq" type="number" min="1" value={moq} onChange={(e) => setMoq(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aq-lead">Lead time (days)</Label>
                  <Input id="aq-lead" type="number" min="0" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aq-valid">Valid until</Label>
                  <Input id="aq-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="aq-notes">Internal notes (admin only)</Label>
                <Textarea id="aq-notes" rows={3} value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} />
              </div>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save & send quote"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
