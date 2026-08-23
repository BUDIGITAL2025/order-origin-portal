import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { OrderStatusBadge } from "@/components/documents-ui";
import {
  DisputeReasonLabel,
  DisputeStatusBadge,
} from "@/components/DisputeThread";
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

const FILTERS = [
  { value: undefined, label: "All" },
  { value: "open", label: "Open" },
  { value: "investigating", label: "Investigating" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "closed", label: "Closed" },
] as const;

function AdminDisputesPage() {
  const [status, setStatus] = useState<string | undefined>("open");
  const fetchDisputes = useServerFn(adminListDisputes);
  const fetchSkuReport = useServerFn(adminDisputeSkuReport);

  const { data: disputes, isPending } = useQuery({
    queryKey: ["admin-disputes", status ?? "all"],
    queryFn: () => fetchDisputes({ data: status ? { status } : {} }),
  });
  const { data: skuReport } = useQuery({
    queryKey: ["admin-dispute-sku-report"],
    queryFn: fetchSkuReport,
  });

  return (
    <div>
      <PageHeader
        title="Disputes"
        description="Client claims, oldest first. Recurring disputes on the same SKU signal a failing supplier."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.label}
            size="sm"
            variant={status === f.value ? "default" : "outline"}
            onClick={() => setStatus(f.value)}
            className={cn(status !== f.value && "text-muted-foreground")}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !disputes || disputes.length === 0 ? (
        <EmptyState
          title="No disputes here"
          description="No disputes match this filter. New claims appear in Open, oldest first."
        />
      ) : (
        <div className="mb-8 rounded-2xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Opened</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Order total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {disputes.map((d) => {
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
                  <TableRow key={d.id}>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(d.created_at)}
                    </TableCell>
                    <TableCell>
                      <Link
                        to="/admin/disputes/$id"
                        params={{ id: d.id }}
                        className="tnum text-xs font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        {order?.external_order_number ?? d.order_id.slice(0, 8)}
                      </Link>
                      <div className="mt-0.5">
                        <OrderStatusBadge status={order?.status ?? ""} />
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {store?.entities?.legal_name ?? "—"}
                      <span className="block text-xs text-muted-foreground">
                        {store?.store_name ?? ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      <DisputeReasonLabel reason={d.reason} />
                    </TableCell>
                    <TableCell className="tnum text-right text-sm">
                      {order?.total_amount != null ? formatUSD(order.total_amount) : "—"}
                    </TableCell>
                    <TableCell>
                      <DisputeStatusBadge status={d.status} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <h2 className="mb-3 text-xl font-semibold">Dispute rate per SKU</h2>
      {!skuReport || skuReport.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No disputed SKUs yet. When disputes accumulate on one product, it shows up here.
        </p>
      ) : (
        <div className="rounded-2xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Disputes</TableHead>
                <TableHead className="text-right">Open</TableHead>
                <TableHead className="text-right">Approved</TableHead>
                <TableHead>Latest</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {skuReport.map((row) => (
                <TableRow key={row.sku}>
                  <TableCell className="tnum text-xs font-medium">{row.sku}</TableCell>
                  <TableCell className="tnum text-right text-sm">{row.disputes}</TableCell>
                  <TableCell className="tnum text-right text-sm">
                    <span className={cn(row.open > 0 && "font-semibold text-warning")}>
                      {row.open}
                    </span>
                  </TableCell>
                  <TableCell className="tnum text-right text-sm">{row.approved}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateTime(row.last_dispute_at)}
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
