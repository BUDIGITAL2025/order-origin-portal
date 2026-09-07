import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/desk/")({
  component: () => <Navigate to="/desk/queue" replace />,
});
