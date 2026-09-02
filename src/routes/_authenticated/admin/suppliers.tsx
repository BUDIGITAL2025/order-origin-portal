import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import {
  AdminSearch,
  Chip,
  EmptyCell,
  RowAction,
  RowActions,
  SummaryBar,
  TableShell,
  ToolBar,
  Value,
} from "@/components/admin-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { listSuppliers, saveSupplier } from "@/lib/inventory.functions";
import { friendlyError } from "@/lib/errors";

export const Route = createFileRoute("/_authenticated/admin/suppliers")({
  head: () => ({
    meta: [
      { title: "Suppliers — FlySales admin" },
      { name: "description", content: "Suppliers and their default production and transit lead times." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SuppliersPage,
});

type Draft = {
  id?: string;
  name: string;
  notes: string;
  production: number;
  transit: number;
  active: boolean;
};

const EMPTY: Draft = { name: "", notes: "", production: 14, transit: 10, active: true };

function SuppliersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);

  const fetchSuppliers = useServerFn(listSuppliers);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-suppliers"],
    queryFn: () => fetchSuppliers(),
  });

  const callSave = useServerFn(saveSupplier);
  const save = useMutation({
    mutationFn: (d: Draft) =>
      callSave({
        data: {
          ...(d.id ? { id: d.id } : {}),
          name: d.name,
          notes: d.notes || null,
          default_production_lead_days: d.production,
          default_transit_lead_days: d.transit,
          active: d.active,
        },
      }),
    onSuccess: () => {
      toast.success("Supplier saved. Linked SKUs pick up the new defaults immediately.");
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-suppliers"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-inventory"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const suppliers = data?.suppliers ?? [];
  const term = search.trim().toLowerCase();
  const visible = suppliers.filter((s) => !term || s.name.toLowerCase().includes(term));

  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Internal only. Clients never see supplier names — only the resolved lead times."
        actions={
          <Button size="sm" className="rounded-full" onClick={() => setDraft({ ...EMPTY })}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New supplier
          </Button>
        }
      />

      <SummaryBar
        items={[
          { key: "total", label: "Suppliers", value: suppliers.length },
          {
            key: "active",
            label: "Active",
            value: suppliers.filter((s) => s.active).length,
            tone: "success",
          },
          {
            key: "linked",
            label: "SKUs linked",
            value: suppliers.reduce((sum, s) => sum + s.linked_skus, 0),
          },
        ]}
      />

      <ToolBar>
        <AdminSearch value={search} onChange={setSearch} placeholder="Search suppliers" />
      </ToolBar>

      {isLoading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Loading suppliers…</CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No suppliers yet. Add one so its lead times can cascade to every SKU you link to it.
          </CardContent>
        </Card>
      ) : (
        <TableShell>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Supplier</th>
                <th className="px-3 py-2 text-right font-medium">Production</th>
                <th className="px-3 py-2 text-right font-medium">Transit</th>
                <th className="px-3 py-2 text-right font-medium">SKUs</th>
                <th className="px-3 py-2 font-medium">Notes</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="px-3 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-medium">{s.name}</td>
                  <td className="tnum px-3 py-2 text-right">{s.default_production_lead_days}d</td>
                  <td className="tnum px-3 py-2 text-right">{s.default_transit_lead_days}d</td>
                  <td className="tnum px-3 py-2 text-right">
                    {s.linked_skus > 0 ? s.linked_skus : <EmptyCell label="No SKUs linked" />}
                  </td>
                  <td className="max-w-[280px] truncate px-3 py-2 text-muted-foreground">
                    <Value>{s.notes}</Value>
                  </td>
                  <td className="px-3 py-2">
                    <Chip tone={s.active ? "success" : "neutral"}>
                      {s.active ? "Active" : "Inactive"}
                    </Chip>
                  </td>
                  <td className="px-3 py-2">
                    <RowActions>
                      <RowAction
                        label="Edit supplier"
                        icon={Pencil}
                        onClick={() =>
                          setDraft({
                            id: s.id,
                            name: s.name,
                            notes: s.notes ?? "",
                            production: s.default_production_lead_days ?? 14,
                            transit: s.default_transit_lead_days ?? 10,
                            active: s.active,
                          })
                        }
                      />
                    </RowActions>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      )}

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit supplier" : "New supplier"}</DialogTitle>
            <DialogDescription>
              These defaults apply to every SKU linked to this supplier, unless the product has its
              own override.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="s-name">Name</Label>
                <Input
                  id="s-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="s-prod">Production lead (days)</Label>
                  <Input
                    id="s-prod"
                    type="number"
                    min={0}
                    value={draft.production}
                    onChange={(e) => setDraft({ ...draft, production: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label htmlFor="s-transit">Transit lead (days)</Label>
                  <Input
                    id="s-transit"
                    type="number"
                    min={0}
                    value={draft.transit}
                    onChange={(e) => setDraft({ ...draft, transit: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="s-notes">Notes (internal)</Label>
                <Textarea
                  id="s-notes"
                  rows={3}
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="s-active"
                  checked={draft.active}
                  onCheckedChange={(v) => setDraft({ ...draft, active: v })}
                />
                <Label htmlFor="s-active">Active</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="rounded-full" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              className="rounded-full"
              disabled={save.isPending || !draft || draft.name.trim().length < 2}
              onClick={() => draft && save.mutate(draft)}
            >
              Save supplier
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
