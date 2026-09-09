import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Download, Plus, Truck, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { SectionTabs, FULFILMENT_TABS } from "@/components/section-tabs";
import { getCurrentStoreId, STORE_CHANGED_EVENT } from "@/components/store-switcher";
import { SummaryBar, TableShell, Chip } from "@/components/admin-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createClientProduct,
  declareInboundShipment,
  getInboundLabels,
  listMyInboundShipments,
  listStockInProducts,
  setInboundTracking,
} from "@/lib/inbound.functions";
import { friendlyError } from "@/lib/errors";
import { formatUSD } from "@/lib/format";

const FEE_PER_PIECE = 0.5;
const QC_PER_PIECE = 0.2;
const MIN_UNITS = 10;

export const Route = createFileRoute("/_authenticated/_client/fulfilment/inbound")({
  head: () => ({
    meta: [
      { title: "Inbound shipments — FlySales" },
      {
        name: "description",
        content:
          "Declare stock you send to our fulfilment centre, print SKU labels and follow every shipment to receipt.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InboundPage,
});

type StatusKey = "declared" | "in_transit" | "received" | "completed" | "refused";

const STATUS_LABEL: Record<StatusKey, string> = {
  declared: "Declared",
  in_transit: "In transit",
  received: "Counted",
  completed: "Stocked",
  refused: "Refused",
};

const STATUS_TONE: Record<StatusKey, "neutral" | "info" | "warning" | "success" | "danger"> = {
  declared: "neutral",
  in_transit: "info",
  received: "warning",
  completed: "success",
  refused: "danger",
};

function downloadBase64(filename: string, base64: string, mime: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadText(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function InboundPage() {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [declareOpen, setDeclareOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const [trackingFor, setTrackingFor] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const read = () => setStoreId(getCurrentStoreId());
    read();
    window.addEventListener(STORE_CHANGED_EVENT, read);
    return () => window.removeEventListener(STORE_CHANGED_EVENT, read);
  }, []);

  const fetchShipments = useServerFn(listMyInboundShipments);
  const { data: shipments, isLoading } = useQuery({
    queryKey: ["inbound", storeId],
    enabled: storeId != null,
    queryFn: () => fetchShipments({ data: { storeId: storeId! } }),
  });

  const fetchLabels = useServerFn(getInboundLabels);
  const labels = useMutation({
    mutationFn: (id: string) => fetchLabels({ data: { shipment_id: id } }),
    onSuccess: (res) => {
      downloadBase64(res.filename, res.pdfBase64, "application/pdf");
      downloadText(res.csvFilename, res.csv, "text/csv");
      toast.success("Labels and SKU list downloaded");
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const rows = shipments ?? [];
  const open = rows.filter((s) => s.status === "declared" || s.status === "in_transit");
  const piecesInTransit = open.reduce((sum, s) => sum + s.declared_pieces, 0);
  const stocked = rows.filter((s) => s.status === "completed").length;

  return (
    <div>
      <PageHeader
        title="Inbound"
        description="Stock you send to our fulfilment centre, from declaration to shelf."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="rounded-full"
              disabled={!storeId}
              onClick={() => setProductOpen(true)}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Add my product
            </Button>
            <Button
              className="rounded-full"
              disabled={!storeId}
              onClick={() => setDeclareOpen(true)}
            >
              <Truck className="mr-1.5 h-4 w-4" />
              Declare a shipment
            </Button>
          </div>
        }
      />
      <SectionTabs tabs={FULFILMENT_TABS} />

      <SummaryBar
        items={[
          { key: "open", label: "Open shipments", value: open.length },
          { key: "pieces", label: "Pieces on the way", value: piecesInTransit },
          { key: "stocked", label: "Shipments stocked", value: stocked, tone: "success" },
        ]}
      />

      {isLoading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Loading your shipments…
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-8">
            <Truck className="h-8 w-8 text-muted-foreground" />
            <h2 className="text-base font-semibold">No inbound shipments yet</h2>
            <p className="max-w-xl text-sm text-muted-foreground">
              Declare what you are sending, print our SKU labels and add supplier tracking. We
              count every piece on arrival and charge {formatUSD(FEE_PER_PIECE)} per piece (
              {formatUSD(FEE_PER_PIECE + QC_PER_PIECE)} with quality control) on the quantity we
              count.
            </p>
            <Button className="rounded-full" disabled={!storeId} onClick={() => setDeclareOpen(true)}>
              Declare a shipment
            </Button>
          </CardContent>
        </Card>
      ) : (
        <TableShell>
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Shipment</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Variations</th>
                <th className="px-3 py-2 text-right font-medium">Declared</th>
                <th className="px-3 py-2 text-right font-medium">Counted</th>
                <th className="px-3 py-2 font-medium">QC</th>
                <th className="px-3 py-2 text-right font-medium">Fee</th>
                <th className="px-3 py-2 font-medium">Tracking</th>
                <th className="px-3 py-2 text-right font-medium">Labels</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-medium">{s.ref}</td>
                  <td className="px-3 py-2">
                    <Chip tone={STATUS_TONE[s.status as StatusKey]}>
                      {STATUS_LABEL[s.status as StatusKey] ?? s.status}
                    </Chip>
                    {s.refusal_reason && (
                      <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                        {s.refusal_reason}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {s.lines.length} variation{s.lines.length === 1 ? "" : "s"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.declared_pieces}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.counted_pieces ?? "—"}
                    {s.has_discrepancy && (
                      <span className="ml-1 text-xs text-warning">≠</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{s.qc ? "Yes" : "No"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.fee_charged ? formatUSD(Number(s.fee_charged)) : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {s.tracking_number ? (
                      <span>
                        {s.tracking_carrier} · {s.tracking_number}
                      </span>
                    ) : s.status === "declared" ? (
                      <button
                        type="button"
                        className="text-primary underline-offset-2 hover:underline"
                        onClick={() => setTrackingFor(s.id)}
                      >
                        Add tracking
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => labels.mutate(s.id)}
                    >
                      <Download className="h-3.5 w-3.5" />
                      PDF + CSV
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      )}

      <DeclareDialog
        open={declareOpen}
        storeId={storeId}
        onOpenChange={setDeclareOpen}
        onDone={() => void queryClient.invalidateQueries({ queryKey: ["inbound"] })}
      />
      <AddProductDialog
        open={productOpen}
        storeId={storeId}
        onOpenChange={setProductOpen}
        onDone={() => void queryClient.invalidateQueries({ queryKey: ["stock-in-products"] })}
      />
      <TrackingDialog
        shipmentId={trackingFor}
        onClose={() => setTrackingFor(null)}
        onDone={() => void queryClient.invalidateQueries({ queryKey: ["inbound"] })}
      />
    </div>
  );
}

function DeclareDialog({
  open,
  storeId,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  storeId: string | null;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const [qc, setQc] = useState(false);
  const [cartons, setCartons] = useState("");
  const [expected, setExpected] = useState("");
  const [lines, setLines] = useState<Array<{ product_id: string; quantity: string }>>([
    { product_id: "", quantity: "" },
  ]);

  const fetchProducts = useServerFn(listStockInProducts);
  const { data: products } = useQuery({
    queryKey: ["stock-in-products", storeId],
    enabled: open && storeId != null,
    queryFn: () => fetchProducts({ data: { storeId: storeId! } }),
  });

  const declare = useServerFn(declareInboundShipment);
  const submit = useMutation({
    mutationFn: () =>
      declare({
        data: {
          storeId: storeId!,
          qc,
          lines: lines
            .filter((l) => l.product_id && l.quantity)
            .map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity) })),
          ...(Number(cartons) > 0 ? { cartons: Number(cartons) } : {}),
          ...(expected ? { expected_arrival: expected } : {}),
        },
      }),
    onSuccess: () => {
      toast.success("Shipment declared. Print the labels and add tracking.");
      onDone();
      onOpenChange(false);
      setLines([{ product_id: "", quantity: "" }]);
      setQc(false);
      setCartons("");
      setExpected("");
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const pieces = useMemo(
    () => lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0),
    [lines],
  );
  const fee = pieces * (FEE_PER_PIECE + (qc ? QC_PER_PIECE : 0));
  const belowMin = lines.some((l) => l.quantity !== "" && Number(l.quantity) < MIN_UNITS);
  const ready =
    lines.some((l) => l.product_id && Number(l.quantity) >= MIN_UNITS) && !belowMin;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Declare an inbound shipment</DialogTitle>
          <DialogDescription>
            Tell us what is coming. Minimum {MIN_UNITS} units per variation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {lines.map((line, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-xs">Variation</Label>
                <Select
                  value={line.product_id}
                  onValueChange={(v) =>
                    setLines((prev) =>
                      prev.map((l, idx) => (idx === i ? { ...l, product_id: v } : l)),
                    )
                  }
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Pick a product" />
                  </SelectTrigger>
                  <SelectContent>
                    {(products ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.product_name}
                        {p.variant_label ? ` — ${p.variant_label}` : ""} · {p.sku}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-32">
                <Label className="text-xs">Units</Label>
                <Input
                  className="mt-1"
                  type="number"
                  min={MIN_UNITS}
                  value={line.quantity}
                  onChange={(e) =>
                    setLines((prev) =>
                      prev.map((l, idx) =>
                        idx === i ? { ...l, quantity: e.target.value } : l,
                      ),
                    )
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mb-0.5"
                disabled={lines.length === 1}
                onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => setLines((prev) => [...prev, { product_id: "", quantity: "" }])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add variation
          </Button>

          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Total cartons</Label>
              <Input
                type="number"
                min={1}
                inputMode="numeric"
                value={cartons}
                onChange={(e) => setCartons(e.target.value)}
                placeholder="e.g. 12"
                className="mt-1"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                We count cartons first, then pieces.
              </p>
            </div>
            <div>
              <Label className="text-xs">Expected arrival</Label>
              <Input
                type="date"
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                className="mt-1"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">You can change this later.</p>
            </div>
          </div>

          <label className="mt-2 flex items-start gap-2 rounded-xl border border-border p-3">
            <Checkbox checked={qc} onCheckedChange={(v) => setQc(v === true)} className="mt-0.5" />
            <span className="text-sm">
              Quality control on every piece
              <span className="block text-xs text-muted-foreground">
                We check each piece individually. Adds {formatUSD(QC_PER_PIECE)} per piece.
              </span>
            </span>
          </label>

          <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Declared pieces</span>
              <span className="tabular-nums">{pieces}</span>
            </div>
            <div className="mt-1 flex justify-between font-medium">
              <span>Estimated service fee</span>
              <span className="tabular-nums">{formatUSD(fee)}</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              We charge on the quantity we count on arrival, not on the declared quantity. The fee
              comes out of your wallet balance.
            </p>
          </div>
          {belowMin && (
            <p className="text-xs text-destructive">Every variation needs at least {MIN_UNITS} units.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!ready || submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending ? "Declaring…" : "Declare shipment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddProductDialog({
  open,
  storeId,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  storeId: string | null;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [variants, setVariants] = useState<string[]>([""]);

  const create = useServerFn(createClientProduct);
  const submit = useMutation({
    mutationFn: () =>
      create({
        data: {
          storeId: storeId!,
          name: name.trim(),
          variants: variants.filter((v) => v.trim()).map((v) => ({ label: v.trim() })),
        },
      }),
    onSuccess: () => {
      toast.success("Product added. You can declare it on a shipment now.");
      onDone();
      onOpenChange(false);
      setName("");
      setVariants([""]);
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add my product</DialogTitle>
          <DialogDescription>
            For stock you already own and want to send to our warehouse. We create one SKU per
            variation so you can label the cartons.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Product name</Label>
            <Input
              className="mt-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Posture corrector belt"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Variations</Label>
            {variants.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={v}
                  placeholder="Black / M"
                  onChange={(e) =>
                    setVariants((prev) => prev.map((x, idx) => (idx === i ? e.target.value : x)))
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={variants.length === 1}
                  onClick={() => setVariants((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => setVariants((prev) => [...prev, ""])}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add variation
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              submit.isPending || name.trim().length < 2 || !variants.some((v) => v.trim())
            }
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? "Adding…" : "Add product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TrackingDialog({
  shipmentId,
  onClose,
  onDone,
}: {
  shipmentId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [carrier, setCarrier] = useState("");
  const [number, setNumber] = useState("");

  const save = useServerFn(setInboundTracking);
  const submit = useMutation({
    mutationFn: () =>
      save({
        data: {
          shipment_id: shipmentId!,
          tracking_carrier: carrier.trim(),
          tracking_number: number.trim(),
        },
      }),
    onSuccess: () => {
      toast.success("Tracking added. The shipment is marked in transit.");
      onDone();
      onClose();
      setCarrier("");
      setNumber("");
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <Dialog open={shipmentId != null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add supplier tracking</DialogTitle>
          <DialogDescription>
            Shipments without tracking are refused at the warehouse.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Carrier</Label>
            <Input
              className="mt-1"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              placeholder="DHL"
            />
          </div>
          <div>
            <Label className="text-xs">Tracking number</Label>
            <Input
              className="mt-1"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="1234567890"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={submit.isPending || carrier.trim().length < 2 || number.trim().length < 3}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? "Saving…" : "Save tracking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
