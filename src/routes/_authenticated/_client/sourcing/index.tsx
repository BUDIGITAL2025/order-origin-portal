import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listMyQuotes } from "@/lib/quotes.functions";

export const Route = createFileRoute("/_authenticated/_client/sourcing/")({
  head: () => ({
    meta: [
      { title: "Sourcing — FlySales" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SourcingIndex,
});

/** Opens on "My quotes" when there is history, otherwise on "New request". */
function SourcingIndex() {
  const fetchQuotes = useServerFn(listMyQuotes);
  const { data, isPending } = useQuery({ queryKey: ["my-quotes"], queryFn: fetchQuotes });

  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (data?.quotes ?? []).length > 0 ? (
    <Navigate to="/sourcing/quotes" replace />
  ) : (
    <Navigate to="/sourcing/new" replace />
  );
}
