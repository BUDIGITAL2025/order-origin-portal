import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { SectionTabs, DESK_TABS } from "@/components/section-tabs";
import { SummaryBar, TableShell, Chip } from "@/components/admin-ui";
import { Button } from "@/components/ui/button";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { sourcingListQueue } from "@/lib/sourcing.functions";

export const Route = createFileRoute("/_authenticated/desk/queue")({
  head: () => ({
    meta: [
      { title: "Sourcing queue — FlySales" },
      {
        name: "description",
        content: "Requests waiting for a supplier and a supplier price from the sourcing desk.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: QueuePage,
});

function QueuePage() {
  const fetchQueue = useServerFn(sourcingListQueue);
  const { data, isPending } = useQuery({ queryKey: ["sourcing-queue"], queryFn: fetchQueue });

  const quotes = data?.quotes ?? [];
  const mine = quotes.filter((q) => q.mine);
  const open = quotes.filter((q) => q.priced_lines === 0);

  return (
    <div>
      <PageHeader
        title="Sourcing queue"
        description="Pick up a request, find a supplier and enter the supplier price. Your fee is added automatically."
      />
      <SectionTabs tabs={DESK_TABS} />

      <SummaryBar
        items={[
          { key: "queue", label: "In queue", value: String(quotes.length) },
          { key: "mine", label: "Assigned to me", value: String(mine.length), tone: "primary" },
          { key: "open", label: "Not priced yet", value: String(open.length), tone: "warning" },
          { key: "fee", label: "Your fee", value: `${((data?.feeRate ?? 0) * 100).toFixed(1)}%` },
        ]}
      />

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : quotes.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          hint="New sourcing requests land here as soon as a client submits them."
        />
      ) : (
        <TableShell>
          <TableHeader>
            <TableRow>
              <TableHead>Received</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Countries</TableHead>
              <TableHead className="text-right">Vol./mo</TableHead>
              <TableHead>Priced</TableHead>
              <TableHead>Due</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotes.map((q) => (
              <TableRow key={q.id}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatDate(q.created_at)}
                </TableCell>
                <TableCell className="max-w-72">
                  <div className="truncate text-sm">
                    {q.product_name || q.product_url || "Product request"}
                  </div>
                  {q.mine ? <Chip tone="primary">Mine</Chip> : null}
                </TableCell>
                <TableCell className="text-xs uppercase text-muted-foreground">
                  {(q.target_countries ?? []).join(", ") || "—"}
                </TableCell>
                <TableCell className="text-right tnum text-sm">
                  {q.target_monthly_volume ?? "—"}
                </TableCell>
                <TableCell>
                  {q.priced_lines > 0 ? (
                    <Chip tone="success">{q.priced_lines} variants</Chip>
                  ) : (
                    <Chip tone="warning">Not priced</Chip>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {q.quote_due_at ? formatDate(q.quote_due_at) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant={q.priced_lines ? "outline" : "default"}>
                    <Link to="/desk/quote/$id" params={{ id: q.id }}>
                      {q.priced_lines ? "Open" : "Source it"}
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableShell>
      )}
    </div>
  );
}
