/**
 * Catalog import — upload a supplier catalogue (PDF or image), read it with
 * AI, then review every row by hand next to the original page. Nothing is
 * created downstream until the admin explicitly converts selected rows.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Crop, FileUp, ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableShell } from "@/components/admin-ui";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/errors";
import {
  addCatalogRow,
  convertRowsToProducts,
  convertRowsToQuote,
  deleteCatalogRow,
  getCatalogImport,
  listWorkspacesForImport,
  startCatalogImport,
  updateCatalogRow,
} from "@/lib/catalog.functions";

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_PAGES = 10;

type Row = {
  id: string;
  page_no: number;
  row_ref: string | null;
  item_no: string | null;
  description: string | null;
  color: string | null;
  size_text: string | null;
  packaging: string | null;
  inner_qty: number | null;
  outer_qty: number | null;
  available_qty: number | null;
  weight_g: number | null;
  unit_price: number | null;
  bbox: unknown;
  low_confidence: string[];
  image_urls: string[];
  included: boolean;
  converted_quote_id: string | null;
  converted_product_id: string | null;
};

type NumField = "inner_qty" | "outer_qty" | "available_qty" | "weight_g" | "unit_price";
type TextField = "item_no" | "description" | "color" | "size_text" | "packaging";

/** Render one page of the source file to a canvas-backed data URL. */
async function renderPage(file: {
  url: string;
  mime: string;
  page: number;
}): Promise<HTMLCanvasElement | null> {
  if (file.mime !== "application/pdf") {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not load the image"));
      img.src = file.url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")?.drawImage(img, 0, 0);
    return canvas;
  }

  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const doc = await pdfjs.getDocument({ url: file.url }).promise;
  const page = await doc.getPage(Math.min(file.page, doc.numPages));
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas;
}

async function countPdfPages(file: File): Promise<number> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  return doc.numPages;
}

function Cell({
  value,
  amber,
  onSave,
  numeric,
}: {
  value: string;
  amber: boolean;
  numeric?: boolean;
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onSave(draft)}
      inputMode={numeric ? "decimal" : "text"}
      className={
        "h-8 border-transparent bg-transparent px-1 text-xs focus-visible:border-border " +
        (amber ? "bg-amber-500/10 ring-1 ring-amber-500/40" : "")
      }
    />
  );
}

export function CatalogImportPanel({
  importId,
  onOpenImport,
}: {
  importId: string | null;
  onOpenImport: (id: string | null) => void;
}) {
  const qc = useQueryClient();
  const start = useServerFn(startCatalogImport);
  const fetchImport = useServerFn(getCatalogImport);
  const fetchWorkspaces = useServerFn(listWorkspacesForImport);
  const patchRow = useServerFn(updateCatalogRow);
  const addRow = useServerFn(addCatalogRow);
  const removeRow = useServerFn(deleteCatalogRow);
  const toQuote = useServerFn(convertRowsToQuote);
  const toProducts = useServerFn(convertRowsToProducts);

  const [uploading, setUploading] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [mode, setMode] = React.useState<"single_product" | "product_per_row">("single_product");
  const [workspace, setWorkspace] = React.useState<string>("");
  const [productName, setProductName] = React.useState("");
  const [country, setCountry] = React.useState("US");
  const pageCanvas = React.useRef<HTMLCanvasElement | null>(null);
  const previewRef = React.useRef<HTMLDivElement | null>(null);

  const detail = useQuery({
    queryKey: ["catalog-import", importId],
    enabled: !!importId,
    queryFn: () => fetchImport({ data: { import_id: importId! } }),
    retry: false,
  });

  const workspaces = useQuery({
    queryKey: ["catalog-import-workspaces"],
    queryFn: () => fetchWorkspaces(),
    retry: false,
  });

  const rows = (detail.data?.rows ?? []) as unknown as Row[];
  const imp = detail.data?.import as
    | {
        file_name: string;
        mime_type: string;
        page_count: number;
        status: string;
        error: string | null;
        raw_response: string | null;
      }
    | undefined;
  const fileUrl = detail.data?.file_url ?? null;

  // Render the current page for the side-by-side preview and for crops.
  React.useEffect(() => {
    let cancelled = false;
    if (!fileUrl || !imp) return;
    void (async () => {
      try {
        const canvas = await renderPage({ url: fileUrl, mime: imp.mime_type, page });
        if (cancelled || !canvas) return;
        pageCanvas.current = canvas;
        const host = previewRef.current;
        if (host) {
          host.replaceChildren(canvas);
          canvas.style.width = "100%";
          canvas.style.height = "auto";
        }
      } catch {
        /* preview is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileUrl, imp, page]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["catalog-import", importId] });

  const save = useMutation({
    mutationFn: (vars: { row_id: string; patch: Record<string, unknown> }) =>
      patchRow({ data: vars as never }),
    onSuccess: refresh,
    onError: (e) => toast.error(friendlyError(e)),
  });

  async function upload(file: File) {
    if (file.size > MAX_BYTES) {
      toast.error("The file is larger than 15MB.");
      return;
    }
    const mime = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
    if (!["application/pdf", "image/jpeg", "image/jpg", "image/png", "image/webp"].includes(mime)) {
      toast.error("Upload a PDF, JPG or PNG.");
      return;
    }
    setUploading(true);
    try {
      let pages = 1;
      if (mime === "application/pdf") {
        pages = await countPdfPages(file);
        if (pages > MAX_PAGES) {
          toast.error(`This PDF has ${pages} pages — up to ${MAX_PAGES} per run.`);
          return;
        }
      }
      const { data: session } = await supabase.auth.getUser();
      const uid = session.user?.id;
      if (!uid) throw new Error("Sign in again to upload.");
      const path = `${uid}/catalog/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
      const { error } = await supabase.storage.from("quote-images").upload(path, file);
      if (error) throw new Error(error.message);
      const result = await start({
        data: {
          file_path: path,
          file_name: file.name,
          mime_type: mime as "application/pdf",
          page_count: pages,
        },
      });
      toast.success(
        result.rows ? `${result.rows} rows read — review them before converting.` : "No rows read.",
      );
      onOpenImport(result.import_id);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setUploading(false);
    }
  }

  async function uploadRowImage(rowId: string, blob: Blob, name: string) {
    const { data: session } = await supabase.auth.getUser();
    const uid = session.user?.id;
    if (!uid) throw new Error("Sign in again to upload.");
    const path = `${uid}/catalog/${crypto.randomUUID()}-${name}`;
    const { error } = await supabase.storage.from("quote-images").upload(path, blob);
    if (error) throw new Error(error.message);
    const row = rows.find((r) => r.id === rowId);
    await patchRow({
      data: {
        row_id: rowId,
        patch: { image_urls: [...(row?.image_urls ?? []), path].slice(0, 5) },
      },
    });
    void refresh();
  }

  async function cropRow(row: Row) {
    const box = row.bbox as { x: number; y: number; w: number; h: number } | null;
    const canvas = pageCanvas.current;
    if (!box || !canvas) {
      toast.error("No photo area detected for this row — upload one instead.");
      return;
    }
    if (row.page_no !== page) {
      toast.error(`Open page ${row.page_no} first, then crop.`);
      return;
    }
    const sx = Math.max(0, box.x * canvas.width);
    const sy = Math.max(0, box.y * canvas.height);
    const sw = Math.min(canvas.width - sx, box.w * canvas.width);
    const sh = Math.min(canvas.height - sy, box.h * canvas.height);
    if (sw < 8 || sh < 8) {
      toast.error("The detected photo area is too small — upload the photo instead.");
      return;
    }
    const out = document.createElement("canvas");
    out.width = Math.round(sw);
    out.height = Math.round(sh);
    out.getContext("2d")?.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
    if (!blob) return;
    try {
      await uploadRowImage(row.id, blob, "crop.png");
      toast.success("Photo cropped from the page.");
    } catch (e) {
      toast.error(friendlyError(e));
    }
  }

  const selectedIds = rows.filter((r) => selected[r.id] && r.included).map((r) => r.id);

  const convertQuote = useMutation({
    mutationFn: () =>
      toQuote({
        data: {
          import_id: importId!,
          row_ids: selectedIds,
          store_id: workspace,
          mode,
          product_name: productName,
          country_code: country,
        },
      }),
    onSuccess: (r) => {
      toast.success(
        r.quote_ids.length === 1
          ? "Draft quote request created."
          : `${r.quote_ids.length} draft quote requests created.`,
      );
      setSelected({});
      void refresh();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const convertProducts = useMutation({
    mutationFn: () =>
      toProducts({
        data: {
          import_id: importId!,
          row_ids: selectedIds,
          store_id: workspace,
          product_name: productName,
        },
      }),
    onSuccess: (r) => {
      toast.success(`${r.products.length} products added.`);
      setSelected({});
      void refresh();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (!importId) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <FileUp className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium">Upload a supplier catalogue</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          PDF (up to {MAX_PAGES} pages) or a photo of the price list, up to 15MB. One upload is one
          AI reading; every row is reviewed by hand before anything is created.
        </p>
        <label className="mt-4 inline-flex">
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
          <Button asChild disabled={uploading}>
            <span>
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {uploading ? "Reading catalogue…" : "Choose file"}
            </span>
          </Button>
        </label>
      </div>
    );
  }

  if (detail.isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading import…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-medium">{imp?.file_name}</span>{" "}
          <span className="text-muted-foreground">
            · {imp?.page_count} page{imp?.page_count === 1 ? "" : "s"} · {rows.length} rows
          </span>
        </div>
        <div className="flex items-center gap-2">
          {(imp?.page_count ?? 1) > 1 && (
            <Select value={String(page)} onValueChange={(v) => setPage(Number(v))}>
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: imp?.page_count ?? 1 }, (_, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    Page {i + 1}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpenImport(null)}>
            New import
          </Button>
        </div>
      </div>

      {imp?.status === "failed" || (imp?.status === "empty" && rows.length === 0) ? (
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <p className="font-medium">The reading did not return usable rows.</p>
          {imp?.error && <p className="text-muted-foreground">{imp.error}</p>}
          {imp?.raw_response && (
            <pre className="max-h-40 overflow-auto rounded bg-background/60 p-2 text-[11px]">
              {imp.raw_response.slice(0, 4000)}
            </pre>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              addRow({ data: { import_id: importId, page_no: page } })
                .then(refresh)
                .catch((e) => toast.error(friendlyError(e)))
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add rows manually
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="rounded-lg border border-border bg-muted/30 p-2">
          <p className="mb-2 text-xs text-muted-foreground">Source page {page}</p>
          <div ref={previewRef} className="max-h-[70vh] overflow-auto rounded bg-background" />
        </div>

        <div className="space-y-3">
          <TableShell>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead className="text-xs">Item no</TableHead>
                  <TableHead className="text-xs">Description</TableHead>
                  <TableHead className="text-xs">Colour</TableHead>
                  <TableHead className="text-xs">Size</TableHead>
                  <TableHead className="text-xs">Packaging</TableHead>
                  <TableHead className="text-xs">Inner</TableHead>
                  <TableHead className="text-xs">Outer</TableHead>
                  <TableHead className="text-xs">Available</TableHead>
                  <TableHead className="text-xs">Weight g</TableHead>
                  <TableHead className="text-xs">Price</TableHead>
                  <TableHead className="text-xs">Photo</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const amber = (f: string) => row.low_confidence.includes(f);
                  const text = (f: TextField) => (
                    <Cell
                      value={row[f] ?? ""}
                      amber={amber(f)}
                      onSave={(v) =>
                        save.mutate({ row_id: row.id, patch: { [f]: v.trim() || null } })
                      }
                    />
                  );
                  const num = (f: NumField) => (
                    <Cell
                      numeric
                      value={row[f] == null ? "" : String(row[f])}
                      amber={amber(f)}
                      onSave={(v) =>
                        save.mutate({
                          row_id: row.id,
                          patch: { [f]: v.trim() === "" ? null : Number(v.replace(",", ".")) },
                        })
                      }
                    />
                  );
                  return (
                    <TableRow key={row.id} className={row.included ? "" : "opacity-40"}>
                      <TableCell>
                        <Checkbox
                          checked={!!selected[row.id]}
                          onCheckedChange={(v) =>
                            setSelected((s) => ({ ...s, [row.id]: v === true }))
                          }
                          aria-label="Select row"
                        />
                      </TableCell>
                      <TableCell className="p-1">{text("item_no")}</TableCell>
                      <TableCell className="min-w-48 p-1">{text("description")}</TableCell>
                      <TableCell className="p-1">{text("color")}</TableCell>
                      <TableCell className="p-1">{text("size_text")}</TableCell>
                      <TableCell className="p-1">{text("packaging")}</TableCell>
                      <TableCell className="p-1">{num("inner_qty")}</TableCell>
                      <TableCell className="p-1">{num("outer_qty")}</TableCell>
                      <TableCell className="p-1">{num("available_qty")}</TableCell>
                      <TableCell className="p-1">{num("weight_g")}</TableCell>
                      <TableCell className="p-1">{num("unit_price")}</TableCell>
                      <TableCell className="p-1">
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Crop the photo from the page"
                            onClick={() => void cropRow(row)}
                          >
                            <Crop className="h-3.5 w-3.5" />
                          </Button>
                          <label className="cursor-pointer">
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                e.target.value = "";
                                if (f)
                                  void uploadRowImage(row.id, f, f.name).catch((err) =>
                                    toast.error(friendlyError(err)),
                                  );
                              }}
                            />
                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted">
                              <ImagePlus className="h-3.5 w-3.5" />
                            </span>
                          </label>
                          {row.image_urls.length > 0 && (
                            <span className="text-[11px] text-muted-foreground">
                              {row.image_urls.length}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="p-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            removeRow({ data: { row_id: row.id } })
                              .then(refresh)
                              .catch((e) => toast.error(friendlyError(e)))
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableShell>

          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              addRow({ data: { import_id: importId, page_no: page } })
                .then(refresh)
                .catch((e) => toast.error(friendlyError(e)))
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add row
          </Button>

          <div className="space-y-3 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">
              Convert {selectedIds.length} selected row{selectedIds.length === 1 ? "" : "s"}
            </p>
            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <Label className="text-xs">Workspace</Label>
                <Select value={workspace} onValueChange={setWorkspace}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Pick a workspace" />
                  </SelectTrigger>
                  <SelectContent>
                    {(workspaces.data ?? []).map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.store_name || w.store_url}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Product name</Label>
                <Input
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="e.g. Glass vases"
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs">Grouping</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single_product">One product, rows as variants</SelectItem>
                    <SelectItem value="product_per_row">One product per row</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Target country</Label>
                <Input
                  value={country}
                  onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
                  className="h-9"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={
                  !selectedIds.length ||
                  !workspace ||
                  productName.trim().length < 2 ||
                  convertQuote.isPending
                }
                onClick={() => convertQuote.mutate()}
              >
                {convertQuote.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create quote request
              </Button>
              <Button
                variant="outline"
                disabled={
                  !selectedIds.length ||
                  !workspace ||
                  productName.trim().length < 2 ||
                  convertProducts.isPending
                }
                onClick={() => convertProducts.mutate()}
              >
                {convertProducts.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add to products
              </Button>
              <Button variant="ghost" asChild>
                <Link to="/admin/quotes">Open quote queue</Link>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Everything lands as a draft — pricing and publishing stay in the normal flow.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
