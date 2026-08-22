import { useState } from "react";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createWalletTopupCheckout } from "@/lib/billing.functions";

/**
 * Embedded Stripe checkout for a wallet top-up (payment mode). The card is
 * saved via setup_future_usage so auto top-up can charge it later. The parent
 * must render this keyed by amount (`key={amount}`) so a new amount remounts
 * with a fresh client secret.
 */
export function TopUpCheckoutDialog({
  amountUsd,
  storeId,
  entityId,
  open,
  onOpenChange,
}: {
  amountUsd: number;
  /** Current store — the top-up credits the entity that owns it. */
  storeId?: string;
  /** Storeless accounts pass the entity directly. */
  entityId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [options] = useState(() => ({
    fetchClientSecret: async (): Promise<string> => {
      const result = await createWalletTopupCheckout({
        data: {
          amountUsd,
          ...(storeId ? { storeId } : {}),
          ...(entityId ? { entityId } : {}),
          returnUrl: `${window.location.origin}/billing?topup=done&session_id={CHECKOUT_SESSION_ID}`,
          environment: getStripeEnvironment(),
        },
      });
      if ("error" in result) throw new Error(result.error);
      if (!result.clientSecret) throw new Error("Stripe did not return a client secret");
      return result.clientSecret;
    },
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Top up ${amountUsd.toFixed(2)}</DialogTitle>
          <DialogDescription>
            Secure card payment. Your card is saved so you can enable auto top-up later.
          </DialogDescription>
        </DialogHeader>
        <EmbeddedCheckoutProvider stripe={getStripe()} options={options}>
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </DialogContent>
    </Dialog>
  );
}
