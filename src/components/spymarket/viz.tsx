/**
 * SpyMarket data-viz primitives: circle flags, lazy sparklines and larger
 * area charts. Pure SVG on our design tokens — primary (lime) for growth,
 * destructive (red) for decline. No chart library: 60+ instances per page
 * must stay cheap, and sparklines lazy-render near the viewport.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asRec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const asNum = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const asStr = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export interface TrendPoint {
  label: string;
  value: number;
}

/** Raw Trendtrack series ([{period|date, value|reach}]) → clean points. */
export function toTrendPoints(raw: unknown): TrendPoint[] {
  return asArr(raw)
    .map(asRec)
    .map((p) => ({
      label: asStr(p["period"]) ?? asStr(p["date"]) ?? "",
      value: asNum(p["value"] ?? p["reach"]) ?? Number.NaN,
    }))
    .filter((p) => p.label !== "" && Number.isFinite(p.value));
}

/** "2026-02-01" → "Feb 2026" (monthly), "2026-04-20" → "20 Apr 26" (weekly). */
export function formatPeriod(label: string): string {
  const d = new Date(label);
  if (Number.isNaN(d.getTime())) return label;
  return d.getDate() <= 2
    ? d.toLocaleDateString("en-GB", { month: "short", year: "numeric" })
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
}

export const fmtAxis = (v: number): string =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);

/** Keep the points whose date falls within the trailing 3M / 6M window. */
export function filterRange(points: TrendPoint[], range: "3M" | "6M" | "ALL"): TrendPoint[] {
  if (range === "ALL" || points.length < 3) return points;
  const last = new Date(points[points.length - 1]!.label).getTime();
  if (!Number.isFinite(last)) return points;
  const cutoff = last - (range === "3M" ? 92 : 183) * 86_400_000;
  const out = points.filter((p) => new Date(p.label).getTime() >= cutoff);
  return out.length >= 2 ? out : points;
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

/** Circle flag from the HatScripts CDN. Renders nothing for unknown codes. */
export function Flag({
  code,
  size = 16,
  className,
}: {
  code: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  if (!code || failed) return null;
  return (
    <img
      src={`https://cdn.jsdelivr.net/gh/HatScripts/circle-flags/flags/${code.toLowerCase()}.svg`}
      alt={code}
      title={code}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("inline-block shrink-0 rounded-full", className)}
      style={{ width: size, height: size }}
    />
  );
}

/** Overlapping flag stack for country lists, with a "+N" overflow. */
export function FlagStack({
  codes,
  size = 16,
  max = 3,
  className,
}: {
  codes: Array<string | null | undefined>;
  size?: number;
  max?: number;
  className?: string;
}) {
  const clean = codes.filter((c): c is string => typeof c === "string" && c !== "");
  if (clean.length === 0) return null;
  const shown = clean.slice(0, max);
  return (
    <span className={cn("inline-flex items-center", className)}>
      {shown.map((c, i) => (
        <Flag
          key={`${c}-${i}`}
          code={c}
          size={size}
          className={cn("ring-2 ring-card", i > 0 && "-ml-1")}
        />
      ))}
      {clean.length > max && (
        <span className="ml-1 text-[10px] font-medium text-muted-foreground">
          +{clean.length - max}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

/** Catmull-Rom → cubic bezier for a smooth 1px line. */
function smoothPath(pts: ReadonlyArray<readonly [number, number]>): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0]![0].toFixed(2)},${pts[0]![1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}

interface ChartGeometry {
  pts: Array<readonly [number, number]>;
  line: string;
  area: string;
  growing: boolean;
}

function useChartGeometry(
  points: TrendPoint[],
  width: number,
  height: number,
  pad: number,
): ChartGeometry | null {
  return React.useMemo(() => {
    if (points.length < 2) return null;
    const values = points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const stepX = width / (points.length - 1);
    const pts = points.map(
      (p, i) =>
        [i * stepX, height - pad - ((p.value - min) / span) * (height - pad * 2)] as const,
    );
    const line = smoothPath(pts);
    const area = `${line} L ${width.toFixed(2)},${height} L 0,${height} Z`;
    return { pts, line, area, growing: values[values.length - 1]! >= values[0]! };
  }, [points, width, height, pad]);
}

function useHoverIndex(count: number) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [hover, setHover] = React.useState<number | null>(null);
  const onMouseMove = React.useCallback(
    (e: React.MouseEvent) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || count < 2) return;
      const frac = (e.clientX - rect.left) / rect.width;
      setHover(Math.max(0, Math.min(count - 1, Math.round(frac * (count - 1)))));
    },
    [count],
  );
  return { ref, hover, onMouseMove, clear: () => setHover(null) };
}

function ChartTooltip({
  point,
  xPct,
  yPct,
}: {
  point: TrendPoint;
  xPct: number;
  yPct: number;
}) {
  return (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border bg-popover px-2 py-1 text-[10px] shadow-md"
      style={{ left: `${Math.min(88, Math.max(12, xPct))}%`, top: `max(0px, calc(${yPct}% - 6px))` }}
    >
      <span className="font-semibold text-foreground">{fmtAxis(point.value)}</span>
      <span className="ml-1.5 text-muted-foreground">{formatPeriod(point.label)}</span>
    </div>
  );
}

/**
 * Dense sparkline (~139×48): smooth 1px line over a vertical gradient that
 * fades to transparent. Lime when the series grows, red when it declines.
 * Hover shows date + value. No axes, no grid.
 */
export function Sparkline({
  points,
  width = 139,
  height = 48,
  className,
}: {
  points: TrendPoint[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const gradientId = React.useId();
  const geo = useChartGeometry(points, width, height, 3);
  const { ref, hover, onMouseMove, clear } = useHoverIndex(points.length);
  if (!geo) return null;
  return (
    <div
      ref={ref}
      className={cn("relative w-full", className)}
      style={{ height }}
      onMouseMove={onMouseMove}
      onMouseLeave={clear}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={cn("h-full w-full", geo.growing ? "text-primary" : "text-destructive")}
        aria-hidden
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={geo.area} fill={`url(#${gradientId})`} stroke="none" />
        <path
          d={geo.line}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hover != null && geo.pts[hover] && (
          <circle cx={geo.pts[hover][0]} cy={geo.pts[hover][1]} r="3" fill="currentColor" />
        )}
      </svg>
      {hover != null && geo.pts[hover] && points[hover] && (
        <ChartTooltip
          point={points[hover]}
          xPct={(geo.pts[hover][0] / width) * 100}
          yPct={(geo.pts[hover][1] / height) * 100}
        />
      )}
    </div>
  );
}

/** Renders the sparkline only when it scrolls near the viewport. */
export function LazySparkline({
  points,
  height = 48,
  className,
}: {
  points: TrendPoint[];
  height?: number;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible]);
  return (
    <div ref={ref} style={{ minHeight: height }} className={className}>
      {visible && points.length >= 2 ? <Sparkline points={points} height={height} /> : null}
    </div>
  );
}

/**
 * Large area chart for the shop detail top: smooth line, gradient fill, a
 * dot per point, hover crosshair + tooltip. Range filtering is the parent's
 * job (filterRange).
 */
export function AreaChart({
  points,
  height = 180,
  className,
}: {
  points: TrendPoint[];
  height?: number;
  className?: string;
}) {
  const width = 560;
  const pad = 10;
  const gradientId = React.useId();
  const geo = useChartGeometry(points, width, height, pad);
  const { ref, hover, onMouseMove, clear } = useHoverIndex(points.length);
  if (!geo) return null;
  return (
    <div
      ref={ref}
      className={cn("relative w-full", className)}
      style={{ height }}
      onMouseMove={onMouseMove}
      onMouseLeave={clear}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={cn("h-full w-full", geo.growing ? "text-primary" : "text-destructive")}
        aria-hidden
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={geo.area} fill={`url(#${gradientId})`} stroke="none" />
        <path
          d={geo.line}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {geo.pts.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={hover === i ? 4 : 2.5}
            fill="currentColor"
            className="transition-[r]"
          />
        ))}
        {hover != null && geo.pts[hover] && (
          <line
            x1={geo.pts[hover][0]}
            y1={0}
            x2={geo.pts[hover][0]}
            y2={height}
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {hover != null && geo.pts[hover] && points[hover] && (
        <ChartTooltip
          point={points[hover]}
          xPct={(geo.pts[hover][0] / width) * 100}
          yPct={(geo.pts[hover][1] / height) * 100}
        />
      )}
    </div>
  );
}
