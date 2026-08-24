import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, ClipboardList, PackageSearch, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatUSD } from "@/lib/format";
import { formatSlaDuration, isQuoteOpenForSla, useNow } from "@/components/quote-sla";

export type OpenQuoteRow = {
  id: string;
  product_url: string;
  product_name: string | null;
  status: string;
  quote_due_at: string | null;
  from_price: number | null;
};

const MAX_ROWS = 5;

/**
 * Dashboard widget: the client's open quote requests, most urgent first.
 * Quoted rows lead (the action moved to the client), then by least time left.
 * Rows without a due date yet show an em dash instead of a timer.
 */
export function OpenQuotesWidget({
  quotes,
  subscribed,
}: {
  quotes: OpenQuoteRow[];
  subscribed: boolean;
}) {
  const navigate = useNavigate();
  const now = useNow(1000);
  const visible = quotes.slice(0, MAX_ROWS);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          Open quotations
        </CardTitle>
        {quotes.length > MAX_ROWS && (
          <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
            <Link to="/quotes">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {visible.length === 0 ? (
          <div className="p-6">
            {subscribed ? (
              <EmptyState
                icon={PackageSearch}
                title="No open quotations"
                hint="Paste a product URL and our sourcing team comes back with per-variant pricing."
                action={{ label: "Request a quote", to: "/quotes/new" }}
              />
            ) : (
              <EmptyState
                icon={Sparkles}
                title="Start sourcing with a plan"
                hint="Quote requests are included in every plan — pick one and send your first product link."
                action={{ label: "Choose a plan", to: "/billing" }}
              />
            )}
          </div>
        ) : (

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Price</TableHead>
                <TableHead className="text-right">Time left</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((q) => (
                <TableRow
                  key={q.id}
                  className="cursor-pointer"
                  onClick={() => navigate({ to: "/quotes/$id", params: { id: q.id } })}
                >
                  <TableCell className="max-w-56 truncate text-sm">
                    <Link
                      to="/quotes/$id"
                      params={{ id: q.id }}
                      className="underline-offset-2 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {q.product_name || truncateUrl(q.product_url)}
                    </Link>
                  </TableCell>
                  <TableCell className="tnum whitespace-nowrap text-sm">
                    {q.status === "quoted" && q.from_price != null
                      ? `from ${formatUSD(q.from_price)}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <TimeLeftCell quote={q} now={now} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function TimeLeftCell({ quote, now }: { quote: OpenQuoteRow; now: number }) {
  // Quoted: the action moved to the client — no timer.
  if (quote.status === "quoted") {
    return <Badge className="whitespace-nowrap">Quoted — review</Badge>;
  }
  if (!isQuoteOpenForSla(quote.status) || !quote.quote_due_at) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const remaining = new Date(quote.quote_due_at).getTime() - now;
  if (remaining <= 0) {
    return (
      <span className="whitespace-nowrap text-xs font-medium text-warning">
        In progress — taking longer than usual
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap tnum text-xs text-muted-foreground">
      {formatSlaDuration(remaining)}
    </span>
  );
}

/** Compact a product URL for display: host + first path segment. */
function truncateUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    const short = path.length > 24 ? `${path.slice(0, 24)}…` : path;
    return `${u.hostname}${short}`;
  } catch {
    return url.length > 40 ? `${url.slice(0, 40)}…` : url;
  }
}
