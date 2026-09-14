import { isTestMode } from "@/lib/stripe-mode";
import { isPaymentsConfigured } from "@/lib/stripe";

export function PaymentTestModeBanner() {
  if (!isPaymentsConfigured()) {
    return (
      <div className="w-full border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
        Production checkout is not configured. Complete Stripe go-live in your Lovable project to
        accept real payments.
      </div>
    );
  }
  // One switch decides: forced test mode, or any non-production build.
  if (isTestMode()) {
    return (
      <div className="w-full border-b border-warning/30 bg-warning/10 px-4 py-2 text-center text-sm text-warning">
        All payments made in the preview are in test mode.{" "}
        <a
          href="https://docs.lovable.dev/features/payments#test-and-live-environments"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium underline"
        >
          Read more
        </a>
      </div>
    );
  }
  return null;
}
