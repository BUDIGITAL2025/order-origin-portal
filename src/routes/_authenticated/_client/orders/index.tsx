import { createFileRoute, redirect } from "@tanstack/react-router";

/** Legacy path — kept so old bookmarks and emails keep working. */
export const Route = createFileRoute("/_authenticated/_client/orders/")({
  beforeLoad: () => {
    throw redirect({ to: "/fulfilment/orders" });
  },
});
