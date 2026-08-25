import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { getCurrentStoreId } from "@/components/store-switcher";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  validateAddressFields,
  type AddressFields,
} from "@/lib/address";
import { COUNTRIES } from "@/lib/countries";
import { formatUSD } from "@/lib/format";
import { createMyManualOrder, listMyCatalogue } from "@/lib/orders.functions";
import { useMyContext } from "../../_client";
import { friendlyError } from "@/lib/errors";

export const Route = createFileRoute("/_authenticated/_client/orders/new")({
  head: () => ({
    meta: [
      { title: "Create order — FlySales" },
      { name: "description", content: "Create a manual order from your workspace catalogue." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NewOrderPage,
});

const EMPTY_ADDRESS: AddressFields = {
  name: "",
  email: "",
  phone: "",
  address1: "",
  address2: "",
  city: "",
  postal_code: "",
  state: "",
  country: "",
};

function NewOrderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const callCatalogue = useServerFn(listMyCatalogue);
  const callCreate = useServerFn(createMyManualOrder);
  const { data: ctx } = useMyContext();

  // Resolve the workspace from the switcher's persisted selection.
  const [storeId, setStoreId] = useState<string | null>(null);
  useEffect(() => {
    setStoreId(getCurrentStoreId());
  }, []);
  const allStores = ctx?.entities?.flatMap((e) => e.stores) ?? [];
  const store = allStores.find((s) => s.id === storeId) ?? allStores[0] ?? null;

  const { data: catalogue, isPending } = useQuery({
    queryKey: ["my-catalogue", store?.id],
    enabled: Boolean(store?.id),
    queryFn: () => callCatalogue({ data: { store_id: store!.id } }),
  });

  const [address, setAddress] = useState<AddressFields>(EMPTY_ADDRESS);
  const [reference, setReference] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof AddressFields, string>>>({});
  const [busy, setBusy] = useState(false);

  const setAddr = (key: keyof AddressFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setAddress((s) => ({ ...s, [key]: e.target.value }));

  // Price lookup: simple products from product_country_prices, bundles from
  // the bundle_prices view (effective price, override included).
  const priceFor = useMemo(() => {
    const country = address.country.trim().toUpperCase();
    const simple = new Map(
      (catalogue?.countryPrices ?? [])
        .filter((p) => p.country_code === country)
        .map((p) => [p.product_id, Number(p.unit_price)] as const),
    );
    const bundle = new Map(
      (catalogue?.bundlePrices ?? [])
        .filter((p) => p.country_code === country)
        .map((p) => [p.bundle_product_id, Number(p.effective_price)] as const),
    );
    return (productId: string, type: string): number | null => {
      if (!country) return null;
      return type === "bundle" ? (bundle.get(productId) ?? null) : (simple.get(productId) ?? null);
    };
  }, [catalogue, address.country]);

  const chosen = (catalogue?.products ?? []).filter((p) => (quantities[p.id] ?? 0) > 0);
  const total = chosen.reduce((acc, p) => {
    const price = priceFor(p.id, p.product_type);
    return acc + (price ?? 0) * (quantities[p.id] ?? 0);
  }, 0);
  const allPriced = chosen.every((p) => priceFor(p.id, p.product_type) != null);

  function bump(productId: string, delta: number) {
    setQuantities((prev) => {
      const next = Math.max(0, (prev[productId] ?? 0) + delta);
      return { ...prev, [productId]: next };
    });
  }

  async function submitOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!store) return;
    const errors = validateAddressFields(address);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error("Fix the highlighted address fields.");
      return;
    }
    if (chosen.length === 0) {
      toast.error("Add at least one product.");
      return;
    }
    if (!allPriced) {
      toast.error("Some products have no price for this destination country.");
      return;
    }
    setBusy(true);
    try {
      const result = await callCreate({
        data: {
          store_id: store.id,
          client_reference: reference,
          customer: { name: address.name, email: address.email, phone: address.phone },
          address: {
            address1: address.address1,
            address2: address.address2,
            city: address.city,
            postal_code: address.postal_code,
            state: address.state,
            country: address.country.trim().toUpperCase(),
          },
          lines: chosen.map((p) => ({ sku: p.sku, quantity: quantities[p.id] ?? 1 })),
        },
      });
      toast.success(
        result.order.status === "paid"
          ? `Order ${result.order.external_order_number} created and paid from your wallet.`
          : `Order ${result.order.external_order_number} created. It is awaiting payment.`,
      );
      await queryClient.invalidateQueries({ queryKey: ["my-orders"] });
      await queryClient.invalidateQueries({ queryKey: ["my-wallet"] });
      await navigate({ to: "/orders/$id", params: { id: result.order.id } });
    } catch (err) {
      toast.error(friendlyError(err, "The order was not created and your wallet was not debited."));
    } finally {
      setBusy(false);
    }
  }

  if (!store) {
    return (
      <EmptyWorkspace />
    );
  }

  return (
    <div className="max-w-3xl">
      <Link
        to="/orders"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All orders
      </Link>
      <PageHeader
        title="Create order"
        description={`Manual order in ${store.store_name ?? "your workspace"}, priced from your catalogue and paid from your wallet when the balance covers the total.`}
      />

      <form onSubmit={submitOrder} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Customer &amp; delivery</CardTitle>
            <CardDescription>
              Addresses are validated strictly — a bad address means a lost parcel.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name *" error={fieldErrors.name}>
              <Input value={address.name} onChange={setAddr("name")} />
            </Field>
            <Field label="Email *" error={fieldErrors.email}>
              <Input type="email" value={address.email} onChange={setAddr("email")} />
            </Field>
            <Field label="Phone (intl. format) *" error={fieldErrors.phone}>
              <Input placeholder="+14155552671" value={address.phone} onChange={setAddr("phone")} />
            </Field>
            <Field label="Your reference">
              <Input
                placeholder="e.g. Shopify #1001"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
            <Field label="Address line 1 *" error={fieldErrors.address1}>
              <Input value={address.address1} onChange={setAddr("address1")} />
            </Field>
            <Field label="Address line 2">
              <Input value={address.address2} onChange={setAddr("address2")} />
            </Field>
            <Field label="City *" error={fieldErrors.city}>
              <Input value={address.city} onChange={setAddr("city")} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Postal code" error={fieldErrors.postal_code}>
                <Input value={address.postal_code} onChange={setAddr("postal_code")} />
              </Field>
              <Field label="State / province" error={fieldErrors.state}>
                <Input value={address.state} onChange={setAddr("state")} />
              </Field>
            </div>
            <Field label="Country *" error={fieldErrors.country}>
              <Select
                value={address.country}
                onValueChange={(v) => setAddress((s) => ({ ...s, country: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select country" />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Products</CardTitle>
            <CardDescription>
              {address.country
                ? "Prices shown for the destination country. Unpriced items can't be ordered there."
                : "Pick a destination country above to see prices."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {isPending ? (
              <p className="text-sm text-muted-foreground">Loading catalogue…</p>
            ) : (catalogue?.products ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active products in this workspace yet — accept quote lines to build your
                catalogue first.
              </p>
            ) : (
              (catalogue?.products ?? []).map((p) => {
                const price = priceFor(p.id, p.product_type);
                const qty = quantities[p.id] ?? 0;
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 rounded-xl border border-border px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {p.product_name}
                        {p.variant_label ? ` — ${p.variant_label}` : ""}
                      </p>
                      <p className="tnum text-xs text-muted-foreground">
                        {p.sku}
                        {p.product_type === "bundle" ? " · bundle" : ""}
                        {p.moq ? ` · MOQ ${p.moq}` : ""}
                      </p>
                    </div>
                    <span className="tnum w-20 text-right text-sm">
                      {price != null ? formatUSD(price) : "—"}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        aria-label={`Remove one ${p.sku}`}
                        onClick={() => bump(p.id, -1)}
                        disabled={qty === 0}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="tnum w-8 text-center text-sm">{qty}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        aria-label={`Add one ${p.sku}`}
                        onClick={() => bump(p.id, 1)}
                        disabled={price == null}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-4">
          <div>
            <p className="text-sm font-semibold">
              {chosen.length} line{chosen.length === 1 ? "" : "s"}
            </p>
            <p className="tnum text-xs text-muted-foreground">Total {formatUSD(total)}</p>
          </div>
          <Button type="submit" disabled={busy || chosen.length === 0 || !allPriced}>
            {busy ? "Creating…" : "Create order"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function EmptyWorkspace() {
  return (
    <div className="max-w-2xl">
      <PageHeader title="Create order" />
      <Card>
        <CardContent className="p-8 text-sm text-muted-foreground">
          You need a workspace first. <Link to="/workspaces/new" className="text-primary underline">Add one</Link>{" "}
          — or subscribe on the <Link to="/billing" className="text-primary underline">Billing page</Link>{" "}
          and a workspace is created for you.
        </CardContent>
      </Card>
    </div>
  );
}
