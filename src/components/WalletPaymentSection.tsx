import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, RefreshCcw, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { SaveCardDialog } from "@/components/SaveCardDialog";
import { TopUpCheckoutDialog } from "@/components/TopUpCheckoutDialog";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { friendlyError } from "@/lib/errors";
import { cardLabel } from "@/lib/card-label";
import {
  chargeSavedCardTopup,
  finalizeCardTopup,
  getMyPaymentMethod,
  removeSavedCard,
} from "@/lib/cards.functions";
import { saveAutoTopupSettings } from "@/lib/billing.functions";

const TOPUP_MIN = 50;
const SUGGESTED = [100, 250, 500, 1000];

function safeEnvironment(): "sandbox" | "live" | null {
  try {
    return getStripeEnvironment();
  } catch {
    return null;
  }
}

/**
 * Payment method + fast top-up + auto top-up for the wallet. ONE saved card
 * per entity: the same card powers manual fast top-ups, automatic top-ups
 * and cover-the-difference order payments.
 */
export function WalletPaymentSection({
  storeId,
  entityId,
}: {
  storeId?: string | undefined;
  entityId?: string | undefined;
}) {
  const environment = safeEnvironment();
  const queryClient = useQueryClient();
  const scope = { ...(storeId ? { storeId } : {}), ...(entityId ? { entityId } : {}) };

  const fetchCard = useServerFn(getMyPaymentMethod);
  const callRemove = useServerFn(removeSavedCard);
  const callCharge = useServerFn(chargeSavedCardTopup);
  const callFinalize = useServerFn(finalizeCardTopup);
  const callSaveAuto = useServerFn(saveAutoTopupSettings);

  const { data, isPending } = useQuery({
    queryKey: ["my-payment-method", storeId ?? null, entityId ?? null],
    queryFn: () => fetchCard({ data: scope }),
  });
  const card = data?.card ?? null;

  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [checkoutAmount, setCheckoutAmount] = useState<number | null>(null);

  const [autoEnabled, setAutoEnabled] = useState<boolean | null>(null);
  const [autoThreshold, setAutoThreshold] = useState<string | null>(null);
  const [autoAmount, setAutoAmount] = useState<string | null>(null);
  const auto = data?.autoTopup;
  const enabled = autoEnabled ?? auto?.enabled ?? false;
  const threshold = autoThreshold ?? (auto?.threshold != null ? String(auto.threshold) : "");
  const chargeAmount = autoAmount ?? (auto?.amount != null ? String(auto.amount) : "");

  const refresh = () =>
    queryClient.invalidateQueries().then(() => {
      setAutoEnabled(null);
      setAutoThreshold(null);
      setAutoAmount(null);
    });

  const remove = useMutation({
    mutationFn: async () => {
      if (!environment) throw new Error("Payments are not available in this environment yet.");
      const result = await callRemove({ data: { ...scope, environment } });
      if ("error" in result) throw new Error(String(result.error));
      return result;
    },
    onSuccess: async () => {
      toast.success("Card removed.");
      setRemoveOpen(false);
      await refresh();
    },
    onError: (e) => toast.error(friendlyError(e, "The card could not be removed.")),
  });

  const fastTopup = useMutation({
    mutationFn: async (usd: number) => {
      if (!environment) throw new Error("Payments are not available in this environment yet.");
      const result = await callCharge({ data: { ...scope, environment, amountUsd: usd } });
      if ("error" in result) throw new Error(String(result.error));
      if (result.status === "requires_action") {
        const stripe = await getStripe();
        if (!stripe) throw new Error("Stripe could not be loaded.");
        const { error } = await stripe.handleNextAction({
          clientSecret: result.clientSecret,
        });
        if (error) throw new Error(error.message ?? "Card authentication failed.");
        const done = await callFinalize({
          data: { ...scope, environment, paymentIntentId: result.paymentIntentId },
        });
        if ("error" in done) throw new Error(String(done.error));
        return done;
      }
      return result;
    },
    onSuccess: async (r) => {
      toast.success(`$${Number(r.amountUsd).toFixed(2)} added to your wallet.`);
      setAmount("");
      await refresh();
    },
    onError: (e) => toast.error(friendlyError(e, "The card was declined. Nothing was credited.")),
  });

  const saveAuto = useMutation({
    mutationFn: async () => {
      if (!storeId) throw new Error("Select a workspace first.");
      const t = threshold === "" ? null : Number(threshold);
      const a = chargeAmount === "" ? null : Number(chargeAmount);
      if (enabled && (t == null || a == null)) {
        throw new Error("Set both a threshold and an amount.");
      }
      if (enabled && (a ?? 0) < TOPUP_MIN) {
        throw new Error(`The auto top-up amount must be at least $${TOPUP_MIN}.`);
      }
      return callSaveAuto({ data: { enabled, threshold: t, amount: a, storeId } });
    },
    onSuccess: async () => {
      toast.success("Auto top-up settings saved.");
      await refresh();
    },
    onError: (e) => toast.error(friendlyError(e, "Settings could not be saved.")),
  });

  function startTopup(usd: number, viaCard: boolean) {
    if (!environment) {
      toast.error("Payments are not available in this environment yet.");
      return;
    }
    if (!Number.isFinite(usd) || usd < TOPUP_MIN) {
      toast.error(`The minimum top-up is $${TOPUP_MIN}.`);
      return;
    }
    if (viaCard && card) fastTopup.mutate(usd);
    else setCheckoutAmount(usd);
  }

  const typedAmount = Number(amount);

  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-2">
      {/* ============ Payment method ============ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4" /> Payment method
          </CardTitle>
          <CardDescription>
            One card on file. It funds your wallet — for manual top-ups, automatic top-ups and
            covering the difference when you pay an order.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isPending ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : card ? (
            <>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">{cardLabel(card)}</p>
                  <p className="tnum text-xs text-muted-foreground">
                    Expires {String(card.expMonth).padStart(2, "0")}/{card.expYear}
                  </p>
                </div>
                <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
                  Saved
                </Badge>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setCardDialogOpen(true)}>
                  Replace card
                </Button>
                <Button variant="outline" size="sm" onClick={() => setRemoveOpen(true)}>
                  Remove card
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                No card saved. Add one to top up in one click and to pay orders when your balance
                falls short.
              </p>
              <Button size="sm" onClick={() => setCardDialogOpen(true)}>
                Add card
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* ============ Fast top-up ============ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4" /> Top up
          </CardTitle>
          <CardDescription>
            Add funds in USD. The balance stays yours until an order is paid.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {SUGGESTED.map((v) => (
              <Button
                key={v}
                variant="outline"
                size="sm"
                disabled={fastTopup.isPending}
                onClick={() => startTopup(v, Boolean(card))}
              >
                + ${v}
              </Button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wallet-topup-amount">Custom amount (min ${TOPUP_MIN})</Label>
            <Input
              id="wallet-topup-amount"
              type="number"
              min={TOPUP_MIN}
              placeholder="e.g. 250"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {card && (
              <Button disabled={fastTopup.isPending} onClick={() => startTopup(typedAmount, true)}>
                {fastTopup.isPending ? "Charging…" : `Charge saved card ${cardLabel(card)}`}
              </Button>
            )}
            <Button
              variant={card ? "outline" : "default"}
              disabled={fastTopup.isPending}
              onClick={() => startTopup(typedAmount, false)}
            >
              {card ? "Use another card" : "Top up by card"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ============ Auto top-up ============ */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <RefreshCcw className="h-4 w-4" /> Auto top-up
          </CardTitle>
          <CardDescription>
            Off by default. When your balance falls below your threshold, we charge your saved card
            once and credit the wallet on success.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="auto-topup-enabled">Enable auto top-up</Label>
            <Switch
              id="auto-topup-enabled"
              checked={enabled}
              onCheckedChange={setAutoEnabled}
              disabled={!card || !storeId}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="auto-threshold">When balance falls below</Label>
              <Input
                id="auto-threshold"
                type="number"
                min={0}
                placeholder="e.g. 100"
                value={threshold}
                onChange={(e) => setAutoThreshold(e.target.value)}
                disabled={!enabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auto-amount">Charge amount (min ${TOPUP_MIN})</Label>
              <Input
                id="auto-amount"
                type="number"
                min={TOPUP_MIN}
                placeholder="e.g. 250"
                value={chargeAmount}
                onChange={(e) => setAutoAmount(e.target.value)}
                disabled={!enabled}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {card ? `Charges ${cardLabel(card)}.` : "Add a card above to enable automatic top-ups."}
            {!storeId ? " Select a workspace to change these settings." : ""}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={saveAuto.isPending || !storeId}
            onClick={() => saveAuto.mutate()}
          >
            {saveAuto.isPending ? "Saving…" : "Save auto top-up settings"}
          </Button>
        </CardContent>
      </Card>

      <SaveCardDialog
        open={cardDialogOpen}
        onOpenChange={setCardDialogOpen}
        scope={scope}
        replacing={Boolean(card)}
        onSaved={() => void refresh()}
      />

      {checkoutAmount != null && (
        <TopUpCheckoutDialog
          key={checkoutAmount}
          amountUsd={checkoutAmount}
          {...scope}
          open={true}
          onOpenChange={(open) => {
            if (!open) setCheckoutAmount(null);
          }}
        />
      )}

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this card?</AlertDialogTitle>
            <AlertDialogDescription>
              {auto?.enabled
                ? "This disables automatic top-ups. Your wallet balance is not affected, and you can add a card again at any time."
                : "Your wallet balance is not affected. You can add a card again at any time."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep card</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                remove.mutate();
              }}
            >
              {remove.isPending ? "Removing…" : "Remove card"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
