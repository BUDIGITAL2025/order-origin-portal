import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { DocumentDownloadButton, DocumentTypeBadge } from "@/components/documents-ui";
import { Input } from "@/components/ui/input";
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
import { formatDateTime, formatUSD } from "@/lib/format";
import { adminListDocuments } from "@/lib/documents.functions";

export const Route = createFileRoute("/_authenticated/admin/documents")({
  head: () => ({
    meta: [
      { title: "Payment Receipts — FlySales Admin" },
      { name: "description", content: "All client payment receipts." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminDocumentsPage,
});

function AdminDocumentsPage() {
  const fetchDocuments = useServerFn(adminListDocuments);
  const [typeFilter, setTypeFilter] = React.useState<string>("all");
  const [clientSearch, setClientSearch] = React.useState("");

  const { data, isPending } = useQuery({
    queryKey: ["admin-documents", typeFilter],
    queryFn: () =>
      fetchDocuments({
        data: typeFilter === "all" ? {} : { type: typeFilter as "order_receipt" },
      }),
  });

  const search = clientSearch.trim().toLowerCase();
  const documents = (data ?? []).filter(
    (doc) =>
      !search || (doc.entities?.legal_name ?? "").toLowerCase().includes(search),
  );

  return (
    <div>
      <PageHeader
        title="Payment receipts"
        description="Every payment receipt issued to clients. Documents are immutable once issued."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="order_receipt">Order receipts</SelectItem>
            <SelectItem value="wallet_topup">Wallet top-ups</SelectItem>
            <SelectItem value="subscription">Subscriptions</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={clientSearch}
          onChange={(e) => setClientSearch(e.target.value)}
          placeholder="Search entity name…"
          className="w-64"
        />
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : documents.length === 0 ? (
        <EmptyState title="No receipts found" hint="Try widening the filters." />
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Download</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell className="font-mono text-xs font-medium">
                    {doc.document_number}
                  </TableCell>
                  <TableCell className="max-w-48 truncate text-sm">
                    {doc.entities?.legal_name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <DocumentTypeBadge type={doc.document_type} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDateTime(doc.issued_at)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {doc.document_type === "order_receipt"
                      ? `Order ${doc.orders?.external_order_number ?? doc.order_id?.slice(0, 8) ?? "—"}`
                      : doc.document_type === "wallet_topup"
                        ? "Wallet credit"
                        : "Monthly plan"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatUSD(doc.amount)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DocumentDownloadButton id={doc.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
