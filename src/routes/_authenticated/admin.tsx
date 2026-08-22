import { createFileRoute, Navigate, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useMyContext } from "./_client";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const { data: ctx, isPending } = useMyContext();

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!ctx?.isAdmin) return <Navigate to="/dashboard" />;

  return (
    <AppShell
      role="admin"
      email={ctx.email}
      companyName={ctx.entities[0]?.legal_name ?? null}
    >
      <Outlet />
    </AppShell>
  );
}
