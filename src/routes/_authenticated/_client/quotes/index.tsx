import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { QuoteStatusBadge } from "@/components/status-badges";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatUSD, isQuoteExpired } from "@/lib/format";
import { listMyQuotes, respondToQuote } from "@/lib/quotes.functions";

export const Route = createFileRoute("/_authenticated/_client/quotes/")({
  head: () => ({
    meta: [
      { title: "My quotes — FlySales" },
      { name: "description", content: "Your quote requests and their status." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MyQuotesPage,
});

function MyQuotesPage() {
  const fetchQuotes = useServerFn(listMyQuotes);
  const callRespond = useServerFn(respondToQuote);
  const queryClient = useQueryClient();

  const { data, isPending } = useQuery({ queryKey: ["my-quotes"], queryFn: fetchQuotes });

  const respond = useMutation({
    mutationFn: (input: { quote_id: string; accept: boolean }) => callRespond({ data: input }),
    onSuccess: (_r, vars) => {
      toast.success(vars.accept ? "Quote accepted" : "Quote rejected");
      void queryClient.invalidateQueries({ queryKey: ["my-quotes"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const quotes = data?.quotes ?? [];

  return (
    <div>
      <PageHeader
        title="My quotes"
        description="Every sourcing request you've sent us."
        actions={
          <Button asChild size="sm">
            <Link to="/quotes/new">Request a quote</Link>
          </Button>
        }
      />

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : quotes.length === 0 ? (
        <EmptyState
          title="No quote requests yet"
          hint="Paste a product link and we'll come back with a price, MOQ and lead time."
        />
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Requested</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">MOQ</TableHead>
                <TableHead className="text-right">Lead time</TableHead>
                <TableHead>Valid until</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotes.map((q) => {
                const expired = isQuoteExpired(q.status, q.quote_valid_until);
                const actionable = q.status === "quoted" && !expired;
                return (
                  <TableRow key={q.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(q.created_at)}
                    </TableCell>
                    <TableCell className="max-w-56">
                      <div className="truncate text-sm font-medium">
                        {q.product_name || "Untitled product"}
                      </div>
                      <a
                        href={q.product_url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="block max-w-56 truncate text-xs text-muted-foreground underline-offset-2 hover:underline"
                      >
                        {q.product_url}
                      </a>
                    </TableCell>
                    <TableCell>
                      <QuoteStatusBadge status={q.status} validUntil={q.quote_valid_until} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {q.quoted_price_total != null ? formatUSD(q.quoted_price_total) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{q.moq ?? "—"}</TableCell>
                    <TableCell className="text-right text-sm">
                      {q.lead_time_days != null ? `${q.lead_time_days} d` : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDate(q.quote_valid_until)}
                    </TableCell>
                    <TableCell className="text-right">
                      {actionable && (
                        <div className="flex justify-end gap-2">
                          <ConfirmRespond
                            label="Accept"
                            accept
                            pending={respond.isPending}
                            onConfirm={() =>
                              respond.mutate({ quote_id: q.id ?? "", accept: true })
                            }
                          />
                          <ConfirmRespond
                            label="Reject"
                            accept={false}
                            pending={respond.isPending}
                            onConfirm={() =>
                              respond.mutate({ quote_id: q.id ?? "", accept: false })
                            }
                          />
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ConfirmRespond({
  label,
  accept,
  pending,
  onConfirm,
}: {
  label: string;
  accept: boolean;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant={accept ? "default" : "outline"} disabled={pending}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{accept ? "Accept this quote?" : "Reject this quote?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {accept
              ? "Accepting confirms you intend to order at the quoted price and conditions."
              : "Rejecting closes this request. You can always submit a new one."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{label} quote</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
