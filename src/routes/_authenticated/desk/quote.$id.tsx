import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Chip, PanelHeader } from "@/components/admin-ui";
import { QuoteThread } from "@/components/quote-thread";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { defaultImportTax, PASSTHROUGH_NOTE, sourcingFee } from "@/lib/pricing";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { friendlyError } from "@/lib/errors";
import { formatUSD } from "@/lib/format";
import {
  sourcingGetQuote,
  sourcingRequestProductDetails,
  sourcingSaveLines,
} from "@/lib/sourcing.functions";
import { sourcingSaveLinesSchema } from "@/lib/schemas";

export const Route = createFileRoute("/_authenticated/desk/quote/$id")({
  head: () => ({
    meta: [
      { title: "Source a request — FlySales" },
      {
        name: "description",
        content: "Enter the supplier, the supplier unit price, MOQ and production lead time.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DeskQuotePage,
});

type LineDraft = {
  id?: string;
  variant_label: string;
  country_code: string;
  supplier_name: string;
  supplier_unit_price: string;
  supplier_shipping: string;
  supplier_tax: string;
  moq: string;
  production_lead_days: string;
  sourcing_notes: string;
};

const emptyLine = (country: string): LineDraft => ({
  variant_label: "",
  country_code: country,
  supplier_name: "",
  supplier_unit_price: "",
  supplier_shipping: "",
  supplier_tax: String(defaultImportTax(country)),
  moq: "",
  production_lead_days: "",
  sourcing_notes: "",
});

function DeskQuotePage() {
  const { id } = useParams({ from: "/_authenticated/desk/quote/$id" });
  const fetchQuote = useServerFn(sourcingGetQuote);
  const callSave = useServerFn(sourcingSaveLines);
  const queryClient = useQueryClient();

  const { data, isPending } = useQuery({
    queryKey: ["sourcing-quote", id],
    queryFn: () => fetchQuote({ data: { quote_id: id } }),
  });

  const [lines, setLines] = useState<LineDraft[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!data || loaded) return;
    const country = data.quote.target_countries?.[0] ?? "US";
    setLines(
      data.lines.length
        ? data.lines.map((l) => ({
            id: l.id,
            variant_label: l.variant_label ?? "",
            country_code: l.country_code ?? country,
            supplier_name: l.supplier_name ?? "",
            supplier_unit_price:
              l.supplier_cogs != null
                ? String(l.supplier_cogs)
                : l.supplier_unit_price != null
                  ? String(l.supplier_unit_price)
                  : "",
            supplier_shipping: l.supplier_shipping != null ? String(l.supplier_shipping) : "0",
            supplier_tax:
              l.supplier_tax != null
                ? String(l.supplier_tax)
                : String(defaultImportTax(l.country_code ?? country)),
            moq: l.moq != null ? String(l.moq) : "",
            production_lead_days:
              l.production_lead_days != null ? String(l.production_lead_days) : "",
            sourcing_notes: l.sourcing_notes ?? "",
          }))
        : [emptyLine(country)],
    );
    setLoaded(true);
  }, [data, loaded]);

  const feeRate = data?.feeRate ?? 0;

  const setField = (index: number, key: keyof LineDraft, value: string) =>
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [key]: value } : l)));

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        quote_id: id,
        lines: lines.map((l) => ({
          ...(l.id ? { id: l.id } : {}),
          variant_label: l.variant_label,
          country_code: l.country_code,
          supplier_name: l.supplier_name,
          supplier_unit_price: Number(l.supplier_unit_price),
          supplier_shipping: Number(l.supplier_shipping || 0),
          supplier_tax: Number(l.supplier_tax || 0),
          moq: Number(l.moq),
          production_lead_days: Number(l.production_lead_days),
          sourcing_notes: l.sourcing_notes,
        })),
      };
      const parsed = sourcingSaveLinesSchema.safeParse(payload);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check your input");
      return callSave({ data: parsed.data });
    },
    onSuccess: async () => {
      toast.success("Sent to FlySales for pricing.");
      await queryClient.invalidateQueries({ queryKey: ["sourcing-quote", id] });
      await queryClient.invalidateQueries({ queryKey: ["sourcing-queue"] });
    },
    onError: (e) => toast.error(friendlyError(e, "Your sourcing was not saved.")),
  });

  const askDetails = useMutation({
    mutationFn: () => callAskDetails({ data: { quote_id: id } }),
    onSuccess: () => toast.success("The FlySales team will send you more details."),
    onError: (e) => toast.error(friendlyError(e, "Your request was not sent.")),
  });

  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Request not found.</p>;

  // The client's own request images plus anything we scraped and stored.
  const photos = [
    ...new Set([...(data.quote.image_urls ?? []), ...(data.preview?.image_urls ?? [])]),
  ];


  const totalFee = lines.reduce(
    (sum, l) =>
      sum +
      sourcingFee(Number(l.supplier_unit_price) || 0, Number(l.supplier_shipping) || 0, feeRate),
    0,
  );

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link to="/desk/queue">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to queue
        </Link>
      </Button>

      <PageHeader
        title={data.quote.product_name || "Sourcing request"}
        description="Enter what the supplier charges. Your fee is added on top automatically — you never see or set the client price."
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {lines.map((line, index) => {
            const fee = sourcingFee(
              Number(line.supplier_unit_price) || 0,
              Number(line.supplier_shipping) || 0,
              feeRate,
            );
            return (
              <Card key={line.id ?? `new-${index}`}>
                <CardContent className="space-y-3 pt-5">
                  <div className="flex items-center justify-between">
                    <PanelHeader title={`Variant ${index + 1}`} />
                    {lines.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Variant</Label>
                      <Input
                        value={line.variant_label}
                        placeholder="Black / Large"
                        onChange={(e) => setField(index, "variant_label", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Destination country</Label>
                      <Input
                        value={line.country_code}
                        maxLength={2}
                        placeholder="US"
                        onChange={(e) =>
                          setField(index, "country_code", e.target.value.toUpperCase())
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Supplier</Label>
                      <Input
                        value={line.supplier_name}
                        placeholder="Supplier name"
                        onChange={(e) => setField(index, "supplier_name", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>COGS (EXW) — supplier unit price (USD)</Label>
                      <Input
                        inputMode="decimal"
                        value={line.supplier_unit_price}
                        placeholder="4.20"
                        onChange={(e) => setField(index, "supplier_unit_price", e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Supplier unit price Ex Works — excludes all freight. Per-order shipping goes
                        in Ship; bulk freight is quoted on the purchase.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Supplier shipping per unit (USD)</Label>
                      <Input
                        inputMode="decimal"
                        value={line.supplier_shipping}
                        placeholder="0.00"
                        onChange={(e) => setField(index, "supplier_shipping", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>IOSS / import per unit (USD)</Label>
                      <Input
                        inputMode="decimal"
                        value={line.supplier_tax}
                        placeholder="3.50"
                        onChange={(e) => setField(index, "supplier_tax", e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">{PASSTHROUGH_NOTE}</p>
                    </div>

                    <div className="space-y-1.5">
                      <Label>MOQ</Label>
                      <Input
                        inputMode="numeric"
                        value={line.moq}
                        placeholder="100"
                        onChange={(e) => setField(index, "moq", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Production lead time (days)</Label>
                      <Input
                        inputMode="numeric"
                        value={line.production_lead_days}
                        placeholder="12"
                        onChange={(e) => setField(index, "production_lead_days", e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Notes for FlySales</Label>
                    <Textarea
                      rows={2}
                      value={line.sourcing_notes}
                      placeholder="Packaging, certifications, sample status…"
                      onChange={(e) => setField(index, "sourcing_notes", e.target.value)}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Your fee on this variant:{" "}
                    <span className="font-medium text-foreground">{formatUSD(fee)}</span> per unit
                  </p>
                </CardContent>
              </Card>
            );
          })}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setLines((prev) => [...prev, emptyLine(data.quote.target_countries?.[0] ?? "US")])
            }
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Add variant
          </Button>
        </div>

        <div className="space-y-3">
          <Card>
            <CardContent className="space-y-2 pt-5 text-sm">
              <PanelHeader title="The request" />
              <p className="text-sm font-medium">{data.quote.product_name || "Product request"}</p>
              {data.quote.product_url ? (
                <p className="break-all text-xs text-muted-foreground">{data.quote.product_url}</p>
              ) : null}
              {data.quote.notes ? (
                <p className="text-muted-foreground">{data.quote.notes}</p>
              ) : null}
              {(data.preview?.variants ?? []).length ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {(data.preview?.variants ?? []).slice(0, 12).map((v) => (
                    <Chip key={v}>{v}</Chip>
                  ))}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {(data.quote.target_countries ?? []).map((c) => (
                  <Chip key={c}>{c}</Chip>
                ))}
              </div>
              {data.quote.target_monthly_volume ? (
                <p className="text-xs text-muted-foreground">
                  Target volume: {data.quote.target_monthly_volume} units / month
                </p>
              ) : null}
              {photos.length ? (
                <div className="grid grid-cols-3 gap-1.5 pt-2">
                  {photos.slice(0, 9).map((url) => (
                    <img
                      key={url}
                      src={url}
                      alt={data.quote.product_name ?? "Product reference"}
                      loading="lazy"
                      className="aspect-square w-full rounded-md border border-border object-cover"
                    />
                  ))}
                </div>
              ) : null}
              {data.essentialsOnly ? (
                <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">
                    Source from the photos and specs — original listing withheld for privacy.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={!data.quote.assigned_sourcer || askDetails.isPending}
                    onClick={() => askDetails.mutate()}
                  >
                    {askDetails.isPending ? "Sending…" : "Need more product details"}
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    This goes to the FlySales team, not the client.
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>


          <Card>
            <CardContent className="space-y-2 pt-5">
              <PanelHeader title="Your commission" />
              <p className="text-2xl font-semibold tnum">{formatUSD(totalFee)}</p>
              <p className="text-xs text-muted-foreground">
                Per unit across {lines.length} variant{lines.length === 1 ? "" : "s"}, at{" "}
                {(feeRate * 100).toFixed(1)}%. It is paid out on units the client actually buys.
              </p>
              <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? "Saving…" : "Submit sourcing"}
              </Button>
            </CardContent>
          </Card>

          {/* The client's thread, with the client masked. No final prices here. */}
          {data.quote.assigned_sourcer ? (
            <QuoteThread quoteId={id} mode="sourcing" className="h-[32rem]" />
          ) : (
            <Card>
              <CardContent className="pt-5 text-sm text-muted-foreground">
                Submit your sourcing to take this request — the client conversation opens once it is
                assigned to you.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
