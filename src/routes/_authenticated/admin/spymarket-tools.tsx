/**
 * /admin/spymarket-tools — internal Trendtrack research tool (admin-only).
 * Separate from /admin/spymarket (the public waitlist admin). The client
 * facing /spymarket page is untouched.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SpyMarketTools } from "@/components/spymarket-tools";

export const Route = createFileRoute("/_authenticated/admin/spymarket-tools")({
  validateSearch: (search) => ({
    tab: typeof search["tab"] === "string" ? search["tab"] : "lookup",
    shopId: typeof search["shopId"] === "string" ? search["shopId"] : undefined,
    domain: typeof search["domain"] === "string" ? search["domain"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "SpyMarket research — FlySales admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminSpyMarketToolsPage,
});

function AdminSpyMarketToolsPage() {
  const { tab, shopId, domain } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <div className="p-6">
      <SpyMarketTools
        tab={tab}
        shopId={shopId}
        domain={domain}
        go={(patch) =>
          void navigate({
            search: (prev) => ({
              tab: patch.tab ?? prev.tab,
              shopId: patch.shopId,
              domain: patch.domain,
            }),
            replace: true,
          })
        }
      />
    </div>
  );
}
