import * as React from "react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  Building2,
  ChevronDown,
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
import { formatUSD } from "@/lib/format";
import { getOnboardingLinks } from "@/lib/onboarding.functions";
import { getMyWallet } from "@/lib/wallet.functions";
import { cn } from "@/lib/utils";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { ThemeToggle } from "@/components/theme-toggle";
import { StoreSwitcher, getCurrentStoreId } from "@/components/store-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
      // Subscriptions live on stores — RLS scopes this to the caller's own
      // stores, so any past_due store surfaces the banner.
      const { data } = await supabase
        .from("stores")
        .select("id")
        .eq("subscription_status", "past_due")
        .limit(1);
      return (data ?? []).length > 0 ? "past_due" : null;
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
  { to: "/admin/entities", label: "Entities & stores", icon: Building2 },
  { to: "/admin/wallet", label: "Wallet adjustments", icon: Wallet },
  { to: "/admin/documents", label: "Receipts", icon: FileText },
];

interface OnboardingStore {
  platform: string;
  store_url: string;
  integration_mode: string;
}

/**
 * Resources block — quiet links below the main nav, separated by a divider.
 * Shown only while the client still has a setup step left:
 *  - "Create a Shopify store" while they have no Shopify store URL on file.
 *  - "Install our Shopify app" to Shopify clients not yet on automatic mode.
 * Hidden entirely once platform is Shopify with a store and automatic sync.
 */
function ResourcesSection({ store }: { store: OnboardingStore }) {
  const fetchLinks = useServerFn(getOnboardingLinks);
  const { data: links } = useQuery({
    queryKey: ["onboarding-links"],
    staleTime: 300_000,
    queryFn: fetchLinks,
  });

  const isShopify = store.platform === "shopify";
  const hasStore = store.store_url.trim().length > 0;
  const isAutomatic = store.integration_mode === "automatic";

  const showCreateStore = !isShopify || !hasStore;
  const showInstallApp = isShopify && !isAutomatic;

  // Fully set up — no resources left to surface.
  if (!showCreateStore && !showInstallApp) return null;

  const appUrl = links?.shopifyAppUrl ?? null;
  const affiliateUrl = links?.shopifyAffiliateUrl ?? null;

  return (
    <div className="border-t border-sidebar-border px-3 py-3">
      <p className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
        Resources
      </p>
      <div className="space-y-0.5">
        {showInstallApp &&
          (appUrl ? (
            <a
              href={appUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <Download className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">Install our Shopify app</span>
              <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
            </a>
          ) : (
            <div className="flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-xs text-sidebar-foreground/50">
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
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <Store className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">Create a Shopify store</span>
              <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
            </a>
            <p className="px-2 pb-1 text-[10px] leading-snug text-sidebar-foreground/50">
              FlySales may earn a commission from this link.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Balance below this stalls orders and triggers the warning treatment. */
const LOW_BALANCE_USD = 50;

/**
 * Wallet balance in the top bar, always visible, with the entity named
 * beside it — the balance belongs to the entity and gates every order
 * across all its stores. Low balances render in warning color with an
 * inline top-up action.
 */
function WalletChip() {
  const { data: ctx } = useMyContext();
  const fetchWallet = useServerFn(getMyWallet);
  const { data: wallet } = useQuery({
    queryKey: ["my-wallet"],
    staleTime: 30_000,
    queryFn: fetchWallet,
  });

  // localStorage is unreadable during SSR — render after hydration only.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const entities = ctx?.entities ?? [];
  const storeId = getCurrentStoreId();
  const entity =
    entities.find((e) => e.stores.some((s) => s.id === storeId)) ?? entities[0] ?? null;
  if (!entity) return null;

  const balance = wallet?.balance ?? 0;
  const low = balance < LOW_BALANCE_USD;

  return (
    <Link
      to={low ? "/billing" : "/wallet"}
      title={low ? "Balance is low — top up to keep orders moving" : "Wallet balance"}
      className={cn(
        "flex h-9 items-center gap-2 rounded-full border px-3.5 text-xs transition-colors",
        low
          ? "border-warning/40 bg-warning/10 text-warning"
          : "border-border text-muted-foreground hover:bg-accent",
      )}
    >
      <Wallet className="h-3.5 w-3.5 shrink-0" />
      <span className={cn("tnum font-semibold", low ? "text-warning" : "text-foreground")}>
        {formatUSD(balance)}
      </span>
      <span className="max-w-28 truncate">{entity.legal_name}</span>
      {low && <span className="shrink-0 font-medium underline underline-offset-2">Top up</span>}
    </Link>
  );
}

function AccountMenu({
  email,
  companyName,
  onSignOut,
}: {
  email: string | null;
  companyName: string | null;
  onSignOut: () => void;
}) {
  const initial = (companyName ?? email ?? "?").charAt(0).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 px-2" aria-label="Account menu">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">
            {initial}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          {companyName && <p className="truncate text-sm font-medium">{companyName}</p>}
          <p className="truncate text-xs text-muted-foreground">{email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut} className="gap-2 cursor-pointer">
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({
  role,
  email,
  companyName,
  onboardingStore,
  children,
}: {
  role: "client" | "admin";
  email: string | null;
  companyName: string | null;
  onboardingStore?: OnboardingStore | null;
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
      {/* Fixed dark sidebar — same cool charcoal in both modes. */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-5">
          <a href={MARKETING_URL} className="flex items-center gap-2">
            <Boxes className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold tracking-tight text-sidebar-accent-foreground">
              FlySales
            </span>
          </a>
          <span className="ml-auto rounded border border-sidebar-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sidebar-foreground">
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
                  "border-primary bg-sidebar-accent text-sidebar-accent-foreground font-medium",
              }}
              className="flex items-center gap-2.5 rounded-md border-l-[3px] border-transparent px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        {role === "client" && onboardingStore && <ResourcesSection store={onboardingStore} />}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar: store switcher, wallet, theme, account. */}
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-background px-6">
          {role === "client" && (
            <div className="w-56">
              <StoreSwitcher />
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {role === "client" && <WalletChip />}
            <ThemeToggle />
            <AccountMenu email={email} companyName={companyName} onSignOut={() => void handleSignOut()} />
          </div>
        </header>

        <main className="min-w-0 flex-1">
          <PaymentTestModeBanner />
          {role === "client" && <PastDueBanner />}
          <div className="mx-auto max-w-6xl px-6 py-6">{children}</div>
        </main>
      </div>
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

/**
 * Every empty state states what is missing and what action produces data,
 * with a button where an action exists.
 */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: { label: string; to: string };
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {action && (
        <Button asChild size="sm" className="mt-4">
          <Link to={action.to}>{action.label}</Link>
        </Button>
      )}
    </div>
  );
}
