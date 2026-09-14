/**
 * Notification kind → sidebar destination.
 *
 * One shared table so the sidebar bell logic stays generic: every kind that
 * is ever inserted into `notifications` declares which nav item should light
 * up for the admin console and/or the client portal. Anything not listed here
 * simply never shows a bell.
 *
 * Scoping convention (mirrors the RLS policies on `notifications`):
 *  - ADMIN notifications carry NO store_id and NO entity_id — only staff read them.
 *  - CLIENT notifications carry store_id and/or entity_id.
 */
export type NavAudience = "admin" | "client";

export interface NavTargets {
  /** Admin sidebar path, when staff should see this kind. */
  admin?: string;
  /** Client sidebar path, when the workspace owner should see this kind. */
  client?: string;
}

export const NOTIFICATION_NAV_MAP: Record<string, NavTargets> = {
  // ----- Quotes / sourcing -----
  quote_sla_breach: { admin: "/admin/quotes" },
  quote_request_submitted: { admin: "/admin/quotes" },
  quote_answered: { client: "/sourcing" },

  // ----- Disputes / claims (client claims live under Fulfilment) -----
  dispute_opened: { admin: "/admin/disputes" },
  dispute_resolved: { client: "/fulfilment" },

  // ----- Orders & fulfilment -----
  order_needs_review: { admin: "/admin/orders" },
  order_shipped: { client: "/fulfilment" },
  order_reminder_24: { client: "/fulfilment" },
  order_reminder_48: { client: "/fulfilment" },
  order_reminder_72: { client: "/fulfilment" },
  order_auto_cancelled: { client: "/fulfilment" },

  // ----- Inventory -----
  inventory_reorder: { client: "/fulfilment", admin: "/admin/orders" },

  // ----- Money -----
  order_batch_settled: { client: "/billing" },
  subscription_payment_failed: { client: "/billing", admin: "/admin/wallet" },
  auto_topup_failed: { client: "/billing" },
  wallet_topup: { client: "/billing" },
  payment_failed: { client: "/billing", admin: "/admin/wallet" },
};

/** Every kind that should light up `to` for this audience. */
export function kindsForNav(audience: NavAudience, to: string): string[] {
  return Object.entries(NOTIFICATION_NAV_MAP)
    .filter(([, targets]) => targets[audience] === to)
    .map(([kind]) => kind);
}

/** Nav paths that have at least one unread kind in `unreadKinds`. */
export function navPathsWithAlerts(audience: NavAudience, unreadKinds: string[]): string[] {
  const set = new Set(unreadKinds);
  const paths = new Set<string>();
  for (const [kind, targets] of Object.entries(NOTIFICATION_NAV_MAP)) {
    const to = targets[audience];
    if (to && set.has(kind)) paths.add(to);
  }
  return [...paths];
}

/** Every nav path referenced by the map for this audience. */
export function navPathsForAudience(audience: NavAudience): string[] {
  const paths = new Set<string>();
  for (const targets of Object.values(NOTIFICATION_NAV_MAP)) {
    if (targets[audience]) paths.add(targets[audience]!);
  }
  return [...paths];
}
