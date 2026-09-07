import * as React from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { adminCreateClient, adminUpdateEntityFiscal } from "@/lib/profiles.functions";
import { adminCreateClientSchema, entityDetailsSchema } from "@/lib/schemas";

export interface FiscalEntity {
  id: string;
  legal_name: string;
  country: string | null;
  vat_number: string | null;
  tax_id?: string | null;
  address?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  postal_code?: string | null;
  city?: string | null;
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  required,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Admin: edit a client company's fiscal identity used on receipts. */
export function EditFiscalDetailsDialog({
  entity,
  open,
  onOpenChange,
  onSaved,
}: {
  entity: FiscalEntity;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const callUpdate = useServerFn(adminUpdateEntityFiscal);
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    legal_name: entity.legal_name ?? "",
    country: entity.country ?? "",
    vat_number: entity.vat_number ?? "",
    tax_id: entity.tax_id ?? "",
    address_line1: entity.address_line1 ?? "",
    address_line2: entity.address_line2 ?? "",
    postal_code: entity.postal_code ?? "",
    city: entity.city ?? "",
    address: entity.address ?? "",
  });
  const set = (key: keyof typeof form) => (v: string) => setForm((s) => ({ ...s, [key]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = entityDetailsSchema.safeParse({ entity_id: entity.id, ...form });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the fields");
      return;
    }
    setBusy(true);
    try {
      await callUpdate({ data: parsed.data });
      toast.success("Fiscal details saved");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the fiscal details");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit fiscal details</DialogTitle>
          <DialogDescription>
            These fields appear in the billed-to block of new payment receipts.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <Field
            id="fd-legal"
            label="Legal name"
            required
            value={form.legal_name}
            onChange={set("legal_name")}
            className="sm:col-span-2"
          />
          <Field id="fd-tax" label="Tax ID (NIF / VAT / EIN)" value={form.tax_id} onChange={set("tax_id")} />
          <Field id="fd-vat" label="VAT number" value={form.vat_number} onChange={set("vat_number")} />
          <Field
            id="fd-addr1"
            label="Registered address"
            placeholder="Street and number"
            value={form.address_line1}
            onChange={set("address_line1")}
            className="sm:col-span-2"
          />
          <Field
            id="fd-addr2"
            label="Address line 2"
            placeholder="Apartment, floor, unit"
            value={form.address_line2}
            onChange={set("address_line2")}
            className="sm:col-span-2"
          />
          <Field id="fd-postal" label="Postal code" value={form.postal_code} onChange={set("postal_code")} />
          <Field id="fd-city" label="City" value={form.city} onChange={set("city")} />
          <Field
            id="fd-country"
            label="Country"
            required
            value={form.country}
            onChange={set("country")}
          />
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save fiscal details"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Admin: create account + company + first workspace for an off-platform client. */
export function AddClientDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const callCreate = useServerFn(adminCreateClient);
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    email: "",
    contact_name: "",
    phone: "",
    legal_name: "",
    country: "",
    vat_number: "",
    tax_id: "",
    address_line1: "",
    address_line2: "",
    postal_code: "",
    city: "",
    store_name: "",
    store_url: "",
  });
  const [platform, setPlatform] = React.useState<"shopify" | "woocommerce" | "other">("shopify");
  const [mode, setMode] = React.useState<"automatic" | "manual">("manual");
  const [sendInvite, setSendInvite] = React.useState(true);
  const set = (key: keyof typeof form) => (v: string) => setForm((s) => ({ ...s, [key]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = adminCreateClientSchema.safeParse({
      ...form,
      platform,
      integration_mode: mode,
      send_invite: sendInvite,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the fields");
      return;
    }
    setBusy(true);
    try {
      await callCreate({ data: parsed.data });
      toast.success(
        sendInvite ? "Client created — invite email sent" : "Client created",
      );
      onCreated();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the client");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add client manually</DialogTitle>
          <DialogDescription>
            Creates the account, the company and a first workspace. The client gets an invite email
            to set their password and take over.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground sm:col-span-2">
            Account
          </p>
          <Field id="ac-email" label="Email" required value={form.email} onChange={set("email")} />
          <Field
            id="ac-contact"
            label="Contact name"
            required
            value={form.contact_name}
            onChange={set("contact_name")}
          />
          <Field id="ac-phone" label="Phone" value={form.phone} onChange={set("phone")} />
          <div className="flex items-center gap-3 pt-6">
            <Switch id="ac-invite" checked={sendInvite} onCheckedChange={setSendInvite} />
            <Label htmlFor="ac-invite">Send invite email</Label>
          </div>

          <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:col-span-2">
            Company
          </p>
          <Field
            id="ac-legal"
            label="Legal name"
            required
            value={form.legal_name}
            onChange={set("legal_name")}
            className="sm:col-span-2"
          />
          <Field id="ac-tax" label="Tax ID (NIF / VAT / EIN)" value={form.tax_id} onChange={set("tax_id")} />
          <Field id="ac-vat" label="VAT number" value={form.vat_number} onChange={set("vat_number")} />
          <Field
            id="ac-addr1"
            label="Registered address"
            placeholder="Street and number"
            value={form.address_line1}
            onChange={set("address_line1")}
            className="sm:col-span-2"
          />
          <Field
            id="ac-addr2"
            label="Address line 2"
            value={form.address_line2}
            onChange={set("address_line2")}
            className="sm:col-span-2"
          />
          <Field id="ac-postal" label="Postal code" value={form.postal_code} onChange={set("postal_code")} />
          <Field id="ac-city" label="City" value={form.city} onChange={set("city")} />
          <Field
            id="ac-country"
            label="Country"
            required
            value={form.country}
            onChange={set("country")}
            className="sm:col-span-2"
          />

          <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:col-span-2">
            First workspace
          </p>
          <Field
            id="ac-store"
            label="Workspace name"
            required
            value={form.store_name}
            onChange={set("store_name")}
          />
          <Field
            id="ac-url"
            label="Store URL"
            placeholder="client-shop.myshopify.com"
            value={form.store_url}
            onChange={set("store_url")}
          />
          <div className="space-y-1.5">
            <Label>Platform</Label>
            <Select value={platform} onValueChange={(v) => setPlatform(v as typeof platform)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shopify">Shopify</SelectItem>
                <SelectItem value="woocommerce">WooCommerce</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Integration mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="automatic">Automatic</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
