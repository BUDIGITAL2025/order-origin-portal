import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Eye, Search, Store, Telescope, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  getMySpyMarketInterest,
  registerSpyMarketInterest,
} from "@/lib/spymarket.functions";

export const Route = createFileRoute("/_authenticated/_client/spymarket")({
  head: () => ({
    meta: [
      { title: "SpyMarket — FlySales" },
      {
        name: "description",
        content:
          "SpyMarket by FlySales: see competitor products, the ads and stores behind every dropshipping product, and the best-performing creatives. Join the waitlist.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SpyMarketPage,
});

type PlanId = "starter" | "plus" | "max";

const PLANS: Array<{
  id: PlanId;
  name: string;
  credits: string;
  price: string;
}> = [
  { id: "starter", name: "Starter", credits: "50,000 credits/month", price: "$99/month" },
  { id: "plus", name: "Plus", credits: "125,000 credits/month", price: "$189/month" },
  { id: "max", name: "Max", credits: "350,000 credits/month", price: "$349/month" },
];

const BENEFITS = [
  {
    icon: Search,
    text: "See competitor products for any niche",
  },
  {
    icon: Eye,
    text: "Browse the ads and stores behind every dropshipping product",
  },
  {
    icon: TrendingUp,
    text: "Analyse the best-performing ads, stores and product pages",
  },
];

function SpyMarketPage() {
  const queryClient = useQueryClient();
  const fetchInterest = useServerFn(getMySpyMarketInterest);
  const register = useServerFn(registerSpyMarketInterest);

  const { data: interest, isPending } = useQuery({
    queryKey: ["spymarket-interest"],
    queryFn: fetchInterest,
  });

  const mutation = useMutation({
    mutationFn: (plan: PlanId) => register({ data: { plan } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["spymarket-interest"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Could not join the waitlist");
    },
  });

  const picked = (interest?.plan_interest ?? null) as PlanId | null;
  const pickedPlan = PLANS.find((p) => p.id === picked) ?? null;

  return (
    <div className="space-y-8">
      {/* Own header treatment: dark charcoal hero with the lime accent. */}
      <section className="overflow-hidden rounded-2xl bg-sidebar text-sidebar-foreground">
        <div className="px-8 py-10 sm:px-12">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15">
              <Telescope className="h-4.5 w-4.5 text-primary" />
            </span>
            <Badge className="bg-primary text-primary-foreground hover:bg-primary">
              New
            </Badge>
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight">
            SpyMarket
          </h1>
          <p className="mt-2 max-w-xl text-sm text-sidebar-foreground/70">
            Competitor intelligence for dropshipping, built by FlySales.
          </p>
          <ul className="mt-6 space-y-3">
            {BENEFITS.map((b) => (
              <li key={b.text} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15">
                  <b.icon className="h-3.5 w-3.5 text-primary" />
                </span>
                <span className="text-sidebar-foreground/90">{b.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Confirmed state */}
      {pickedPlan && (
        <div className="flex items-start gap-3 rounded-2xl border border-primary/40 bg-primary/10 px-5 py-4">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-3.5 w-3.5" />
          </span>
          <div>
            <p className="text-sm font-medium">
              You're on the list — we'll email you at launch.
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              You picked <span className="font-medium text-foreground">{pickedPlan.name}</span>.
              Pick another plan below to change it.
            </p>
          </div>
        </div>
      )}

      {/* Plans — displayed, not purchasable. */}
      <section>
        <h2 className="text-lg font-semibold tracking-tight">Plans</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          SpyMarket is not available yet. Join the waitlist and we'll email you
          at launch.
        </p>
        {isPending ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {PLANS.map((p) => (
              <Skeleton key={p.id} className="h-56 rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {PLANS.map((plan) => {
              const isPicked = picked === plan.id;
              return (
                <div
                  key={plan.id}
                  className={cn(
                    "flex flex-col rounded-2xl border bg-card p-6",
                    isPicked ? "border-primary" : "border-border",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold">{plan.name}</h3>
                    {isPicked && (
                      <Badge className="bg-primary text-primary-foreground hover:bg-primary">
                        Your pick
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{plan.credits}</p>
                  <p className="mt-4 text-2xl font-semibold tracking-tight">{plan.price}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    +10,000 credits included with your base plan
                  </p>
                  <Button
                    className="mt-6 w-full"
                    variant={isPicked ? "outline" : "default"}
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate(plan.id)}
                  >
                    {isPicked
                      ? "You're on the list"
                      : picked
                        ? "Switch to this plan"
                        : "Join the waitlist"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Store className="h-3.5 w-3.5" />
        SpyMarket subscriptions will be separate from your FlySales workspace
        plan. Joining the waitlist is free and does not charge you.
      </p>
    </div>
  );
}
