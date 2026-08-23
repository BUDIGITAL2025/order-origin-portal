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
 *
 * SSR note: module-level constants must be identical on server and client
 * (they are rendered into anchor hrefs). Anything origin-dependent must be
 * resolved at call time via getAppBaseUrl() inside event handlers.
 */

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Base URL of this portal from env ("" when unset — resolved at call time). */
export const APP_BASE_URL: string = stripTrailingSlash(
  (import.meta.env["VITE_APP_BASE_URL"] as string | undefined) || "",
);

/**
 * Absolute base URL of this portal, resolved where it is called.
 * Use inside client event handlers (auth redirects, email links) — never at
 * module scope or in render, to keep SSR and client markup identical.
 */
export function getAppBaseUrl(): string {
  if (APP_BASE_URL) return APP_BASE_URL;
  if (typeof window !== "undefined") return stripTrailingSlash(window.location.origin);
  return "";
}

/**
 * Public marketing site. The header logo links here.
 * Note: stripTrailingSlash("/") is "" — an empty href resolves to the current
 * page and (worse) differs between the SSR string and the client-resolved
 * URL, which is what tripped the auth-page logo hydration warning. Resolve
 * empties to "/" instead so SSR and client markup are always identical.
 */
export const MARKETING_URL: string =
  stripTrailingSlash((import.meta.env["VITE_MARKETING_URL"] as string | undefined) || "") ||
  APP_BASE_URL ||
  "/";
