import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { DocumentDownloadButton, DocumentTypeBadge } from "@/components/documents-ui";
import {
  AdminSearch,
  FilterTabs,
  RowActions,
  SummaryBar,
  TableShell,
  ToolBar,
  Value,
} from "@/components/admin-ui";
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

const TABS = [
  { id: "all", label: "All types" },
  { id: "order_receipt", label: "Order receipts" },
  { id: "wallet_topup", label: "Wallet top-ups" },
  { id: "subscription", label: "Subscriptions" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function AdminDocumentsPage() {
  const fetchDocuments = useServerFn(adminListDocuments);
  const [tab, setTab] = React.useState<TabId>("all");
  const [clientSearch, setClientSearch] = React.useState("");

  const { data, isPending } = useQuery({
    queryKey: ["admin-documents", tab],
    queryFn: () =>
      fetchDocuments({
        data: tab === "all" ? {} : { type: tab as "order_receipt" },
      }),
  });
  // Totals always read from the unfiltered set.
  const { data: allDocs } = useQuery({
    queryKey: ["admin-documents", "all"],
    queryFn: () => fetchDocuments({ data: {} }),
  });

  const search = clientSearch.trim().toLowerCase();
  const documents = (data ?? []).filter(
    (doc) =>
      !search || (doc.entities?.legal_name ?? "").toLowerCase().includes(search),
  );

  const now = new Date();
  const monthDocs = (allDocs ?? []).filter((d) => {
    const issued = new Date(d.issued_at);
    return (
      issued.getUTCMonth() === now.getUTCMonth() &&
      issued.getUTCFullYear() === now.getUTCFullYear()
    );
  });
  const monthTotal = monthDocs.reduce((acc, d) => acc + Number(d.amount ?? 0), 0);
  const countByType = (type: string) =>
    (allDocs ?? []).filter((d) => d.document_type === type).length;

  return (
    <div>
      <PageHeader
        title="Payment receipts"
        description="Every payment receipt issued to clients. Documents are immutable once issued."
      />

      <SummaryBar
        className="lg:grid-cols-4"
        items={[
          {
            key: "month",
            label: "This month",
            value: formatUSD(monthTotal),
            tone: "primary",
            hint: `${monthDocs.length} receipt${monthDocs.length === 1 ? "" : "s"}`,
          },
          {
            key: "order_receipt",
            label: "Order receipts",
            value: countByType("order_receipt"),
            active: tab === "order_receipt",
            onClick: () => setTab(tab === "order_receipt" ? "all" : "order_receipt"),
          },
          {
            key: "wallet_topup",
            label: "Wallet top-ups",
            value: countByType("wallet_topup"),
            active: tab === "wallet_topup",
            onClick: () => setTab(tab === "wallet_topup" ? "all" : "wallet_topup"),
          },
          {
            key: "subscription",
            label: "Subscriptions",
            value: countByType("subscription"),
            active: tab === "subscription",
            onClick: () => setTab(tab === "subscription" ? "all" : "subscription"),
          },
        ]}
      />

      <ToolBar>
        <FilterTabs tabs={TABS} value={tab} onChange={setTab} />
        <AdminSearch
          value={clientSearch}
          onChange={setClientSearch}
          placeholder="Search by entity name"
        />
      </ToolBar>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : documents.length === 0 ? (
        <EmptyState title="No receipts found" hint="Try widening the filters." />
      ) : (
        <TableShell>
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow>
                <TableHead className="h-9">Number</TableHead>
                <TableHead className="h-9">Client</TableHead>
                <TableHead className="h-9">Type</TableHead>
                <TableHead className="h-9">Issued</TableHead>
                <TableHead className="h-9">Source</TableHead>
                <TableHead className="h-9 text-right">Amount</TableHead>
                <TableHead className="h-9 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.id} className="hover:bg-accent/60">
                  <TableCell className="py-2.5 font-mono text-xs font-medium">
                    {doc.document_number}
                  </TableCell>
                  <TableCell className="max-w-48 truncate py-2.5">
                    <Value>{doc.entities?.legal_name}</Value>
                  </TableCell>
                  <TableCell className="py-2.5">
                    <DocumentTypeBadge type={doc.document_type} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2.5 text-xs text-muted-foreground">
                    {formatDateTime(doc.issued_at)}
                  </TableCell>
                  <TableCell className="py-2.5 text-xs text-muted-foreground">
                    {doc.document_type === "order_receipt"
                      ? `Order ${doc.orders?.external_order_number ?? doc.order_id?.slice(0, 8) ?? ""}`
                      : doc.document_type === "wallet_topup"
                        ? "Wallet credit"
                        : "Monthly plan"}
                  </TableCell>
                  <TableCell className="tnum py-2.5 text-right">
                    {formatUSD(doc.amount)}
                  </TableCell>
                  <TableCell className="py-2.5">
                    <RowActions>
                      <DocumentDownloadButton id={doc.id} label="" />
                    </RowActions>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableShell>
      )}
    </div>
  );
}
