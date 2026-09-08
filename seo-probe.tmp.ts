import { dataforseoCall, TTL, getUserDaySpend } from "@/lib/seo.server";
const userId = process.argv[2]!;
const endpoint = "serp/google/organic/live/advanced";
const res = await dataforseoCall({
  userId, endpoint, path: `/v3/${endpoint}`,
  task: { keyword: "mesa de apoio", location_code: 2620, language_code: "pt", device: "desktop", depth: 20 },
  summary: { keyword: "mesa de apoio", location: 2620, device: "desktop" },
  ttlMs: TTL.serp, estimatedCost: 0.0025, confirmOverage: true,
});
if (res.status === "ok") {
  const first = (res.data as any)[0];
  console.log("cost", res.cost, "cacheHit", res.cacheHit, "features", first.item_types?.slice(0,6), "top3", first.items.filter((i:any)=>i.type==="organic").slice(0,3).map((i:any)=>`${i.rank_group} ${i.domain}`));
} else console.log(res);
// repeat -> cache
const again = await dataforseoCall({
  userId, endpoint, path: `/v3/${endpoint}`,
  task: { keyword: "mesa de apoio", location_code: 2620, language_code: "pt", device: "desktop", depth: 20 },
  ttlMs: TTL.serp, estimatedCost: 0.0025, confirmOverage: true,
});
console.log("repeat:", again.status === "ok" ? { cost: again.cost, cacheHit: again.cacheHit } : again);
console.log("day spend", await getUserDaySpend(userId));
