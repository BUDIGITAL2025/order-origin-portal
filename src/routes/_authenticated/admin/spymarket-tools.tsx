/**
 * /admin/spymarket-tools — internal Trendtrack research tool (admin-only).
 * Separate from /admin/spymarket (the public waitlist admin). The client
 * facing /spymarket page is untouched.
 *
 * URL state: active filters + sort serialize into the query string so a
 * filtered view survives refresh and can be shared between team members.
 * Short keys keep URLs readable: sq/st (shops search), vmin/vmax, amin/amax/
 * awin, pmin/pmax, plus, cat, cinc/cexc (country include/exclude csv), lang,
 * tp, ssort — and aq/atyp/astat/amed/asort for the ads tab.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SpyMarketTools } from "@/components/spymarket-tools";

const str = (search: Record<string, unknown>, key: string): string | undefined => {
  const v = search[key];
  return typeof v === "string" && v !== "" ? v : undefined;
};

export const Route = createFileRoute("/_authenticated/admin/spymarket-tools")({
  validateSearch: (search) => ({
    tab: str(search, "tab") ?? "lookup",
    shopId: str(search, "shopId"),
    domain: str(search, "domain"),
    // Shop explorer filters
    sq: str(search, "sq"),
    st: str(search, "st"),
    vmin: str(search, "vmin"),
    vmax: str(search, "vmax"),
    amin: str(search, "amin"),
    amax: str(search, "amax"),
    awin: str(search, "awin"),
    pmin: str(search, "pmin"),
    pmax: str(search, "pmax"),
    plus: str(search, "plus"),
    cat: str(search, "cat"),
    cinc: str(search, "cinc"),
    cexc: str(search, "cexc"),
    lang: str(search, "lang"),
    tp: str(search, "tp"),
    ssort: str(search, "ssort"),
    dtc: str(search, "dtc"),
    // Ad library filters
    aq: str(search, "aq"),
    atyp: str(search, "atyp"),
    astat: str(search, "astat"),
    amed: str(search, "amed"),
    asort: str(search, "asort"),
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
        shopId={search.shopId}
        domain={search.domain}
        search={search}
        go={(patch) =>
          void navigate({
            search: (prev) => ({ ...prev, ...patch }),
            replace: true,
          })
        }
      />
    </div>
  );
}
