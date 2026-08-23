import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { LineStatusBadge, QuoteStatusBadge } from "@/components/status-badges";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { countryName } from "@/lib/countries";
import { formatDate, formatUSD } from "@/lib/format";
import { getMyQuote, respondToQuoteLines } from "@/lib/quotes.functions";

export const Route = createFileRoute("/_authenticated/_client/quotes/$id")({
  head: () => ({
    meta: [
      { title: "Quote — FlySales" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MyQuoteDetailPage,
});

function MyQuoteDetailPage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const fetchQuote = useServerFn(getMyQuote);
  const callRespond = useServerFn(respondToQuoteLines);

  const { data, isPending } = useQuery({
    queryKey: ["my-quote", id],
    queryFn: () => fetchQuote({ data: { quote_id: id } }),
  });

  const [namingLineId, setNamingLineId] = useState<string | null>(null);
  const [productName, setProductName] = useState("");

  const respond = useMutation({
    mutationFn: (vars: { lineId: string; accept: boolean; name: string }) =>
      callRespond({
        data: {
          quote_id: id,
          product_name: vars.accept ? vars.name : "",
          decisions: [{ line_id: vars.lineId, accept: vars.accept }],
        },
      }),
    onSuccess: (r) => {
      setNamingLineId(null);
      setProductName("");
      if (r.accepted > 0) {
        toast.success("Variant accepted — it's now in your product catalogue.");
      } else {
        toast.success("Response saved.");
      }
      void queryClient.invalidateQueries({ queryKey: ["my-quote", id] });
      void queryClient.invalidateQueries({ queryKey: ["my-quotes"] });
      void queryClient.invalidateQueries({ queryKey: ["my-products"] });
    },
    onError: (err) => toast.error(err.message),
  });

  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Quote request not found.</p>;

  const { quote, lines } = data;
  const expired =
    quote.quote_valid_until != null &&
    new Date(quote.quote_valid_until) < new Date(new Date().setHours(0, 0, 0, 0));
  const canRespond = quote.status === "quoted" && !expired;
  const allAnswered = lines.length > 0 && lines.every((l) => l.status !== "pending");

  // Variant × country grid: rows are variants, columns the requested countries.
  const gridCountries =
    quote.target_countries.length > 0
      ? quote.target_countries
      : [...new Set(lines.map((l) => l.country_code).filter((c): c is string => c != null))];
  const variantRows = (() => {
    const map = new Map<
      string,
      { label: string; sku: string | null; moq: number | null; cells: Record<string, (typeof lines)[number]> }
    >();
    for (const l of lines) {
      const label = l.variant_label ?? "";
      let row = map.get(label);
      if (!row) {
        row = { label, sku: l.sku, moq: l.moq, cells: {} };
        map.set(label, row);
      }
      if (l.country_code) row.cells[l.country_code] = l;
    }
    return [...map.values()];
  })();

  return (
    <div>
      <PageHeader
        title={quote.product_name || "Quote request"}
        description={`Submitted ${formatDate(quote.created_at)}${quote.quote_valid_until ? ` · valid until ${formatDate(quote.quote_valid_until)}` : ""}`}
        actions={
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link to="/quotes">
              <ArrowLeft className="h-3.5 w-3.5" /> My quotes
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
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
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Your notes</div>
              <p className="whitespace-pre-wrap">{quote.notes || "—"}</p>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Volume / month</div>
              <div className="tnum">{quote.target_monthly_volume ?? "—"}</div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Variant pricing by country</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {lines.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                {quote.status === "submitted" || quote.status === "sourcing"
                  ? "We're sourcing this product — variant pricing will appear here."
                  : "No variant lines."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Variant</TableHead>
                      {gridCountries.map((c) => (
                        <TableHead key={c} title={countryName(c)}>
                          {c}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {variantRows.map((v) => (
                      <TableRow key={v.label}>
                        <TableCell className="align-top">
                          <div className="text-sm font-medium">{v.label}</div>
                          <div className="tnum text-xs text-muted-foreground">{v.sku}</div>
                          {v.moq != null && (
                            <div className="text-xs text-muted-foreground">MOQ {v.moq}</div>
                          )}
                        </TableCell>
                        {gridCountries.map((c) => {
                          const line = v.cells[c];
                          if (!line) {
                            return (
                              <TableCell key={c} className="align-top text-muted-foreground">
                                —
                              </TableCell>
                            );
                          }
                          return (
                            <TableCell key={c} className="align-top">
                              <div className="space-y-1.5">
                                <div className="tnum text-sm font-medium">
                                  {line.unit_price != null ? formatUSD(line.unit_price) : "—"}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {line.lead_time_days != null
                                    ? `${line.lead_time_days}d lead`
                                    : "lead time —"}
                                </div>
                                {line.status === "pending" && canRespond ? (
                                  <div className="flex gap-1">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 gap-1 px-2 text-xs"
                                      disabled={respond.isPending}
                                      onClick={() => {
                                        if (!line.id) return;
                                        setProductName(quote.product_name ?? "");
                                        setNamingLineId(line.id);
                                      }}
                                    >
                                      <Check className="h-3 w-3" /> Accept
                                    </Button>
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-7 gap-1 px-2 text-xs"
                                        >
                                          <X className="h-3 w-3" /> Reject
                                        </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>
                                            Reject {v.label} for {countryName(c)}?
                                          </AlertDialogTitle>
                                          <AlertDialogDescription>
                                            Rejected lines are kept as history and never become
                                            products. This cannot be undone.
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                                          <AlertDialogAction
                                            disabled={respond.isPending}
                                            onClick={() => {
                                              if (line.id)
                                                respond.mutate({
                                                  lineId: line.id,
                                                  accept: false,
                                                  name: "",
                                                });
                                            }}
                                          >
                                            Reject
                                          </AlertDialogAction>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  </div>
                                ) : (
                                  <LineStatusBadge status={line.status ?? "pending"} />
                                )}
                              </div>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {allAnswered && (
        <p className="mt-4 text-sm text-muted-foreground">
          All variants answered — accepted variants are now in{" "}
          <Link to="/products" className="underline underline-offset-2">
            My products
          </Link>
          .
        </p>
      )}
      {expired && quote.status === "quoted" && (
        <p className="mt-4 text-sm text-muted-foreground">
          This quote has expired. Ask us for a requote if you still need it.
        </p>
      )}

      <Dialog
        open={namingLineId != null}
        onOpenChange={(open) => {
          if (!open) setNamingLineId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Name your product</DialogTitle>
            <DialogDescription>
              Accepted variants become products in your catalogue. Variants of the same request
              share one product name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="mq-name">Product name</Label>
            <Input
              id="mq-name"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="e.g. Plush Bear — 20cm"
              maxLength={200}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNamingLineId(null)}>
              Cancel
            </Button>
            <Button
              disabled={respond.isPending || productName.trim().length < 2}
              onClick={() => {
                if (!namingLineId) return;
                respond.mutate({ lineId: namingLineId, accept: true, name: productName.trim() });
              }}
            >
              {respond.isPending ? "Accepting…" : "Accept variant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
