import { createFileRoute, redirect } from "@tanstack/react-router";

/** Legacy path — kept so old bookmarks and checkout returns keep working. */
export const Route = createFileRoute("/_authenticated/_client/billing/")({
  // Forward the query string: Stripe returns land here with ?sub=… / ?topup=…
  // and the tab needs them to show the "payment received" confirmation.
  validateSearch: (search: Record<string, unknown>): { sub?: string; topup?: string } => ({
    ...(typeof search["sub"] === "string" ? { sub: search["sub"] } : {}),
    ...(typeof search["topup"] === "string" ? { topup: search["topup"] } : {}),
  }),
  beforeLoad: ({ search }) => {
    if (search.topup) throw redirect({ to: "/billing/wallet", search: { topup: search.topup } });
    throw redirect({
      to: "/billing/subscription",
      search: search.sub ? { sub: search.sub } : {},
    });
  },
});
