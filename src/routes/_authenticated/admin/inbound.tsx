import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { SectionTabs, ADMIN_FULFILMENT_TABS } from "@/components/section-tabs";
import { SummaryBar, FilterTabs, TableShell, Chip } from "@/components/admin-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  adminConfirmInboundReceipt,
  adminListInboundShipments,
  adminRefuseInbound,
} from "@/lib/inbound.functions";
import { CleanupRowActions, ShowArchivedToggle } from "@/components/cleanup-actions";
import { friendlyError } from "@/lib/errors";
import { formatUSD, formatDateTime } from "@/lib/format";

const FEE_PER_PIECE = 0.5;
const QC_PER_PIECE = 0.2;

export const Route = createFileRoute("/_authenticated/admin/inbound")({
  head: () => ({
    meta: [{ title: "Inbound — FlySales admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminInboundPage,
});

const TABS = [
  { id: "queue", label: "To process" },
  { id: "declared", label: "Declared" },
  { id: "in_transit", label: "In transit" },
  { id: "completed", label: "Stocked" },
  { id: "refused", label: "Refused" },
  { id: "discrepancies", label: "Discrepancies" },
  { id: "all", label: "All" },
] as const;

type Shipment = Awaited<ReturnType<typeof adminListInboundShipments>>[number];

const STATUS_LABEL: Record<string, string> = {
  declared: "Declared",
  in_transit: "In transit",
  received: "Counted",
  completed: "Stocked",
  refused: "Refused",
};
const STATUS_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  declared: "neutral",
  in_transit: "info",
  received: "warning",
  completed: "success",
  refused: "danger",
};

function AdminInboundPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("queue");
  const [counting, setCounting] = useState<Shipment | null>(null);
  const [refusing, setRefusing] = useState<Shipment | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const fetchAll = useServerFn(adminListInboundShipments);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-inbound"],
    queryFn: () => fetchAll({}),
  });

  const rows = (data ?? []).filter(
    (s) => showArchived || !(s as { archived_at?: string | null }).archived_at,
  );
  const visible =
    tab === "all"
      ? rows
      : tab === "queue"
        ? rows.filter((s) => s.status === "in_transit" || s.status === "received")
        : tab === "discrepancies"
          ? rows.filter(
              (s) =>
                s.has_discrepancy ||
                (s.counted_cartons != null &&
                  s.declared_cartons != null &&
                  s.counted_cartons !== s.declared_cartons),
            )
          : rows.filter((s) => s.status === tab);

  return (
    <div>
      <PageHeader title="Inbound" description="Shipments arriving at the fulfilment centre." />
      <SectionTabs tabs={ADMIN_FULFILMENT_TABS} />

      <SummaryBar
        items={[
          {
            key: "queue",
            label: "Waiting to be counted",
            value: rows.filter((s) => s.status === "in_transit").length,
            tone: "warning",
          },
          {
            key: "declared",
            label: "Declared, no tracking",
            value: rows.filter((s) => s.status === "declared").length,
          },
          {
            key: "stocked",
            label: "Stocked",
            value: rows.filter((s) => s.status === "completed").length,
            tone: "success",
          },
          {
            key: "refused",
            label: "Refused",
            value: rows.filter((s) => s.status === "refused").length,
            tone: "danger",
          },
        ]}
      />

      <div className="mb-3">
        <FilterTabs tabs={TABS} value={tab} onChange={setTab} />
        <div className="mt-2">
          <ShowArchivedToggle value={showArchived} onChange={setShowArchived} />
        </div>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nothing here right now.
          </CardContent>
        </Card>
      ) : (
        <TableShell>
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Shipment</th>
                <th className="px-3 py-2 font-medium">Workspace</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Tracking</th>
                <th className="px-3 py-2 text-right font-medium">Declared</th>
                <th className="px-3 py-2 text-right font-medium">Counted</th>
                <th className="px-3 py-2 text-right font-medium">Cartons</th>
                <th className="px-3 py-2 font-medium">Expected</th>
                <th className="px-3 py-2 font-medium">QC</th>
                <th className="px-3 py-2 text-right font-medium">Fee</th>
                <th className="px-3 py-2 font-medium">Declared on</th>
                <th className="px-3 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-medium">
                    {s.ref}
                    {tab === "discrepancies" && (
                      <ul className="mt-1 space-y-0.5 text-[11px] font-normal text-warning">
                        {s.lines
                          .filter((l) => l.counted_qty != null && l.counted_qty !== l.declared_qty)
                          .map((l) => (
                            <li key={l.id}>
                              {l.sku}: declared {l.declared_qty} · counted {l.counted_qty} (
                              {(l.counted_qty ?? 0) > l.declared_qty ? "+" : ""}
                              {(l.counted_qty ?? 0) - l.declared_qty})
                            </li>
                          ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{s.workspace_name}</td>
                  <td className="px-3 py-2">
                    <Chip tone={STATUS_TONE[s.status] ?? "neutral"}>
                      {STATUS_LABEL[s.status] ?? s.status}
                    </Chip>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {s.tracking_number ? `${s.tracking_carrier} · ${s.tracking_number}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.declared_pieces}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.counted_pieces ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">
                    {s.declared_cartons ?? "—"}
                    {s.counted_cartons != null && (
                      <span
                        className={
                          s.counted_cartons !== s.declared_cartons
                            ? "ml-1 text-warning"
                            : "ml-1 text-muted-foreground"
                        }
                      >
                        → {s.counted_cartons}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {s.expected_arrival_date ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">{s.qc ? "Yes" : "No"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.fee_charged ? formatUSD(Number(s.fee_charged)) : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {formatDateTime(s.created_at)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="mb-1 flex justify-end">
                      <CleanupRowActions
                        type="inbound"
                        id={s.id}
                        name={s.ref}
                        archived={!!(s as { archived_at?: string | null }).archived_at}
                        invalidateKeys={[["admin-inbound"]]}
                      />
                    </div>
                    {s.status === "completed" || s.status === "refused" ? (
                      <span className="text-xs text-muted-foreground">Done</span>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          className="h-7 rounded-full px-3 text-xs"
                          onClick={() => setCounting(s)}
                        >
                          Count &amp; receive
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 rounded-full px-3 text-xs"
                          onClick={() => setRefusing(s)}
                        >
                          Refuse
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      )}

      <CountDialog shipment={counting} onClose={() => setCounting(null)} />
      <RefuseDialog shipment={refusing} onClose={() => setRefusing(null)} />
    </div>
  );
}

function CountDialog({ shipment, onClose }: { shipment: Shipment | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [cartons, setCartons] = useState("");

  useEffect(() => {
    if (shipment) {
      setCounts(Object.fromEntries(shipment.lines.map((l) => [l.id, String(l.declared_qty)])));
    }
  }, [shipment]);

  const confirm = useServerFn(adminConfirmInboundReceipt);
  const submit = useMutation({
    mutationFn: () =>
      confirm({
        data: {
          shipment_id: shipment!.id,
          counts: shipment!.lines.map((l) => ({
            line_id: l.id,
            counted_qty: Number(counts[l.id] ?? 0),
          })),
          ...(Number(cartons) >= 0 && cartons !== "" ? { counted_cartons: Number(cartons) } : {}),
        },
      }),
    onSuccess: () => {
      toast.success("Received. Stock added and the fee charged.");
      void queryClient.invalidateQueries({ queryKey: ["admin-inbound"] });
      onClose();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const pieces = shipment
    ? shipment.lines.reduce((sum, l) => sum + (Number(counts[l.id]) || 0), 0)
    : 0;
  const fee = pieces * (FEE_PER_PIECE + (shipment?.qc ? QC_PER_PIECE : 0));

  return (
    <Dialog open={shipment != null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Count {shipment?.ref}</DialogTitle>
          <DialogDescription>
            Enter what you counted per variation. The fee is charged on these numbers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {/* Cartons before pieces — the order the dock actually works in. */}
          <div className="flex items-end gap-3 rounded-xl border border-border p-3">
            <div className="flex-1">
              <p className="text-sm font-medium">Cartons received</p>
              <p className="text-xs text-muted-foreground">
                Declared {shipment?.declared_cartons ?? "—"}
              </p>
            </div>
            <div className="w-28">
              <Label className="text-xs">Counted</Label>
              <Input
                className="mt-1"
                type="number"
                min={0}
                value={cartons}
                onChange={(e) => setCartons(e.target.value)}
              />
            </div>
            <span
              className={`mb-2 w-16 text-xs ${
                cartons !== "" &&
                shipment?.declared_cartons != null &&
                Number(cartons) !== shipment.declared_cartons
                  ? "text-warning"
                  : "text-muted-foreground"
              }`}
            >
              {cartons !== "" && shipment?.declared_cartons != null
                ? Number(cartons) === shipment.declared_cartons
                  ? "match"
                  : `${Number(cartons) > shipment.declared_cartons ? "+" : ""}${Number(cartons) - shipment.declared_cartons}`
                : ""}
            </span>
          </div>

          {(shipment?.lines ?? []).map((l) => {
            const counted = Number(counts[l.id] ?? 0);
            const gap = counted !== l.declared_qty;
            return (
              <div key={l.id} className="flex items-end gap-3">
                <div className="flex-1">
                  <p className="text-sm font-medium">{l.product_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {l.sku} · declared {l.declared_qty}
                  </p>
                </div>
                <div className="w-28">
                  <Label className="text-xs">Counted</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    min={0}
                    value={counts[l.id] ?? ""}
                    onChange={(e) => setCounts((prev) => ({ ...prev, [l.id]: e.target.value }))}
                  />
                </div>
                <span
                  className={`mb-2 w-16 text-xs ${gap ? "text-warning" : "text-muted-foreground"}`}
                >
                  {gap
                    ? `${counted > l.declared_qty ? "+" : ""}${counted - l.declared_qty}`
                    : "match"}
                </span>
              </div>
            );
          })}

          <div className="mt-2 rounded-xl border border-border bg-muted/40 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Counted pieces</span>
              <span className="tabular-nums">{pieces}</span>
            </div>
            <div className="mt-1 flex justify-between font-medium">
              <span>Fee to charge{shipment?.qc ? " (with QC)" : ""}</span>
              <span className="tabular-nums">{formatUSD(fee)}</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              The client's wallet is debited. If the balance is short, we email them to top up and
              nothing is stocked.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending ? "Receiving…" : "Confirm receipt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefuseDialog({ shipment, onClose }: { shipment: Shipment | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  const refuse = useServerFn(adminRefuseInbound);
  const submit = useMutation({
    mutationFn: () => refuse({ data: { shipment_id: shipment!.id, reason: reason.trim() } }),
    onSuccess: () => {
      toast.success("Shipment refused and the client notified.");
      void queryClient.invalidateQueries({ queryKey: ["admin-inbound"] });
      setReason("");
      onClose();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <Dialog open={shipment != null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refuse {shipment?.ref}</DialogTitle>
          <DialogDescription>
            Nothing is charged. The client gets your reason by email.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Cartons arrived without our SKU labels and with no tracking on file."
          rows={4}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={submit.isPending || reason.trim().length < 5}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? "Refusing…" : "Refuse shipment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
