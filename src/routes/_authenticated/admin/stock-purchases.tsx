import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { SectionTabs, ADMIN_SOURCING_TABS } from "@/components/section-tabs";
import { Chip, FilterTabs, RowActions, SummaryBar, TableShell } from "@/components/admin-ui";
import { CleanupRowActions, ShowArchivedToggle } from "@/components/cleanup-actions";
import { ProductCell } from "@/components/product-thumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { friendlyError } from "@/lib/errors";
import { formatDate, formatUSD } from "@/lib/format";
import {
  adminAdvancePurchase,
  adminListStockPurchases,
  adminQuoteFreight,
} from "@/lib/purchases.functions";

type StatusFilter = "all" | "requested" | "paid" | "in_production" | "shipped" | "delivered";

const STATUS_TONE: Record<string, "neutral" | "primary" | "success" | "warning" | "danger"> = {
  requested: "warning",
  freight_quoted: "warning",
  paid: "primary",
  in_production: "primary",
  shipped: "primary",
  delivered: "success",
  cancelled: "danger",
};

export const Route = createFileRoute("/_authenticated/admin/stock-purchases")({
  head: () => ({
    meta: [{ title: "Stock purchases — FlySales admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminStockPurchasesPage,
});

function AdminStockPurchasesPage() {
  const queryClient = useQueryClient();
  const fetchPurchases = useServerFn(adminListStockPurchases);
  const callAdvance = useServerFn(adminAdvancePurchase);

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [freightFor, setFreightFor] = useState<{
    id: string;
    ref: string;
    goods: number;
    freight: string;
    importCost: string;
  } | null>(
    null,
  );
  const [trackingFor, setTrackingFor] = useState<{ id: string; ref: string } | null>(null);

  const { data: rows } = useQuery({
    queryKey: ["admin-stock-purchases", filter],
    queryFn: () => fetchPurchases({ data: filter === "all" ? {} : { status: filter } }),
  });

  const [showArchived, setShowArchived] = useState(false);
  const purchases = (rows ?? []).filter(
    (p) => showArchived || !(p as { archived_at?: string | null }).archived_at,
  );
  const awaitingFreight = purchases.filter((p) => p.path === "direct" && p.status === "requested");
  const paidValue = purchases
    .filter((p) => p.paid_at)
    .reduce((s, p) => s + Number(p.total_amount ?? 0), 0);

  const advance = useMutation({
    mutationFn: (input: {
      purchase_id: string;
      status: "in_production" | "shipped" | "delivered" | "cancelled";
      tracking_number?: string;
      tracking_carrier?: string;
    }) => callAdvance({ data: input }),
    onSuccess: async () => {
      toast.success("Purchase updated.");
      setTrackingFor(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-stock-purchases"] });
    },
    onError: (e) => toast.error(friendlyError(e, "The purchase was not updated.")),
  });

  return (
    <div>
      <PageHeader
        title="Stock purchases"
        description="Bulk stock bought against a quote. Quote freight and import on every purchase, then move each one through production to delivery."
      />
      <SectionTabs tabs={ADMIN_SOURCING_TABS} />

      <SummaryBar
        items={[
          { key: "total", label: "Purchases", value: String(purchases.length) },
          {
            key: "freight",
            label: "Need a freight quote",
            value: String(awaitingFreight.length),
            tone: "warning",
          },
          {
            key: "production",
            label: "In production",
            value: String(purchases.filter((p) => p.status === "in_production").length),
            tone: "primary",
          },
          { key: "value", label: "Paid value", value: formatUSD(paidValue), tone: "success" },
        ]}
      />

      <div className="mb-3">
        <FilterTabs
          value={filter}
          onChange={setFilter}
          tabs={[
            { id: "all", label: "All" },
            { id: "requested", label: "Awaiting payment" },
            { id: "paid", label: "Paid" },
            { id: "in_production", label: "In production" },
            { id: "shipped", label: "Shipped" },
            { id: "delivered", label: "Delivered" },
          ]}
        />
        <div className="mt-2">
          <ShowArchivedToggle value={showArchived} onChange={setShowArchived} />
        </div>
      </div>

      <TableShell>
        <TableHeader>
          <TableRow>
            <TableHead>Reference</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">Units</TableHead>
            <TableHead className="text-right">Goods</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Path</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {purchases.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="whitespace-nowrap font-mono text-xs">{p.ref}</TableCell>
              <TableCell className="max-w-40">
                <div className="truncate text-sm">{p.client_name ?? "—"}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {p.workspace_name ?? ""}
                </div>
              </TableCell>
              <TableCell className="max-w-56">
                <ProductCell
                  imageUrls={
                    (p as { products?: { image_urls?: string[] } | null }).products?.image_urls ??
                    []
                  }
                  name={p.product_name}
                  secondary={`${p.variant_label ?? ""} · ${formatDate(p.created_at)}`}
                />
              </TableCell>
              <TableCell className="text-right tnum text-sm">{p.quantity}</TableCell>
              <TableCell className="text-right tnum text-sm">
                {formatUSD(Number(p.goods_total))}
              </TableCell>
              <TableCell className="text-right tnum text-sm font-medium">
                {p.payable_total != null ? formatUSD(p.payable_total) : "—"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {p.path === "flysales" ? "Warehouse" : "Direct"}
              </TableCell>
              <TableCell>
                <Chip tone={STATUS_TONE[p.status] ?? "neutral"}>{p.status.replace("_", " ")}</Chip>
              </TableCell>
              <TableCell className="text-right">
                <RowActions>
                  <CleanupRowActions
                    type="stock_purchase"
                    id={p.id}
                    name={p.ref}
                    archived={!!(p as { archived_at?: string | null }).archived_at}
                    invalidateKeys={[["admin-stock-purchases"]]}
                  />
                  {!p.paid_at ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setFreightFor({
                          id: p.id,
                          ref: p.ref,
                          goods: Number(p.goods_total),
                          freight: p.freight_cost != null ? String(p.freight_cost) : "",
                          importCost:
                            (p as { import_cost?: number | null }).import_cost != null
                              ? String((p as { import_cost?: number | null }).import_cost)
                              : "",
                        })
                      }
                    >
                      {p.freight_cost != null ? "Edit freight" : "Quote freight"}
                    </Button>
                  ) : null}
                  {p.status === "paid" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => advance.mutate({ purchase_id: p.id, status: "in_production" })}
                    >
                      In production
                    </Button>
                  ) : null}
                  {p.status === "in_production" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setTrackingFor({ id: p.id, ref: p.ref })}
                    >
                      Mark shipped
                    </Button>
                  ) : null}
                  {p.status === "shipped" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => advance.mutate({ purchase_id: p.id, status: "delivered" })}
                    >
                      Delivered
                    </Button>
                  ) : null}
                </RowActions>
              </TableCell>
            </TableRow>
          ))}
          {purchases.length === 0 && (
            <TableRow>
              <TableCell colSpan={9} className="text-sm text-muted-foreground">
                No stock purchases for this filter.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </TableShell>

      <FreightDialog purchase={freightFor} onClose={() => setFreightFor(null)} />

      <Dialog open={!!trackingFor} onOpenChange={(v) => !v && setTrackingFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark shipped</DialogTitle>
            <DialogDescription>
              Add the tracking so the client can follow {trackingFor?.ref}.
            </DialogDescription>
          </DialogHeader>
          <ShipForm
            busy={advance.isPending}
            onSubmit={(tracking) =>
              trackingFor &&
              advance.mutate({
                purchase_id: trackingFor.id,
                status: "shipped",
                ...tracking,
              })
            }
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ShipForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (t: { tracking_number: string; tracking_carrier: string }) => void;
}) {
  const [number, setNumber] = useState("");
  const [carrier, setCarrier] = useState("");
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Carrier</Label>
        <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>Tracking number</Label>
        <Input value={number} onChange={(e) => setNumber(e.target.value)} />
      </div>
      <DialogFooter>
        <Button
          disabled={busy}
          onClick={() => onSubmit({ tracking_number: number, tracking_carrier: carrier })}
        >
          {busy ? "Saving…" : "Mark shipped"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function FreightDialog({
  purchase,
  onClose,
}: {
  purchase: {
    id: string;
    ref: string;
    goods: number;
    freight: string;
    importCost: string;
  } | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const callQuote = useServerFn(adminQuoteFreight);
  const [cost, setCost] = useState("");
  const [importCost, setImportCost] = useState("");

  useEffect(() => {
    setCost(purchase?.freight ?? "");
    setImportCost(purchase?.importCost ?? "");
  }, [purchase]);

  const freightValue = cost === "" ? 0 : Number(cost);
  const importValue = importCost === "" ? 0 : Number(importCost);
  const previewTotal = (purchase?.goods ?? 0) + (freightValue || 0) + (importValue || 0);

  const quote = useMutation({
    mutationFn: async () => {
      if (!purchase) throw new Error("No purchase selected");
      if (!Number.isFinite(freightValue) || freightValue < 0) {
        throw new Error("Enter a valid freight cost");
      }
      if (!Number.isFinite(importValue) || importValue < 0) {
        throw new Error("Enter a valid import cost");
      }
      return callQuote({
        data: {
          purchase_id: purchase.id,
          freight_cost: freightValue,
          import_cost: importValue,
        },
      });
    },
    onSuccess: async () => {
      toast.success("Freight and import quoted. The client can pay now.");
      setCost("");
      setImportCost("");
      onClose();
      await queryClient.invalidateQueries({ queryKey: ["admin-stock-purchases"] });
    },
    onError: (e) => toast.error(friendlyError(e, "The freight quote was not saved.")),
  });

  return (
    <Dialog open={!!purchase} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Quote freight and import</DialogTitle>
          <DialogDescription>
            {purchase?.ref} — goods {formatUSD(purchase?.goods ?? 0)} Ex Works. Both lines pass
            through at exact cost and are never marked up.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Freight cost (USD)</Label>
            <Input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Import / duties cost (USD)</Label>
            <Input
              inputMode="decimal"
              value={importCost}
              onChange={(e) => setImportCost(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Client pays</span>
            <span className="tnum font-semibold">{formatUSD(previewTotal)}</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={quote.isPending} onClick={() => quote.mutate()}>
            {quote.isPending ? "Saving…" : "Save quote"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
