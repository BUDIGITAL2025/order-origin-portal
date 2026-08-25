import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { OrderStatusBadge } from "@/components/documents-ui";
import { OpenDisputeDialog } from "@/components/OpenDisputeDialog";
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
import { getMyOrder } from "@/lib/orders.functions";

export const Route = createFileRoute("/_authenticated/_client/orders/$id")({
  head: () => ({
    meta: [
      { title: "Order — FlySales" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OrderDetailPage,
});

/** Orders in these states can be disputed (database enforces the windows). */
const DISPUTABLE = new Set(["paid", "processing", "shipped", "delivered"]);

function OrderDetailPage() {
  const { id } = Route.useParams();
  const fetchOrder = useServerFn(getMyOrder);
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: ["my-order", id],
    queryFn: () => fetchOrder({ data: { order_id: id } }),
  });
  const [disputeOpen, setDisputeOpen] = useState(false);

  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) {
    return (
      <p className="text-sm text-muted-foreground">
        {error instanceof Error ? error.message : "Order not found."}
      </p>
    );
  }

  const { order, maxLeadTimeDays, disputes } = data;
  const canDispute =
    DISPUTABLE.has(order.status) &&
    !disputes.some((d) => d.status === "open" || d.status === "investigating");
  const address = (order.shipping_address ?? {}) as Record<string, string>;

  return (
    <div>
      <Link
        to="/orders"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All orders
      </Link>
      <PageHeader
        title={`Order ${order.external_order_number ?? order.id.slice(0, 8)}`}
        description={`Placed ${formatDateTime(order.created_at)}${order.destination_country ? ` · ships to ${order.destination_country}` : ""}`}
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <OrderStatusBadge status={order.status} />
        {order.total_amount != null && (
          <span className="tnum text-sm font-semibold">{formatUSD(order.total_amount)}</span>
        )}
        {canDispute && (
          <Button size="sm" variant="outline" onClick={() => setDisputeOpen(true)}>
            Open a claim
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card lg:col-span-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.order_items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="tnum text-xs font-medium">{item.sku ?? "—"}</TableCell>
                  <TableCell className="text-right tnum text-sm">
                    {Math.max(1, item.quantity ?? 1)}
                  </TableCell>
                  <TableCell className="text-right tnum text-sm">
                    {item.unit_price != null ? formatUSD(item.unit_price) : "—"}
                  </TableCell>
                  <TableCell className="text-right tnum text-sm">
                    {item.line_total != null ? formatUSD(item.line_total) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="mb-2 text-base font-semibold">Delivery</h2>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Paid</dt>
                <dd>{order.paid_at ? formatDateTime(order.paid_at) : "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Shipped</dt>
                <dd>{order.shipped_at ? formatDateTime(order.shipped_at) : "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Delivered</dt>
                <dd>{order.delivered_at ? formatDateTime(order.delivered_at) : "—"}</dd>
              </div>
              {order.tracking_number && (
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Tracking</dt>
                  <dd className="tnum flex items-center gap-1.5 text-xs">
                    {order.tracking_carrier}: {order.tracking_number}
                    <button
                      type="button"
                      aria-label="Copy tracking number"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        void navigator.clipboard.writeText(order.tracking_number!);
                        toast.success("Tracking number copied");
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </dd>
                </div>
              )}
            </dl>
            {Object.keys(address).length > 0 && (
              <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                {[address["name"], address["address1"], address["city"], address["country"]]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="mb-2 text-base font-semibold">Claims</h2>
            {disputes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No claims on this order.</p>
            ) : (
              <ul className="space-y-2">
                {disputes.map((d) => (
                  <li key={d.id}>
                    <Link
                      to="/disputes/$id"
                      params={{ id: d.id }}
                      className="flex items-center justify-between rounded-lg border border-border p-2 text-sm hover:bg-muted/50"
                    >
                      <DisputeReasonLabel reason={d.reason} />
                      <DisputeStatusBadge status={d.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <OpenDisputeDialog
        orderId={order.id}
        orderStatus={order.status}
        paidAt={order.paid_at}
        deliveredAt={order.delivered_at}
        maxLeadTimeDays={maxLeadTimeDays}
        open={disputeOpen}
        onOpenChange={setDisputeOpen}
        onOpened={() => queryClient.invalidateQueries()}
      />
    </div>
  );
}
