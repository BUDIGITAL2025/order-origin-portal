/**
 * Delete / archive row actions for the admin console.
 *
 * The delete dialog never guesses: it asks the server what would be removed
 * and refuses with the exact money trail when a hard delete is not allowed,
 * offering archive instead.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { RowAction } from "@/components/admin-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { adminCleanupCheck, adminCleanupDelete, adminSetArchived } from "@/lib/cleanup.functions";

export type CleanupType = "quote" | "product" | "order" | "stock_purchase" | "inbound" | "account";

const TYPE_LABEL: Record<CleanupType, string> = {
  quote: "quote request",
  product: "product",
  order: "order",
  stock_purchase: "stock purchase",
  inbound: "inbound shipment",
  account: "account",
};

export function CleanupRowActions({
  type,
  id,
  name,
  archived,
  /** Query keys to refresh after the action. */
  invalidateKeys,
  /** Orders are never deletable — hide the trash entirely. */
  deletable = true,
}: {
  type: CleanupType;
  id: string;
  name: string;
  archived: boolean;
  invalidateKeys: unknown[][];
  deletable?: boolean | undefined;
}) {
  const queryClient = useQueryClient();
  const callArchive = useServerFn(adminSetArchived);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const refresh = () => {
    for (const key of invalidateKeys) void queryClient.invalidateQueries({ queryKey: key });
  };

  const archive = useMutation({
    mutationFn: (next: boolean) => callArchive({ data: { type, id, archived: next } }),
    onSuccess: (_r, next) => {
      toast.success(next ? "Archived." : "Restored.");
      refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <RowAction
        label={archived ? "Restore" : "Archive"}
        icon={archived ? ArchiveRestore : Archive}
        disabled={archive.isPending}
        onClick={() => archive.mutate(!archived)}
      />
      {deletable && (
        <RowAction
          label="Delete permanently"
          icon={Trash2}
          tone="danger"
          onClick={() => setConfirmOpen(true)}
        />
      )}
      <DeleteDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        type={type}
        id={id}
        name={name}
        onDone={refresh}
        onArchive={() => archive.mutate(true)}
      />
    </>
  );
}

function DeleteDialog({
  open,
  onOpenChange,
  type,
  id,
  name,
  onDone,
  onArchive,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  type: CleanupType;
  id: string;
  name: string;
  onDone: () => void;
  onArchive: () => void;
}) {
  const check = useServerFn(adminCleanupCheck);
  const del = useServerFn(adminCleanupDelete);

  const { data, isPending } = useQuery({
    queryKey: ["cleanup-check", type, id],
    enabled: open,
    queryFn: () => check({ data: { type, id } }),
  });

  const remove = useMutation({
    mutationFn: () => del({ data: { type, id } }),
    onSuccess: () => {
      toast.success(`Deleted ${TYPE_LABEL[type]}.`);
      onOpenChange(false);
      onDone();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {TYPE_LABEL[type]}</DialogTitle>
          <DialogDescription>{name} — this cannot be undone.</DialogDescription>
        </DialogHeader>

        {isPending ? (
          <p className="text-sm text-muted-foreground">Checking what this would remove…</p>
        ) : data?.deletable ? (
          <div className="space-y-2 text-sm">
            <p>Permanently removes:</p>
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              <li>
                The {TYPE_LABEL[type]} <span className="text-foreground">{data.label}</span>
              </li>
              {data.cascade
                .filter((c) => c.count > 0)
                .map((c) => (
                  <li key={c.label}>
                    {c.label}: {c.count}
                  </li>
                ))}
            </ul>
            <p className="text-xs text-muted-foreground">A line is written to the audit trail.</p>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="font-medium text-destructive">
              This has financial history and can only be archived.
            </p>
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              {(data?.blockers ?? []).map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {data && !data.deletable && (
            <Button
              variant="secondary"
              onClick={() => {
                onArchive();
                onOpenChange(false);
              }}
            >
              Archive instead
            </Button>
          )}
          {data?.deletable && (
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? "Deleting…" : "Delete permanently"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Show archived" toggle shared by the admin tables. */
export function ShowArchivedToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Button
      variant={value ? "secondary" : "outline"}
      size="sm"
      className="h-9 rounded-full text-[13px]"
      onClick={() => onChange(!value)}
    >
      <Archive className="mr-1.5 h-3.5 w-3.5" />
      {value ? "Hiding nothing" : "Show archived"}
    </Button>
  );
}
