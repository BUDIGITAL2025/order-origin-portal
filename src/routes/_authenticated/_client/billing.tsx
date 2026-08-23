import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Building2, CreditCard, RefreshCcw, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { TopUpCheckoutDialog } from "@/components/TopUpCheckoutDialog";
import { TxnTypeBadge } from "@/components/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatDateTime, formatUSD } from "@/lib/format";
import { PLANS, planLabel } from "@/lib/plans";
import { getStripeEnvironment } from "@/lib/stripe";
import {
  cancelPendingPlanChange,
  changePlan,
  createSubscriptionCheckout,
  getBillingOverview,
  markNotificationsRead,
  saveAutoTopupSettings,
} from "@/lib/billing.functions";
import { getMyWallet } from "@/lib/wallet.functions";
import { updateMyEntity } from "@/lib/profiles.functions";
import { entityDetailsSchema } from "@/lib/schemas";
import { getCurrentStoreId } from "@/components/store-switcher";
import { useMyContext } from "../_client";

type StripeEnv = "sandbox" | "live";

function safeEnvironment(): StripeEnv | null {
  try {
    return getStripeEnvironment();
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/_authenticated/_client/billing")({
  // Stripe's {CHECKOUT_SESSION_ID} is substituted server-side; whatever
  // reaches the browser is still just a display hint — all state changes
  // come from the webhook.
  validateSearch: (
    search: Record<string, unknown>,
  ): { sub?: string; topup?: string } => {
    const sub = search["sub"];
    const topup = search["topup"];
    return {
      ...(typeof sub === "string" ? { sub } : {}),
      ...(typeof topup === "string" ? { topup } : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "Billing — FlySales" },
      { name: "description", content: "Plan, wallet top-ups and auto top-up settings." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BillingPage,
});

const SUGGESTED_AMOUNTS = [100, 250, 500, 1000];
const TOPUP_MIN = 50;

function SubStatusBadge({ status }: { status: string }) {
  const styles: Record<string, { label: string; className: string }> = {
    active: {
      label: "Active",
      className: "border-success/40 bg-success/10 text-success",
    },
    past_due: {
      label: "Past due",
      className: "border-destructive/40 bg-destructive/10 text-destructive",
    },
    canceled: { label: "Canceled", className: "text-muted-foreground" },
    none: { label: "No subscription", className: "text-muted-foreground" },
  };
  const s = styles[status] ?? { label: status, className: "text-muted-foreground" };
  return (
    <Badge variant="outline" className={s.className}>
      {s.label}
    </Badge>
  );
}

function BillingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const environment = safeEnvironment();

  const fetchOverview = useServerFn(getBillingOverview);
  const callSubscribe = useServerFn(createSubscriptionCheckout);
  const callChangePlan = useServerFn(changePlan);
  const callSaveAuto = useServerFn(saveAutoTopupSettings);
  const callMarkRead = useServerFn(markNotificationsRead);
  const fetchWallet = useServerFn(getMyWallet);

  // Billing is per store: the subscription lives on the store selected in
  // the switcher; the wallet/auto top-up resolve to that store's entity.
  const { data: ctx } = useMyContext();
  const [storeId, setStoreId] = useState<string | null>(null);
  useEffect(() => {
    const entities = ctx?.entities ?? [];
    const stored = getCurrentStoreId();
    const valid =
      stored && entities.some((e) => e.stores.some((s) => s.id === stored))
        ? stored
        : null;
    setStoreId(valid ?? entities[0]?.stores[0]?.id ?? null);
  }, [ctx]);

  // The entity the wallet/auto top-up belong to — the current store's owner,
  // or the account's first entity when storeless.
  const billingEntity =
    ctx?.entities?.find((e) => e.stores.some((s) => s.id === storeId)) ??
    ctx?.entities?.[0] ??
    null;

  const { data, isPending } = useQuery({
    queryKey: ["billing-overview", storeId, environment],
    queryFn: () =>
      fetchOverview({
        data: { storeId: storeId!, environment: environment ?? "sandbox" },
      }),
    enabled: environment != null && storeId != null,
  });
  const { data: wallet } = useQuery({ queryKey: ["my-wallet"], queryFn: fetchWallet });

  const { sub, topup } = Route.useSearch();
  useEffect(() => {
    if (sub === "success") {
      toast.success("Subscription received — it activates as soon as the payment confirms.");
    } else if (sub === "cancel") {
      toast.info("Checkout canceled — nothing was charged.");
    }
    if (topup === "done") {
      toast.success("Top-up received — your balance updates as soon as the payment confirms.");
    }
    if (sub || topup) {
      void navigate({ to: "/billing", replace: true, search: {} });
    }
  }, [sub, topup, navigate]);

  const [topupAmount, setTopupAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");

  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoThreshold, setAutoThreshold] = useState("");
  const [autoAmount, setAutoAmount] = useState("");
  useEffect(() => {
    if (!data) return;
    setAutoEnabled(data.entity.auto_topup_enabled);
    setAutoThreshold(
      data.entity.auto_topup_threshold != null ? String(data.entity.auto_topup_threshold) : "",
    );
    setAutoAmount(
      data.entity.auto_topup_amount != null ? String(data.entity.auto_topup_amount) : "",
    );
  }, [data]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["billing-overview"] });

  const subscribe = useMutation({
    mutationFn: async (plan: "basic" | "unlimited") => {
      if (!environment) throw new Error("Payments are not configured for this build");
      if (!storeId) throw new Error("No workspace selected");
      const result = await callSubscribe({
        data: {
          plan,
          returnUrl: `${window.location.origin}/billing`,
          environment,
          storeId,
        },
      });
      if ("error" in result) throw new Error(result.error);
      return result;
    },
    onSuccess: (r) => {
      window.location.assign(r.url);
    },
    onError: (e) => toast.error(e.message),
  });

  const change = useMutation({
    mutationFn: async (plan: "basic" | "unlimited") => {
      if (!environment) throw new Error("Payments are not configured for this build");
      if (!storeId) throw new Error("No workspace selected");
      const result = await callChangePlan({ data: { plan, environment, storeId } });
      if ("error" in result) throw new Error(result.error);
      return result;
    },
    onSuccess: async (r) => {
      toast.success(
        r.applied === "immediate"
          ? "Plan upgraded — you're now on Unlimited."
          : "Downgrade scheduled — it takes effect at the end of the current billing period.",
      );
      await invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const callCancelPending = useServerFn(cancelPendingPlanChange);
  const keepPlan = useMutation({
    mutationFn: async () => {
      if (!environment) throw new Error("Payments are not configured for this build");
      if (!storeId) throw new Error("No workspace selected");
      const result = await callCancelPending({ data: { storeId, environment } });
      if ("error" in result) throw new Error(result.error);
      return result;
    },
    onSuccess: async () => {
      toast.success("Scheduled change cancelled — you keep your current plan.");
      await invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const saveAuto = useMutation({
    mutationFn: () => {
      const threshold = autoThreshold === "" ? null : Number(autoThreshold);
      const amount = autoAmount === "" ? null : Number(autoAmount);
      if (autoEnabled && (threshold == null || amount == null)) {
        throw new Error("Set both a threshold and an amount");
      }
      if (autoEnabled && (amount ?? 0) < TOPUP_MIN) {
        throw new Error(`Auto top-up amount must be at least $${TOPUP_MIN}`);
      }
      if (!storeId) throw new Error("No workspace selected");
      return callSaveAuto({ data: { enabled: autoEnabled, threshold, amount, storeId } });
    },
    onSuccess: async () => {
      toast.success("Auto top-up settings saved");
      await invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const dismiss = useMutation({
    mutationFn: (ids: string[]) => callMarkRead({ data: { ids } }),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const openTopup = (amount: number) => {
    if (!environment) {
      toast.error("Payments are not configured for this build");
      return;
    }
    if (!Number.isFinite(amount) || amount < TOPUP_MIN) {
      toast.error(`Minimum top-up is $${TOPUP_MIN}`);
      return;
    }
    setTopupAmount(amount);
  };

  if (environment == null) {
    return (
      <div>
        <PageHeader title="Billing" description="Plan, wallet and payment settings." />
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Payments are not configured for this build yet. Complete Stripe go-live to
            enable checkout.
          </CardContent>
        </Card>
      </div>
    );
  }

  const store = data?.store;
  const plan = store?.subscription_plan ?? "basic";
  const subStatus = store?.subscription_status ?? "none";
  const hasActiveSub = subStatus === "active" || subStatus === "past_due";
  const feeWaived = store?.fee_waived ?? false;
  const transactions = wallet?.transactions ?? [];

  return (
    <div>
      <PageHeader
        title="Billing"
        description="Your plan, wallet top-ups and auto top-up settings."
      />

      {data?.notifications && data.notifications.length > 0 && (
        <div className="mb-6 space-y-2">
          {data.notifications.map((n) => (
            <div
              key={n.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3"
            >
              <div className="flex items-start gap-2.5">
                <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div>
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={dismiss.isPending}
                onClick={() => dismiss.mutate([n.id])}
              >
                Dismiss
              </Button>
            </div>
          ))}
        </div>
      )}

      {subStatus === "past_due" && (
        <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          Your last subscription payment failed. Stripe retries automatically — make sure
          your saved card is up to date to keep your plan.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ============ Plan ============ */}
        {storeId == null ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="h-4 w-4" /> Subscription
              </CardTitle>
              <CardDescription>Plans are per workspace.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Add a store to choose its plan. Wallet top-ups work without one.
              </p>
              <Button asChild size="sm">
                <Link to="/stores/new">Add store</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="h-4 w-4" /> Subscription
              </CardTitle>
              <SubStatusBadge status={subStatus} />
            </div>
            <CardDescription>
              State changes are applied when the payment confirms — never by just
              visiting checkout.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-2xl font-semibold">{planLabel(plan)}</div>
                <div className="text-sm text-muted-foreground">
                  ${PLANS[plan].priceUsd}/month
                  {feeWaived && " · fee waived by FlySales"}
                </div>
              </div>
              {data?.nextBillingDate && hasActiveSub && (
                <div className="text-right text-xs text-muted-foreground">
                  Next billing date
                  <div className="text-sm font-medium text-foreground">
                    {formatDate(data.nextBillingDate)}
                  </div>
                </div>
              )}
            </div>

            {feeWaived ? (
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                Your plan is managed by FlySales — no payment is collected.
              </p>
            ) : !hasActiveSub ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={subscribe.isPending}
                  onClick={() => subscribe.mutate("basic")}
                >
                  Subscribe — Basic ${PLANS.basic.priceUsd}/mo
                </Button>
                <Button
                  disabled={subscribe.isPending}
                  onClick={() => subscribe.mutate("unlimited")}
                >
                  {subscribe.isPending ? "Redirecting…" : `Subscribe — Unlimited $${PLANS.unlimited.priceUsd}/mo`}
                </Button>
              </div>
            ) : store?.pending_plan_change ? (
              <div className="space-y-3">
                <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
                  Your subscription changes to{" "}
                  <span className="font-medium">{planLabel(store.pending_plan_change)}</span>
                  {store.pending_plan_change_date && (
                    <>
                      {" "}on{" "}
                      <span className="font-medium">
                        {formatDate(store.pending_plan_change_date)}
                      </span>
                    </>
                  )}
                  . Until then you keep {planLabel(plan)} with its full quota.
                </p>
                <Button
                  variant="outline"
                  disabled={keepPlan.isPending}
                  onClick={() => keepPlan.mutate()}
                >
                  {keepPlan.isPending ? "Cancelling…" : `Keep ${planLabel(plan)}`}
                </Button>
              </div>
            ) : plan === "basic" ? (
              <Button
                disabled={change.isPending}
                onClick={() => change.mutate("unlimited")}
              >
                {change.isPending
                  ? "Upgrading…"
                  : `Upgrade to Unlimited — $${PLANS.unlimited.priceUsd}/mo (prorated today)`}
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={change.isPending}
                onClick={() => change.mutate("basic")}
              >
                {change.isPending
                  ? "Scheduling…"
                  : `Downgrade to Basic $${PLANS.basic.priceUsd}/mo (at period end)`}
              </Button>
            )}
          </CardContent>
        </Card>
        )}

        {/* ============ Wallet top-up ============ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4" /> Wallet
            </CardTitle>
            <CardDescription>
              Your prepaid balance funds fulfilment. Top-ups are credited when the
              payment confirms.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Current balance
              </div>
              <div className="tnum text-2xl font-semibold">
                {formatUSD(wallet?.balance ?? data?.balance ?? 0)}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_AMOUNTS.map((amount) => (
                <Button
                  key={amount}
                  variant="outline"
                  size="sm"
                  onClick={() => openTopup(amount)}
                >
                  + ${amount}
                </Button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="custom-topup">Custom amount (min ${TOPUP_MIN})</Label>
                <Input
                  id="custom-topup"
                  type="number"
                  min={TOPUP_MIN}
                  placeholder="e.g. 750"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                />
              </div>
              <Button onClick={() => openTopup(Number(customAmount))}>Top up</Button>
            </div>
          </CardContent>
        </Card>

        {/* ============ Auto top-up ============ */}
        {storeId != null && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RefreshCcw className="h-4 w-4" /> Auto top-up
            </CardTitle>
            <CardDescription>
              Off by default. When your balance falls below your threshold, we charge
              your saved card once and credit the wallet on success.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="auto-topup-enabled">Enable auto top-up</Label>
              <Switch
                id="auto-topup-enabled"
                checked={autoEnabled}
                onCheckedChange={setAutoEnabled}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="auto-threshold">When balance falls below</Label>
                <Input
                  id="auto-threshold"
                  type="number"
                  min={0}
                  placeholder="e.g. 100"
                  value={autoThreshold}
                  onChange={(e) => setAutoThreshold(e.target.value)}
                  disabled={!autoEnabled}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="auto-amount">Charge amount (min ${TOPUP_MIN})</Label>
                <Input
                  id="auto-amount"
                  type="number"
                  min={TOPUP_MIN}
                  placeholder="e.g. 250"
                  value={autoAmount}
                  onChange={(e) => setAutoAmount(e.target.value)}
                  disabled={!autoEnabled}
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Saved card:{" "}
              {data?.paymentMethod ? (
                <span className="font-medium text-foreground">
                  {data.paymentMethod.brand.toUpperCase()} •••• {data.paymentMethod.last4}{" "}
                  (exp {String(data.paymentMethod.expMonth).padStart(2, "0")}/
                  {data.paymentMethod.expYear})
                </span>
              ) : (
                "none yet — make a card top-up first and we'll keep it on file."
              )}
            </div>
            <Button
              variant="secondary"
              disabled={saveAuto.isPending}
              onClick={() => saveAuto.mutate()}
            >
              {saveAuto.isPending ? "Saving…" : "Save auto top-up settings"}
            </Button>
          </CardContent>
        </Card>
        )}
      </div>

      {billingEntity && (
        <div className="mt-6">
          <EntityDetailsCard entity={billingEntity} />
        </div>
      )}

      {/* ============ Billing history ============ */}
      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold">Billing history</h2>
        {transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No transactions yet — top-ups and refunds appear here.
          </p>
        ) : (
          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance after</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(t.created_at)}
                    </TableCell>
                    <TableCell>
                      <TxnTypeBadge type={t.type} />
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-sm">{t.description}</TableCell>
                    <TableCell className="max-w-40 truncate tnum text-xs text-muted-foreground">
                      {t.reference ?? "—"}
                    </TableCell>
                    <TableCell
                      className={
                        "text-right tnum text-sm " +
                        (t.type === "debit" ? "text-destructive" : "text-success")
                      }
                    >
                      {t.type === "debit" ? "−" : "+"}
                      {formatUSD(t.amount)}
                    </TableCell>
                    <TableCell className="text-right tnum text-sm">
                      {formatUSD(t.balance_after)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {topupAmount != null && (storeId != null || billingEntity != null) && (
        <TopUpCheckoutDialog
          key={topupAmount}
          storeId={storeId ?? undefined}
          entityId={billingEntity?.id}
          amountUsd={topupAmount}
          open={topupAmount != null}
          onOpenChange={(open) => {
            if (!open) setTopupAmount(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Entity fiscal details (legal name, VAT, address) — shown on payment
 * receipts. Editable by the account owner; lives at entity level.
 */
function EntityDetailsCard({
  entity,
}: {
  entity: {
    id: string;
    legal_name: string;
    vat_number: string | null;
    country: string | null;
    address?: string | null;
  };
}) {
  const callUpdate = useServerFn(updateMyEntity);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    legal_name: entity.legal_name ?? "",
    country: entity.country ?? "",
    vat_number: entity.vat_number ?? "",
    address: entity.address ?? "",
  });
  const setField =
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((s) => ({ ...s, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = entityDetailsSchema.safeParse({ entity_id: entity.id, ...form });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check your input");
      return;
    }
    setBusy(true);
    try {
      await callUpdate({ data: parsed.data });
      await queryClient.invalidateQueries({ queryKey: ["my-context"] });
      toast.success("Company details saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save company details");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4" /> Company details
        </CardTitle>
        <CardDescription>
          Legal name, VAT and address appear on your payment receipts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ed-legal-name">Legal name</Label>
            <Input id="ed-legal-name" required value={form.legal_name} onChange={setField("legal_name")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ed-country">Country</Label>
            <Input id="ed-country" required value={form.country} onChange={setField("country")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ed-vat">VAT number</Label>
            <Input id="ed-vat" value={form.vat_number} onChange={setField("vat_number")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ed-address">Address</Label>
            <Input id="ed-address" value={form.address} onChange={setField("address")} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" variant="secondary" disabled={busy}>
              {busy ? "Saving…" : "Save company details"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
