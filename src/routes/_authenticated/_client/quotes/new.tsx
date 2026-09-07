import { createFileRoute, redirect } from "@tanstack/react-router";

/** Legacy path — kept so old bookmarks and emails keep working. */
export const Route = createFileRoute("/_authenticated/_client/quotes/new")({
  beforeLoad: () => {
    throw redirect({ to: "/sourcing/new" });
  },
});
