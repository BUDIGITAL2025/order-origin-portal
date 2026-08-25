import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw, Settings2, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { ProfileStatusBadge, ProvisioningBadge, TierBadge } from "@/components/status-badges";
import {
  AdminSearch,
  Chip,
  FilterTabs,
  RowAction,
  RowActions,
  SummaryBar,
  TableShell,
  ToolBar,
  Value,
} from "@/components/admin-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { formatSignupSource } from "@/lib/acquisition";
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

const STATUS_TABS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "pending", label: "Pending" },
  { id: "suspended", label: "Suspended" },
] as const;
type StatusTab = (typeof STATUS_TABS)[number]["id"];

function AdminClientsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
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
      toast.success("Workspace approved and provisioned");
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

  const allClients = data?.clients ?? [];
  const countStatus = (status: string) => allClients.filter((c) => c.status === status).length;
  const pendingWorkspaces = allClients.reduce(
    (acc, c) =>
      acc +
      c.entities.reduce((n, e) => n + e.stores.filter((s) => s.status === "pending").length, 0),
    0,
  );

  const term = search.trim().toLowerCase();
  const clients = allClients.filter((c) => {
    if (statusFilter && c.status !== statusFilter) return false;
    if (!term) return true;
    return [
      c.contact_name,
      ...c.entities.flatMap((e) => [
        e.legal_name,
        ...e.stores.map((s) => `${s.store_name ?? ""} ${s.store_url ?? ""}`),
      ]),
    ]
      .join(" ")
      .toLowerCase()
      .includes(term);
  });

  return (
    <div>
      <PageHeader title="Clients" description="Approve, suspend and manage plans and pricing tiers." />

      <SummaryBar
        className="lg:grid-cols-4"
        items={[
          {
            key: "active",
            label: "Active",
            value: countStatus("active"),
            tone: "success",
            active: statusFilter === "active",
            onClick: () => setStatusFilter(statusFilter === "active" ? null : "active"),
          },
          {
            key: "pending",
            label: "Pending approval",
            value: countStatus("pending"),
            tone: "warning",
            active: statusFilter === "pending",
            onClick: () => setStatusFilter(statusFilter === "pending" ? null : "pending"),
          },
          {
            key: "suspended",
            label: "Suspended",
            value: countStatus("suspended"),
            tone: "danger",
            active: statusFilter === "suspended",
            onClick: () => setStatusFilter(statusFilter === "suspended" ? null : "suspended"),
          },
          {
            key: "ws_pending",
            label: "Workspaces awaiting approval",
            value: pendingWorkspaces,
            tone: "info",
          },
        ]}
      />

      <ToolBar>
        <FilterTabs
          tabs={STATUS_TABS}
          value={(statusFilter ?? "all") as StatusTab}
          onChange={(id) => setStatusFilter(id === "all" ? null : id)}
        />
        <AdminSearch
          value={search}
          onChange={setSearch}
          placeholder="Search by contact, entity or workspace"
        />
      </ToolBar>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : clients.length === 0 ? (
        <EmptyState title="No clients yet" hint="New signups appear here for approval." />
      ) : (
        <div className="space-y-4">
          {clients.map((c) => (
            <Card key={c.id}>
              <CardHeader className="pb-3">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <CardTitle className="truncate text-base">{c.contact_name}</CardTitle>
                    <ProfileStatusBadge status={c.status} />
                    {formatSignupSource(c.signup_source) && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {formatSignupSource(c.signup_source)}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground sm:ml-auto">
                    Since {formatDateTime(c.created_at)}
                  </span>
                  {c.status === "active" && (
                    <RowAction
                      label="Suspend account"
                      icon={UserX}
                      tone="danger"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ client_id: c.id, status: "suspended" })}
                    />
                  )}
                  {c.status === "suspended" && (
                    <RowAction
                      label="Reactivate account"
                      icon={UserCheck}
                      tone="primary"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ client_id: c.id, status: "active" })}
                    />
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {c.entities.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No legal entities yet.</p>
                ) : (
                  c.entities.map((entity) => (
                    <div key={entity.id} className="rounded-md border border-border p-3 pl-4">
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
                        <p className="text-xs text-muted-foreground">No workspaces under this entity.</p>
                      ) : (
                        <TableShell>
                          <Table className="text-[13px]">
                            <TableHeader>
                              <TableRow>
                                <TableHead className="h-9">Workspace</TableHead>
                                <TableHead className="h-9">Plan</TableHead>
                                <TableHead className="h-9">Subscription</TableHead>
                                <TableHead className="h-9">Tier</TableHead>
                                <TableHead className="h-9 text-right">Units/day</TableHead>
                                <TableHead className="h-9 text-right">Quotes</TableHead>
                                <TableHead className="h-9">Status</TableHead>
                                <TableHead className="h-9 text-right">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {entity.stores.map((s) => {
                                const effTier = effectiveTier(s.pricing_tier, s.tier_override);
                                return (
                                  <TableRow key={s.id} className="hover:bg-accent/60">
                                    <TableCell className="max-w-56 py-2.5">
                                      <div className="truncate font-medium">
                                        {s.store_name ?? s.store_url}
                                      </div>
                                      <div className="truncate text-xs text-muted-foreground">
                                        {s.store_url}
                                      </div>
                                      <div className="mt-1 flex flex-wrap items-center gap-1">
                                        <Chip>{s.platform}</Chip>
                                        <Chip tone={s.integration_mode === "automatic" ? "success" : "neutral"}>
                                          {s.integration_mode}
                                        </Chip>
                                        {s.fee_waived && <Chip tone="info">fee waived</Chip>}
                                      </div>
                                    </TableCell>
                                    <TableCell className="py-2.5">
                                      <Select
                                        value={s.subscription_plan}
                                        onValueChange={(v) =>
                                          setPlan.mutate({
                                            store_id: s.id,
                                            subscription_plan: v as "basic" | "unlimited",
                                          })
                                        }
                                      >
                                        <SelectTrigger className="h-7 w-28 text-xs">
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
                                    {/* Read-only Stripe state — written by the payment webhook only. */}
                                    <TableCell className="py-2.5">
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
                                    </TableCell>
                                    <TableCell className="py-2.5">
                                      <div className="flex items-center gap-1.5">
                                        <TierBadge tier={effTier} />
                                        {s.tier_override && (
                                          <span className="text-[11px] text-warning">override</span>
                                        )}
                                      </div>
                                    </TableCell>
                                    <TableCell className="tnum py-2.5 text-right">
                                      {Number(s.avg_daily_units_30d ?? 0).toFixed(1)}
                                    </TableCell>
                                    <TableCell className="tnum py-2.5 text-right">
                                      {s.quotes_used_this_month} /{" "}
                                      {planQuota(s.subscription_plan) ?? "∞"}
                                    </TableCell>
                                    <TableCell className="py-2.5">
                                      <ProfileStatusBadge status={s.status} />
                                      <div className="mt-1">
                                        <ProvisioningBadge status={s.provisioning_status} />
                                      </div>
                                    </TableCell>
                                    <TableCell className="py-2.5">
                                      <RowActions>
                                        {s.status === "pending" && (
                                          <RowAction
                                            label={provision.isPending ? "Approving…" : "Approve workspace"}
                                            icon={CheckCircle2}
                                            tone="primary"
                                            disabled={provision.isPending}
                                            onClick={() => provision.mutate(s.id)}
                                          />
                                        )}
                                        {s.provisioning_status === "failed" && (
                                          <RowAction
                                            label="Retry provisioning"
                                            icon={RefreshCw}
                                            disabled={provision.isPending}
                                            onClick={() => provision.mutate(s.id)}
                                          />
                                        )}
                                        <Popover>
                                          <PopoverTrigger asChild>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-7 w-7"
                                              aria-label="Workspace details"
                                              title="Details and overrides"
                                            >
                                              <Settings2 className="h-3.5 w-3.5" />
                                            </Button>
                                          </PopoverTrigger>
                                          <PopoverContent align="end" className="w-72 space-y-3">
                                            <div className="space-y-1.5">
                                              <Label className="text-xs">Integration mode</Label>
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
                                                  <SelectTrigger className="h-8 text-xs">
                                                    <SelectValue />
                                                  </SelectTrigger>
                                                  <SelectContent>
                                                    <SelectItem value="manual">Manual</SelectItem>
                                                    <SelectItem value="automatic">Automatic</SelectItem>
                                                  </SelectContent>
                                                </Select>
                                              ) : (
                                                <p className="text-xs text-muted-foreground">
                                                  Manual only on this platform.
                                                </p>
                                              )}
                                            </div>
                                            <div className="space-y-1.5">
                                              <Label className="text-xs">Pricing tier</Label>
                                              <Select
                                                value={s.tier_override ?? "auto"}
                                                onValueChange={(v) =>
                                                  setOverride.mutate({
                                                    store_id: s.id,
                                                    tier_override:
                                                      v === "auto"
                                                        ? null
                                                        : (v as "starter" | "growth" | "scale"),
                                                  })
                                                }
                                              >
                                                <SelectTrigger className="h-8 text-xs">
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
                                            </div>
                                            <div className="flex items-center justify-between gap-3">
                                              <Label className="text-xs">Monthly fee waived</Label>
                                              <Switch
                                                checked={s.fee_waived}
                                                disabled={setFeeWaived.isPending}
                                                onCheckedChange={(checked) =>
                                                  setFeeWaived.mutate({
                                                    store_id: s.id,
                                                    fee_waived: checked,
                                                  })
                                                }
                                                aria-label={`Toggle fee waiver for ${s.store_name ?? s.store_url}`}
                                              />
                                            </div>
                                            <dl className="space-y-1 border-t border-border pt-2 text-xs">
                                              <div className="flex justify-between gap-2">
                                                <dt className="text-muted-foreground">Subscription id</dt>
                                                <dd className="max-w-36 truncate font-mono">
                                                  <Value>{s.stripe_subscription_id}</Value>
                                                </dd>
                                              </div>
                                              <div className="flex justify-between gap-2">
                                                <dt className="text-muted-foreground">Tenant id</dt>
                                                <dd className="max-w-36 truncate font-mono">
                                                  <Value>{s.middleware_tenant_id}</Value>
                                                </dd>
                                              </div>
                                              {s.provisioning_status === "failed" && (
                                                <p className="text-destructive">
                                                  {s.provisioning_step}: {s.provisioning_error}
                                                </p>
                                              )}
                                            </dl>
                                          </PopoverContent>
                                        </Popover>
                                      </RowActions>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </TableShell>
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
        and are immutable. Last signup:{" "}
        {allClients[0] ? formatDateTime(allClients[0].created_at) : "—"}.
      </p>
    </div>
  );
}
