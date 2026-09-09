/**
 * Client offer cards: up to three anonymous options on one quote, laid out
 * identically so they read top-to-bottom as a comparison. Suppliers are never
 * named — risk is expressed as our own dispute history plus a quality bar.
 */
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Star } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { countryName } from "@/lib/countries";
import { formatUSD } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { createQuoteIntent } from "@/lib/quote-intents.functions";
import { acceptQuoteOption, listQuoteOffers } from "@/lib/quote-offers.functions";
import { cn } from "@/lib/utils";

function leadLabel(days: number | null): string {
  if (days == null) return "—";
  return `${Number.isInteger(days) ? days : days.toFixed(1)} days`;
}

/** Three-segment bar. Quality is our own assessment, never the supplier's name. */
function QualityBar({ quality }: { quality: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 w-5 rounded-full",
              i <= quality ? "bg-primary" : "bg-muted-foreground/20",
            )}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground">
        {quality === 3 ? "High" : quality === 2 ? "Medium" : "Low"}
      </span>
    </div>
  );
}

export function QuoteOfferCards({
  quoteId,
  productName,
  canRespond,
}: {
  quoteId: string;
  productName: string;
  canRespond: boolean;
}) {
  const queryClient = useQueryClient();
  const fetchOffers = useServerFn(listQuoteOffers);
  const callAccept = useServerFn(acceptQuoteOption);

  const { data, isPending } = useQuery({
    queryKey: ["quote-offers", quoteId],
    queryFn: () => fetchOffers({ data: { quote_id: quoteId } }),
  });

  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [name, setName] = useState(productName);

  // "Cancel request" is the client asking us to stop quoting — it goes through
  // the same typed-request queue as every other structured ask.
  const callIntent = useServerFn(createQuoteIntent);
  const cancel = useMutation({
    mutationFn: () => callIntent({ data: { quote_id: quoteId, type: "stop_quoting" } }),
    onSuccess: () => {
      setCancelling(false);
      toast.success("We'll stop quoting this product.");
      void queryClient.invalidateQueries({ queryKey: ["quote-thread", quoteId] });
    },
    onError: (err) => toast.error(friendlyError(err)),
  });

  const accept = useMutation({
    mutationFn: () =>
      callAccept({ data: { option_id: selected!, product_name: name.trim() } }),
    onSuccess: () => {
      setConfirming(false);
      toast.success("Offer accepted — the product and its SKUs are in your catalogue.");
      void queryClient.invalidateQueries({ queryKey: ["quote-offers", quoteId] });
      void queryClient.invalidateQueries({ queryKey: ["my-quote", quoteId] });
      void queryClient.invalidateQueries({ queryKey: ["my-products"] });
    },
    onError: (err) => toast.error(friendlyError(err)),
  });

  if (isPending) return <p className="text-sm text-muted-foreground">Loading offers…</p>;
  const offers = data?.offers ?? [];
  if (offers.length === 0) return null;

  const allVariants = data?.all_variants ?? [];
  const acceptedOption = offers.find((o) => o.accepted_at != null);

  return (
    <div className="space-y-3">
      {offers.map((offer) => {
        const isSelected = selected === offer.id;
        const isAccepted = offer.accepted_at != null;
        const prices = offer.lines
          .map((l) => l.unit_price)
          .filter((p): p is number => typeof p === "number" && p > 0);
        const from = prices.length > 0 ? Math.min(...prices) : null;
        const countries = [...new Set(offer.lines.map((l) => l.country_code))];

        return (
          <Card
            key={offer.id}
            className={cn(
              "transition-colors",
              (isSelected || isAccepted) &&
                "border-primary bg-primary/[0.06] ring-1 ring-primary/40",
            )}
          >
            <CardContent className="space-y-4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold">Option {offer.letter}</span>
                  {offer.recommended && (
                    <Badge className="gap-1">
                      <Star className="h-3 w-3" /> Recommended
                    </Badge>
                  )}
                  {isAccepted && <Badge variant="secondary">Accepted</Badge>}
                  {isSelected && !isAccepted && <Badge variant="secondary">Selected</Badge>}
                </div>
                {canRespond && !acceptedOption && (
                  <Button
                    size="sm"
                    variant={isSelected ? "default" : "outline"}
                    className="gap-1.5"
                    onClick={() => setSelected(isSelected ? null : offer.id)}
                  >
                    {isSelected ? <Check className="h-3.5 w-3.5" /> : null}
                    {isSelected ? "Selected" : "Select"}
                  </Button>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-4">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">From</div>
                  <div className="tnum text-lg font-semibold">
                    {from != null ? formatUSD(from) : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {countries.length} destination{countries.length === 1 ? "" : "s"}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">MOQ</div>
                  <div className="tnum text-sm">{offer.moq ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Production
                  </div>
                  <div className="tnum text-sm">{leadLabel(offer.production_lead_days)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Shipping
                  </div>
                  <div className="tnum text-sm">{leadLabel(offer.shipping_lead_days)}</div>
                </div>
              </div>

              <div className="grid gap-4 border-t border-border pt-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Quality
                  </div>
                  <div className="mt-1">
                    <QualityBar quality={offer.quality} />
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Dispute rate
                  </div>
                  <div className="tnum mt-1 text-sm">
                    {offer.dispute_rate != null ? (
                      `${offer.dispute_rate}% of past orders`
                    ) : (
                      <span className="text-muted-foreground">Not enough history yet</span>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                onClick={() => setExpanded(expanded === offer.id ? null : offer.id)}
              >
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", expanded === offer.id && "rotate-180")}
                />
                Variant pricing by country
              </button>

              {expanded === offer.id && (
                <div className="space-y-3">
                  {allVariants.map((variant) => {
                    const rows = offer.lines.filter((l) => l.variant_label === variant);
                    const covered = rows.length > 0;
                    return (
                      <div key={variant} className="rounded-lg border border-border p-3">
                        <div
                          className={cn(
                            "text-sm font-medium",
                            !covered && "text-muted-foreground line-through",
                          )}
                        >
                          {variant}
                        </div>
                        {covered ? (
                          <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
                            {rows.map((l) => (
                              <div
                                key={`${l.variant_label}-${l.country_code}`}
                                className="flex items-center justify-between text-sm"
                              >
                                <span className="text-muted-foreground">
                                  {countryName(l.country_code)}
                                </span>
                                <span className="tnum">
                                  {l.unit_price != null ? formatUSD(l.unit_price) : "—"}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="tnum mt-1 text-sm text-muted-foreground line-through">
                            $0.00 — not covered by this option
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {canRespond && !acceptedOption && (
        <div className="sticky bottom-0 -mx-1 flex items-center gap-2 border-t border-border bg-card/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <Button
            variant="outline"
            className="shrink-0"
            disabled={cancel.isPending}
            onClick={() => setCancelling(true)}
          >
            Cancel request
          </Button>
          <Button
            className="flex-1"
            disabled={!selected}
            onClick={() => {
              setName(productName);
              setConfirming(true);
            }}
          >
            {selected ? "Accept selected offer" : "Select an offer"}
          </Button>
        </div>
      )}

      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this request?</DialogTitle>
            <DialogDescription>
              We stop quoting this product. The offers here stay visible until they expire, and you
              can always submit a new request later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(false)}>
              Keep it open
            </Button>
            <Button
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              {cancel.isPending ? "Cancelling…" : "Cancel request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accept this offer?</DialogTitle>
            <DialogDescription>
              This becomes your closed price. The product and its SKUs are created in your catalog,
              and the other options on this quote are archived.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="offer-name">Product name</Label>
            <Input
              id="offer-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="e.g. Plush Bear — 20cm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              disabled={accept.isPending || name.trim().length < 2}
              onClick={() => accept.mutate()}
            >
              {accept.isPending ? "Accepting…" : "Accept offer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
