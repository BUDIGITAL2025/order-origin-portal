/**
 * Shared admin console design language.
 *
 * Every admin page composes the same primitives so the console reads as one
 * surface: a summary bar of stat chips, filter tabs + search above a dense
 * table, colored status chips and icon-only row actions.
 */
import * as React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type StatTone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

const TONE_TEXT: Record<StatTone, string> = {
  neutral: "text-foreground",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-info",
};

export type StatItem = {
  key: string;
  label: string;
  value: React.ReactNode;
  tone?: StatTone;
  active?: boolean;
  onClick?: () => void;
  hint?: string;
};

/** Compact stat chips, clickable where they filter the table below. */
export function SummaryBar({
  items,
  className,
}: {
  items: StatItem[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3 lg:grid-cols-5",
        className,
      )}
    >
      {items.map((item) => {
        const interactive = typeof item.onClick === "function";
        const Tag = interactive ? "button" : "div";
        return (
          <Tag
            key={item.key}
            {...(interactive
              ? { type: "button" as const, onClick: item.onClick }
              : {})}
            className={cn(
              "bg-card px-3 py-2.5 text-left transition-colors",
              interactive && "hover:bg-accent",
              item.active && "bg-accent ring-1 ring-inset ring-primary/40",
            )}
          >
            <span className="metric-label block truncate">{item.label}</span>
            <span
              className={cn(
                "tnum mt-0.5 block text-lg font-semibold leading-none",
                TONE_TEXT[item.tone ?? "neutral"],
              )}
            >
              {item.value}
            </span>
            {item.hint && (
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                {item.hint}
              </span>
            )}
          </Tag>
        );
      })}
    </div>
  );
}

/** Pill filter tabs, same shape as the client Orders page. */
export function FilterTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-full border border-border bg-card p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={cn(
            "rounded-full px-3 py-1 text-[13px] font-medium transition-colors",
            value === t.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function AdminSearch({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={cn("relative min-w-[200px] flex-1", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 rounded-full pl-9 text-[13px]"
      />
    </div>
  );
}

/** The one control row every admin table sits under. */
export function ToolBar({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>;
}

/** Dense table shell: one border language, horizontal scroll contained. */
export function TableShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-xl border border-border bg-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Empty cells read as a muted dot, never a dash floating in space. */
export function EmptyCell({ label = "No value" }: { label?: string }) {
  return (
    <span
      aria-label={label}
      title={label}
      className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/35 align-middle"
    />
  );
}

/** Renders a value, or the muted dot when it is empty. */
export function Value({ children }: { children: React.ReactNode }) {
  const empty =
    children == null ||
    children === "" ||
    children === "—" ||
    (typeof children === "string" && children.trim() === "");
  return empty ? <EmptyCell /> : <>{children}</>;
}

/** Icon-only row action with a tooltip instead of a wide text button. */
export function RowAction({
  label,
  icon: Icon,
  onClick,
  disabled,
  tone,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "primary" | "danger";
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-7 w-7",
              tone === "primary" && "text-primary",
              tone === "danger" && "text-destructive",
            )}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            <Icon className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function RowActions({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-end gap-0.5">{children}</div>;
}

/** Small inline chip used for secondary counts and paths. */
export function Chip({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: StatTone;
  className?: string;
}) {
  const tones: Record<StatTone, string> = {
    neutral: "border-border bg-muted/50 text-muted-foreground",
    primary: "border-primary/30 bg-primary/10 text-primary",
    success: "border-success/25 bg-success/10 text-success",
    warning: "border-warning/25 bg-warning/10 text-warning",
    danger: "border-destructive/25 bg-destructive/10 text-destructive",
    info: "border-info/25 bg-info/10 text-info",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-none",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Section header used inside composed pages (panels within a page). */
export function PanelHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
