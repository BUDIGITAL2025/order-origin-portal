import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { DocumentDownloadButton, DocumentTypeBadge } from "@/components/documents-ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatUSD } from "@/lib/format";
import { listMyDocuments } from "@/lib/documents.functions";

export const Route = createFileRoute("/_authenticated/_client/documents")({
  head: () => ({
    meta: [
      { title: "Payment Receipts — FlySales" },
      {
        name: "description",
        content: "Your payment receipts — proof of payment for every order, top-up and subscription charge.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DocumentsPage,
});

function DocumentsPage() {
  const fetchDocuments = useServerFn(listMyDocuments);
  const { data, isPending } = useQuery({
    queryKey: ["my-documents"],
    queryFn: fetchDocuments,
  });

  const documents = data ?? [];

  return (
    <div>
      <PageHeader
        title="Payment receipts"
        description="Proof of payment for your accountant — issued automatically for every paid order, wallet top-up and subscription charge. These are not tax invoices."
      />

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : documents.length === 0 ? (
        <EmptyState
          title="No receipts yet"
          hint="A payment receipt is issued automatically each time a payment is confirmed."
        />
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
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
                  <TableCell className="tnum text-xs font-medium">
                    {doc.document_number}
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
                  <TableCell className="text-right tnum text-sm">
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
