import { useEffect, useState } from "react";
import { AlarmClock, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Ticking clock for SLA countdowns. */
export function useNow(stepMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(t);
  }, [stepMs]);
  return now;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "47h 12m 09s" (or "47h 12m" without seconds) remaining/elapsed time text. */
export function formatSlaDuration(ms: number, withSeconds = true): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return withSeconds ? `${h}h ${pad2(m)}m ${pad2(s)}s` : `${h}h ${m}m`;
  return withSeconds ? `${m}m ${pad2(s)}s` : `${m}m`;
}

/** Open requests are the ones the 48h sourcing target applies to. */
export function isQuoteOpenForSla(status: string): boolean {
  return status === "submitted" || status === "sourcing";
}

/**
 * Client quote detail: live countdown to the 48h sourcing target. When the
 * target passes without a quote, show reassurance instead of a dead 00:00:00.
 * Hidden once the quote arrives (the acceptance grid takes over) or the
 * request is closed/expired.
 */
export function QuoteSlaCountdown({
  dueAt,
  status,
  className,
}: {
  dueAt: string;
  status: string;
  className?: string;
}) {
  const now = useNow(1000);
  if (!isQuoteOpenForSla(status)) return null;
  const remaining = new Date(dueAt).getTime() - now;

  if (remaining <= 0) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-border bg-card p-6 text-center",
          className,
        )}
      >
        <p className="text-sm font-semibold">Taking longer than usual</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Our sourcing team is on it — you'll be notified as soon as your quote arrives.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-6 text-center",
        className,
      )}
    >
      <p className="flex items-center justify-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <AlarmClock className="h-3.5 w-3.5" />
        Expected quote within
      </p>
      <p className="mt-2 tnum text-3xl font-semibold tabular-nums">
        {formatSlaDuration(remaining)}
      </p>
    </div>
  );
}

/** Admin queue: compact time-against-target badge. Red once overdue. */
export function QuoteSlaBadge({
  dueAt,
  status,
}: {
  dueAt: string | null;
  status: string;
}) {
  const now = useNow(30_000);
  if (!dueAt || !isQuoteOpenForSla(status)) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const remaining = new Date(dueAt).getTime() - now;
  if (remaining <= 0) {
    return (
      <Badge variant="destructive" className="whitespace-nowrap">
        Overdue {formatSlaDuration(-remaining, false)}
      </Badge>
    );
  }
  return (
    <span
      className={cn(
        "whitespace-nowrap text-xs tnum",
        remaining < 12 * 3600 * 1000 ? "font-medium text-foreground" : "text-muted-foreground",
      )}
    >
      {formatSlaDuration(remaining, false)} left
    </span>
  );
}

const TIMELINE_STEPS = [
  { key: "submitted", label: "Submitted" },
  { key: "sourcing", label: "Sourcing" },
  { key: "quoted", label: "Quoted" },
] as const;

/** Status timeline: Submitted → Sourcing → Quoted. */
export function QuoteTimeline({ status }: { status: string }) {
  const currentIdx = TIMELINE_STEPS.findIndex((s) => s.key === status);
  // closed/expired quotes still passed through these states — show all done.
  const effectiveIdx = currentIdx === -1 ? TIMELINE_STEPS.length : currentIdx;

  return (
    <ol className="flex items-center gap-2">
      {TIMELINE_STEPS.map((step, i) => {
        const done = i < effectiveIdx;
        const current = i === effectiveIdx && currentIdx !== -1;
        return (
          <li key={step.key} className="flex flex-1 items-center gap-2 last:flex-none">
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                done
                  ? "border-primary bg-primary text-primary-foreground"
                  : current
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span
              className={cn(
                "text-xs",
                done || current ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
            {i < TIMELINE_STEPS.length - 1 && (
              <span className={cn("h-px flex-1", i < effectiveIdx ? "bg-primary" : "bg-border")} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
