import { createFileRoute, Navigate, Outlet } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { getSourcingDeskContext } from "@/lib/sourcing.functions";

export const Route = createFileRoute("/_authenticated/desk")({
  component: DeskLayout,
});

/** Shared context for every desk page: who the collaborator is. */
export function useDeskContext() {
  const fetchContext = useServerFn(getSourcingDeskContext);
  return useQuery({ queryKey: ["sourcing-desk-context"], queryFn: fetchContext });
}

function DeskLayout() {
  const { data, isPending } = useDeskContext();

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading your desk…
      </div>
    );
  }

  // Anyone who is not an active collaborator belongs in the client portal.
  if (!data?.collaborator) return <Navigate to="/dashboard" />;

  return (
    <AppShell
      role="sourcing"
      email={data.collaborator.email}
      companyName={data.collaborator.display_name ?? "Sourcing desk"}
    >
      <Outlet />
    </AppShell>
  );
}
