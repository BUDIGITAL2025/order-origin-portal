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
import { formatDateTime } from "@/lib/format";
import { PLANS, TIER_LABELS, effectiveTier, planQuota } from "@/lib/plans";
import {
  adminListClients,
  adminSetClientStatus,
  adminSetFeeWaived,
  adminSetIntegrationMode,
  adminSetPlan,
  adminSetTierOverride,
  provisionClient,
} from "@/lib/profiles.functions";

// Stripe dashboard links differ between the test environment and live.
const STRIPE_TEST_PREFIX = (
  import.meta.env["VITE_PAYMENTS_CLIENT_TOKEN"] as string | undefined
)?.startsWith("pk_test_")
  ? "/test"
  : "";

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
  const callProvision = useServerFn(provisionClient);

  const { data, isPending } = useQuery({ queryKey: ["admin-clients"], queryFn: fetchClients });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-clients"] });

  const provision = useMutation({
    mutationFn: (client_id: string) => callProvision({ data: { client_id } }),
    onSuccess: () => {
      toast.success("Client approved and provisioned");
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
      toast.success(vars.status === "suspended" ? "Client suspended" : "Client reactivated");
      void invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const setPlan = useMutation({
    mutationFn: (input: { client_id: string; subscription_plan: "basic" | "unlimited" }) =>
      callSetPlan({ data: input }),
    onSuccess: () => {
      toast.success("Subscription plan updated");
      void invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const setFeeWaived = useMutation({
    mutationFn: (input: { client_id: string; fee_waived: boolean }) =>
      callSetFeeWaived({ data: input }),
    onSuccess: (_r, vars) => {
      toast.success(vars.fee_waived ? "Monthly fee waived" : "Fee waiver removed");
      void invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const setOverride = useMutation({
    mutationFn: (input: { client_id: string; tier_override: "starter" | "growth" | "scale" | null }) =>
      callSetOverride({ data: input }),
    onSuccess: () => {
      toast.success("Tier override updated");
      void invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const setIntegrationMode = useMutation({
    mutationFn: (input: { client_id: string; integration_mode: "automatic" | "manual" }) =>
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
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Integration</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Fee waived</TableHead>
                <TableHead>Stripe</TableHead>
                <TableHead>Effective tier</TableHead>
                <TableHead className="text-right">Units/day (30d)</TableHead>
                <TableHead className="text-right">Quotes used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Provisioning</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((c) => {
                const effTier = effectiveTier(c.pricing_tier, c.tier_override);
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="text-sm font-medium">{c.company_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.contact_name} · {c.country} · {c.store_url}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {c.platform}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {c.platform === "shopify" ? (
                        <Select
                          value={c.integration_mode}
                          onValueChange={(v) =>
                            setIntegrationMode.mutate({
                              client_id: c.id,
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
                        value={c.subscription_plan}
                        onValueChange={(v) =>
                          setPlan.mutate({
                            client_id: c.id,
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
                          checked={c.fee_waived}
                          disabled={setFeeWaived.isPending}
                          onCheckedChange={(checked) =>
                            setFeeWaived.mutate({ client_id: c.id, fee_waived: checked })
                          }
                          aria-label={`Toggle fee waiver for ${c.company_name}`}
                        />
                        {c.fee_waived && <Badge variant="secondary">Fee waived</Badge>}
                      </div>
                    </TableCell>
                    {/* Read-only Stripe state — written by the payment webhook only.
                        Admins never charge from inside the portal. */}
                    <TableCell>
                      {c.stripe_customer_id ? (
                        <div className="space-y-1">
                          <Badge
                            variant="outline"
                            className={
                              c.subscription_status === "active"
                                ? "border-success/40 bg-success/10 text-success"
                                : c.subscription_status === "past_due"
                                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                                  : "text-muted-foreground"
                            }
                          >
                            {c.subscription_status}
                          </Badge>
                          <a
                            href={`https://dashboard.stripe.com${STRIPE_TEST_PREFIX}/customers/${c.stripe_customer_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block max-w-32 truncate font-mono text-xs text-primary underline"
                          >
                            {c.stripe_customer_id}
                          </a>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <TierBadge tier={effTier} />
                        {c.tier_override && (
                          <span className="text-xs text-warning-foreground">override</span>
                        )}
                      </div>
                      <Select
                        value={c.tier_override ?? "auto"}
                        onValueChange={(v) =>
                          setOverride.mutate({
                            client_id: c.id,
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
                            Auto ({TIER_LABELS[c.pricing_tier] ?? c.pricing_tier})
                          </SelectItem>
                          <SelectItem value="starter">Override: Starter</SelectItem>
                          <SelectItem value="growth">Override: Growth</SelectItem>
                          <SelectItem value="scale">Override: Scale</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {Number(c.avg_daily_units_30d ?? 0).toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {c.quotes_used_this_month} / {planQuota(c.subscription_plan) ?? "∞"}
                    </TableCell>
                    <TableCell>
                      <ProfileStatusBadge status={c.status} />
                    </TableCell>
                    <TableCell>
                      <ProvisioningBadge status={c.provisioning_status} />
                      {c.provisioning_status === "failed" && (
                        <div className="mt-1 max-w-48 text-xs text-destructive">
                          {c.provisioning_step}: {c.provisioning_error}
                        </div>
                      )}
                      {c.middleware_tenant_id && (
                        <div className="mt-1 max-w-40 truncate font-mono text-xs text-muted-foreground">
                          {c.middleware_tenant_id}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {c.status === "pending" && (
                          <Button
                            size="sm"
                            disabled={provision.isPending}
                            onClick={() => provision.mutate(c.id)}
                          >
                            {provision.isPending ? "Approving…" : "Approve"}
                          </Button>
                        )}
                        {c.provisioning_status === "failed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={provision.isPending}
                            onClick={() => provision.mutate(c.id)}
                          >
                            Retry
                          </Button>
                        )}
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
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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
