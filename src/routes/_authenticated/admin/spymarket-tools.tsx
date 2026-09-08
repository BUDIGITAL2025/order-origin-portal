/**
 * /admin/spymarket-tools — internal WinningHunter research tool (admin-only).
 * Separate from /admin/spymarket (the public waitlist admin). The client
 * facing /spymarket page is untouched.
 *
 * URL state: the active tab plus each tab's search context serialize into the
 * query string so a view survives refresh and can be shared with the team.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SpyMarketTools } from "@/components/spymarket-tools";

const str = (search: Record<string, unknown>, key: string): string | undefined => {
  const v = search[key];
  // Numeric-looking params arrive parsed as numbers.
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" && v !== "" ? v : undefined;
};

export const Route = createFileRoute("/_authenticated/admin/spymarket-tools")({
  validateSearch: (search) => ({
    tab: str(search, "tab") ?? "stores",
    // Ad library
    whp: str(search, "whp"),
    whq: str(search, "whq"),
    // Store explorer + brands
    wsq: str(search, "wsq"),
    wsc: str(search, "wsc"),
    wbid: str(search, "wbid"),
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
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <div className="p-6">
      <SpyMarketTools
        tab={search.tab}
        search={search}
        /**
         * Filter tweaks replace the current entry (no history spam); tab
         * changes push, so the back button walks between searches naturally.
         */
        go={(patch, opts) =>
          void navigate({
            search: (prev) => ({ ...prev, ...patch }),
            replace: opts?.push ? false : true,
          })
        }
      />
    </div>
  );
}
