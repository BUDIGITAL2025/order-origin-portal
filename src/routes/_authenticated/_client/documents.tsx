import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Receipt,
  Search,
  Wallet,
} from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { DocumentDownloadButton, DocumentTypeBadge } from "@/components/documents-ui";
import type { DocumentType } from "@/components/documents-ui";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { formatDateTime, formatUSD } from "@/lib/format";
import { listMyDocuments } from "@/lib/documents.functions";
import { getMyWallet } from "@/lib/wallet.functions";

export const Route = createFileRoute("/_authenticated/_client/documents")({
  head: () => ({
    meta: [
      { title: "Payment Receipts — FlySales" },
      {
        name: "description",
        content:
          "Proof of payment for every order payment, wallet top-up and subscription charge.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DocumentsPage,
});

type SortKey = "number" | "type" | "amount" | "date";

const TYPE_LABELS: Record<DocumentType, string> = {
  wallet_topup: "Top-up",
  order_receipt: "Order payment",
  subscription: "Subscription",
};

function monthStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

function DocumentsPage() {
  const fetchDocuments = useServerFn(listMyDocuments);
  const fetchWallet = useServerFn(getMyWallet);
  const { data, isPending } = useQuery({
    queryKey: ["my-documents"],
    queryFn: fetchDocuments,
  });
  const { data: wallet } = useQuery({ queryKey: ["my-wallet"], queryFn: fetchWallet });

  const [search, setSearch] = useState("");
  const [type, setType] = useState<"all" | DocumentType>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<SortKey>("date");
  const [asc, setAsc] = useState(false);
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(25);

  const documents = useMemo(() => data ?? [], [data]);

  /** Money already paid out for orders this calendar month. */
  const spentThisMonth = useMemo(() => {
    const start = monthStart();
    return documents
      .filter((d) => d.document_type === "order_receipt" && d.issued_at >= start)
      .reduce((acc, d) => acc + Number(d.amount ?? 0), 0);
  }, [documents]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = documents;
    if (type !== "all") list = list.filter((d) => d.document_type === type);
    if (term) list = list.filter((d) => d.document_number.toLowerCase().includes(term));
    if (from) list = list.filter((d) => d.issued_at >= `${from}T00:00:00`);
    if (to) list = list.filter((d) => d.issued_at <= `${to}T23:59:59`);

    const sorted = [...list];
    sorted.sort((a, b) => {
      let r = 0;
      if (sort === "number") r = a.document_number.localeCompare(b.document_number);
      else if (sort === "type") r = a.document_type.localeCompare(b.document_type);
      else if (sort === "amount") r = Number(a.amount ?? 0) - Number(b.amount ?? 0);
      else r = a.issued_at.localeCompare(b.issued_at);
      return asc ? r : -r;
    });
    return sorted;
  }, [documents, search, type, from, to, sort, asc]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * perPage, currentPage * perPage + perPage);

  function sortBy(key: SortKey) {
    if (sort === key) setAsc((v) => !v);
    else {
      setSort(key);
      setAsc(key === "number" || key === "type");
    }
    setPage(0);
  }

  function SortHead({
    label,
    keyName,
    className,
  }: {
    label: string;
    keyName: SortKey;
    className?: string;
  }) {
    const active = sort === keyName;
    return (
      <TableHead className={cn("h-9", className)}>
        <button
          type="button"
          onClick={() => sortBy(keyName)}
          className={cn(
            "inline-flex items-center gap-1 transition-colors hover:text-foreground",
            active && "text-foreground",
          )}
        >
          {label}
          {active &&
            (asc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
        </button>
      </TableHead>
    );
  }

  return (
    <div>
      <PageHeader
        title="Payment receipts"
        description="Proof of payment for your accountant, issued automatically for every paid order, wallet top-up and subscription charge. These are not tax invoices."
      />

      {/* 1. Prepaid summary — money already paid and money available. */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Receipt className="h-3.5 w-3.5" />
            </span>
            <span className="metric-label">Total spent this month</span>
          </div>
          <p className="tnum mt-3 text-3xl font-semibold leading-none">
            {formatUSD(spentThisMonth)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Order payments debited from your wallet since the 1st.
          </p>
        </div>

        <div className="rounded-2xl border border-primary/30 bg-primary/10 p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Wallet className="h-3.5 w-3.5" />
            </span>
            <span className="metric-label">Current wallet balance</span>
          </div>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            <p className="tnum text-3xl font-semibold leading-none">
              {formatUSD(wallet?.balance ?? 0)}
            </p>
            <Button asChild size="sm">
              <Link to="/wallet">Top up</Link>
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Prepaid credit in USD. Orders are paid from this balance.
          </p>
        </div>
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : documents.length === 0 ? (
        <EmptyState
          title="No receipts yet"
          hint="Your payment records live here. Every top-up and order payment generates a receipt you can download."
          icon={Receipt}
          action={{ label: "Top up", to: "/billing" }}
        />
      ) : (
        <>
          {/* 3. Filters — same controls as the Orders page. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="Search receipt number"
                className="h-9 rounded-full pl-9 text-[13px]"
              />
            </div>
            <Select
              value={type}
              onValueChange={(v) => {
                setType(v as "all" | DocumentType);
                setPage(0);
              }}
            >
              <SelectTrigger className="h-9 w-[168px] rounded-full text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="wallet_topup">Top-up</SelectItem>
                <SelectItem value="order_receipt">Order payment</SelectItem>
                <SelectItem value="subscription">Subscription</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                aria-label="From date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(0);
                }}
                className="h-9 w-[150px] rounded-full text-[13px]"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                aria-label="To date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(0);
                }}
                className="h-9 w-[150px] rounded-full text-[13px]"
              />
            </div>
            {(search || type !== "all" || from || to) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setType("all");
                  setFrom("");
                  setTo("");
                  setPage(0);
                }}
              >
                Clear
              </Button>
            )}
          </div>

          {/* 2 + 4. Clean, dense records table. */}
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table className="text-[13px]">
              <TableHeader>
                <TableRow>
                  <SortHead label="Receipt" keyName="number" />
                  <SortHead label="Type" keyName="type" />
                  <SortHead label="Amount" keyName="amount" className="text-right" />
                  <SortHead label="Date" keyName="date" />
                  <TableHead className="h-9">Source</TableHead>
                  <TableHead className="h-9 text-right">Download</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      No receipts match these filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  visible.map((doc) => (
                    <TableRow key={doc.id} className="hover:bg-accent/60">
                      <TableCell className="tnum py-3 font-medium">
                        {doc.document_number}
                      </TableCell>
                      <TableCell className="py-3">
                        <DocumentTypeBadge type={doc.document_type} />
                      </TableCell>
                      <TableCell className="tnum py-3 text-right">
                        {formatUSD(doc.amount)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-3 text-xs text-muted-foreground">
                        {formatDateTime(doc.issued_at)}
                      </TableCell>
                      <TableCell className="py-3 text-xs text-muted-foreground">
                        {doc.document_type === "order_receipt"
                          ? `Order ${doc.orders?.external_order_number ?? doc.order_id?.slice(0, 8) ?? "—"}`
                          : doc.document_type === "wallet_topup"
                            ? "Wallet credit"
                            : "Monthly plan"}
                      </TableCell>
                      <TableCell className="py-3 text-right">
                        <DocumentDownloadButton id={doc.id} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted-foreground">
            <span className="tnum">
              {filtered.length === 0
                ? "0 receipts"
                : `${currentPage * perPage + 1}–${Math.min(filtered.length, (currentPage + 1) * perPage)} of ${filtered.length} receipts`}
            </span>
            <div className="flex items-center gap-2">
              <span>Rows</span>
              <Select
                value={String(perPage)}
                onValueChange={(v) => {
                  setPerPage(Number(v));
                  setPage(0);
                }}
              >
                <SelectTrigger className="h-8 w-[72px] rounded-full text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                aria-label="Previous page"
                disabled={currentPage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="tnum">
                {currentPage + 1} / {pageCount}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                aria-label="Next page"
                disabled={currentPage >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
