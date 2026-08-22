import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CreditCard, RefreshCcw, Wallet } from "lucide-react";
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
  changePlan,
  createSubscriptionCheckout,
  getBillingOverview,
  markNotificationsRead,
  saveAutoTopupSettings,
} from "@/lib/billing.functions";
import { getMyWallet } from "@/lib/wallet.functions";

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

  const { data, isPending } = useQuery({
    queryKey: ["billing-overview"],
    queryFn: () => fetchOverview({ data: environment ?? "sandbox" }),
    enabled: environment != null,
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
    setAutoEnabled(data.profile.auto_topup_enabled);
    setAutoThreshold(
      data.profile.auto_topup_threshold != null ? String(data.profile.auto_topup_threshold) : "",
    );
    setAutoAmount(
      data.profile.auto_topup_amount != null ? String(data.profile.auto_topup_amount) : "",
    );
  }, [data]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["billing-overview"] });

  const subscribe = useMutation({
    mutationFn: async (plan: "basic" | "unlimited") => {
      if (!environment) throw new Error("Payments are not configured for this build");
      const result = await callSubscribe({
        data: {
          plan,
          returnUrl: `${window.location.origin}/billing`,
          environment,
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
      const result = await callChangePlan({ data: { plan, environment } });
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
      return callSaveAuto({ data: { enabled: autoEnabled, threshold, amount } });
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

  const profile = data?.profile;
  const plan = profile?.subscription_plan ?? "basic";
  const subStatus = profile?.subscription_status ?? "none";
  const hasActiveSub = subStatus === "active" || subStatus === "past_due";
  const feeWaived = profile?.fee_waived ?? false;
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
              <div className="font-mono text-2xl font-semibold">
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
      </div>

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
                    <TableCell className="max-w-40 truncate font-mono text-xs text-muted-foreground">
                      {t.reference ?? "—"}
                    </TableCell>
                    <TableCell
                      className={
                        "text-right font-mono text-sm " +
                        (t.type === "debit" ? "text-destructive" : "text-success")
                      }
                    >
                      {t.type === "debit" ? "−" : "+"}
                      {formatUSD(t.amount)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatUSD(t.balance_after)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {topupAmount != null && (
        <TopUpCheckoutDialog
          key={topupAmount}
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
