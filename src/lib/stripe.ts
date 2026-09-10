import { loadStripe, Stripe } from "@stripe/stripe-js";

// Declared locally (duplicated with the server utility) so this client
// module has no cross-tree imports. Structurally identical to the server
// StripeEnv — values pass through server-function inputs without issue.
type StripeEnv = "sandbox" | "live";

const clientToken = import.meta.env["VITE_PAYMENTS_CLIENT_TOKEN"];

// Derive environment from the token PREFIX, not its mere presence.
// Missing/unknown → throw; never silently route to 'live'.
function paymentsEnvironment(): StripeEnv {
  if (clientToken?.startsWith("pk_test_")) return "sandbox";
  if (clientToken?.startsWith("pk_live_")) return "live";
  throw new Error(
    "Stripe payments are not configured for this build. " +
      "Complete Stripe go-live in your Lovable project to enable production checkout.",
  );
}

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    // paymentsEnvironment throws if the token is missing or unrecognized.
    paymentsEnvironment();
    stripePromise = loadStripe(clientToken as string);
  }
  return stripePromise;
}

export function getStripeEnvironment(): StripeEnv {
  return paymentsEnvironment();
}
