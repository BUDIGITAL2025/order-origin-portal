import { createServerFn } from "@tanstack/react-start";

/**
 * Outbound onboarding URLs for the client sidebar "Get started" section.
 * Public, non-sensitive configuration read from backend env so the links can
 * change (or be launched later) without a code deploy:
 *   SHOPIFY_APP_URL       — FlySales app listing on the Shopify App Store
 *   SHOPIFY_AFFILIATE_URL — partner link to create a new Shopify store
 * Either may be unset; the UI degrades to disabled/hidden states.
 */
export const getOnboardingLinks = createServerFn({ method: "GET" }).handler(async () => ({
  shopifyAppUrl: process.env["SHOPIFY_APP_URL"]?.trim() || null,
  shopifyAffiliateUrl: process.env["SHOPIFY_AFFILIATE_URL"]?.trim() || null,
}));
