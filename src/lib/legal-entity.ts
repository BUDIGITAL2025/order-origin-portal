/**
 * Single source of truth for the supplier's legal entity name, shared by the
 * Terms page (client-rendered) and payment documents (server-side receipts)
 * so the two can never drift apart.
 *
 * Override via environment:
 * - Client bundle: VITE_SUPPLIER_LEGAL_NAME
 * - Server runtime (receipts): SUPPLIER_LEGAL_NAME
 * When changing the entity name, set BOTH; when unset, both sides fall back
 * to LEGAL_ENTITY_NAME_FALLBACK below.
 */
export const LEGAL_ENTITY_NAME_FALLBACK = "BUDIGITAL SCALE MANAGEMENT - FZCO";

export const LEGAL_ENTITY_NAME: string =
  ((import.meta.env["VITE_SUPPLIER_LEGAL_NAME"] as string | undefined) ?? "").trim() ||
  LEGAL_ENTITY_NAME_FALLBACK;
