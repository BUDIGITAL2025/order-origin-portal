import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { QuoteStatusBadge, TierBadge } from "@/components/status-badges";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatUSD } from "@/lib/format";
import { effectiveTier, TIER_LABELS } from "@/lib/plans";
import {
  adminGetQuote,
  adminGetQuoteImageUrls,
  adminRequote,
  adminSaveQuote,
  adminSetQuoteStatus,
} from "@/lib/quotes.functions";

export const Route = createFileRoute("/_authenticated/admin/quotes/$id")({
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

function num(value: string): number {
  return value === "" ? 0 : Number(value);
}

function AdminQuoteDetailPage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const fetchQuote = useServerFn(adminGetQuote);
  const fetchImages = useServerFn(adminGetQuoteImageUrls);
  const callSave = useServerFn(adminSaveQuote);
  const callSetStatus = useServerFn(adminSetQuoteStatus);
  const callRequote = useServerFn(adminRequote);

  const { data, isPending } = useQuery({
    queryKey: ["admin-quote", id],
    queryFn: () => fetchQuote({ data: { quote_id: id } }),
  });
  const quote = data?.quote;
  const client = (quote?.profiles ?? null) as {
    company_name?: string;
    contact_name?: string;
    shopify_domain?: string;
    country?: string;
    pricing_tier?: string;
    tier_override?: string | null;
    avg_daily_units_30d?: number;
    subscription_plan?: string;
  } | null;

  const clientTier = effectiveTier(client?.pricing_tier, client?.tier_override);

  const imagePaths = (quote?.image_urls ?? []).filter(Boolean) as string[];
  const { data: images } = useQuery({
    queryKey: ["admin-quote-images", id, imagePaths.join(",")],
    queryFn: () => fetchImages({ data: { paths: imagePaths } }),
    enabled: imagePaths.length > 0,
  });

  const [cogs, setCogs] = useState("");
  const [shipping, setShipping] = useState("");
  const [tax, setTax] = useState("");
  const [markupProduct, setMarkupProduct] = useState("");
  const [markupShipping, setMarkupShipping] = useState("");
  const [moq, setMoq] = useState("");
  const [leadTime, setLeadTime] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!quote || hydrated) return;
    setCogs(quote.supplier_cogs != null ? String(quote.supplier_cogs) : "");
    setShipping(quote.supplier_shipping != null ? String(quote.supplier_shipping) : "");
    setTax(quote.supplier_tax != null ? String(quote.supplier_tax) : "");
    setMarkupProduct(quote.markup_product != null ? String(quote.markup_product) : "");
    setMarkupShipping(quote.markup_shipping != null ? String(quote.markup_shipping) : "");
    setMoq(quote.moq != null ? String(quote.moq) : "");
    setLeadTime(quote.lead_time_days != null ? String(quote.lead_time_days) : "");
    setValidUntil(quote.quote_valid_until ?? "");
    setAdminNotes(quote.admin_notes ?? "");
    setHydrated(true);
  }, [quote, hydrated]);

  const totalCost = round2(num(cogs) + num(shipping) + num(tax));
  const totalMarkup = round2(num(markupProduct) + num(markupShipping));
  // supplier_tax is a pass-through at exact cost — never marked up.
  const finalPrice = round2(totalCost + totalMarkup);
  const effectiveMargin = totalCost > 0 ? round2((totalMarkup / totalCost) * 100) : 0;

  const save = useMutation({
    mutationFn: () => {
      if (cogs === "") throw new Error("Enter the supplier COGS first");
      return callSave({
        data: {
          quote_id: id,
          supplier_cogs: num(cogs),
          supplier_shipping: num(shipping),
          supplier_tax: num(tax),
          markup_product: num(markupProduct),
          markup_shipping: num(markupShipping),
          moq: moq ? Number(moq) : null,
          lead_time_days: leadTime ? Number(leadTime) : null,
          quote_valid_until: validUntil || null,
          admin_notes: adminNotes,
        },
      });
    },
    onSuccess: (r) => {
      toast.success(`Quote saved — client sees ${formatUSD(r.quoted_price_total)}`);
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

  const requote = useMutation({
    mutationFn: () => callRequote({ data: { quote_id: id } }),
    onSuccess: (r) => {
      toast.success("Requote created in the queue (status: sourcing)");
      void queryClient.invalidateQueries({ queryKey: ["admin-quotes"] });
      if (r.quote_id) {
        void queryClient.invalidateQueries({ queryKey: ["admin-quote", r.quote_id] });
      }
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

  const requotable = quote.status === "accepted" || quote.status === "expired";

  return (
    <div>
      <PageHeader
        title={quote.product_name || "Quote request"}
        description={`Submitted ${formatDate(quote.created_at)}${quote.supersedes_quote_id ? " · requote of an earlier request" : ""}`}
        actions={
          <>
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link to="/admin/quotes">
                <ArrowLeft className="h-3.5 w-3.5" /> Queue
              </Link>
            </Button>
            {requotable && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <RefreshCw className="h-3.5 w-3.5" /> Requote
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Requote this request?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Creates a new quote request (status: sourcing) with the same product, URL and
                      notes. The original is never edited and the client's monthly quota is not
                      affected.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={requote.isPending}
                      onClick={() => requote.mutate()}
                    >
                      Create requote
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
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
                    {client?.company_name ?? "—"} <TierBadge tier={clientTier} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {client?.shopify_domain ?? ""}
                    {client?.tier_override
                      ? ` · override (auto: ${TIER_LABELS[client?.pricing_tier ?? "starter"] ?? client?.pricing_tier})`
                      : ` · auto · ${Number(client?.avg_daily_units_30d ?? 0).toFixed(1)} units/day`}
                  </div>
                </div>
              </div>
              {quote.tier_at_quote && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Tier frozen at quote
                  </div>
                  <div className="font-mono text-sm">{quote.tier_at_quote}</div>
                </div>
              )}
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
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Pricing</CardTitle>
              <span className="text-xs text-muted-foreground">
                Client tier: <TierBadge tier={clientTier} />
              </span>
            </div>
            <CardDescription>
              All amounts in USD. Supplier tax (IOSS / duties) passes through at exact cost — it is
              never marked up. Cost and margin are never visible to the client. Saving moves the
              request to "quoted" and freezes the client's current tier.
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
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="aq-cogs">Supplier COGS ($)</Label>
                  <Input id="aq-cogs" type="number" step="0.01" min="0" required value={cogs} onChange={(e) => setCogs(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aq-ship">Supplier shipping ($)</Label>
                  <Input id="aq-ship" type="number" step="0.01" min="0" required value={shipping} onChange={(e) => setShipping(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aq-tax">Supplier tax ($)</Label>
                  <Input id="aq-tax" type="number" step="0.01" min="0" required value={tax} onChange={(e) => setTax(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Pass-through, no markup</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="aq-mkprod">Markup — product ($)</Label>
                  <Input id="aq-mkprod" type="number" step="0.01" min="0" required value={markupProduct} onChange={(e) => setMarkupProduct(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aq-mkship">Markup — shipping ($)</Label>
                  <Input id="aq-mkship" type="number" step="0.01" min="0" required value={markupShipping} onChange={(e) => setMarkupShipping(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border text-sm sm:grid-cols-4">
                <div className="bg-muted/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Supplier cost</div>
                  <div className="font-mono font-medium">{formatUSD(totalCost)}</div>
                </div>
                <div className="bg-muted/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Total markup</div>
                  <div className="font-mono font-medium">{formatUSD(totalMarkup)}</div>
                </div>
                <div className="bg-muted/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Client price</div>
                  <div className="font-mono font-semibold">{formatUSD(finalPrice)}</div>
                </div>
                <div className="bg-muted/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Margin (ref)</div>
                  <div className="font-mono font-medium">{effectiveMargin.toFixed(1)}%</div>
                </div>
              </div>

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
