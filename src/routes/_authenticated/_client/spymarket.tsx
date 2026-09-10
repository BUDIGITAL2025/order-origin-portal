import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Eye, Loader2, Search, Store, Telescope, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getStripeEnvironment } from "@/lib/stripe";
import { createSpyMarketCheckout, getMySpyMarketSubscription } from "@/lib/spymarket.functions";

export const Route = createFileRoute("/_authenticated/_client/spymarket")({
  head: () => ({
    meta: [
      { title: "SpyMarket — FlySales" },
      {
        name: "description",
        content:
          "SpyMarket by FlySales: see competitor products, the ads and stores behind every dropshipping product, and the best-performing creatives. Subscribe from $99/month.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SpyMarketPage,
});

/**
 * SpyMarket is a single module at $49/month, in line with SEO ($49) and
 * Ads ($39). The old $99/$189/$349 tiers came from the previous data
 * provider and are retired.
 */
const MODULE = {
  name: "SpyMarket",
  price: "$49/month",
  blurb: "Full access to competitor, ad and store research.",
};

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
  const environment = getStripeEnvironment();
  const fetchSubscription = useServerFn(getMySpyMarketSubscription);
  const checkout = useServerFn(createSpyMarketCheckout);

  const { data: subscription, isPending } = useQuery({
    queryKey: ["spymarket-subscription", environment],
    queryFn: () => fetchSubscription({ data: { environment } }),
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const result = await checkout({
        data: { returnUrl: `${window.location.origin}/spymarket`, environment },
      });
      if ("error" in result) throw new Error(result.error);
      return result;
    },
    onSuccess: (result) => {
      window.location.href = result.url;
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Could not start checkout");
    },
  });

  const isSubscribed = Boolean(
    subscription && (subscription.status === "active" || subscription.status === "past_due"),
  );

  return (
    <div className="space-y-8">
      {/* Own header treatment: dark charcoal hero with the lime accent. */}
      <section className="overflow-hidden rounded-2xl bg-sidebar text-sidebar-foreground">
        <div className="px-8 py-10 sm:px-12">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15">
              <Telescope className="h-4.5 w-4.5 text-primary" />
            </span>
            <Badge className="bg-primary text-primary-foreground hover:bg-primary">New</Badge>
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight">SpyMarket</h1>
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

      {/* Subscribed state */}
      {isSubscribed && (
        <div className="flex items-start gap-3 rounded-2xl border border-primary/40 bg-primary/10 px-5 py-4">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-3.5 w-3.5" />
          </span>
          <div>
            <p className="text-sm font-medium">
              {MODULE.name} is active
              {subscription?.status === "past_due" ? ", payment failed" : ""}.
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {subscription?.status === "past_due"
                ? "Update your payment method to keep your plan. Contact support and we sort it out."
                : subscription?.cancel_at_period_end
                  ? `Cancels on ${subscription.current_period_end ?? "the end of the period"}.`
                  : `Your access is switched on at launch. ${
                      subscription?.current_period_end
                        ? `Next billing date ${subscription.current_period_end}.`
                        : ""
                    }`}
            </p>
          </div>
        </div>
      )}

      {/* Single module subscription — real checkout. */}
      <section>
        <h2 className="text-lg font-semibold tracking-tight">Subscription</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {isSubscribed
            ? "To cancel your SpyMarket subscription, contact support."
            : "Subscribe now to lock your price. Billing starts today; the research tool switches on for subscribers at launch."}
        </p>
        {isPending ? (
          <Skeleton className="mt-4 h-56 rounded-2xl sm:max-w-sm" />
        ) : (
          <div
            className={cn(
              "mt-4 flex flex-col rounded-2xl border bg-card p-6 sm:max-w-sm",
              isSubscribed ? "border-primary" : "border-border",
            )}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">{MODULE.name}</h3>
              {isSubscribed && (
                <Badge className="bg-primary text-primary-foreground hover:bg-primary">
                  Your plan
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{MODULE.blurb}</p>
            <p className="mt-4 text-2xl font-semibold tracking-tight">{MODULE.price}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              One module, one price — no credit tiers.
            </p>
            <Button
              className="mt-6 w-full"
              variant={isSubscribed ? "outline" : "default"}
              disabled={isSubscribed || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isSubscribed ? "Current plan" : `Subscribe — ${MODULE.price}`}
            </Button>
          </div>
        )}
      </section>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Store className="h-3.5 w-3.5" />
        SpyMarket is billed separately from your FlySales workspace plan, on its own monthly
        subscription. Cancel any time by contacting support.
      </p>
    </div>
  );
}
