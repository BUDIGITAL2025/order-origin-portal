import { loadStripe, Stripe } from "@stripe/stripe-js";
import { isTestMode, resolvedStripeEnv } from "./stripe-mode";

// Declared locally (duplicated with the server utility) so this client
// module has no cross-tree imports. Structurally identical to the server
// StripeEnv — values pass through server-function inputs without issue.
type StripeEnv = "sandbox" | "live";

// Publishable keys are public by design. Both are shipped to every build and
// the ACTIVE one is chosen by the same switch the server uses, so the browser
// can never hold a live key while the server is answering in test mode
// (that mismatch was the go-live blocker).
// Publishable keys are public by design. We still read env vars first so a
// project can rotate keys without a code change, but we keep the current keys
// as fallbacks so the checkout can never be disabled by a missing build-time
// variable (the previous live-only env split caused the published app to fail in
// test mode).
const TEST_TOKEN =
  (import.meta.env["VITE_PAYMENTS_CLIENT_TOKEN_TEST"] as string | undefined) ||
  "pk_test_51UFY5JGbNoUPCmzMU2cBA6sx3tUwjIDo1XVcVCKasAUhYrQRKZryvB944FLA02k8oOTDJKi8CUuoBAqVJW0r3L1P00MORkmVyd";
const LIVE_TOKEN =
  (import.meta.env["VITE_PAYMENTS_CLIENT_TOKEN_LIVE"] as string | undefined) ||
  "pk_live_51UFb0zPw8DAwWlgPAGeA7ti9R8lYTmvIbZd5h4hM806DUu6esvIaCvC7ncfPrccKkyhsCC9jdjS4DNs17y5aEolt00IRnPuIGo";
// Legacy single-token var kept as a fallback for whichever mode matches it.
const LEGACY_TOKEN = import.meta.env["VITE_PAYMENTS_CLIENT_TOKEN"] as string | undefined;

function tokenFor(testMode: boolean): string | undefined {
  const prefix = testMode ? "pk_test_" : "pk_live_";
  const primary = testMode ? TEST_TOKEN : LIVE_TOKEN;
  if (primary?.startsWith(prefix)) return primary;
  if (LEGACY_TOKEN?.startsWith(prefix)) return LEGACY_TOKEN;
  return undefined;
}

/** The publishable key for the mode the whole app is currently running in. */
export function getPublishableKey(): string {
  const testMode = isTestMode();
  const token = tokenFor(testMode);
  if (!token) {
    throw new Error(
      testMode
        ? "Stripe test payments are not configured for this build (missing test publishable key)."
        : "Stripe live payments are not configured for this build. " +
            "Complete Stripe go-live in your Lovable project to enable production checkout.",
    );
  }
  return token;
}

/** True when the active publishable key is present for the current mode. */
export function isPaymentsConfigured(): boolean {
  return tokenFor(isTestMode()) != null;
}

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    stripePromise = loadStripe(getPublishableKey());
  }
  return stripePromise;
}

export function getStripeEnvironment(): StripeEnv {
  // Derived from the single master switch — never from the token prefix.
  return resolvedStripeEnv();
}
