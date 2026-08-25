import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { OrderStatusBadge, type OrderStatus } from "@/components/documents-ui";
import {
  DisputeReasonLabel,
  DisputeStatusBadge,
} from "@/components/DisputeThread";
import {
  AdminSearch,
  FilterTabs,
  PanelHeader,
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
import { formatDateTime, formatUSD } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  adminDisputeSkuReport,
  adminListDisputes,
} from "@/lib/disputes.functions";

export const Route = createFileRoute("/_authenticated/admin/disputes")({
  head: () => ({
    meta: [
      { title: "Disputes — FlySales Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminDisputesPage,
});

const TABS = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "investigating", label: "Investigating" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "closed", label: "Closed" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function AdminDisputesPage() {
  const [tab, setTab] = useState<TabId>("open");
  const [search, setSearch] = useState("");
  const fetchDisputes = useServerFn(adminListDisputes);
  const fetchSkuReport = useServerFn(adminDisputeSkuReport);

  const status = tab === "all" ? undefined : tab;
  const { data: disputes, isPending } = useQuery({
    queryKey: ["admin-disputes", status ?? "all"],
    queryFn: () => fetchDisputes({ data: status ? { status } : {} }),
  });
  // Counts always come from the unfiltered list so the summary bar is stable.
  const { data: allDisputes } = useQuery({
    queryKey: ["admin-disputes", "all"],
    queryFn: () => fetchDisputes({ data: {} }),
  });
  const { data: skuReport } = useQuery({
    queryKey: ["admin-dispute-sku-report"],
    queryFn: fetchSkuReport,
  });

  const counts = (allDisputes ?? []).reduce<Record<string, number>>((acc, d) => {
    acc[d.status] = (acc[d.status] ?? 0) + 1;
    return acc;
  }, {});

  const term = search.trim().toLowerCase();
  const rows = (disputes ?? []).filter((d) => {
    if (!term) return true;
    const order = d.orders as { external_order_number: string | null } | null;
    const store = d.stores as {
      store_name: string | null;
      entities: { legal_name: string } | null;
    } | null;
    return [
      order?.external_order_number ?? d.order_id,
      store?.store_name ?? "",
      store?.entities?.legal_name ?? "",
      d.reason,
    ]
      .join(" ")
      .toLowerCase()
      .includes(term);
  });

  return (
    <div className="space-y-8">
      <div>
        <PageHeader
          title="Disputes"
          description="Client claims, oldest first. Recurring disputes on the same SKU signal a failing supplier."
        />

        <SummaryBar
          className="lg:grid-cols-4"
          items={[
            {
              key: "open",
              label: "Open",
              value: counts["open"] ?? 0,
              tone: "warning",
              active: tab === "open",
              onClick: () => setTab("open"),
            },
            {
              key: "investigating",
              label: "Investigating",
              value: counts["investigating"] ?? 0,
              tone: "info",
              active: tab === "investigating",
              onClick: () => setTab("investigating"),
            },
            {
              key: "approved",
              label: "Approved",
              value: counts["approved"] ?? 0,
              tone: "success",
              active: tab === "approved",
              onClick: () => setTab("approved"),
            },
            {
              key: "rejected",
              label: "Rejected",
              value: counts["rejected"] ?? 0,
              tone: "danger",
              active: tab === "rejected",
              onClick: () => setTab("rejected"),
            },
          ]}
        />

        <ToolBar>
          <FilterTabs tabs={TABS} value={tab} onChange={setTab} />
          <AdminSearch
            value={search}
            onChange={setSearch}
            placeholder="Search by order, workspace or client"
          />
        </ToolBar>

        {isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No disputes here"
            hint="No disputes match this filter. New claims appear in Open, oldest first."
          />
        ) : (
          <TableShell>
            <Table className="text-[13px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-9">Opened</TableHead>
                  <TableHead className="h-9">Order</TableHead>
                  <TableHead className="h-9">Client</TableHead>
                  <TableHead className="h-9">Reason</TableHead>
                  <TableHead className="h-9 text-right">Order total</TableHead>
                  <TableHead className="h-9">Status</TableHead>
                  <TableHead className="h-9 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((d) => {
                  const order = d.orders as {
                    external_order_number: string | null;
                    status: string;
                    total_amount: number | null;
                    destination_country: string | null;
                  } | null;
                  const store = d.stores as {
                    store_name: string | null;
                    entities: { legal_name: string } | null;
                  } | null;
                  return (
                    <TableRow key={d.id} className="hover:bg-accent/60">
                      <TableCell className="whitespace-nowrap py-2.5 text-xs text-muted-foreground">
                        {formatDateTime(d.created_at)}
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Link
                          to="/admin/disputes/$id"
                          params={{ id: d.id }}
                          className="font-mono text-xs font-medium text-foreground underline-offset-2 hover:underline"
                        >
                          {order?.external_order_number ?? d.order_id.slice(0, 8)}
                        </Link>
                        <div className="mt-0.5">
                          <OrderStatusBadge
                            status={(order?.status ?? "awaiting_payment") as OrderStatus}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <span className="block max-w-[180px] truncate">
                          <Value>{store?.entities?.legal_name}</Value>
                        </span>
                        <span className="block max-w-[180px] truncate text-xs text-muted-foreground">
                          {store?.store_name ?? ""}
                        </span>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <DisputeReasonLabel reason={d.reason} />
                      </TableCell>
                      <TableCell className="tnum py-2.5 text-right">
                        {order?.total_amount != null ? (
                          formatUSD(order.total_amount)
                        ) : (
                          <Value>{null}</Value>
                        )}
                      </TableCell>
                      <TableCell className="py-2.5">
                        <DisputeStatusBadge status={d.status} />
                      </TableCell>
                      <TableCell className="py-2.5">
                        <RowActions>
                          <Button asChild variant="ghost" size="icon" className="h-7 w-7">
                            <Link
                              to="/admin/disputes/$id"
                              params={{ id: d.id }}
                              aria-label="Open claim"
                              title="Open claim"
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

      <div>
        <PanelHeader
          title="Dispute rate per SKU"
          description="When disputes accumulate on one product, the supplier is the problem."
        />
        {!skuReport || skuReport.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No disputed SKUs yet. When disputes accumulate on one product, it shows up here.
          </p>
        ) : (
          <TableShell>
            <Table className="text-[13px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-9">SKU</TableHead>
                  <TableHead className="h-9 text-right">Disputes</TableHead>
                  <TableHead className="h-9 text-right">Open</TableHead>
                  <TableHead className="h-9 text-right">Approved</TableHead>
                  <TableHead className="h-9">Latest</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {skuReport.map((row) => (
                  <TableRow key={row.sku} className="hover:bg-accent/60">
                    <TableCell className="py-2.5 font-mono text-xs font-medium">
                      {row.sku}
                    </TableCell>
                    <TableCell className="tnum py-2.5 text-right">{row.disputes}</TableCell>
                    <TableCell className="tnum py-2.5 text-right">
                      <span className={cn(row.open > 0 && "font-semibold text-warning")}>
                        {row.open}
                      </span>
                    </TableCell>
                    <TableCell className="tnum py-2.5 text-right">{row.approved}</TableCell>
                    <TableCell className="py-2.5 text-xs text-muted-foreground">
                      {formatDateTime(row.last_dispute_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableShell>
        )}
      </div>
    </div>
  );
}
