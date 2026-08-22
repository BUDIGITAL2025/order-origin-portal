import * as React from "react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  ClipboardList,
  FilePlus2,
  LayoutDashboard,
  LogOut,
  Users,
  Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
  { to: "/wallet", label: "Wallet", icon: Wallet },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/admin/quotes", label: "Quote queue", icon: ClipboardList },
  { to: "/admin/clients", label: "Clients", icon: Users },
  { to: "/admin/wallet", label: "Wallet adjustments", icon: Wallet },
];

export function AppShell({
  role,
  email,
  companyName,
  children,
}: {
  role: "client" | "admin";
  email: string | null;
  companyName: string | null;
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
          <Boxes className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold tracking-tight">FlySales</span>
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
