import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { QuoteSlaBadge } from "@/components/quote-sla";
import { QuoteStatusBadge, TierBadge } from "@/components/status-badges";
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
import { effectiveTier } from "@/lib/plans";
import { adminListQuotes } from "@/lib/quotes.functions";

const STATUSES = ["submitted", "sourcing", "quoted", "closed", "expired"] as const;

const searchSchema = z.object({
  status: z.enum(STATUSES).optional(),
});

export const Route = createFileRoute("/_authenticated/admin/quotes/")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Quote queue — FlySales Admin" },
      { name: "description", content: "All client quote requests, oldest first." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminQuotesPage,
});

function AdminQuotesPage() {
  const { status } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const fetchQuotes = useServerFn(adminListQuotes);

  const { data, isPending } = useQuery({
    queryKey: ["admin-quotes", status ?? "all"],
    queryFn: () => fetchQuotes({ data: status ? { status } : {} }),
  });

  const quotes = data?.quotes ?? [];

  // Worklist ordering: open requests first, most urgent (closest to / past
  // the 48h target) at the top; answered requests follow, newest first.
  const isOpen = (s: string) => s === "submitted" || s === "sourcing";
  const sorted = [...quotes].sort((a, b) => {
    const aOpen = isOpen(a.status);
    const bOpen = isOpen(b.status);
    if (aOpen && bOpen) {
      return new Date(a.quote_due_at).getTime() - new Date(b.quote_due_at).getTime();
    }
    if (aOpen) return -1;
    if (bOpen) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  const overdueCount = quotes.filter(
    (q) => isOpen(q.status) && new Date(q.quote_due_at).getTime() < Date.now(),
  ).length;

  return (
    <div>
      <PageHeader
        title="Quote queue"
        description="Open requests first, most urgent at the top."
      />

      {overdueCount > 0 && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
          {overdueCount} {overdueCount === 1 ? "request is" : "requests are"} past the 48h sourcing
          target.
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant={!status ? "default" : "outline"}
          onClick={() => void navigate({ search: {}, replace: true })}
        >
          All
        </Button>
        {STATUSES.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? "default" : "outline"}
            className="capitalize"
            onClick={() => void navigate({ search: { status: s }, replace: true })}
          >
            {s}
          </Button>
        ))}
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : sorted.length === 0 ? (
        <EmptyState title="No requests" hint={status ? `Nothing with status "${status}".` : "The queue is empty."} />
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Requested</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Vol./mo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>48h target</TableHead>
                <TableHead>Ref</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((q) => {
                const client = q.profiles as {
                  company_name?: string;
                  pricing_tier?: string;
                  tier_override?: string | null;
                } | null;
                const overdue =
                  isOpen(q.status) && new Date(q.quote_due_at).getTime() < Date.now();
                return (
                  <TableRow key={q.id} className={overdue ? "bg-destructive/5" : undefined}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(q.created_at)}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{client?.company_name ?? "—"}</div>
                      <TierBadge tier={effectiveTier(client?.pricing_tier, client?.tier_override)} />
                    </TableCell>
                    <TableCell className="max-w-56">
                      <div className="truncate text-sm">{q.product_name || q.product_url}</div>
                    </TableCell>
                    <TableCell className="text-right tnum text-sm">
                      {q.target_monthly_volume ?? "—"}
                    </TableCell>
                    <TableCell>
                      <QuoteStatusBadge status={q.status} validUntil={q.quote_valid_until} />
                    </TableCell>
                    <TableCell>
                      <QuoteSlaBadge dueAt={q.quote_due_at} status={q.status} />
                    </TableCell>
                    <TableCell className="max-w-32 truncate tnum text-xs text-muted-foreground">
                      {q.internal_reference ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link to="/admin/quotes/$id" params={{ id: q.id }}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
