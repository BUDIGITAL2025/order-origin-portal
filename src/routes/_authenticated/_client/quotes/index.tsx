import { StoreGate } from "@/components/store-gate";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@/components/app-shell";
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
import { formatDate } from "@/lib/format";
import { listMyQuotes } from "@/lib/quotes.functions";

export const Route = createFileRoute("/_authenticated/_client/quotes/")({
  head: () => ({
    meta: [
      { title: "My quotes — FlySales" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MyQuotesPageGated,
});

function MyQuotesPageInner() {
  const fetchQuotes = useServerFn(listMyQuotes);
  const { data, isPending } = useQuery({
    queryKey: ["my-quotes"],
    queryFn: fetchQuotes,
  });

  const quotes = data?.quotes ?? [];

  return (
    <div>
      <PageHeader
        title="My quotes"
        description="Every sourcing request you've sent us."
        actions={
          <Button asChild size="sm">
            <Link to="/quotes/new">Request a quote</Link>
          </Button>
        }
      />

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : quotes.length === 0 ? (
        <EmptyState
          title="No quote requests yet"
          hint="Send us a product link and we'll come back with per-variant pricing."
          action={{ label: "Request a quote", to: "/quotes/new" }}
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
                    <div className="truncate text-sm">{q.product_name || q.product_url}</div>
                  </TableCell>
                  <TableCell className="text-right tnum text-sm">
                    {q.target_monthly_volume ?? "—"}
                  </TableCell>
                  <TableCell>
                    <QuoteStatusBadge status={q.status} validUntil={q.quote_valid_until} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {q.quote_valid_until ? formatDate(q.quote_valid_until) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant={q.status === "quoted" ? "default" : "outline"}>
                      <Link to="/quotes/$id" params={{ id: q.id }}>
                        {q.status === "quoted" ? "Review & respond" : "Open"}
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

function MyQuotesPageGated() {
  return (
    <StoreGate feature="Quotes">
      <MyQuotesPageInner />
    </StoreGate>
  );
}
