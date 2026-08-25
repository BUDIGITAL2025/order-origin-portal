import * as React from "react";
import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  ChevronDown,
  ClipboardList,
  CreditCard,
  Download,
  ExternalLink,
  FilePlus2,
  FileText,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Package,
  Plug,
  ShieldAlert,
  ShoppingCart,
  Sparkles,

  Store,
  Telescope,
  Users,
  Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { MARKETING_URL } from "@/lib/config";
import { formatUSD } from "@/lib/format";
import logoAsset from "@/assets/flysales-logo-green.svg.asset.json";
import { getOnboardingLinks } from "@/lib/onboarding.functions";
import { getMyWallet } from "@/lib/wallet.functions";
import { cn } from "@/lib/utils";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { LegalFooter } from "@/components/legal";
import { ThemeToggle } from "@/components/theme-toggle";
import { StoreSwitcher, getCurrentStoreId, STORE_CHANGED_EVENT } from "@/components/store-switcher";
import { useMyContext } from "@/routes/_authenticated/_client";
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
  badge?: string;
}

const CLIENT_NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/workspaces", label: "Workspaces", icon: Store },
  { to: "/quotes/new", label: "Request a quote", icon: FilePlus2 },
  { to: "/quotes", label: "Quote requests", icon: ClipboardList },
  { to: "/products", label: "Products", icon: Package },
  { to: "/orders", label: "Orders", icon: ShoppingCart },
  { to: "/disputes", label: "Claims", icon: ShieldAlert },
  { to: "/wallet", label: "Wallet", icon: Wallet },
  { to: "/billing", label: "Billing", icon: CreditCard },
  { to: "/documents", label: "Receipts", icon: FileText },
  { to: "/spymarket", label: "SpyMarket", icon: Telescope, badge: "New" },
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
      Your last subscription payment failed and we retry it automatically.{" "}
      <Link to="/billing" className="font-medium underline">
        Update your card
      </Link>{" "}
      to keep your plan.
    </div>
  );
}

const ADMIN_NAV: NavItem[] = [
  { to: "/admin/quotes", label: "Quote queue", icon: ClipboardList },
  { to: "/admin/orders", label: "Orders", icon: ShoppingCart },
  { to: "/admin/products", label: "Products", icon: Package },
  { to: "/admin/disputes", label: "Disputes", icon: ShieldAlert },
  { to: "/admin/clients", label: "Clients", icon: Users },
  { to: "/admin/entities", label: "Entities & workspaces", icon: Building2 },
  { to: "/admin/wallet", label: "Wallet adjustments", icon: Wallet },
  { to: "/admin/documents", label: "Receipts", icon: FileText },
  { to: "/admin/integration", label: "Integration", icon: Plug },
  { to: "/admin/spymarket", label: "SpyMarket waitlist", icon: Telescope },
  { to: "/admin/spymarket-tools", label: "SpyMarket tools", icon: FlaskConical, badge: "New" },
];

interface OnboardingStore {
  id: string;
  platform: string;
  store_url: string | null;
  integration_mode: string;
}

/**
 * "Get started" block — quiet links pinned to the bottom of the client
 * sidebar, below the main nav and separated by a divider. Visibility follows
 * the CURRENT workspace (the store-switcher selection):
 *  - "Create a Shopify store" while the workspace has no connected Shopify
 *    store (draft / no store_url — or no workspace at all yet).
 *  - "Install our Shopify app" while the workspace is not on automatic
 *    integration mode; rendered disabled with a "Coming soon" badge until
 *    the SHOPIFY_APP_URL backend config has a value.
 * Hidden entirely once the workspace is fully connected and automatic.
 */
function GetStartedSection({ stores }: { stores: OnboardingStore[] }) {
  const fetchLinks = useServerFn(getOnboardingLinks);
  const { data: links } = useQuery({
    queryKey: ["onboarding-links"],
    staleTime: 300_000,
    queryFn: fetchLinks,
  });

  // The current workspace lives in localStorage — resolve after hydration
  // and follow store-switcher changes (same-tab custom event).
  const [currentId, setCurrentId] = React.useState<string | null>(null);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    const read = () => setCurrentId(getCurrentStoreId());
    read();
    setMounted(true);
    window.addEventListener(STORE_CHANGED_EVENT, read);
    return () => window.removeEventListener(STORE_CHANGED_EVENT, read);
  }, []);
  if (!mounted) return null;

  const store = stores.find((s) => s.id === currentId) ?? stores[0] ?? null;

  const hasConnectedStore = !!store && (store.store_url ?? "").trim().length > 0;
  const isAutomatic = store?.integration_mode === "automatic";

  const showCreateStore = !hasConnectedStore;
  const showInstallApp = !isAutomatic;

  // Fully connected + automatic — nothing left to surface.
  if (!showCreateStore && !showInstallApp) return null;

  const appUrl = links?.shopifyAppUrl ?? null;
  const affiliateUrl = links?.shopifyAffiliateUrl ?? null;

  // The install item always renders when allowed (its disabled state covers
  // the missing URL); the create-store item needs its URL to be useful.
  const renderCreate = showCreateStore && !!affiliateUrl;
  if (!showInstallApp && !renderCreate) return null;

  return (
    <div className="border-t border-sidebar-border px-3 py-3">
      <p className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
        Get started
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
        {renderCreate && (
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
  onboardingStores,
  children,
}: {
  role: "client" | "admin";
  email: string | null;
  companyName: string | null;
  onboardingStores?: OnboardingStore[];
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const nav = role === "admin" ? ADMIN_NAV : CLIENT_NAV;

  // Manual active matching so "/quotes/new" doesn't light up "My quotes".
  const isActive = (to: string) => {
    if (to === "/dashboard" || to === "/admin/quotes") return pathname === to;
    if (to === "/quotes/new") return pathname === "/quotes/new";
    if (to === "/quotes")
      return pathname === "/quotes" || (pathname.startsWith("/quotes/") && pathname !== "/quotes/new");
    return pathname === to || pathname.startsWith(to + "/");
  };

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
            <img
              src={logoAsset.url}
              alt="FlySales"
              className="h-7 w-auto sm:h-8"
            />
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
              className={cn(
                "flex items-center gap-2.5 rounded-md border-l-[3px] border-transparent px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                isActive(item.to) &&
                  "border-primary bg-sidebar-accent text-sidebar-accent-foreground font-medium",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
              {item.badge && (
                <Badge className="ml-auto bg-primary/15 px-1.5 py-0 text-[9px] font-medium text-primary hover:bg-primary/15">
                  {item.badge}
                </Badge>
              )}
            </Link>
          ))}
        </nav>
        {role === "client" && <GetStartedSection stores={onboardingStores ?? []} />}
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

        <LegalFooter className="border-t border-border" />
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
  icon: Icon,
}: {
  title: string;
  hint?: string;
  action?: { label: string; to: string };
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20">
        {Icon ? <Icon className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
      </span>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-muted-foreground">{hint}</p>}
      {action && (
        <Button asChild size="sm" className="mt-4">
          <Link to={action.to}>{action.label}</Link>
        </Button>
      )}
    </div>
  );
}

