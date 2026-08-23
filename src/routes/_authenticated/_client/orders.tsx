import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/app-shell";
import {
  DocumentDownloadButton,
  OrderStatusBadge,
} from "@/components/documents-ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { getMyWallet } from "@/lib/wallet.functions";
import {
  createBatchOrderCheckout,
  payOrdersFromWallet,
} from "@/lib/billing.functions";
import { getStripeEnvironment } from "@/lib/stripe";

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
  const fetchWallet = useServerFn(getMyWallet);
  const queryClient = useQueryClient();
  const { data: orders, isPending } = useQuery({
    queryKey: ["my-orders"],
    queryFn: fetchOrders,
  });
  const { data: documents } = useQuery({
    queryKey: ["my-documents"],
    queryFn: fetchDocuments,
  });
  const { data: wallet } = useQuery({
    queryKey: ["my-wallet"],
    queryFn: fetchWallet,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"wallet" | "card" | null>(null);

  const receiptByOrder = new Map(
    (documents ?? [])
      .filter((d) => d.order_id)
      .map((d) => [d.order_id as string, d.id] as const),
  );

  const rows = useMemo(() => orders ?? [], [orders]);
  const payable = rows.filter(
    (o) => o.status === "awaiting_payment" && Number(o.total_amount ?? 0) > 0,
  );
  const selectedRows = payable.filter((o) => selected.has(o.id));
  const selectedTotal = selectedRows.reduce(
    (acc, o) => acc + Number(o.total_amount ?? 0),
    0,
  );
  const balance = wallet?.balance ?? 0;
  const walletCovers = selectedTotal > 0 && balance >= selectedTotal;

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function selectAllPayable() {
    setSelected(new Set(payable.map((o) => o.id)));
  }

  async function payFromWallet() {
    setBusy("wallet");
    try {
      const result = await payOrdersFromWallet({
        data: { orderIds: selectedRows.map((o) => o.id) },
      });
      const skipped = selectedRows.length - result.settled.length;
      toast.success(
        `${result.settled.length} order${result.settled.length === 1 ? "" : "s"} paid from your wallet` +
          (skipped > 0 ? ` — ${skipped} were settled by another route and credited back` : ""),
      );
      setSelected(new Set());
      await queryClient.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setBusy(null);
    }
  }

  async function payByCard() {
    setBusy("card");
    try {
      const result = await createBatchOrderCheckout({
        data: {
          orderIds: selectedRows.map((o) => o.id),
          returnUrl: `${window.location.origin}/orders`,
          environment: getStripeEnvironment(),
        },
      });
      if ("error" in result && result.error) throw new Error(String(result.error));
      const url = "url" in result ? result.url : null;
      if (!url) throw new Error("Stripe did not return a checkout URL");
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start checkout");
      setBusy(null);
    }
  }

  return (
    <div className={selectedRows.length > 0 ? "pb-24" : undefined}>
      <PageHeader
        title="Orders"
        description="Every order in this workspace, its payment status and its payment receipt."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={rows.length === 0}
              onClick={() => {
                const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
                const header = "order,date,status,country,total,tracking_carrier,tracking_number\n";
                const body = rows
                  .map((o) =>
                    [
                      o.external_order_number ?? o.id.slice(0, 8),
                      o.created_at,
                      o.status,
                      o.destination_country ?? "",
                      o.total_amount ?? "",
                      o.tracking_carrier ?? "",
                      o.tracking_number ?? "",
                    ]
                      .map((v) => esc(String(v)))
                      .join(","),
                  )
                  .join("\n");
                const blob = new Blob([header + body], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "flysales-tracking.csv";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Export tracking
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/orders/import">Import CSV</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/orders/new">Create order</Link>
            </Button>
          </>
        }
      />

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No orders yet"
          hint="Orders appear here — synced from Shopify or created manually."
        />
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all awaiting payment"
                    checked={
                      payable.length > 0 &&
                      payable.every((o) => selected.has(o.id))
                    }
                    onCheckedChange={(checked) =>
                      checked ? selectAllPayable() : setSelected(new Set())
                    }
                  />
                </TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Tracking</TableHead>
                <TableHead className="text-right">Receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((order) => {
                const receiptId = receiptByOrder.get(order.id);
                const isPayable =
                  order.status === "awaiting_payment" &&
                  Number(order.total_amount ?? 0) > 0;
                return (
                  <TableRow key={order.id}>
                    <TableCell>
                      {isPayable ? (
                        <Checkbox
                          aria-label="Select order for batch payment"
                          checked={selected.has(order.id)}
                          onCheckedChange={(checked) =>
                            toggle(order.id, checked === true)
                          }
                        />
                      ) : null}
                    </TableCell>
                    <TableCell className="tnum text-xs font-medium">
                      <Link
                        to="/orders/$id"
                        params={{ id: order.id }}
                        className="hover:underline"
                      >
                        {order.external_order_number ?? order.id.slice(0, 8)}
                      </Link>
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
                    <TableCell>
                      {order.tracking_number ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="tnum text-xs text-muted-foreground">
                            {order.tracking_carrier}
                          </span>
                          <button
                            type="button"
                            aria-label={`Copy tracking number ${order.tracking_number}`}
                            title={order.tracking_number}
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              void navigator.clipboard.writeText(order.tracking_number!);
                              toast.success("Tracking number copied");
                            }}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
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

      {payable.length > 1 && selectedRows.length === 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={selectAllPayable}
            className="text-sm font-medium text-primary hover:underline"
          >
            Select all {payable.length} orders awaiting payment
          </button>
        </div>
      )}

      {selectedRows.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-6 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {selectedRows.length} order{selectedRows.length === 1 ? "" : "s"} selected
              </p>
              <p className="tnum text-xs text-muted-foreground">
                Total {formatUSD(selectedTotal)}
                {!walletCovers &&
                  ` — wallet balance ${formatUSD(balance)} does not cover this`}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelected(new Set())}
              disabled={busy !== null}
            >
              Clear
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={payFromWallet}
              disabled={!walletCovers || busy !== null}
              title={
                walletCovers
                  ? "Settle immediately from your wallet"
                  : "Wallet balance is too low for this selection"
              }
            >
              {busy === "wallet" ? "Paying…" : "Pay from wallet"}
            </Button>
            <Button size="sm" onClick={payByCard} disabled={busy !== null}>
              {busy === "card"
                ? "Redirecting…"
                : `Pay ${selectedRows.length} order${selectedRows.length === 1 ? "" : "s"} — ${formatUSD(selectedTotal)}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
