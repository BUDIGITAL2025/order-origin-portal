/**
 * The orders funnel: one clickable chip per stage of the order lifecycle,
 * with live counts. Shared by the client and admin order lists so both read
 * the same stages in the same sequence. Selection is URL-driven by the caller.
 */
import { cn } from "@/lib/utils";

export const FUNNEL_STAGES = [
  { id: "awaiting_payment", label: "Awaiting payment", statuses: ["awaiting_payment"] },
  { id: "processing", label: "Paid / processing", statuses: ["paid", "processing"] },
  { id: "shipped", label: "Shipped / in transit", statuses: ["shipped"] },
  { id: "delivered", label: "Delivered", statuses: ["delivered"] },
  { id: "needs_review", label: "Needs review", statuses: ["needs_review"] },
  { id: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number]["id"] | "disputed";

const ACCENT: Record<string, string> = {
  awaiting_payment: "text-warning",
  processing: "text-info",
  shipped: "text-info",
  delivered: "text-success",
  needs_review: "text-warning",
  cancelled: "text-muted-foreground",
  disputed: "text-destructive",
};

/** Does an order status belong to this funnel stage? */
export function matchesStage(status: string, stage: FunnelStage): boolean {
  const found = FUNNEL_STAGES.find((s) => s.id === stage);
  return found ? (found.statuses as readonly string[]).includes(status) : false;
}

/** Count each stage from a list of order statuses. */
export function countStages(statuses: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const stage of FUNNEL_STAGES) {
    out[stage.id] = statuses.filter((s) =>
      (stage.statuses as readonly string[]).includes(s),
    ).length;
  }
  return out;
}

export function OrdersFunnel({
  counts,
  value,
  onChange,
  showDisputed = false,
  disputedCount = 0,
}: {
  counts: Record<string, number>;
  value: FunnelStage | null;
  onChange: (next: FunnelStage | null) => void;
  showDisputed?: boolean;
  disputedCount?: number;
}) {
  const stages: { id: FunnelStage; label: string; count: number }[] = [
    ...FUNNEL_STAGES.map((s) => ({
      id: s.id as FunnelStage,
      label: s.label,
      count: counts[s.id] ?? 0,
    })),
    ...(showDisputed
      ? [{ id: "disputed" as FunnelStage, label: "Disputed", count: disputedCount }]
      : []),
  ];

  return (
    <div
      className={cn(
        "mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3",
        stages.length > 6 ? "xl:grid-cols-7" : "xl:grid-cols-6",
      )}
    >
      {stages.map((stage) => {
        const active = value === stage.id;
        return (
          <button
            key={stage.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? null : stage.id)}
            className={cn(
              "bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent",
              active && "bg-accent ring-1 ring-inset ring-primary/40",
            )}
          >
            <span className="metric-label block truncate">{stage.label}</span>
            <span
              className={cn(
                "tnum mt-0.5 block text-lg font-semibold leading-none",
                ACCENT[stage.id] ?? "",
              )}
            >
              {stage.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
