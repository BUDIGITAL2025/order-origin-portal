import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@/components/app-shell";
import {
  DocumentDownloadButton,
  OrderStatusBadge,
} from "@/components/documents-ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatUSD } from "@/lib/format";
import { listMyOrders } from "@/lib/orders.functions";
import { listMyDocuments } from "@/lib/documents.functions";

export const Route = createFileRoute("/_authenticated/_client/orders")({
  head: () => ({
    meta: [
      { title: "Orders — FlySales" },
      { name: "description", content: "Your orders, their payment status and receipts." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OrdersPage,
});

function OrdersPage() {
  const fetchOrders = useServerFn(listMyOrders);
  const fetchDocuments = useServerFn(listMyDocuments);
  const { data: orders, isPending } = useQuery({
    queryKey: ["my-orders"],
    queryFn: fetchOrders,
  });
  const { data: documents } = useQuery({
    queryKey: ["my-documents"],
    queryFn: fetchDocuments,
  });

  // order_id → receipt document, for the per-order download link.
  const receiptByOrder = new Map(
    (documents ?? [])
      .filter((d) => d.order_id)
      .map((d) => [d.order_id as string, d.id] as const),
  );

  const rows = orders ?? [];

  return (
    <div>
      <PageHeader
        title="Orders"
        description="Every order synced from your store, its payment status and its payment receipt."
      />

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No orders yet"
          hint="Orders from your store will appear here once your integration is live."
        />
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((order) => {
                const receiptId = receiptByOrder.get(order.id);
                return (
                  <TableRow key={order.id}>
                    <TableCell className="tnum text-xs font-medium">
                      {order.external_order_number ?? order.id.slice(0, 8)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(order.created_at)}
                    </TableCell>
                    <TableCell>
                      <OrderStatusBadge status={order.status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {order.destination_country ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tnum text-sm">
                      {order.order_items.reduce(
                        (acc, item) => acc + Math.max(1, item.quantity ?? 1),
                        0,
                      )}
                    </TableCell>
                    <TableCell className="text-right tnum text-sm">
                      {order.total_amount != null ? formatUSD(order.total_amount) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {receiptId ? (
                        <DocumentDownloadButton id={receiptId} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
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
