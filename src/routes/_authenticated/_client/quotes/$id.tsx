import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { QuoteOfferCards } from "@/components/quote-offer-cards";
import { QuoteSlaCountdown, QuoteTimeline, QuoteValidityChip } from "@/components/quote-sla";
import { QuoteThread } from "@/components/quote-thread";
import { SpecialRequestMenu } from "@/components/special-request-menu";
import { QuoteStatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { countryName } from "@/lib/countries";
import { formatDate } from "@/lib/format";
import { getMyQuote } from "@/lib/quotes.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/_client/quotes/$id")({
  head: () => ({
    meta: [{ title: "Quote — FlySales" }, { name: "robots", content: "noindex" }],
  }),
  component: MyQuoteDetailPage,
});

function MyQuoteDetailPage() {
  const { id } = Route.useParams();
  const fetchQuote = useServerFn(getMyQuote);

  const { data, isPending } = useQuery({
    queryKey: ["my-quote", id],
    queryFn: () => fetchQuote({ data: { quote_id: id } }),
  });

  // Reference images live in a private bucket under the caller's own folder —
  // the storage policy lets the owner mint short-lived signed URLs.
  const imageKey = (data?.quote?.image_urls ?? []).join("|");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  useEffect(() => {
    const all = imageKey ? imageKey.split("|") : [];
    const external = all.filter((p) => /^https?:\/\//i.test(p));
    const paths = all.filter((p) => !/^https?:\/\//i.test(p));
    if (paths.length === 0) {
      setImageUrls(external);
      return;
    }
    let cancelled = false;
    void supabase.storage
      .from("quote-images")
      .createSignedUrls(paths, 300)
      .then(({ data: signed }) => {
        if (cancelled) return;
        setImageUrls([
          ...external,
          ...(signed ?? []).map((s) => s.signedUrl).filter((u): u is string => !!u),
        ]);
      });
    return () => {
      cancelled = true;
    };
  }, [imageKey]);

  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Quote request not found.</p>;

  const { quote, lines } = data;
  const expired =
    quote.quote_valid_until != null &&
    new Date(quote.quote_valid_until) < new Date(new Date().setHours(0, 0, 0, 0));
  const canRespond = quote.status === "quoted" && !expired;
  const published = quote.status === "quoted" || quote.status === "closed";

  return (
    <div>
      <PageHeader
        title={quote.product_name || "Quote request"}
        description={`Submitted ${formatDate(quote.created_at)}${quote.quote_valid_until ? ` · valid until ${formatDate(quote.quote_valid_until)}` : ""}`}
        actions={
          <>
            {published && <SpecialRequestMenu quoteId={id} hasOffers={lines.length > 0} />}
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link to="/sourcing/quotes">
                <ArrowLeft className="h-3.5 w-3.5" /> My quotes
              </Link>
            </Button>
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="p-4">
          <QuoteTimeline status={quote.status} />
        </CardContent>
      </Card>

      {quote.quote_due_at && (
        <QuoteSlaCountdown dueAt={quote.quote_due_at} status={quote.status} className="mb-6" />
      )}

      {/* Two fixed columns: offers ~60%, conversation ~40%, each scrolling on
          its own so the comparison and the thread stay side by side. */}
      <div className="grid gap-6 lg:h-[calc(100vh-20rem)] lg:min-h-[34rem] lg:grid-cols-5">
        <div className="flex min-h-0 flex-col gap-6 overflow-y-auto pr-1 lg:col-span-3">
          {lines.length === 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Your offers</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {quote.status === "submitted" || quote.status === "sourcing"
                    ? "We're sourcing this product — your pricing options will appear here."
                    : "No offers on this request."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <QuoteOfferCards
              quoteId={id}
              productName={quote.product_name ?? ""}
              canRespond={canRespond}
            />
          )}

          {expired && quote.status === "quoted" && (
            <p className="text-sm text-muted-foreground">
              This quote has expired. Ask us for a requote if you still need it.
            </p>
          )}
          {quote.status === "closed" && (
            <p className="text-sm text-muted-foreground">
              This quote is closed — accepted variants are in{" "}
              <Link to="/products" className="underline underline-offset-2">
                My products
              </Link>
              .
            </p>
          )}
        </div>

        <div className="flex min-h-0 flex-col gap-4 lg:col-span-2">
          <Card className="max-h-[40%] shrink-0 overflow-y-auto">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Request</CardTitle>
                <div className="flex items-center gap-2">
                  <QuoteStatusBadge status={quote.status} validUntil={quote.quote_valid_until} />
                  {quote.status === "quoted" && (
                    <QuoteValidityChip validUntil={quote.quote_valid_until} />
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Product URL
                </div>
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
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Your notes
                </div>
                <p className="whitespace-pre-wrap">{quote.notes || "—"}</p>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Volume / month
                </div>
                <div className="tnum">{quote.target_monthly_volume ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Target countries
                </div>
                <p>{quote.target_countries.map((c) => countryName(c)).join(", ") || "—"}</p>
              </div>
              {imageUrls.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Images
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {imageUrls.map((u, i) => (
                      <a key={i} href={u} target="_blank" rel="noreferrer">
                        <img
                          src={u}
                          alt={`Reference ${i + 1}`}
                          className="h-16 w-16 rounded-lg border border-border object-cover"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <QuoteThread quoteId={id} mode="client" className="min-h-0 flex-1" />
        </div>
      </div>
    </div>
  );
}
