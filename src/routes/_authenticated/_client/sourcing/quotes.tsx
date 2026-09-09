import { createFileRoute, Link } from "@tanstack/react-router";
import { ProductCell } from "@/components/product-thumb";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { SectionTabs, SOURCING_TABS } from "@/components/section-tabs";
import { QuoteStatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { listMyQuotes } from "@/lib/quotes.functions";
import { listMyQuoteSignals } from "@/lib/quote-thread.functions";
import { cn } from "@/lib/utils";
import { useState } from "react";

type SavedView = "all" | "action" | "messages" | "expiring";

const VIEWS: { key: SavedView; label: string }[] = [
  { key: "all", label: "All" },
  { key: "action", label: "Action needed" },
  { key: "messages", label: "New messages" },
  { key: "expiring", label: "Expiring soon" },
];

/** Hours left on a quote, so anything under a day reads as urgent. */
function hoursLeft(validUntil: string | null): number | null {
  if (!validUntil) return null;
  const end = new Date(`${validUntil}T23:59:59`).getTime();
  return (end - Date.now()) / (60 * 60 * 1000);
}

export const Route = createFileRoute("/_authenticated/_client/sourcing/quotes")({
  head: () => ({
    meta: [{ title: "Quote requests — FlySales" }, { name: "robots", content: "noindex" }],
  }),
  component: MyQuotesPageInner,
});

function MyQuotesPageInner() {
  const fetchQuotes = useServerFn(listMyQuotes);
  const { data, isPending } = useQuery({
    queryKey: ["my-quotes"],
    queryFn: fetchQuotes,
  });

  const fetchSignals = useServerFn(listMyQuoteSignals);
  const { data: signals } = useQuery({ queryKey: ["my-quote-signals"], queryFn: fetchSignals });
  const unread = signals?.unread ?? {};
  const [view, setView] = useState<SavedView>("all");

  const allQuotes = data?.quotes ?? [];
  const quotes = allQuotes.filter((q) => {
    const left = hoursLeft(q.quote_valid_until);
    if (view === "action") return q.status === "quoted" && (left == null || left > 0);
    if (view === "messages") return (unread[q.id] ?? 0) > 0;
    if (view === "expiring") return left != null && left > 0 && left <= 72;
    return true;
  });

  return (
    <div>
      <PageHeader
        title="Quote requests"
        description="Every quote request you have sent, with its status and validity."
        actions={
          <Button asChild size="sm">
            <Link to="/sourcing/new">Request a quote</Link>
          </Button>
        }
      />
      <SectionTabs tabs={SOURCING_TABS} />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {VIEWS.map((v) => {
          const count =
            v.key === "messages"
              ? allQuotes.filter((q) => (unread[q.id] ?? 0) > 0).length
              : v.key === "action"
                ? allQuotes.filter((q) => q.status === "quoted").length
                : 0;
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              className={cn(
                "rounded-full border border-border px-3 py-1 text-xs font-medium",
                view === v.key ? "bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              {v.label}
              {count > 0 ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : allQuotes.length === 0 ? (
        <EmptyState
          title="No quote requests yet"
          hint="Paste a product link and get a firm price per variant and country within 48 hours."
          action={{ label: "Request a quote", to: "/sourcing/new" }}
        />
      ) : quotes.length === 0 ? (
        <EmptyState
          title="Nothing in this view"
          hint="Switch back to All to see every quote request you have sent."
        />
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Requested</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Vol./mo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Valid until</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotes.map((q) => (
                <TableRow key={q.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDate(q.created_at)}
                  </TableCell>
                  <TableCell className="max-w-64">
                    <ProductCell
                      imageUrls={(q as { image_urls?: string[] | null }).image_urls ?? []}
                      name={q.product_name || q.product_url}
                    />
                  </TableCell>
                  <TableCell className="text-right tnum text-sm">
                    {q.target_monthly_volume ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <QuoteStatusBadge status={q.status} validUntil={q.quote_valid_until} />
                      {(unread[q.id] ?? 0) > 0 && (
                        <Badge variant="secondary">{unread[q.id]} new</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {(() => {
                      const left = hoursLeft(q.quote_valid_until);
                      if (left != null && left > 0 && left <= 24) {
                        return (
                          <span className="font-medium text-destructive">
                            {Math.max(1, Math.round(left))}h left
                          </span>
                        );
                      }
                      return (
                        <span className="text-muted-foreground">
                          {q.quote_valid_until ? formatDate(q.quote_valid_until) : "—"}
                        </span>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      asChild
                      size="sm"
                      variant={q.status === "quoted" ? "default" : "outline"}
                    >
                      <Link to="/quotes/$id" params={{ id: q.id }}>
                        {q.status === "quoted" ? "Review prices" : "Open"}
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
