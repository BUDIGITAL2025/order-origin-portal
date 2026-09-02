/**
 * Admin-only planning editor for one catalogue SKU: supplier assignment plus
 * the product-level lead-time overrides that sit at the top of the cascade
 * (product → supplier → workspace). Leaving a field empty falls back down.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getProductPlanning, listSuppliers, setProductPlanning } from "@/lib/inventory.functions";
import { friendlyError } from "@/lib/errors";

const NONE = "__none__";

function numOrNull(v: string): number | null {
  const n = Number(v);
  return v.trim() === "" || !Number.isFinite(n) ? null : Math.max(0, Math.floor(n));
}

export function PlanningDialog({
  productId,
  onClose,
}: {
  productId: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const fetchPlanning = useServerFn(getProductPlanning);
  const fetchSuppliers = useServerFn(listSuppliers);
  const callSave = useServerFn(setProductPlanning);

  const [supplierId, setSupplierId] = useState<string>(NONE);
  const [production, setProduction] = useState("");
  const [transit, setTransit] = useState("");
  const [safety, setSafety] = useState("");

  const { data: planning } = useQuery({
    queryKey: ["product-planning", productId],
    enabled: productId != null,
    queryFn: () => fetchPlanning({ data: { productId: productId! } }),
  });

  const { data: suppliers } = useQuery({
    queryKey: ["admin-suppliers"],
    enabled: productId != null,
    queryFn: () => fetchSuppliers(),
  });

  useEffect(() => {
    if (!planning) return;
    setSupplierId(planning.supplier_id ?? NONE);
    setProduction(planning.production_lead_days?.toString() ?? "");
    setTransit(planning.transit_lead_days?.toString() ?? "");
    setSafety(planning.safety_margin_days?.toString() ?? "");
  }, [planning]);

  const save = useMutation({
    mutationFn: () =>
      callSave({
        data: {
          productId: productId!,
          supplier_id: supplierId === NONE ? null : supplierId,
          production_lead_days: numOrNull(production),
          transit_lead_days: numOrNull(transit),
          safety_margin_days: numOrNull(safety),
        },
      }),
    onSuccess: () => {
      toast.success("Planning saved");
      void queryClient.invalidateQueries({ queryKey: ["admin-inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["product-planning", productId] });
      onClose();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <Dialog open={productId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Planning — {planning?.product_name ?? "SKU"}</DialogTitle>
          <DialogDescription>
            Leave a field empty to inherit the supplier default, then the workspace default.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Supplier</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger>
                <SelectValue placeholder="No supplier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No supplier</SelectItem>
                {(suppliers?.suppliers ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.default_production_lead_days ?? 0}d + {s.default_transit_lead_days ?? 0}d)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="p-prod">Production</Label>
              <Input
                id="p-prod"
                type="number"
                min={0}
                placeholder="Inherit"
                value={production}
                onChange={(e) => setProduction(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="p-transit">Transit</Label>
              <Input
                id="p-transit"
                type="number"
                min={0}
                placeholder="Inherit"
                value={transit}
                onChange={(e) => setTransit(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="p-safety">Safety</Label>
              <Input
                id="p-safety"
                type="number"
                min={0}
                placeholder="Inherit"
                value={safety}
                onChange={(e) => setSafety(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={onClose}>
            Cancel
          </Button>
          <Button className="rounded-full" disabled={save.isPending} onClick={() => save.mutate()}>
            Save planning
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
