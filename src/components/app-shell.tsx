import * as React from "react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  ClipboardList,
  CreditCard,
  Download,
  ExternalLink,
  FilePlus2,
  FileText,
  LayoutDashboard,
  LogOut,
  Package,
  ShoppingCart,
  Store,
  Users,
  Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { MARKETING_URL } from "@/lib/config";
import { getOnboardingLinks } from "@/lib/onboarding.functions";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const CLIENT_NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/quotes/new", label: "Request a quote", icon: FilePlus2 },
  { to: "/quotes", label: "My quotes", icon: ClipboardList },
  { to: "/products", label: "My products", icon: Package },
  { to: "/orders", label: "Orders", icon: ShoppingCart },
  { to: "/wallet", label: "Wallet", icon: Wallet },
  { to: "/billing", label: "Billing", icon: CreditCard },
  { to: "/documents", label: "Receipts", icon: FileText },
];

/**
 * Persistent portal banner while a subscription is past_due. Nothing is
 * blocked at this stage — Stripe retries for days — but the client should
 * always see the ask to update their card.
 */
function PastDueBanner() {
  const { data: status } = useQuery({
    queryKey: ["my-subscription-status"],
    staleTime: 60_000,
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("subscription_status")
        .eq("id", user.id)
        .maybeSingle();
      return data?.subscription_status ?? null;
    },
  });
  if (status !== "past_due") return null;
  return (
    <div className="w-full border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
      Your last subscription payment failed — Stripe retries automatically.{" "}
      <Link to="/billing" className="font-medium underline">
        Update your card
      </Link>{" "}
      to keep your plan.
    </div>
  );
}

const ADMIN_NAV: NavItem[] = [
  { to: "/admin/quotes", label: "Quote queue", icon: ClipboardList },
  { to: "/admin/products", label: "Products", icon: Package },
  { to: "/admin/clients", label: "Clients", icon: Users },
  { to: "/admin/wallet", label: "Wallet adjustments", icon: Wallet },
  { to: "/admin/documents", label: "Receipts", icon: FileText },
];

interface OnboardingProfile {
  platform: string;
  store_url: string;
  integration_mode: string;
}

/**
 * Sidebar onboarding nudges — deliberately styled apart from the main nav.
 * Shown only while the client still has a setup step left:
 *  - "Create a Shopify store" while they have no Shopify store URL on file.
 *  - "Install our Shopify app" to Shopify clients not yet on automatic mode.
 * Hidden entirely once platform is Shopify with a store and automatic sync.
 */
function GetStartedSection({ profile }: { profile: OnboardingProfile }) {
  const fetchLinks = useServerFn(getOnboardingLinks);
  const { data: links } = useQuery({
    queryKey: ["onboarding-links"],
    staleTime: 300_000,
    queryFn: fetchLinks,
  });

  const isShopify = profile.platform === "shopify";
  const hasStore = profile.store_url.trim().length > 0;
  const isAutomatic = profile.integration_mode === "automatic";

  const showCreateStore = !isShopify || !hasStore;
  const showInstallApp = isShopify && !isAutomatic;

  // Fully set up — no onboarding left to nudge.
  if (!showCreateStore && !showInstallApp) return null;

  const appUrl = links?.shopifyAppUrl ?? null;
  const affiliateUrl = links?.shopifyAffiliateUrl ?? null;

  return (
    <div className="mx-3 mb-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-primary">
        Get started
      </p>
      <div className="space-y-1">
        {showInstallApp &&
          (appUrl ? (
            <a
              href={appUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <Download className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">Install our Shopify app</span>
              <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
            </a>
          ) : (
            <div className="flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground/60">
              <Download className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">Install our Shopify app</span>
              <Badge variant="outline" className="px-1.5 py-0 text-[9px] font-normal">
                Coming soon
              </Badge>
            </div>
          ))}
        {showCreateStore && affiliateUrl && (
          <div>
            <a
              href={affiliateUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <Store className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">Create a Shopify store</span>
              <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
            </a>
            <p className="px-2 pb-1 text-[10px] leading-snug text-muted-foreground/70">
              FlySales may earn a commission from this link.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function AppShell({
  role,
  email,
  companyName,
  onboardingProfile,
  children,
}: {
  role: "client" | "admin";
  email: string | null;
  companyName: string | null;
  onboardingProfile?: OnboardingProfile | null;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const nav = role === "admin" ? ADMIN_NAV : CLIENT_NAV;

  const handleSignOut = async () => {
    // Sign-out hygiene: tear down queries first so none refetch against a
    // cleared session, then sign out and land on the auth page.
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    await router.invalidate();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-5">
          <a href={MARKETING_URL} className="flex items-center gap-2">
            <Boxes className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold tracking-tight">FlySales</span>
          </a>
          <span className="ml-auto rounded border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {role === "admin" ? "Admin" : "Client"}
          </span>
        </div>
        <nav className="flex-1 space-y-0.5 p-3">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/dashboard" || item.to === "/admin/quotes" }}
              activeProps={{
                className:
                  "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
              }}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <Separator />
        <div className="p-3">
          <div className="truncate px-3 pb-1 text-xs text-muted-foreground">
            {companyName && <div className="truncate font-medium text-foreground">{companyName}</div>}
            {email}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2.5 text-muted-foreground"
            onClick={() => void handleSignOut()}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <PaymentTestModeBanner />
        {role === "client" && <PastDueBanner />}
        <div className="mx-auto max-w-6xl px-6 py-6">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
