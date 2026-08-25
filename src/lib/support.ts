/**
 * Support contact — one address for everything that is not a claim.
 * Claims stay in the structured in-portal flow; support@ handles the rest.
 *
 * Sending stays on noreply@ (EMAIL_FROM_ADDRESS); this is the contact address.
 */
export const SUPPORT_EMAIL =
  (import.meta.env["VITE_SUPPORT_EMAIL"] as string | undefined)?.trim() || "support@flysales.app";

/** Appended to error copy that asks the user to try again. */
export const STILL_STUCK = `Still stuck? ${SUPPORT_EMAIL}`;

/** mailto link with a prefilled subject that names the workspace when known. */
export function supportMailto(workspaceName?: string | null): string {
  const subject = workspaceName?.trim()
    ? `FlySales support — ${workspaceName.trim()}`
    : "FlySales support";
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
