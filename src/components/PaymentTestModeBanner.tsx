import { STRIPE_FORCE_TEST_MODE } from "@/lib/stripe-mode";

const clientToken = import.meta.env["VITE_PAYMENTS_CLIENT_TOKEN"];

export function PaymentTestModeBanner() {
  if (!clientToken) {
    return (
      <div className="w-full border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
        Production checkout is not configured. Complete Stripe go-live in your Lovable project to
        accept real payments.
      </div>
    );
  }
  // The forced flag wins over the token prefix: while it is on, every payment
  // is routed to the test account even on a pk_live_ build.
  if (STRIPE_FORCE_TEST_MODE || clientToken.startsWith("pk_test_")) {
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
