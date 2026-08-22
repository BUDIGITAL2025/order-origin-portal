import { Badge } from "@/components/ui/badge";
import { isQuoteExpired } from "@/lib/format";
import { cn } from "@/lib/utils";

const QUOTE_STYLES: Record<string, string> = {
  submitted: "bg-info/10 text-info border-info/25",
  sourcing: "bg-warning/10 text-warning border-warning/25",
  quoted: "bg-primary/10 text-primary border-primary/25",
  accepted: "bg-success/10 text-success border-success/25",
  rejected: "bg-destructive/10 text-destructive border-destructive/25",
  expired: "bg-muted text-muted-foreground border-border",
};

export function QuoteStatusBadge({
  status,
  validUntil,
}: {
  status: string | null;
  validUntil?: string | null;
}) {
  const raw = status ?? "submitted";
  const effective = isQuoteExpired(raw, validUntil) ? "expired" : raw;
  return (
    <Badge variant="outline" className={cn("font-medium capitalize", QUOTE_STYLES[effective] ?? "")}>
      {effective}
    </Badge>
  );
}

const PROFILE_STYLES: Record<string, string> = {
  pending: "bg-warning/10 text-warning border-warning/25",
  active: "bg-success/10 text-success border-success/25",
  suspended: "bg-destructive/10 text-destructive border-destructive/25",
};

export function ProfileStatusBadge({ status }: { status: string | null }) {
  const key = status ?? "";
  return (
    <Badge variant="outline" className={cn("font-medium capitalize", PROFILE_STYLES[key] ?? "")}>
      {key || "—"}
    </Badge>
  );
}

const PROVISIONING_STYLES: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground border-border",
  in_progress: "bg-info/10 text-info border-info/25",
  complete: "bg-success/10 text-success border-success/25",
  failed: "bg-destructive/10 text-destructive border-destructive/25",
};

export function ProvisioningBadge({ status }: { status: string | null }) {
  const key = status ?? "";
  return (
    <Badge variant="outline" className={cn("font-medium", PROVISIONING_STYLES[key] ?? "")}>
      {key ? key.replaceAll("_", " ") : "—"}
    </Badge>
  );
}

const TXN_STYLES: Record<string, string> = {
  credit: "bg-success/10 text-success border-success/25",
  debit: "bg-destructive/10 text-destructive border-destructive/25",
  adjustment: "bg-info/10 text-info border-info/25",
};

export function TxnTypeBadge({ type }: { type: string | null }) {
  const key = type ?? "";
  return (
    <Badge variant="outline" className={cn("font-medium capitalize", TXN_STYLES[key] ?? "")}>
      {key || "—"}
    </Badge>
  );
}

const TIER_STYLES: Record<string, string> = {
  starter: "bg-muted text-muted-foreground border-border",
  growth: "bg-info/10 text-info border-info/25",
  scale: "bg-success/10 text-success border-success/25",
};

export function TierBadge({ tier }: { tier: string | null }) {
  const key = tier ?? "";
  return (
    <Badge variant="outline" className={cn("font-medium capitalize", TIER_STYLES[key] ?? "")}>
      {key || "—"}
    </Badge>
  );
}
