/**
 * Manual inventory item creation. Clients type in the stock they hold and the
 * timing behind it; everything derived (sellable, sales, state) is computed
 * server-side and never submitted from here.
 */
import { useMemo, useState } from "react";
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
import { createInventoryItem } from "@/lib/inventory.functions";
import { friendlyError } from "@/lib/errors";

interface RouteDraft {
  destination: string;
  handlingTimeDays: string;
  isDefault: boolean;
}

const emptyRoute = (): RouteDraft => ({ destination: "", handlingTimeDays: "", isDefault: false });

function intOr(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

export function InventoryItemDialog({
  open,
  storeId,
  existingSkus,
  onOpenChange,
}: {
  open: boolean;
  storeId: string | null;
  existingSkus: string[];
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const callCreate = useServerFn(createInventoryItem);

  const [sku, setSku] = useState("");
  const [productName, setProductName] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [inWarehouse, setInWarehouse] = useState("0");
  const [reserved, setReserved] = useState("0");
  const [incoming, setIncoming] = useState("0");
  const [weight, setWeight] = useState("");
  const [weightUnit, setWeightUnit] = useState<"g" | "kg">("g");
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [routes, setRoutes] = useState<RouteDraft[]>([emptyRoute()]);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setSku("");
    setProductName("");
    setTagsInput("");
    setInWarehouse("0");
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
          in_warehouse: intOr(inWarehouse, 0),
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
      toast.success("Product added to your inventory");
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
    if (intOr(inWarehouse, -1) < 0) return setError("Warehouse quantity cannot be negative.");
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
          <DialogTitle>Add product</DialogTitle>
          <DialogDescription>
            The SKU must match the one in your store exactly, so sales can be deducted
            automatically later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="i-sku">SKU</Label>
              <Input id="i-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="FS-0001" />
              {duplicate && sku.trim() !== "" && (
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
                onChange={(e) => setProductName(e.target.value)}
                placeholder="Sleep mask"
              />
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

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="i-wh">In warehouse</Label>
              <Input
                id="i-wh"
                type="number"
                min={0}
                value={inWarehouse}
                onChange={(e) => setInWarehouse(e.target.value)}
              />
            </div>
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
                  onChange={(e) => setWeight(e.target.value)}
                  placeholder="Optional"
                />
                <Select value={weightUnit} onValueChange={(v) => setWeightUnit(v as "g" | "kg")}>
                  <SelectTrigger className="w-24">
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
            {create.isPending ? "Adding…" : "Add product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
