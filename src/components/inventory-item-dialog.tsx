/**
 * Manual inventory item creation. Clients type in the stock they hold and the
 * timing behind it; everything derived (sellable, sales, state) is computed
 * server-side and never submitted from here.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { InventoryRow } from "@/components/inventory-table";
import { createInventoryItem } from "@/lib/inventory.functions";
import { friendlyError } from "@/lib/errors";

interface RouteDraft {
  destination: string;
  handlingTimeDays: string;
  isDefault: boolean;
}

interface WarehouseDraft {
  location: string;
  quantity: string;
}

const WAREHOUSE_SUGGESTIONS = ["China", "EUA", "Espanha", "Portugal"];

const emptyRoute = (): RouteDraft => ({ destination: "", handlingTimeDays: "", isDefault: false });
const emptyWarehouse = (): WarehouseDraft => ({ location: "", quantity: "" });

function intOr(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}


export function InventoryItemDialog({
  open,
  storeId,
  existingSkus,
  item,
  onOpenChange,
}: {
  open: boolean;
  storeId: string | null;
  existingSkus: string[];
  /** When set, the dialog edits this SKU instead of creating a new one. */
  item?: InventoryRow | null | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const callCreate = useServerFn(createInventoryItem);

  const editing = item != null;
  const synced = editing && item.source === "shopify";

  const [sku, setSku] = useState("");
  const [productName, setProductName] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [warehouses, setWarehouses] = useState<WarehouseDraft[]>([emptyWarehouse()]);
  const [reserved, setReserved] = useState("0");
  const [incoming, setIncoming] = useState("0");
  const [weight, setWeight] = useState("");
  const [weightUnit, setWeightUnit] = useState<"g" | "kg">("g");
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [routes, setRoutes] = useState<RouteDraft[]>([emptyRoute()]);
  const [error, setError] = useState<string | null>(null);

  // Prefill whenever the dialog opens on an existing row.
  useEffect(() => {
    if (!open) return;
    if (!item) return;
    setSku(item.sku);
    setProductName(item.product_name);
    setTagsInput((item.tags ?? []).join(", "));
    setWarehouses(
      item.locations.length > 0
        ? item.locations.map((l) => ({ location: l.location, quantity: String(l.quantity) }))
        : [emptyWarehouse()],
    );
    setReserved(String(item.reserved ?? 0));
    setIncoming(String(item.incoming ?? 0));
    setWeight(item.weight != null ? String(item.weight) : "");
    setWeightUnit(item.weight_unit === "kg" ? "kg" : "g");
    setLeadTimeDays(String(item.production_lead ?? 0));
    setRoutes(
      (item.routes ?? []).length > 0
        ? (item.routes ?? []).map((r) => ({
            destination: r.destination,
            handlingTimeDays: String(r.handling_time_days),
            isDefault: r.is_default,
          }))
        : [emptyRoute()],
    );
    setError(null);
  }, [open, item]);


  const reset = () => {
    setSku("");
    setProductName("");
    setTagsInput("");
    setWarehouses([emptyWarehouse()]);
    setReserved("0");
    setIncoming("0");
    setWeight("");
    setWeightUnit("g");
    setLeadTimeDays("");
    setRoutes([emptyRoute()]);
    setError(null);
  };

  const mainRoute = useMemo(() => routes.find((r) => r.isDefault) ?? routes[0], [routes]);
  const production = intOr(leadTimeDays, 0);
  const handling = intOr(mainRoute?.handlingTimeDays ?? "", 0);
  const duplicate = existingSkus.some((s) => s.toLowerCase() === sku.trim().toLowerCase());

  const totalStock = useMemo(
    () => warehouses.reduce((sum, w) => sum + intOr(w.quantity, 0), 0),
    [warehouses],
  );
  const duplicateWarehouse = useMemo(() => {
    const names = warehouses
      .map((w) => w.location.trim().toLowerCase())
      .filter(Boolean);
    return new Set(names).size !== names.length;
  }, [warehouses]);

  const updateWarehouse = (index: number, patch: Partial<WarehouseDraft>) =>
    setWarehouses((prev) => prev.map((w, i) => (i === index ? { ...w, ...patch } : w)));

  const updateRoute = (index: number, patch: Partial<RouteDraft>) =>
    setRoutes((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const setDefaultRoute = (index: number) =>
    setRoutes((prev) => prev.map((r, i) => ({ ...r, isDefault: i === index })));

  const create = useMutation({
    mutationFn: () =>
      callCreate({
        data: {
          storeId: storeId!,
          sku: sku.trim(),
          product_name: productName.trim(),
          tags: tagsInput.split(",").map((t) => t.trim()).filter(Boolean),
          warehouses: warehouses
            .filter((w) => w.location.trim() !== "")
            .map((w) => ({ location: w.location.trim(), quantity: intOr(w.quantity, 0) })),
          reserved: intOr(reserved, 0),
          incoming: intOr(incoming, 0),
          weight: weight.trim() === "" ? null : Number(weight),
          weight_unit: weightUnit,
          lead_time_days: intOr(leadTimeDays, 0),
          shipping_routes: routes.map((r, i) => ({
            destination: r.destination.trim(),
            handling_time_days: intOr(r.handlingTimeDays, 0),
            is_default: r.isDefault || (!routes.some((x) => x.isDefault) && i === 0),
          })),
        },
      }),
    onSuccess: () => {
      toast.success(editing ? "Product updated" : "Product added to your inventory");
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      reset();
      onOpenChange(false);
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const submit = () => {
    if (!storeId) return;
    if (!sku.trim()) return setError("Enter the SKU.");
    if (!productName.trim()) return setError("Enter the product name.");
    if (leadTimeDays.trim() === "") return setError("Enter the production lead time in days.");
    const filledWarehouses = warehouses.filter(
      (w) => w.location.trim() !== "" && w.quantity.trim() !== "",
    );
    if (filledWarehouses.length === 0) {
      return setError("Add at least one warehouse with a name and a quantity.");
    }
    if (warehouses.some((w) => w.quantity.trim() !== "" && Number(w.quantity) < 0)) {
      return setError("Warehouse quantity cannot be negative.");
    }
    if (duplicateWarehouse) return setError("Each warehouse can only appear once.");
    if (routes.some((r) => !r.destination.trim() || r.handlingTimeDays.trim() === "")) {
      return setError("Every shipping route needs a destination and a handling time.");
    }
    setError(null);
    create.mutate();
  };


  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${item.product_name}` : "Add product"}</DialogTitle>
          <DialogDescription>
            {synced
              ? "This product is synced from Shopify. Stock, timings and routes are yours to edit."
              : "The SKU must match the one in your store exactly, so sales can be deducted automatically later."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="i-sku">SKU</Label>
              <Input
                id="i-sku"
                value={sku}
                disabled={synced || editing}
                className={synced || editing ? "bg-muted" : undefined}
                onChange={(e) => setSku(e.target.value)}
                placeholder="FS-0001"
              />
              {synced && <p className="mt-1 text-[12px] text-muted-foreground">Synced from Shopify</p>}
              {!editing && duplicate && sku.trim() !== "" && (
                <p className="mt-1 text-[12px] text-warning">
                  This SKU already exists in this workspace — saving updates it.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="i-name">Product name</Label>
              <Input
                id="i-name"
                value={productName}
                disabled={synced}
                className={synced ? "bg-muted" : undefined}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="Sleep mask"
              />
              {synced && <p className="mt-1 text-[12px] text-muted-foreground">Synced from Shopify</p>}
            </div>
          </div>

          <div>
            <Label htmlFor="i-tags">Tags</Label>
            <Input
              id="i-tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="winter, bestseller"
            />
            <p className="mt-1 text-[12px] text-muted-foreground">Separate with commas. Optional.</p>
          </div>

          <div className="rounded-xl border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <Label>Warehouses</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 rounded-full px-3 text-[12px]"
                onClick={() => setWarehouses((prev) => [...prev, emptyWarehouse()])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add warehouse
              </Button>
            </div>

            <datalist id="warehouse-suggestions">
              {WAREHOUSE_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>

            <div className="space-y-2">
              {warehouses.map((wh, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <Input
                    className="min-w-[140px] flex-1"
                    list="warehouse-suggestions"
                    value={wh.location}
                    onChange={(e) => updateWarehouse(index, { location: e.target.value })}
                    placeholder="Warehouse (e.g. China)"
                  />
                  <Input
                    className="w-32"
                    type="number"
                    min={0}
                    value={wh.quantity}
                    onChange={(e) => updateWarehouse(index, { quantity: e.target.value })}
                    placeholder="Quantity"
                  />
                  {warehouses.length > 1 && (
                    <button
                      type="button"
                      aria-label="Remove warehouse"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setWarehouses((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {duplicateWarehouse && (
              <p className="mt-2 text-[12px] text-warning">
                Each warehouse can only appear once.
              </p>
            )}

            <p className="mt-3 text-[13px] text-muted-foreground">
              Total stock:{" "}
              <span className="font-medium text-foreground">{totalStock} units</span>
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="i-res">Reserved</Label>
              <Input
                id="i-res"
                type="number"
                min={0}
                value={reserved}
                onChange={(e) => setReserved(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="i-inc">Incoming</Label>
              <Input
                id="i-inc"
                type="number"
                min={0}
                value={incoming}
                onChange={(e) => setIncoming(e.target.value)}
              />
            </div>
          </div>


          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Label htmlFor="i-weight">Weight</Label>
              <div className="flex gap-2">
                <Input
                  id="i-weight"
                  type="number"
                  min={0}
                  step="0.01"
                  value={weight}
                  disabled={synced}
                  className={synced ? "bg-muted" : undefined}
                  onChange={(e) => setWeight(e.target.value)}
                  placeholder="Optional"
                />
                <Select
                  value={weightUnit}
                  disabled={synced}
                  onValueChange={(v) => setWeightUnit(v as "g" | "kg")}
                >
                  <SelectTrigger className={synced ? "w-24 bg-muted" : "w-24"}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="g">g</SelectItem>
                    <SelectItem value="kg">kg</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="i-lead">Lead time (days)</Label>
              <Input
                id="i-lead"
                type="number"
                min={0}
                value={leadTimeDays}
                onChange={(e) => setLeadTimeDays(e.target.value)}
                placeholder="30"
              />
            </div>
          </div>

          <div className="rounded-xl border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <Label>Shipping routes</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 rounded-full px-3 text-[12px]"
                onClick={() => setRoutes((prev) => [...prev, emptyRoute()])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add destination
              </Button>
            </div>

            <div className="space-y-2">
              {routes.map((route, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <Input
                    className="min-w-[140px] flex-1"
                    value={route.destination}
                    onChange={(e) => updateRoute(index, { destination: e.target.value })}
                    placeholder="Destination (e.g. United States)"
                  />
                  <Input
                    className="w-32"
                    type="number"
                    min={0}
                    value={route.handlingTimeDays}
                    onChange={(e) => updateRoute(index, { handlingTimeDays: e.target.value })}
                    placeholder="Days"
                  />
                  <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                    <Checkbox
                      checked={route.isDefault}
                      onCheckedChange={() => setDefaultRoute(index)}
                    />
                    Main
                  </label>
                  {routes.length > 1 && (
                    <button
                      type="button"
                      aria-label="Remove destination"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setRoutes((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <p className="mt-3 text-[13px] text-muted-foreground">
              Total lead time:{" "}
              <span className="font-medium text-foreground">{production + handling} days</span>{" "}
              (production: {production}d + shipping to {mainRoute?.destination.trim() || "your main destination"}:{" "}
              {handling}d)
            </p>
          </div>

          {error && <p className="text-[13px] text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="rounded-full" disabled={create.isPending || !storeId} onClick={submit}>
            {create.isPending ? "Saving…" : editing ? "Save changes" : "Add product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
