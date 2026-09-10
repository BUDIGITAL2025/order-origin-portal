/**
 * Paywall for the paid Fulfilment module (the warehouse service).
 *
 * Dropshipping per order and buying stock direct to your own address are base
 * plan behaviour and never touch this component.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, Lock, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MODULES } from "@/lib/modules";
import { getMyWorkspaceModules, createModuleCheckout } from "@/lib/modules.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { friendlyError } from "@/lib/errors";

export function useWorkspaceModule(storeId: string | null, moduleKey: "fulfilment") {
  const fetchModules = useServerFn(getMyWorkspaceModules);
  const query = useQuery({
    queryKey: ["workspace-modules", storeId],
    enabled: Boolean(storeId),
    queryFn: () =>
      fetchModules({ data: { storeId: storeId!, environment: getStripeEnvironment() } }),
  });
  return {
    isLoading: query.isPending && Boolean(storeId),
    hasModule: Boolean(query.data?.keys.includes(moduleKey)),
    activation: query.data?.modules.find((m) => m.module_key === moduleKey) ?? null,
  };
}

export function FulfilmentPaywall({
  storeId,
  action,
}: {
  storeId: string | null;
  /** What the client was trying to do, so the copy lands in context. */
  action?: string;
}) {
  const mod = MODULES.fulfilment;
  const checkout = useServerFn(createModuleCheckout);
  const start = useMutation({
    mutationFn: async () => {
      if (!storeId) throw new Error("Choose a workspace first.");
      const r = await checkout({
        data: {
          storeId,
          moduleKey: "fulfilment" as const,
          environment: getStripeEnvironment(),
          returnUrl: window.location.href.split("?")[0]!,
        },
      });
      if ("error" in r && r.error) throw new Error(r.error);
      return r as { url: string };
    },
    onSuccess: (r) => {
      window.location.href = r.url;
    },
    onError: (e) => toast.error(friendlyError(e, "Activation could not be started.")),
  });

  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15">
        <Warehouse className="h-5 w-5 text-primary" />
      </span>
      <h2 className="mt-4 text-lg font-semibold tracking-tight">{mod.name}</h2>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">
        {action ? `${action} is part of our fulfilment service. ` : ""}
        {mod.blurb}
      </p>

      <ul className="mt-4 grid gap-2 sm:max-w-xl">
        {mod.unlocks.map((u) => (
          <li key={u} className="flex items-start gap-2 text-sm">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{u}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-xl border border-border bg-muted/30 p-3">
        <p className="text-xs font-medium">Per-piece rules once active</p>
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {mod.rules.map((r) => (
            <li key={r}>• {r}</li>
          ))}
        </ul>
      </div>

      <p className="mt-4 text-2xl font-semibold tracking-tight">${mod.priceUsd}/month</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Billed separately from your plan and from the Growth Bundle. Dropshipping per order, and
        buying stock direct to your own address, stay open without it.
      </p>
      <Button className="mt-4" disabled={!storeId || start.isPending} onClick={() => start.mutate()}>
        {start.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Lock className="mr-2 h-4 w-4" />
        )}
        Activate — ${mod.priceUsd}/month
      </Button>
    </section>
  );
}

export function ModuleGateSkeleton() {
  return <Skeleton className="h-64 rounded-2xl" />;
}
