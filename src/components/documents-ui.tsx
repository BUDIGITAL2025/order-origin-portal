import * as React from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getDocumentDownloadUrl } from "@/lib/documents.functions";

// ---------- Badges ----------

export type DocumentType = "order_receipt" | "wallet_topup" | "subscription";

const DOC_STYLES: Record<DocumentType, string> = {
  order_receipt: "bg-info/10 text-info border-info/25",
  wallet_topup: "bg-success/10 text-success border-success/25",
  subscription: "bg-warning/10 text-warning border-warning/25",
};

const DOC_LABELS: Record<DocumentType, string> = {
  order_receipt: "Order receipt",
  wallet_topup: "Wallet top-up",
  subscription: "Subscription",
};

export function DocumentTypeBadge({ type }: { type: DocumentType }) {
  return (
    <Badge variant="outline" className={cn("font-normal", DOC_STYLES[type])}>
      {DOC_LABELS[type]}
    </Badge>
  );
}

export type OrderStatus =
  | "awaiting_payment"
  | "paid"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "needs_review";

const ORDER_STYLES: Record<OrderStatus, string> = {
  awaiting_payment: "bg-warning/10 text-warning border-warning/25",
  paid: "bg-success/10 text-success border-success/25",
  processing: "bg-info/10 text-info border-info/25",
  shipped: "bg-success/10 text-success border-success/25",
  delivered: "bg-success/10 text-success border-success/25",
  cancelled: "bg-destructive/10 text-destructive border-destructive/25",
  needs_review: "bg-warning/10 text-warning border-warning/25",
};

const ORDER_LABELS: Record<OrderStatus, string> = {
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  needs_review: "Needs review",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge variant="outline" className={cn("font-normal", ORDER_STYLES[status])}>
      {ORDER_LABELS[status]}
    </Badge>
  );
}

// ---------- Download ----------

/**
 * Fetches a short-lived signed URL for the receipt PDF and opens it in a
 * new tab. The bucket is private — links expire after 60 seconds.
 */
export function useDocumentDownload() {
  const getUrl = useServerFn(getDocumentDownloadUrl);
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);

  const download = React.useCallback(
    async (id: string) => {
      setDownloadingId(id);
      try {
        const { url } = await getUrl({ data: { id } });
        window.open(url, "_blank", "noopener");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not download the receipt");
      } finally {
        setDownloadingId(null);
      }
    },
    [getUrl],
  );

  return { download, downloadingId };
}

export function DocumentDownloadButton({ id, label }: { id: string; label?: string }) {
  const { download, downloadingId } = useDocumentDownload();
  const busy = downloadingId === id;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => void download(id)}
      disabled={busy}
      className="gap-1.5"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
      {label ?? "Receipt"}
    </Button>
  );
}
