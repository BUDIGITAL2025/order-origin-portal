/**
 * Maps raw backend error strings to friendly client-facing messages.
 *
 * Database functions raise coded errors like
 *   "SUBSCRIPTION_REQUIRED: an active subscription is needed to request quotes"
 * and PostgREST surfaces that string verbatim. Toasts that print err.message
 * would otherwise leak the SCREAMING_CODE prefix (or a bare code) to clients.
 *
 * Rules:
 *  - "CODE: human text"  → keep the human text, drop the code.
 *  - A bare known code   → mapped friendly text.
 *  - Anything else       → returned unchanged.
 */

const BARE_CODE_MESSAGES: Record<string, string> = {
  STORE_NOT_FOUND: "Workspace not found — refresh the page and try again.",
  ENTITY_NOT_FOUND: "Account not fully set up — contact support.",
  QUOTE_NOT_FOUND: "Quote not found.",
  ORDER_NOT_FOUND: "Order not found.",
  DISPUTE_NOT_FOUND: "Dispute not found.",
  BUNDLE_NOT_FOUND: "Bundle not found.",
  LINE_NOT_FOUND: "Quote line not found.",
  PRODUCT_NOT_FOUND: "Product not found.",
  UNAUTHENTICATED: "Please sign in again.",
  AUTH_REQUIRED: "Please sign in again.",
  FORBIDDEN: "You don't have permission to do that.",
  NOT_AUTHORISED: "You don't have permission to do that.",
  NO_DECISIONS: "Choose an option for at least one line first.",
  IMPORT_REQUIRES_ROWS: "The file has no rows to import.",
  ORDER_REQUIRES_ITEMS: "The order needs at least one item.",
  DESTINATION_COUNTRY_REQUIRED: "Choose a destination country.",
  NAME_REQUIRED: "A name is required.",
  MESSAGE_REQUIRED: "Write a message first.",
  EVIDENCE_REQUIRED: "Attach at least one photo as evidence.",
};

const CODE_PREFIX_RE = /^([A-Z][A-Z0-9_]{2,}):\s*/;
const BARE_CODE_RE = /^[A-Z][A-Z0-9_]{2,}$/;

export function friendlyError(err: unknown, fallback = "Something went wrong"): string {
  const raw = err instanceof Error ? err.message : "";
  const message = raw.trim();
  if (!message) return fallback;

  const prefixed = CODE_PREFIX_RE.exec(message);
  if (prefixed) {
    const rest = message.slice(prefixed[0].length).trim();
    if (rest) return rest.charAt(0).toUpperCase() + rest.slice(1);
  }

  if (BARE_CODE_RE.test(message)) {
    return BARE_CODE_MESSAGES[message] ?? fallback;
  }

  return message;
}
