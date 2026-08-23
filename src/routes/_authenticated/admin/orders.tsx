import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { OrderStatusBadge } from "@/components/documents-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatUSD } from "@/lib/format";
import { adminListOrders, adminSetOrderTracking } from "@/lib/orders.functions";
import { orderTrackingSchema } from "@/lib/schemas";

export const Route = createFileRoute("/_authenticated/admin/orders")({
  head: () => ({
    meta: [
      { title: "Orders — FlySales Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminOrdersPage,
});

type AdminOrder = Awaited<ReturnType<typeof adminListOrders>>["orders"][number];

function AdminOrdersPage() {
  const fetchOrders = useServerFn(adminListOrders);
  const { data, isPending } = useQuery({
    queryKey: ["admin-orders"],
    queryFn: fetchOrders,
  });
  const [trackingOrder, setTrackingOrder] = useState<AdminOrder | null>(null);

  return (
    <div>
      <PageHeader
        title="Orders"
        description="Every workspace order. Add tracking here — the client is emailed the first time tracking appears."
      />
      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Workspace</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Tracking</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.orders ?? []).map((order) => {
                const store = order.stores as {
                  store_name?: string | null;
                  entities?: { legal_name?: string | null } | null;
                } | null;
                return (
                  <TableRow key={order.id}>
                    <TableCell className="tnum text-xs font-medium">
                      {order.external_order_number ?? order.id.slice(0, 8)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {store?.store_name ?? "—"}
                      {store?.entities?.legal_name ? ` · ${store.entities.legal_name}` : ""}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(order.created_at)}
                    </TableCell>
                    <TableCell>
                      <OrderStatusBadge status={order.status} />
                    </TableCell>
                    <TableCell className="text-right tnum text-sm">
                      {order.total_amount != null ? formatUSD(order.total_amount) : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {order.tracking_number ? (
                        <span className="tnum">
                          {order.tracking_carrier}: {order.tracking_number}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setTrackingOrder(order)}>
                        {order.tracking_number ? "Edit tracking" : "Add tracking"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <TrackingDialog order={trackingOrder} onClose={() => setTrackingOrder(null)} />
    </div>
  );
}

function TrackingDialog({ order, onClose }: { order: AdminOrder | null; onClose: () => void }) {
  const callSetTracking = useServerFn(adminSetOrderTracking);
  const queryClient = useQueryClient();
  const [carrier, setCarrier] = useState("");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);

  // Re-seed the form whenever a different order opens.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (order && seededFor !== order.id) {
    setSeededFor(order.id);
    setCarrier(order.tracking_carrier ?? "");
    setNumber(order.tracking_number ?? "");
  }

  async function save() {
    if (!order) return;
    const parsed = orderTrackingSchema.safeParse({
      order_id: order.id,
      tracking_number: number,
      tracking_carrier: carrier,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check your input");
      return;
    }
    setBusy(true);
    try {
      await callSetTracking({ data: parsed.data });
      toast.success(
        order.tracking_number
          ? "Tracking updated"
          : "Tracking added — the client has been emailed",
      );
      await queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save tracking");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={order !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Tracking — {order?.external_order_number ?? order?.id.slice(0, 8)}
          </DialogTitle>
          <DialogDescription>
            First-time tracking marks the order shipped and emails the client.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tr-carrier">Carrier</Label>
            <Input
              id="tr-carrier"
              placeholder="e.g. DHL"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tr-number">Tracking number</Label>
            <Input
              id="tr-number"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save tracking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
