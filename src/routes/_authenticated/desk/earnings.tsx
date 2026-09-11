import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { SectionTabs, DESK_TABS } from "@/components/section-tabs";
import { Chip, SummaryBar, TableShell } from "@/components/admin-ui";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatUSD } from "@/lib/format";
import { pct, tierTermsSentence } from "@/lib/fee-tiers";
import { sourcingMyEarnings } from "@/lib/sourcing.functions";

export const Route = createFileRoute("/_authenticated/desk/earnings")({
  head: () => ({
    meta: [
      { title: "My earnings — FlySales" },
      {
        name: "description",
        content: "Commission accrued on the units your sourced products actually sell.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EarningsPage,
});

function EarningsPage() {
  const fetchEarnings = useServerFn(sourcingMyEarnings);
  const { data, isPending } = useQuery({
    queryKey: ["sourcing-my-earnings"],
    queryFn: fetchEarnings,
  });

  const rows = data?.rows ?? [];

  return (
    <div>
      <PageHeader
        title="My earnings"
        description="Your fee accrues on every unit sold or purchased from a product you sourced."
      />
      <SectionTabs tabs={DESK_TABS} />

      {data?.tier && data.tiers ? (
        <div className="mb-4 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Your service fee right now
              </p>
              <p className="text-2xl font-semibold tnum">{pct(data.tier.rate)}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Your service fee: {tierTermsSentence(data.tiers)}.
            </p>
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.round(data.tier.progress * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {data.tier.nextAt != null
              ? `${data.tier.count} / ${data.tier.nextAt} paid transactions — ${
                  data.tier.nextRate != null ? pct(data.tier.nextRate) : "the next rate"
                } after ${data.tier.nextAt}`
              : `${data.tier.count} paid transactions — you are on your final rate.`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            The rate is locked onto every quote the moment you price it, so crossing a tier never
            changes a price you already gave.
          </p>
        </div>
      ) : null}

      <SummaryBar
        items={[
          {
            key: "pending",
            label: "Awaiting payout",
            value: formatUSD(data?.pending ?? 0),
            tone: "primary",
          },
          {
            key: "settled",
            label: "Paid out",
            value: formatUSD(data?.settled ?? 0),
            tone: "success",
          },
          { key: "lines", label: "Entries", value: String(rows.length) },
        ]}
      />

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No commission yet"
          hint="Once a client buys a product you sourced, your fee shows up here automatically."
        />
      ) : (
        <TableShell>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatDate(r.accrued_at)}
                </TableCell>
                <TableCell className="text-sm">{r.description}</TableCell>
                <TableCell className="text-right tnum text-sm">{r.units}</TableCell>
                <TableCell className="text-right tnum text-xs text-muted-foreground">
                  {(Number(r.fee_rate) * 100).toFixed(1)}%
                </TableCell>
                <TableCell className="text-right tnum text-sm font-medium">
                  {formatUSD(Number(r.amount))}
                </TableCell>
                <TableCell>
                  {r.settled ? (
                    <Chip tone="success">Paid {r.settled_at ? formatDate(r.settled_at) : ""}</Chip>
                  ) : (
                    <Chip tone="warning">Awaiting payout</Chip>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableShell>
      )}
    </div>
  );
}
