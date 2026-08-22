import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { ProfileStatusBadge, ProvisioningBadge, TierBadge } from "@/components/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { PLANS, TIER_LABELS, effectiveTier, planQuota } from "@/lib/plans";
import {
  adminListClients,
  adminSetClientStatus,
  adminSetFeeWaived,
  adminSetIntegrationMode,
  adminSetPlan,
  adminSetTierOverride,
  provisionStore,
} from "@/lib/profiles.functions";

export const Route = createFileRoute("/_authenticated/admin/clients")({
  head: () => ({
    meta: [
      { title: "Clients — FlySales Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminClientsPage,
});

function AdminClientsPage() {
  const queryClient = useQueryClient();
  const fetchClients = useServerFn(adminListClients);
  const callSetStatus = useServerFn(adminSetClientStatus);
  const callSetPlan = useServerFn(adminSetPlan);
  const callSetFeeWaived = useServerFn(adminSetFeeWaived);
  const callSetOverride = useServerFn(adminSetTierOverride);
  const callSetIntegrationMode = useServerFn(adminSetIntegrationMode);
  const callProvision = useServerFn(provisionStore);

  const { data, isPending } = useQuery({ queryKey: ["admin-clients"], queryFn: fetchClients });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-clients"] });

  const provision = useMutation({
    mutationFn: (store_id: string) => callProvision({ data: { store_id } }),
    onSuccess: () => {
      toast.success("Store approved and provisioned");
      void invalidate();
    },
    onError: (err) => {
      toast.error(err.message);
      void invalidate();
    },
  });

  const setStatus = useMutation({
    mutationFn: (input: { client_id: string; status: "active" | "suspended" }) =>
      callSetStatus({ data: input }),
    onSuccess: (_r, vars) => {
      toast.success(vars.status === "suspended" ? "Account suspended" : "Account reactivated");
      void invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const setPlan = useMutation({
    mutationFn: (input: { store_id: string; subscription_plan: "basic" | "unlimited" }) =>
      callSetPlan({ data: input }),
    onSuccess: () => {
      toast.success("Subscription plan updated");
      void invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const setFeeWaived = useMutation({
    mutationFn: (input: { store_id: string; fee_waived: boolean }) =>
      callSetFeeWaived({ data: input }),
    onSuccess: (_r, vars) => {
      toast.success(vars.fee_waived ? "Monthly fee waived" : "Fee waiver removed");
      void invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const setOverride = useMutation({
    mutationFn: (input: { store_id: string; tier_override: "starter" | "growth" | "scale" | null }) =>
      callSetOverride({ data: input }),
    onSuccess: () => {
      toast.success("Tier override updated");
      void invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const setIntegrationMode = useMutation({
    mutationFn: (input: { store_id: string; integration_mode: "automatic" | "manual" }) =>
      callSetIntegrationMode({ data: input }),
    onSuccess: () => {
      toast.success("Integration mode updated");
      void invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const clients = data?.clients ?? [];

  return (
    <div>
      <PageHeader title="Clients" description="Approve, suspend and manage plans and pricing tiers." />

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : clients.length === 0 ? (
        <EmptyState title="No clients yet" hint="New signups appear here for approval." />
      ) : (
        <div className="space-y-4">
          {clients.map((c) => (
            <Card key={c.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{c.contact_name}</CardTitle>
                  <ProfileStatusBadge status={c.status} />
                  <span className="ml-auto text-xs text-muted-foreground">
                    Account since {formatDateTime(c.created_at)}
                  </span>
                  {c.status === "active" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ client_id: c.id, status: "suspended" })}
                    >
                      Suspend
                    </Button>
                  )}
                  {c.status === "suspended" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ client_id: c.id, status: "active" })}
                    >
                      Reactivate
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {c.entities.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No legal entities yet.</p>
                ) : (
                  c.entities.map((entity) => (
                    <div key={entity.id} className="rounded-md border border-border p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{entity.legal_name}</span>
                        <ProfileStatusBadge status={entity.status} />
                        <span className="text-xs text-muted-foreground">
                          {[entity.country, entity.vat_number ? `VAT ${entity.vat_number}` : null]
                            .filter(Boolean)
                            .join(" · ") || "No fiscal details"}
                        </span>
                      </div>
                      {entity.stores.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No stores under this entity.</p>
                      ) : (
                        <div className="overflow-x-auto rounded-lg border border-border bg-card">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Store</TableHead>
                                <TableHead>Platform</TableHead>
                                <TableHead>Integration</TableHead>
                                <TableHead>Plan</TableHead>
                                <TableHead>Fee waived</TableHead>
                                <TableHead>Subscription</TableHead>
                                <TableHead>Effective tier</TableHead>
                                <TableHead className="text-right">Units/day (30d)</TableHead>
                                <TableHead className="text-right">Quotes used</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Provisioning</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {entity.stores.map((s) => {
                                const effTier = effectiveTier(s.pricing_tier, s.tier_override);
                                return (
                                  <TableRow key={s.id}>
                                    <TableCell>
                                      <div className="text-sm font-medium">
                                        {s.store_name ?? s.store_url}
                                      </div>
                                      <div className="text-xs text-muted-foreground">{s.store_url}</div>
                                    </TableCell>
                                    <TableCell>
                                      <Badge variant="outline" className="capitalize">
                                        {s.platform}
                                      </Badge>
                                    </TableCell>
                                    <TableCell>
                                      {s.platform === "shopify" ? (
                                        <Select
                                          value={s.integration_mode}
                                          onValueChange={(v) =>
                                            setIntegrationMode.mutate({
                                              store_id: s.id,
                                              integration_mode: v as "automatic" | "manual",
                                            })
                                          }
                                        >
                                          <SelectTrigger className="h-8 w-32 text-xs">
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="manual">Manual</SelectItem>
                                            <SelectItem value="automatic">Automatic</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      ) : (
                                        <span className="text-xs text-muted-foreground">Manual</span>
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      <Select
                                        value={s.subscription_plan}
                                        onValueChange={(v) =>
                                          setPlan.mutate({
                                            store_id: s.id,
                                            subscription_plan: v as "basic" | "unlimited",
                                          })
                                        }
                                      >
                                        <SelectTrigger className="h-8 w-36 text-xs">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="basic">
                                            {PLANS.basic.label} ${PLANS.basic.priceUsd}/mo
                                          </SelectItem>
                                          <SelectItem value="unlimited">
                                            {PLANS.unlimited.label} ${PLANS.unlimited.priceUsd}/mo
                                          </SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </TableCell>
                                    <TableCell>
                                      <div className="flex items-center gap-2">
                                        <Switch
                                          checked={s.fee_waived}
                                          disabled={setFeeWaived.isPending}
                                          onCheckedChange={(checked) =>
                                            setFeeWaived.mutate({ store_id: s.id, fee_waived: checked })
                                          }
                                          aria-label={`Toggle fee waiver for ${s.store_name ?? s.store_url}`}
                                        />
                                        {s.fee_waived && <Badge variant="secondary">Fee waived</Badge>}
                                      </div>
                                    </TableCell>
                                    {/* Read-only Stripe state — written by the payment webhook only.
                                        Admins never charge from inside the portal. */}
                                    <TableCell>
                                      <Badge
                                        variant="outline"
                                        className={
                                          s.subscription_status === "active"
                                            ? "border-success/40 bg-success/10 text-success"
                                            : s.subscription_status === "past_due"
                                              ? "border-destructive/40 bg-destructive/10 text-destructive"
                                              : "text-muted-foreground"
                                        }
                                      >
                                        {s.subscription_status}
                                      </Badge>
                                      {s.stripe_subscription_id && (
                                        <div className="mt-1 max-w-32 truncate font-mono text-xs text-muted-foreground">
                                          {s.stripe_subscription_id}
                                        </div>
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      <div className="flex items-center gap-1.5">
                                        <TierBadge tier={effTier} />
                                        {s.tier_override && (
                                          <span className="text-xs text-warning-foreground">override</span>
                                        )}
                                      </div>
                                      <Select
                                        value={s.tier_override ?? "auto"}
                                        onValueChange={(v) =>
                                          setOverride.mutate({
                                            store_id: s.id,
                                            tier_override:
                                              v === "auto" ? null : (v as "starter" | "growth" | "scale"),
                                          })
                                        }
                                      >
                                        <SelectTrigger className="mt-1 h-7 w-40 text-xs">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="auto">
                                            Auto ({TIER_LABELS[s.pricing_tier] ?? s.pricing_tier})
                                          </SelectItem>
                                          <SelectItem value="starter">Override: Starter</SelectItem>
                                          <SelectItem value="growth">Override: Growth</SelectItem>
                                          <SelectItem value="scale">Override: Scale</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-sm">
                                      {Number(s.avg_daily_units_30d ?? 0).toFixed(1)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-sm">
                                      {s.quotes_used_this_month} / {planQuota(s.subscription_plan) ?? "∞"}
                                    </TableCell>
                                    <TableCell>
                                      <ProfileStatusBadge status={s.status} />
                                    </TableCell>
                                    <TableCell>
                                      <ProvisioningBadge status={s.provisioning_status} />
                                      {s.provisioning_status === "failed" && (
                                        <div className="mt-1 max-w-48 text-xs text-destructive">
                                          {s.provisioning_step}: {s.provisioning_error}
                                        </div>
                                      )}
                                      {s.middleware_tenant_id && (
                                        <div className="mt-1 max-w-40 truncate font-mono text-xs text-muted-foreground">
                                          {s.middleware_tenant_id}
                                        </div>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <div className="flex justify-end gap-2">
                                        {s.status === "pending" && (
                                          <Button
                                            size="sm"
                                            disabled={provision.isPending}
                                            onClick={() => provision.mutate(s.id)}
                                          >
                                            {provision.isPending ? "Approving…" : "Approve"}
                                          </Button>
                                        )}
                                        {s.provisioning_status === "failed" && (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={provision.isPending}
                                            onClick={() => provision.mutate(s.id)}
                                          >
                                            Retry
                                          </Button>
                                        )}
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Effective tier = override if set, otherwise the tier auto-calculated from the 30-day average
        daily units (Starter ≤ 10, Growth ≤ 30, Scale 30+). Tenant IDs are assigned once at approval
        and are immutable. Last signup: {clients[0] ? formatDateTime(clients[0].created_at) : "—"}.
      </p>
    </div>
  );
}
