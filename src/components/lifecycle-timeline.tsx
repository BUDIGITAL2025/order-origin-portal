/**
 * The deal view: one product's stages from request to delivery.
 *
 * Reached stages carry their date and who acted; stages not yet reached are
 * muted. Rendered identically from the quote page, the purchase list and the
 * client panel so every entry point tells the same story.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { adminLifecycle } from "@/lib/command-center.functions";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  quoteId?: string;
  purchaseId?: string;
  storeId?: string;
  /** Hide the product heading when the surrounding page already shows it. */
  hideHeading?: boolean;
  /** Lead with where the deal stands now; the full history opens on demand. */
  collapsible?: boolean;
}

export function LifecycleTimeline({
  quoteId,
  purchaseId,
  storeId,
  hideHeading,
  collapsible,
}: Props) {
  const [openDeal, setOpenDeal] = useState<string | null>(null);
  const fetchLifecycle = useServerFn(adminLifecycle);
  const { data, isPending } = useQuery({
    queryKey: ["admin-lifecycle", quoteId ?? purchaseId ?? storeId ?? "none"],
    enabled: !!(quoteId || purchaseId || storeId),
    staleTime: 30_000,
    queryFn: () =>
      fetchLifecycle({
        data: {
          ...(quoteId ? { quote_id: quoteId } : {}),
          ...(purchaseId ? { purchase_id: purchaseId } : {}),
          ...(storeId ? { store_id: storeId } : {}),
        },
      }),
  });

  if (isPending) return <p className="text-sm text-muted-foreground">Loading timeline…</p>;
  const deals = data?.deals ?? [];
  if (deals.length === 0)
    return <p className="text-sm text-muted-foreground">Nothing to show yet.</p>;

  return (
    <div className="space-y-5">
      {deals.map((deal) => {
        const done = deal.stages.filter((s) => s.done);
        const current = done[done.length - 1] ?? null;
        const next = deal.stages.find((s) => !s.done) ?? null;
        const expanded = !collapsible || openDeal === deal.quote_id;
        return (
          <div key={deal.quote_id}>
            {hideHeading ? null : (
              <p className="mb-2 text-sm font-medium">
                {deal.product_name}
                {deal.quote_ref ? (
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    Ref {deal.quote_ref}
                  </span>
                ) : null}
              </p>
            )}
            {collapsible && (
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpenDeal(expanded ? null : deal.quote_id)}
                className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted/40"
              >
                <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {current ? current.label : "Not started"}
                    {next ? ` · Awaiting ${next.label.toLowerCase()}` : ""}
                  </span>
                  {current?.at ? (
                    <span className="tnum block text-[12px] text-muted-foreground">
                      {formatDate(current.at)}
                      {current.by ? ` · ${current.by}` : ""}
                    </span>
                  ) : null}
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150",
                    expanded && "rotate-180",
                  )}
                />
              </button>
            )}
            {expanded && (
              <ol
                className={cn(
                  "grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4",
                  collapsible && "mt-2 lg:grid-cols-2",
                )}
              >
                {deal.stages.map((s) => (
                  <li
                    key={s.key}
                    className={cn(
                      "bg-card px-3 py-2",
                      !s.done && "bg-muted/40 text-muted-foreground",
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide">
                      {s.done ? <Check className="h-3 w-3 text-success" aria-hidden /> : null}
                      {s.label}
                    </span>
                    <span className="tnum mt-0.5 block text-sm">
                      {s.at ? formatDate(s.at) : s.done ? "Done" : "—"}
                    </span>
                    {s.by || s.detail ? (
                      <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                        {[s.by, s.detail].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}
    </div>
  );
}
