/**
 * Shared dense inventory table used by both the client and admin views.
 * Admin passes `showOrigin` to reveal where each lead time was resolved from
 * (P = product override, S = supplier default, W = workspace default).
 * Clients only ever see the resolved number of days.
 */
import * as React from "react";
import { ChevronDown, ChevronRight, PackagePlus } from "lucide-react";
import { Chip, EmptyCell, TableShell } from "@/components/admin-ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type InventoryState = "green" | "amber" | "red" | "idle";

export interface InventoryRow {
  sku: string;
  product_id: string | null;
  product_name: string;
  locations: { location: string; quantity: number }[];
  total_stock: number;
  reserved?: number;
  incoming?: number;
  sellable?: number;
  weight?: number | null;
  weight_unit?: string | null;
  tags?: string[];
  units_7d: number;
  units_30d: number;
  daily_velocity: number;
  days_of_cover: number | null;
  production_lead: number;
  transit_lead: number;
  safety_margin: number;
  total_lead: number;
  reorder_by: string | null;
  state: InventoryState;
  gap_days: number | null;
  suggested_qty: number;
  production_origin?: string;
  transit_origin?: string;
  safety_origin?: string;
}


const STATE_LABEL: Record<InventoryState, string> = {
  green: "Healthy",
  amber: "Reorder soon",
  red: "Reorder now",
  idle: "No recent sales",
};

const STATE_TONE = {
  green: "success",
  amber: "warning",
  red: "danger",
  idle: "neutral",
} as const;

export function StateChip({ state }: { state: InventoryState }) {
  return <Chip tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Chip>;
}

function LeadCell({ days, origin }: { days: number; origin?: string | undefined }) {
  const title =
    origin === "P"
      ? "From the product override"
      : origin === "S"
        ? "From the supplier default"
        : "From the workspace default";
  return (
    <span className="tnum inline-flex items-center gap-1">
      {days}d
      {origin && (
        <span
          title={title}
          className="rounded border border-border px-1 text-[10px] leading-tight text-muted-foreground"
        >
          {origin}
        </span>
      )}
    </span>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function InventoryTable({
  rows,
  showOrigin,
  onPlanReorder,
  planLabel = "Plan reorder",
  planIcon: PlanIcon = PackagePlus,
}: {
  rows: InventoryRow[];
  showOrigin?: boolean | undefined;
  onPlanReorder?: ((row: InventoryRow) => void) | undefined;
  planLabel?: string | undefined;
  planIcon?: React.ComponentType<{ className?: string }> | undefined;
}) {
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const toggle = (sku: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });

  return (
    <TableShell>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="w-6 px-2 py-2" />
            <th className="px-3 py-2 font-medium">Product</th>
            <th className="px-3 py-2 text-right font-medium">Stock</th>
            <th className="px-3 py-2 text-right font-medium">Reserved</th>
            <th className="px-3 py-2 text-right font-medium">Incoming</th>
            <th className="px-3 py-2 text-right font-medium">Weight</th>
            <th className="px-3 py-2 text-right font-medium">Sales 30d</th>
            <th className="px-3 py-2 text-right font-medium">Units/day</th>
            <th className="px-3 py-2 text-right font-medium">Cover</th>
            <th className="px-3 py-2 text-right font-medium">Total lead</th>

            <th className="px-3 py-2 text-right font-medium">Production</th>
            <th className="px-3 py-2 text-right font-medium">Transit</th>
            <th className="px-3 py-2 text-right font-medium">Safety</th>
            <th className="px-3 py-2 font-medium">Reorder by</th>
            <th className="px-3 py-2 font-medium">State</th>
            <th className="px-3 py-2 text-right font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const open = expanded.has(row.sku);
            return (
              <React.Fragment key={row.sku}>
                <tr
                  className={cn(
                    "border-b border-border/60 last:border-0",
                    row.state === "red" && "bg-destructive/5",
                  )}
                >
                  <td className="px-2 py-2 align-top">
                    {row.locations.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggle(row.sku)}
                        aria-label={open ? "Hide locations" : "Show locations"}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        {open ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium leading-tight">{row.product_name}</div>
                    <div className="text-[11px] text-muted-foreground">{row.sku}</div>
                  </td>
                  <td className="tnum px-3 py-2 text-right">{row.total_stock}</td>
                  <td className="tnum px-3 py-2 text-right">
                    {row.daily_velocity > 0 ? row.daily_velocity.toFixed(2) : <EmptyCell label="No recent sales" />}
                  </td>
                  <td className="tnum px-3 py-2 text-right">
                    {row.days_of_cover == null ? "∞" : `${row.days_of_cover}d`}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <LeadCell days={row.production_lead} origin={showOrigin ? row.production_origin : undefined} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <LeadCell days={row.transit_lead} origin={showOrigin ? row.transit_origin : undefined} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <LeadCell days={row.safety_margin} origin={showOrigin ? row.safety_origin : undefined} />
                  </td>
                  <td className="px-3 py-2">
                    {row.reorder_by ? (
                      <span className="tnum">{formatDate(row.reorder_by)}</span>
                    ) : (
                      <EmptyCell label="No reorder date" />
                    )}
                    {row.gap_days != null && row.gap_days > 0 && (
                      <div className="text-[11px] text-destructive">
                        Ordering today still means ~{row.gap_days} days out of stock
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StateChip state={row.state} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {onPlanReorder ? (
                      <Button
                        size="sm"
                        variant={row.state === "red" ? "default" : "outline"}
                        className="h-7 rounded-full px-3 text-[12px]"
                        onClick={() => onPlanReorder(row)}
                      >
                        <PlanIcon className="mr-1 h-3.5 w-3.5" />
                        {planLabel}
                      </Button>
                    ) : (
                      <EmptyCell label="No action" />
                    )}
                  </td>
                </tr>
                {open && (
                  <tr className="border-b border-border/60 bg-muted/30">
                    <td />
                    <td colSpan={10} className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        {row.locations.map((l) => (
                          <Chip key={l.location}>
                            {l.location}: <span className="tnum font-medium">{l.quantity}</span>
                          </Chip>
                        ))}
                        <Chip tone="info">
                          7d: <span className="tnum">{row.units_7d}</span> · 30d:{" "}
                          <span className="tnum">{row.units_30d}</span>
                        </Chip>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </TableShell>
  );
}

/** Deep link into the quote form, prefilled as a reorder for one SKU. */
export function reorderLink(row: InventoryRow) {
  return {
    to: "/quotes/new" as const,
    search: { sku: row.sku, name: row.product_name, qty: row.suggested_qty },
  };
}
