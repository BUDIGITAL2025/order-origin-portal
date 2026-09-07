import { createFileRoute, redirect } from "@tanstack/react-router";

/** Legacy path — kept so old bookmarks and emails keep working. */
export const Route = createFileRoute("/_authenticated/_client/documents")({
  beforeLoad: () => {
    throw redirect({ to: "/billing/receipts" });
  },
});
