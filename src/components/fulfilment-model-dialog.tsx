/**
 * Admin-only fulfilment-model switch (per_order ↔ stock_in).
 *
 * Shared by the fulfilment catalog (row action + SKU detail) and the inbound
 * receipt flow, where receiving stock for a per_order SKU suggests the flip.
 * Every rule is enforced server-side; this dialog only explains it.
 */
import * as React from "react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { friendlyError } from "@/lib/errors";
import {
  adminGetFulfilmentModelContext,
  adminSetFulfilmentModel,
} from "@/lib/inbound.functions";

export type FulfilmentModelTarget = {
  id: string;
  product_name: string;
  sku: string;
  fulfilment_model: string;
};

export function FulfilmentModelDialog({
  target,
  onClose,
  invalidateKeys = [],
}: {
  target: FulfilmentModelTarget | null;
  onClose: () => void;
  invalidateKeys?: unknown[][];
}) {
  const queryClient = useQueryClient();
  const fetchContext = useServerFn(adminGetFulfilmentModelContext);
  const setModel = useServerFn(adminSetFulfilmentModel);

  const { data, isPending } = useQuery({
    queryKey: ["fulfilment-model-context", target?.id ?? ""],
    enabled: target != null,
    queryFn: () => fetchContext({ data: { product_id: target!.id } }),
  });

  const current = data?.product.fulfilment_model ?? target?.fulfilment_model ?? "per_order";
  const next = current === "stock_in" ? "per_order" : "stock_in";
  const units = data?.warehouse_units ?? 0;
  const blocked = next === "per_order" && units > 0;
  const needsGrant = next === "stock_in" && data != null && !data.has_module;

  const flip = useMutation({
    mutationFn: (grant: boolean) =>
      setModel({
        data: {
          product_id: target!.id,
          fulfilment_model: next as "per_order" | "stock_in",
          ...(grant ? { grant_module: true } : {}),
        },
      }),
    onSuccess: (res) => {
      toast.success(
        next === "stock_in"
          ? res.granted
            ? "Switched to stock_in. Fulfilment module granted to this workspace."
            : "Switched to stock_in."
          : "Switched to per order.",
      );
      void queryClient.invalidateQueries({ queryKey: ["fulfilment-model-context"] });
      for (const key of invalidateKeys) void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ["fulfilment-sku"] });
      onClose();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <Dialog open={target != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Fulfilment model</DialogTitle>
          <DialogDescription>
            {target?.product_name} · {target?.sku}
          </DialogDescription>
        </DialogHeader>

        {isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-3 text-sm">
            <p>
              Currently <span className="font-semibold">{current}</span>
              {data?.store_name ? ` · ${data.store_name}` : ""}
              {" · "}
              {units} units in warehouse
            </p>

            {next === "stock_in" ? (
              <div className="rounded-xl border border-border bg-muted/40 p-3">
                <p className="font-medium">Switching to stock_in changes this:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                  <li>Orders will consume warehouse stock instead of being produced per order.</li>
                  <li>Outbound pricing comes from the fulfilment grid (handling + shipping).</li>
                  <li>Orders without enough stock land in needs review.</li>
                </ul>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-muted/40 p-3">
                <p className="font-medium">Switching back to per order changes this:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                  <li>Orders are produced and shipped per order again.</li>
                  <li>Pricing goes back to the accepted quote price.</li>
                </ul>
              </div>
            )}

            {blocked && (
              <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-destructive">
                {units} units in warehouse — ship or write off that stock before switching back to
                per order.
              </p>
            )}

            {needsGrant && (
              <p className="rounded-xl border border-warning/40 bg-warning/10 p-3">
                This workspace does not hold FlySales Fulfilment ($49/month). Granting it here
                unlocks the warehouse service for them at no charge.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={isPending || blocked || flip.isPending}
            onClick={() => flip.mutate(needsGrant)}
          >
            {flip.isPending
              ? "Switching…"
              : needsGrant
                ? "Grant module & switch to stock_in"
                : `Switch to ${next}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
