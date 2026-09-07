import { useEffect, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createCardSetupIntent, confirmSavedCard } from "@/lib/cards.functions";
import { friendlyError } from "@/lib/errors";

type Scope = { storeId?: string | undefined; entityId?: string | undefined };

/**
 * Add or replace the saved card. The card details go straight from the
 * browser to Stripe (SetupIntent + Elements) — FlySales never sees the
 * number. On success the entity's single saved card is replaced and the old
 * one is detached in Stripe.
 */
export function SaveCardDialog({
  open,
  onOpenChange,
  scope,
  replacing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: Scope;
  replacing: boolean;
  onSaved: () => void;
}) {
  const startSetup = useServerFn(createCardSetupIntent);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setClientSecret(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await startSetup({
          data: { ...scope, environment: getStripeEnvironment() },
        });
        if (cancelled) return;
        if ("error" in result) throw new Error(result.error);
        setClientSecret(result.clientSecret);
      } catch (e) {
        if (!cancelled) setLoadError(friendlyError(e, "Could not open the card form."));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope.storeId, scope.entityId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{replacing ? "Replace card" : "Add card"}</DialogTitle>
          <DialogDescription>
            Your card is stored securely by Stripe and used for top-ups. We never see the card
            number.
            {replacing ? " Your previous card is removed once this one is saved." : ""}
          </DialogDescription>
        </DialogHeader>
        {loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : clientSecret ? (
          <Elements stripe={getStripe()} options={{ clientSecret }}>
            <SaveCardForm
              scope={scope}
              onDone={() => {
                onOpenChange(false);
                onSaved();
              }}
            />
          </Elements>
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SaveCardForm({ scope, onDone }: { scope: Scope; onDone: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const confirmCard = useServerFn(confirmSavedCard);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!stripe || !elements) return;
    setBusy(true);
    try {
      const { error, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: "if_required",
      });
      if (error) throw new Error(error.message ?? "The card could not be saved.");
      if (!setupIntent?.id) throw new Error("The card could not be saved.");
      const result = await confirmCard({
        data: {
          ...scope,
          environment: getStripeEnvironment(),
          setupIntentId: setupIntent.id,
        },
      });
      if ("error" in result) throw new Error(String(result.error));
      toast.success("Card saved.");
      onDone();
    } catch (e) {
      toast.error(friendlyError(e, "The card could not be saved. Nothing was charged."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PaymentElement />
      <DialogFooter>
        <Button onClick={() => void submit()} disabled={busy || !stripe}>
          {busy ? "Saving…" : "Save card"}
        </Button>
      </DialogFooter>
    </div>
  );
}
