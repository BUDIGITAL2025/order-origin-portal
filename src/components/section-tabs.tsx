import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export type SectionTab = { to: string; label: string };

/**
 * Pill tabs shown under a page header, matching the SpyMarket tools pattern.
 * Each tab is a real route, so every tab keeps its own shareable URL.
 */
export function SectionTabs({ tabs }: { tabs: SectionTab[] }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="mb-5 flex flex-wrap items-center gap-1.5 border-b border-border pb-3">
      {tabs.map((tab) => {
        const active = pathname === tab.to || pathname.startsWith(tab.to + "/");
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

export const SOURCING_TABS: SectionTab[] = [
  { to: "/sourcing/new", label: "New request" },
  { to: "/sourcing/quotes", label: "My quotes" },
];

export const FULFILMENT_TABS: SectionTab[] = [
  { to: "/fulfilment/orders", label: "Orders" },
  { to: "/fulfilment/inventory", label: "Inventory" },
  { to: "/fulfilment/inbound", label: "Inbound" },
  { to: "/fulfilment/stock-purchases", label: "Stock purchases" },
  { to: "/fulfilment/claims", label: "Claims" },
];

export const BILLING_TABS: SectionTab[] = [
  { to: "/billing/wallet", label: "Wallet" },
  { to: "/billing/subscription", label: "Subscription" },
  { to: "/billing/receipts", label: "Receipts" },
];

export const ADMIN_FULFILMENT_TABS: SectionTab[] = [
  { to: "/admin/orders", label: "Orders" },
  { to: "/admin/inventory", label: "Inventory" },
  { to: "/admin/inbound", label: "Inbound" },
];

export const ADMIN_BILLING_TABS: SectionTab[] = [
  { to: "/admin/wallet", label: "Wallet adjustments" },
  { to: "/admin/documents", label: "Receipts" },
];

export const DESK_TABS: SectionTab[] = [
  { to: "/desk/queue", label: "Queue" },
  { to: "/desk/earnings", label: "Earnings" },
];

export const ADMIN_SOURCING_TABS: SectionTab[] = [
  { to: "/admin/quotes", label: "Quote queue" },
  { to: "/admin/sourcing", label: "Collaborators" },
  { to: "/admin/stock-purchases", label: "Stock purchases" },
];
