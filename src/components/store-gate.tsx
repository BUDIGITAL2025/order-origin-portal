import { Link } from "@tanstack/react-router";
import { Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useMyContext } from "@/routes/_authenticated/_client";

/**
 * Blocks store-scoped features (quotes, catalogue) until the account has at
 * least one store. Storeless accounts keep dashboard/billing/receipts.
 */
export function StoreGate({
  feature,
  children,
}: {
  feature: string;
  children: React.ReactNode;
}) {
  const { data: ctx, isPending } = useMyContext();

  if (isPending) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const stores = ctx?.entities?.flatMap((e) => e.stores) ?? [];
  if (stores.length > 0) return <>{children}</>;

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <Store className="h-5 w-5 text-muted-foreground" />
          </div>
          <CardTitle className="text-lg">Add a store first</CardTitle>
          <CardDescription>
            {feature} are linked to a store. Add your first store to unlock them — it only
            takes a minute.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link to="/stores/new">Add store</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
