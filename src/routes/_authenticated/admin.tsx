import { createFileRoute, Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useMyContext } from "./_client";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

/** Pages under /admin that sourcing collaborators are also allowed to open. */
const SOURCING_ALLOWED = ["/admin/catalog-import"];

function AdminLayout() {
  const { data: ctx, isPending } = useMyContext();
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const sourcingAllowed =
    !!ctx?.isSourcing &&
    SOURCING_ALLOWED.some((p) => pathname === p || pathname.startsWith(p + "/"));

  if (!ctx?.isAdmin && !sourcingAllowed) {
    return <Navigate to={ctx?.isSourcing ? "/desk/queue" : "/dashboard"} />;
  }

  if (!ctx.isAdmin) {
    return (
      <AppShell role="sourcing" email={ctx.email} companyName="Sourcing desk">
        <Outlet />
      </AppShell>
    );
  }

  return (
    <AppShell role="admin" email={ctx.email} companyName={ctx.entities[0]?.legal_name ?? null}>
      <Outlet />
    </AppShell>
  );
}
