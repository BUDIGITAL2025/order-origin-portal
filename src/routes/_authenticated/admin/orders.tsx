import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Truck } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { OrderStatusBadge } from "@/components/documents-ui";
import {
  AdminSearch,
  FilterTabs,
  RowAction,
  RowActions,
  SummaryBar,
  TableShell,
  ToolBar,
  Value,
  type StatTone,
} from "@/components/admin-ui";
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
import { adminListDisputes } from "@/lib/disputes.functions";
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

const SUMMARY = [
  { key: "awaiting_payment", label: "Awaiting payment", tone: "warning" },
  { key: "processing", label: "Processing", tone: "info" },
  { key: "shipped", label: "Shipped", tone: "info" },
  { key: "needs_review", label: "Needs review", tone: "warning" },
  { key: "disputed", label: "Disputed", tone: "danger" },
] as const satisfies readonly { key: string; label: string; tone: StatTone }[];

const TABS = [
  { id: "all", label: "All" },
  { id: "awaiting_payment", label: "Awaiting payment" },
  { id: "in_transit", label: "In transit" },
  { id: "delivered", label: "Delivered" },
  { id: "needs_review", label: "Needs review" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function workspaceOf(order: AdminOrder) {
  return order.stores as {
    store_name?: string | null;
    entities?: { legal_name?: string | null } | null;
  } | null;
}

function AdminOrdersPage() {
  const fetchOrders = useServerFn(adminListOrders);
  const fetchDisputes = useServerFn(adminListDisputes);
  const { data, isPending } = useQuery({
    queryKey: ["admin-orders"],
    queryFn: fetchOrders,
  });
  const [trackingOrder, setTrackingOrder] = useState<AdminOrder | null>(null);
  const [tab, setTab] = useState<TabId>("all");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: disputes } = useQuery({
    queryKey: ["admin-disputes", "all"],
    queryFn: () => fetchDisputes({ data: {} }),
  });

  const rows = useMemo(() => data?.orders ?? [], [data]);
  const disputedOrderIds = useMemo(
    () => new Set((disputes ?? []).map((d) => d.order_id)),
    [disputes],
  );

  const counts = useMemo(() => {
    const base: Record<string, number> = {
      awaiting_payment: 0,
      processing: 0,
      shipped: 0,
      needs_review: 0,
      disputed: 0,
    };
    for (const o of rows) {
      if (o.status in base) base[o.status] = (base[o.status] ?? 0) + 1;
    }
    base["disputed"] = disputedOrderIds.size;
    return base;
  }, [rows, disputedOrderIds]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = rows;
    if (tab === "awaiting_payment") list = list.filter((o) => o.status === "awaiting_payment");
    else if (tab === "in_transit")
      list = list.filter((o) => o.status === "processing" || o.status === "shipped");
    else if (tab === "delivered") list = list.filter((o) => o.status === "delivered");
    else if (tab === "needs_review") list = list.filter((o) => o.status === "needs_review");
    if (statusFilter === "disputed") list = list.filter((o) => disputedOrderIds.has(o.id));
    else if (statusFilter) list = list.filter((o) => o.status === statusFilter);
    if (term) {
      list = list.filter((o) =>
        [
          o.external_order_number ?? o.id,
          workspaceOf(o)?.store_name ?? "",
          workspaceOf(o)?.entities?.legal_name ?? "",
          o.tracking_number ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(term),
      );
    }
    return list;
  }, [rows, tab, statusFilter, search, disputedOrderIds]);

  return (
    <div>
      <PageHeader
        title="Orders"
        description="Every workspace order. Add tracking here — the client is emailed the first time tracking appears."
      />

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No orders yet"
          hint="Orders appear here as clients place them, from a connected workspace or a manual import."
        />
      ) : (
        <>
          <SummaryBar
            items={SUMMARY.map((s) => ({
              key: s.key,
              label: s.label,
              value: counts[s.key] ?? 0,
              tone: s.tone,
              active: statusFilter === s.key,
              onClick: () => {
                setTab("all");
                setStatusFilter((cur) => (cur === s.key ? null : s.key));
              },
            }))}
          />

          <ToolBar>
            <FilterTabs
              tabs={TABS}
              value={statusFilter ? ("all" as TabId) : tab}
              onChange={(id) => {
                setTab(id);
                setStatusFilter(null);
              }}
            />
            <AdminSearch
              value={search}
              onChange={setSearch}
              placeholder="Search by order reference, workspace or tracking"
            />
          </ToolBar>

          <TableShell>
            <Table className="text-[13px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-9">Order</TableHead>
                  <TableHead className="h-9">Workspace</TableHead>
                  <TableHead className="h-9">Status</TableHead>
                  <TableHead className="h-9 text-right">Total</TableHead>
                  <TableHead className="h-9">Tracking</TableHead>
                  <TableHead className="h-9">Date</TableHead>
                  <TableHead className="h-9 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      No orders match this filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((order) => {
                    const store = workspaceOf(order);
                    return (
                      <TableRow key={order.id} className="hover:bg-accent/60">
                        <TableCell className="py-2.5 font-mono text-xs font-medium">
                          {order.external_order_number ?? order.id.slice(0, 8)}
                        </TableCell>
                        <TableCell className="py-2.5">
                          <span className="block max-w-[200px] truncate">
                            <Value>{store?.store_name}</Value>
                          </span>
                          {store?.entities?.legal_name && (
                            <span className="block max-w-[200px] truncate text-xs text-muted-foreground">
                              {store.entities.legal_name}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5">
                          <OrderStatusBadge status={order.status} />
                        </TableCell>
                        <TableCell className="tnum py-2.5 text-right">
                          {order.total_amount != null ? formatUSD(order.total_amount) : <Value>{null}</Value>}
                        </TableCell>
                        <TableCell className="py-2.5">
                          {order.tracking_number ? (
                            <>
                              <span className="block max-w-[140px] truncate font-mono text-xs">
                                {order.tracking_number}
                              </span>
                              {order.tracking_carrier && (
                                <span className="text-xs text-muted-foreground">
                                  {order.tracking_carrier}
                                </span>
                              )}
                            </>
                          ) : (
                            <Value>{null}</Value>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap py-2.5 text-xs text-muted-foreground">
                          {formatDateTime(order.created_at)}
                        </TableCell>
                        <TableCell className="py-2.5">
                          <RowActions>
                            <RowAction
                              label={order.tracking_number ? "Edit tracking" : "Add tracking"}
                              icon={Truck}
                              tone={order.tracking_number ? undefined : "primary"}
                              onClick={() => setTrackingOrder(order)}
                            />
                          </RowActions>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableShell>
        </>
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
