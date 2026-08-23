/**
 * SpyMarket filter primitives: pill dropdown chips (lime-tinted when active)
 * that open a popover with Apply/Clear, dual-range sliders with min/max
 * inputs (linear or log scale), and a two-column country include/exclude
 * picker with search.
 */
import * as React from "react";
import { Check, ChevronDown, Info, Search } from "lucide-react";
import { COUNTRIES } from "@/lib/countries";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Flag } from "./viz";

// ---------------------------------------------------------------------------
// FilterChip — pill that opens a popover with Apply / Clear
// ---------------------------------------------------------------------------

export function FilterChip({
  label,
  display,
  active,
  onApply,
  onClear,
  children,
  contentClassName,
}: {
  label: string;
  /** Short summary of the active value, shown inside the pill. */
  display?: string | undefined;
  active: boolean;
  /** Commits the (live-edited) state to the URL and closes the popover. */
  onApply: () => void;
  onClear: () => void;
  children: React.ReactNode;
  contentClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
            active
              ? "border-primary/40 bg-primary/15 text-primary"
              : "border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground",
          )}
        >
          {label}
          {active && display && <span className="font-semibold">{display}</span>}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("w-72 rounded-2xl p-3", contentClassName)}>
        {children}
        <div className="mt-3 flex items-center justify-between border-t pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full"
            onClick={() => {
              onClear();
              setOpen(false);
            }}
          >
            Clear
          </Button>
          <Button
            size="sm"
            className="rounded-full"
            onClick={() => {
              onApply();
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// DualRangeContent — dual-thumb slider + min/max inputs
// ---------------------------------------------------------------------------

const SLIDER_STEPS = 200;

export function DualRangeContent({
  min,
  max,
  logScale = false,
  value,
  onChange,
  formatLabel,
}: {
  min: number;
  max: number;
  /** Log scale for huge ranges (e.g. monthly visits 0 → 50M). min must be 0. */
  logScale?: boolean;
  value: [number, number];
  onChange: (v: [number, number]) => void;
  formatLabel?: (n: number) => string;
}) {
  const toSlider = React.useCallback(
    (n: number): number => {
      if (logScale) {
        if (max <= 0) return 0;
        return (Math.log1p(Math.max(0, n)) / Math.log1p(max)) * SLIDER_STEPS;
      }
      return max === min ? 0 : ((n - min) / (max - min)) * SLIDER_STEPS;
    },
    [logScale, min, max],
  );
  const fromSlider = React.useCallback(
    (s: number): number => {
      if (logScale) return Math.round(Math.expm1((s / SLIDER_STEPS) * Math.log1p(max)));
      return Math.round(min + (s / SLIDER_STEPS) * (max - min));
    },
    [logScale, min, max],
  );

  const sliderValue = [toSlider(value[0]), toSlider(value[1])];
  const fmt = formatLabel ?? ((n: number) => n.toLocaleString("en"));

  const setBound = (idx: 0 | 1, raw: string) => {
    const n = Number(raw.replace(/\D/g, ""));
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(min, Math.min(max, n));
    const next: [number, number] = idx === 0 ? [clamped, value[1]] : [value[0], clamped];
    if (next[0] > next[1]) next[idx === 0 ? 1 : 0] = next[idx];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{fmt(value[0])}</span>
        <span>{fmt(value[1])}</span>
      </div>
      <Slider
        min={0}
        max={SLIDER_STEPS}
        step={1}
        value={sliderValue}
        onValueChange={(v) => {
          if (Array.isArray(v) && v.length === 2) {
            onChange([fromSlider(v[0]!), fromSlider(v[1]!)]);
          }
        }}
      />
      <div className="flex items-center gap-2">
        <Input
          value={value[0] === min ? "" : String(value[0])}
          placeholder={`min ${fmt(min)}`}
          inputMode="numeric"
          onChange={(e) => setBound(0, e.target.value)}
          className="h-8 rounded-full text-xs"
        />
        <span className="text-muted-foreground">–</span>
        <Input
          value={value[1] === max ? "" : String(value[1])}
          placeholder={`max ${fmt(max)}`}
          inputMode="numeric"
          onChange={(e) => setBound(1, e.target.value)}
          className="h-8 rounded-full text-xs"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CountryDualContent — include / exclude columns with search
// ---------------------------------------------------------------------------

export function CountryDualContent({
  include,
  exclude,
  onIncludeChange,
  onExcludeChange,
}: {
  include: string[];
  exclude: string[];
  onIncludeChange: (codes: string[]) => void;
  onExcludeChange: (codes: string[]) => void;
}) {
  const [q, setQ] = React.useState("");
  const list = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return COUNTRIES;
    return COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(needle) || c.code.toLowerCase().includes(needle),
    );
  }, [q]);

  const toggle = (
    code: string,
    arr: string[],
    setArr: (c: string[]) => void,
    other: string[],
    setOther: (c: string[]) => void,
  ) => {
    if (arr.includes(code)) setArr(arr.filter((c) => c !== code));
    else {
      setArr([...arr, code]);
      setOther(other.filter((c) => c !== code)); // a country can't be both
    }
  };

  const col = (
    title: string,
    arr: string[],
    setArr: (c: string[]) => void,
    other: string[],
    setOther: (c: string[]) => void,
    activeClass: string,
  ) => (
    <div className="min-w-0 flex-1">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="max-h-52 space-y-0.5 overflow-y-auto pr-1">
        {list.map((c) => {
          const on = arr.includes(c.code);
          return (
            <button
              key={c.code}
              type="button"
              onClick={() => toggle(c.code, arr, setArr, other, setOther)}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-xs transition-colors",
                on ? activeClass : "hover:bg-muted/60",
              )}
            >
              <Flag code={c.code} size={14} />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {on && <Check className="h-3 w-3 shrink-0" />}
            </button>
          );
        })}
        {list.length === 0 && (
          <p className="px-1.5 py-2 text-xs text-muted-foreground">No matches.</p>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search countries"
          className="h-8 rounded-full pl-8 text-xs"
        />
      </div>
      <div className="flex gap-2">
        {col("Include", include, onIncludeChange, exclude, onExcludeChange, "bg-primary/15 text-primary")}
        <div className="w-px bg-border" />
        {col("Exclude", exclude, onExcludeChange, include, onIncludeChange, "bg-destructive/10 text-destructive")}
      </div>
      {exclude.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          Exclusions filter the returned rows in the browser — the API has no exclude param.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ListContent — single-select radio list inside a chip (category, language…)
// ---------------------------------------------------------------------------

export function ListContent({
  options,
  value,
  onChange,
  searchable = false,
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
  searchable?: boolean;
}) {
  const [q, setQ] = React.useState("");
  const list = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [options, q]);
  return (
    <div className="space-y-2">
      {searchable && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className="h-8 rounded-full pl-8 text-xs"
          />
        </div>
      )}
      <div className="max-h-52 space-y-0.5 overflow-y-auto pr-1">
        {list.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-xs transition-colors",
              value === o.value ? "bg-primary/15 text-primary" : "hover:bg-muted/60",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
            {value === o.value && <Check className="h-3 w-3 shrink-0" />}
          </button>
        ))}
        {list.length === 0 && (
          <p className="px-1.5 py-2 text-xs text-muted-foreground">No matches.</p>
        )}
      </div>
    </div>
  );
}
