/**
 * Environment-driven URLs. Domains are never hardcoded:
 * - Production sets VITE_APP_BASE_URL (https://app.flysales.app) and
 *   VITE_MARKETING_URL (https://flysales.io).
 * - In preview/dev they fall back to the current origin so auth emails and
 *   redirects keep working wherever the app is served.
 *
 * MIDDLEWARE_URL / MIDDLEWARE_SERVICE_USER / MIDDLEWARE_SERVICE_PASSWORD /
 * MIDDLEWARE_SERVICE_USER_ID are server-only secrets, read with process.env
 * inside server function handlers — never import them here.
 */

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Base URL of this portal. Used for auth email confirmation / reset links. */
export const APP_BASE_URL: string = stripTrailingSlash(
  (import.meta.env.VITE_APP_BASE_URL as string | undefined) ||
    (typeof window !== "undefined" ? window.location.origin : ""),
);

/** Public marketing site. The header logo links here. */
export const MARKETING_URL: string = stripTrailingSlash(
  (import.meta.env.VITE_MARKETING_URL as string | undefined) || APP_BASE_URL || "/",
);
