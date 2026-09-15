/**
 * SINGLE MASTER SWITCH for Stripe test vs. live mode.
 *
 * This module is browser-safe on purpose: both the client bundle (banner,
 * publishable-key selection in src/lib/stripe.ts) and the server utility
 * (src/lib/stripe.server.ts) import the same helpers, so there is exactly one
 * place to flip and both halves can never disagree.
 *
 *   STRIPE_FORCE_TEST_MODE = true  → every Stripe call (checkout,
 *           subscriptions, wallet top-ups, SetupIntents) is routed to the
 *           TEST/sandbox account, live webhooks are acknowledged and ignored,
 *           the orange test banner shows.
 *   STRIPE_FORCE_TEST_MODE = false → PRODUCTION builds go live (live
 *           publishable key in the browser, STRIPE_LIVE_API_KEY plus
 *           PAYMENTS_LIVE_WEBHOOK_SECRET on the server). Preview/dev builds
 *           STAY IN TEST MODE regardless — see isTestMode() below.
 *
 * Nothing else changes with the flag: idempotency (stripe_events), receipts
 * and wallet paths are mode-agnostic and keyed on Stripe object ids.
 */
export const STRIPE_FORCE_TEST_MODE = false;

/**
 * True only for the production build (the published app). Vite sets PROD on
 * `bun run build`; preview/dev servers run in development mode. Evaluated
 * identically in the browser bundle and in the SSR/worker bundle.
 */
export const IS_PRODUCTION_BUILD: boolean = import.meta.env.PROD === true;

/**
 * The one answer everything derives from: are we in Stripe TEST mode?
 * Test when the master switch is on, and always test outside production —
 * preview can never touch the live account, even after go-live.
 */
export function isTestMode(): boolean {
  return STRIPE_FORCE_TEST_MODE || !IS_PRODUCTION_BUILD;
}

/** Stripe environment name derived from the same single switch. */
export function resolvedStripeEnv(): "sandbox" | "live" {
  return isTestMode() ? "sandbox" : "live";
}
