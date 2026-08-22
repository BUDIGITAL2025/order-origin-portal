import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { EmptyState, PageHeader } from "@/components/app-shell";
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
import { formatDate, formatUSD } from "@/lib/format";
import { adminListQuotes } from "@/lib/quotes.functions";

const STATUSES = ["submitted", "sourcing", "quoted", "accepted", "rejected", "expired"] as const;

const searchSchema = z.object({
  status: z.enum(STATUSES).optional(),
});

export const Route = createFileRoute("/_authenticated/admin/quotes/")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Quote queue — Relay Sourcing Admin" },
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

  return (
    <div>
      <PageHeader title="Quote queue" description="All client requests, oldest first." />

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
      ) : quotes.length === 0 ? (
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
                <TableHead className="text-right">Quoted</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotes.map((q) => {
                const client = q.profiles as { company_name?: string; markup_tier?: string } | null;
                return (
                  <TableRow key={q.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(q.created_at)}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{client?.company_name ?? "—"}</div>
                      <TierBadge tier={client?.markup_tier ?? null} />
                    </TableCell>
                    <TableCell className="max-w-56">
                      <div className="truncate text-sm">{q.product_name || q.product_url}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {q.target_monthly_volume ?? "—"}
                    </TableCell>
                    <TableCell>
                      <QuoteStatusBadge status={q.status} validUntil={q.quote_valid_until} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {q.quoted_price_total != null ? formatUSD(q.quoted_price_total) : "—"}
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
