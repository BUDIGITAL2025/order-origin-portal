/**
 * Small presentation primitives for the client dashboard: a token-coloured
 * mini sparkline, a count-up number, and a staggered entrance wrapper.
 * Pure SVG/CSS — no chart or animation dependency.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

/** Reveal children with a light fade + slide, staggered by `delay` ms. */
export function Reveal({
  delay = 0,
  className,
  children,
}: {
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500 motion-safe:fill-mode-both",
        className,
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/** Smoothly counts from 0 to `value` on mount (and on value changes). */
export function useCountUp(value: number, duration = 700): number {
  const [display, setDisplay] = React.useState(value);
  const fromRef = React.useRef(0);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const from = fromRef.current;
    if (reduce || from === value) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return display;
}

export function CountUp({
  value,
  format,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const n = useCountUp(value);
  const rounded = format ? n : Math.round(n);
  return <span className={cn("tnum", className)}>{format ? format(n) : rounded}</span>;
}

/**
 * Tiny trend line. Flat/absent history renders a muted baseline rather than
 * empty space, so every card keeps the same visual rhythm.
 */
export function MiniSparkline({
  values,
  width = 120,
  height = 28,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const gradientId = React.useId();
  const clean = values.filter((v) => Number.isFinite(v));
  const min = clean.length ? Math.min(...clean) : 0;
  const max = clean.length ? Math.max(...clean) : 0;
  const flat = clean.length < 2 || max === min;
  const positive = !flat && clean[clean.length - 1]! >= clean[0]!;

  const pad = 2;
  const w = width;
  const h = height;
  const pts = flat
    ? [
        [0, h / 2],
        [w, h / 2],
      ]
    : clean.map((v, i) => [
        (i / (clean.length - 1)) * w,
        pad + (1 - (v - min) / (max - min)) * (h - pad * 2),
      ]);

  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x!.toFixed(1)},${y!.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn(
        "h-7 w-full",
        flat ? "text-muted-foreground/40" : positive ? "text-primary" : "text-muted-foreground",
        className,
      )}
      aria-hidden
    >
      {!flat && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.3" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} stroke="none" />
        </>
      )}
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={flat ? "3 3" : undefined}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Bucket ISO timestamps into `buckets` equal windows over the trailing `days`. */
export function bucketCounts(dates: (string | null | undefined)[], days = 90, buckets = 12): number[] {
  const now = Date.now();
  const start = now - days * 86_400_000;
  const size = (now - start) / buckets;
  const out = new Array<number>(buckets).fill(0);
  for (const d of dates) {
    if (!d) continue;
    const t = new Date(d).getTime();
    if (!Number.isFinite(t) || t < start) continue;
    const i = Math.min(buckets - 1, Math.floor((t - start) / size));
    out[i] = (out[i] ?? 0) + 1;
  }
  return out;
}

/**
 * Wallet balance over the trailing window, sampled at `buckets` points.
 * Transactions arrive newest-first with a running `balance_after`.
 */
export function balanceSeries(
  transactions: { created_at: string; balance_after: number | string }[],
  currentBalance: number,
  days = 90,
  buckets = 12,
): number[] {
  const asc = [...transactions]
    .map((t) => ({ t: new Date(t.created_at).getTime(), b: Number(t.balance_after) }))
    .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.b))
    .sort((a, b) => a.t - b.t);
  if (asc.length === 0) return [];
  const now = Date.now();
  const start = now - days * 86_400_000;
  const out: number[] = [];
  for (let i = 0; i < buckets; i++) {
    const at = start + ((i + 1) * (now - start)) / buckets;
    let last: number | null = null;
    for (const p of asc) {
      if (p.t <= at) last = p.b;
      else break;
    }
    out.push(last ?? asc[0]!.b);
  }
  out[out.length - 1] = currentBalance;
  return out;
}
