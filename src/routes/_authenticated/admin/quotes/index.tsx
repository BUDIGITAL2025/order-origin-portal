import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { z } from "zod";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { QuoteSlaBadge } from "@/components/quote-sla";
import { QuoteStatusBadge, TierBadge } from "@/components/status-badges";
import {
  AdminSearch,
  FilterTabs,
  RowActions,
  SummaryBar,
  TableShell,
  ToolBar,
  Value,
} from "@/components/admin-ui";
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
import { cn } from "@/lib/utils";

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

const TABS = [
  { id: "all", label: "All" },
  ...STATUSES.map((s) => ({ id: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
] as const;
type TabId = (typeof TABS)[number]["id"];

const HOUR = 3600_000;

/** Countdown to the 48h sourcing target, rendered in mono. */
function countdown(dueAt: string): string {
  const diff = new Date(dueAt).getTime() - Date.now();
  const abs = Math.abs(diff);
  const h = Math.floor(abs / HOUR);
  const m = Math.floor((abs % HOUR) / 60_000);
  const label = `${h}h ${String(m).padStart(2, "0")}m`;
  return diff < 0 ? `-${label}` : label;
}

function AdminQuotesPage() {
  const { status } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const fetchQuotes = useServerFn(adminListQuotes);
  const [search, setSearch] = useState("");

  const { data, isPending } = useQuery({
    queryKey: ["admin-quotes", status ?? "all"],
    queryFn: () => fetchQuotes({ data: status ? { status } : {} }),
  });

  const quotes = data?.quotes ?? [];

  // Worklist ordering: open requests first, most urgent (closest to / past
  // the 48h target) at the top; answered requests follow, newest first.
  const isOpen = (s: string) => s === "submitted" || s === "sourcing";
  const sorted = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = quotes.filter((q) => {
      if (!term) return true;
      const client = q.profiles as { company_name?: string } | null;
      return [q.product_name ?? "", q.product_url ?? "", q.internal_reference ?? "", client?.company_name ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
    return [...list].sort((a, b) => {
      const aOpen = isOpen(a.status);
      const bOpen = isOpen(b.status);
      if (aOpen && bOpen) {
        return new Date(a.quote_due_at).getTime() - new Date(b.quote_due_at).getTime();
      }
      if (aOpen) return -1;
      if (bOpen) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [quotes, search]);

  const now = Date.now();
  const openQuotes = quotes.filter((q) => isOpen(q.status));
  const overdueCount = openQuotes.filter((q) => new Date(q.quote_due_at).getTime() < now).length;
  const dueSoonCount = openQuotes.filter((q) => {
    const t = new Date(q.quote_due_at).getTime();
    return t >= now && t - now < 12 * HOUR;
  }).length;
  const quotedToday = quotes.filter(
    (q) => q.status === "quoted" && new Date(q.created_at).toDateString() === new Date().toDateString(),
  ).length;

  return (
    <div>
      <PageHeader
        title="Quote queue"
        description="Open requests first, most urgent at the top."
      />

      <SummaryBar
        className="lg:grid-cols-4"
        items={[
          { key: "open", label: "Open", value: openQuotes.length, tone: "primary" },
          { key: "soon", label: "Due < 12h", value: dueSoonCount, tone: "warning" },
          { key: "overdue", label: "Overdue", value: overdueCount, tone: "danger" },
          { key: "today", label: "Quoted today", value: quotedToday, tone: "success" },
        ]}
      />

      <ToolBar>
        <FilterTabs
          tabs={TABS}
          value={(status ?? "all") as TabId}
          onChange={(id) =>
            void navigate({
              search: id === "all" ? {} : { status: id as (typeof STATUSES)[number] },
              replace: true,
            })
          }
        />
        <AdminSearch
          value={search}
          onChange={setSearch}
          placeholder="Search by product, client or internal reference"
        />
      </ToolBar>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : sorted.length === 0 ? (
        <EmptyState
          title="No requests"
          hint={status ? `Nothing with status "${status}".` : "The queue is empty."}
        />
      ) : (
        <TableShell>
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow>
                <TableHead className="h-9">Requested</TableHead>
                <TableHead className="h-9">Client</TableHead>
                <TableHead className="h-9">Product</TableHead>
                <TableHead className="h-9 text-right">Vol./mo</TableHead>
                <TableHead className="h-9">Status</TableHead>
                <TableHead className="h-9">48h target</TableHead>
                <TableHead className="h-9">Ref</TableHead>
                <TableHead className="h-9 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((q) => {
                const client = q.profiles as {
                  company_name?: string;
                  pricing_tier?: string;
                  tier_override?: string | null;
                } | null;
                const due = new Date(q.quote_due_at).getTime();
                const open = isOpen(q.status);
                const overdue = open && due < now;
                const dueSoon = open && !overdue && due - now < 12 * HOUR;
                return (
                  <TableRow
                    key={q.id}
                    className={cn(
                      "hover:bg-accent/60",
                      overdue && "border-l-2 border-l-destructive bg-destructive/5",
                      dueSoon && "border-l-2 border-l-warning bg-warning/5",
                    )}
                  >
                    <TableCell className="whitespace-nowrap py-2.5 text-xs text-muted-foreground">
                      {formatDate(q.created_at)}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <div className="max-w-[180px] truncate font-medium">
                        <Value>{client?.company_name}</Value>
                      </div>
                      <TierBadge tier={effectiveTier(client?.pricing_tier, client?.tier_override)} />
                    </TableCell>
                    <TableCell className="max-w-56 py-2.5">
                      <div className="truncate">{q.product_name || q.product_url}</div>
                    </TableCell>
                    <TableCell className="tnum py-2.5 text-right">
                      <Value>{q.target_monthly_volume}</Value>
                    </TableCell>
                    <TableCell className="py-2.5">
                      <QuoteStatusBadge status={q.status} validUntil={q.quote_valid_until} />
                    </TableCell>
                    <TableCell className="py-2.5">
                      <div className="flex flex-col items-start gap-1">
                        <QuoteSlaBadge dueAt={q.quote_due_at} status={q.status} />
                        {open && (
                          <span
                            className={cn(
                              "font-mono text-[11px]",
                              overdue
                                ? "text-destructive"
                                : dueSoon
                                  ? "text-warning"
                                  : "text-muted-foreground",
                            )}
                          >
                            {countdown(q.quote_due_at)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-32 truncate py-2.5 font-mono text-xs text-muted-foreground">
                      <Value>{q.internal_reference}</Value>
                    </TableCell>
                    <TableCell className="py-2.5">
                      <RowActions>
                        <Button asChild variant="ghost" size="icon" className="h-7 w-7">
                          <Link
                            to="/admin/quotes/$id"
                            params={{ id: q.id }}
                            aria-label="Open request"
                            title="Open request"
                          >
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      </RowActions>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableShell>
      )}
    </div>
  );
}
