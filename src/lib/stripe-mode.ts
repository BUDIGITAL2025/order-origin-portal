/**
 * SINGLE MASTER SWITCH for Stripe test vs. live mode.
 *
 * This module is browser-safe on purpose: both the client bundle (banner,
 * environment derivation in src/lib/stripe.ts) and the server utility
 * (src/lib/stripe.server.ts) import the same constant, so there is exactly
 * one place to flip.
 *
 *   true  → every Stripe call (checkout, subscriptions, wallet top-ups,
 *           SetupIntents) is routed to the TEST/sandbox account, live
 *           webhooks are acknowledged and ignored, the orange test banner
 *           shows. This is today's behaviour.
 *   false → the environment's own credentials decide: production builds ship
 *           the pk_live_ client token and the server uses STRIPE_LIVE_API_KEY
 *           plus PAYMENTS_LIVE_WEBHOOK_SECRET; preview keeps pk_test_ and the
 *           sandbox keys, so test mode stays fully functional in parallel.
 *
 * Nothing else changes with the flag: idempotency (stripe_events), receipts
 * and wallet paths are mode-agnostic and keyed on Stripe object ids.
 */
export const STRIPE_FORCE_TEST_MODE = true;
