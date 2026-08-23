import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type QuoteStatus = "submitted" | "sourcing" | "quoted" | "closed" | "expired";

const QUOTE_STYLES: Record<QuoteStatus, string> = {
  submitted: "bg-info/10 text-info border-info/25",
  sourcing: "bg-info/10 text-info border-info/25",
  quoted: "bg-warning/10 text-warning border-warning/25",
  closed: "bg-success/10 text-success border-success/25",
  expired: "bg-muted text-muted-foreground border-border",
};

const QUOTE_LABELS: Record<QuoteStatus, string> = {
  submitted: "Submitted",
  sourcing: "Sourcing",
  quoted: "Quoted",
  closed: "Closed",
  expired: "Expired",
};

function isPast(date: string | null | undefined): boolean {
  if (!date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(date) < today;
}

export function QuoteStatusBadge({
  status,
  validUntil,
}: {
  status: QuoteStatus;
  validUntil?: string | null;
}) {
  if (status === "quoted" && isPast(validUntil)) {
    return (
      <Badge variant="outline" className={cn("font-normal", QUOTE_STYLES.expired)}>
        Expired
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={cn("font-normal", QUOTE_STYLES[status])}>
      {QUOTE_LABELS[status]}
    </Badge>
  );
}

type LineStatus = "pending" | "accepted" | "rejected";

const LINE_STYLES: Record<LineStatus, string> = {
  pending: "bg-warning/10 text-warning border-warning/25",
  accepted: "bg-success/10 text-success border-success/25",
  rejected: "bg-muted text-muted-foreground border-border",
};

const LINE_LABELS: Record<LineStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
};

export function LineStatusBadge({ status }: { status: LineStatus }) {
  return (
    <Badge variant="outline" className={cn("font-normal", LINE_STYLES[status])}>
      {LINE_LABELS[status]}
    </Badge>
  );
}

type ProductStatus = "active" | "discontinued" | "needs_review";

const PRODUCT_STYLES: Record<ProductStatus, string> = {
  active: "bg-success/10 text-success border-success/25",
  discontinued: "bg-muted text-muted-foreground border-border",
  needs_review: "bg-warning/10 text-warning border-warning/25",
};

const PRODUCT_LABELS: Record<ProductStatus, string> = {
  active: "Active",
  discontinued: "Discontinued",
  needs_review: "Needs review",
};

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  return (
    <Badge variant="outline" className={cn("font-normal", PRODUCT_STYLES[status])}>
      {PRODUCT_LABELS[status]}
    </Badge>
  );
}

type PushStatus = "pending" | "pushed" | "failed";

const PUSH_STYLES: Record<PushStatus, string> = {
  pending: "bg-warning/10 text-warning border-warning/25",
  pushed: "bg-success/10 text-success border-success/25",
  failed: "bg-destructive/10 text-destructive border-destructive/25",
};

const PUSH_LABELS: Record<PushStatus, string> = {
  pending: "Push pending",
  pushed: "Pushed",
  failed: "Push failed",
};

export function PushStatusBadge({ status }: { status: PushStatus }) {
  return (
    <Badge variant="outline" className={cn("font-normal", PUSH_STYLES[status])}>
      {PUSH_LABELS[status]}
    </Badge>
  );
}

type ProductType = "simple" | "bundle";

const PRODUCT_TYPE_STYLES: Record<ProductType, string> = {
  simple: "bg-muted text-muted-foreground border-border",
  bundle: "bg-info/10 text-info border-info/25",
};

export function ProductTypeBadge({ type }: { type: ProductType }) {
  return (
    <Badge variant="outline" className={cn("font-normal", PRODUCT_TYPE_STYLES[type])}>
      {type === "bundle" ? "Bundle" : "Simple"}
    </Badge>
  );
}

type Tier = "starter" | "growth" | "scale";

const TIER_STYLES: Record<Tier, string> = {
  starter: "bg-muted text-muted-foreground border-border",
  growth: "bg-info/10 text-info border-info/25",
  scale: "bg-success/10 text-success border-success/25",
};

export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <Badge variant="outline" className={cn("font-normal", TIER_STYLES[tier])}>
      {tier}
    </Badge>
  );
}

type IntegrationMode = "automatic" | "manual";

export function IntegrationModeBadge({ mode }: { mode: IntegrationMode }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-normal",
        mode === "automatic"
          ? "bg-success/10 text-success border-success/25"
          : "bg-muted text-muted-foreground border-border",
      )}
    >
      {mode === "automatic" ? "Automatic" : "Manual"}
    </Badge>
  );
}

type ProfileStatus = "pending" | "active" | "suspended" | "draft";

const PROFILE_STYLES: Record<ProfileStatus, string> = {
  pending: "bg-warning/10 text-warning border-warning/25",
  active: "bg-success/10 text-success border-success/25",
  suspended: "bg-destructive/10 text-destructive border-destructive/25",
  draft: "bg-muted text-muted-foreground border-border",
};

export function ProfileStatusBadge({ status }: { status: ProfileStatus }) {
  return (
    <Badge variant="outline" className={cn("font-normal", PROFILE_STYLES[status])}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

type TxnType = "credit" | "debit" | "adjustment";

const TXN_STYLES: Record<TxnType, string> = {
  credit: "bg-success/10 text-success border-success/25",
  debit: "bg-destructive/10 text-destructive border-destructive/25",
  adjustment: "bg-info/10 text-info border-info/25",
};

export function TxnTypeBadge({ type }: { type: TxnType }) {
  return (
    <Badge variant="outline" className={cn("font-normal", TXN_STYLES[type])}>
      {type.charAt(0).toUpperCase() + type.slice(1)}
    </Badge>
  );
}

type ProvisioningStatus = "not_started" | "in_progress" | "complete" | "failed";

const PROVISIONING_STYLES: Record<ProvisioningStatus, string> = {
  not_started: "bg-muted text-muted-foreground border-border",
  in_progress: "bg-warning/10 text-warning border-warning/25",
  complete: "bg-success/10 text-success border-success/25",
  failed: "bg-destructive/10 text-destructive border-destructive/25",
};

const PROVISIONING_LABELS: Record<ProvisioningStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  complete: "Complete",
  failed: "Failed",
};

export function ProvisioningBadge({ status }: { status: ProvisioningStatus }) {
  return (
    <Badge variant="outline" className={cn("font-normal", PROVISIONING_STYLES[status])}>
      {PROVISIONING_LABELS[status]}
    </Badge>
  );
}
