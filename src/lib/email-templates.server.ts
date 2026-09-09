/**
 * Copy for every client-facing transactional email, rendered through the
 * branded layout. One builder per email: it returns the subject plus the
 * HTML and plain-text parts, so call sites keep their existing triggers and
 * idempotency guards untouched.
 */

import { portalUrl, renderEmail, type EmailContent } from "./email-layout.server";

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

function build(subject: string, content: EmailContent): BuiltEmail {
  const { html, text } = renderEmail(content);
  return { subject, html, text };
}

function usd(amount: number | string | null | undefined): string {
  const n = Number(amount ?? 0);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 24h / 48h / 72h payment reminder on an order still awaiting payment. */
export function paymentReminderEmail(args: {
  orderLabel: string;
  amount: number;
  hours: number;
  autoCancelDays: number;
  orderId: string;
}): BuiltEmail {
  return build(`Payment reminder: order ${args.orderLabel}`, {
    heading: "Your order is waiting for payment",
    preheader: `${usd(args.amount)} outstanding on order ${args.orderLabel}.`,
    paragraphs: [
      `Order ${args.orderLabel} has been awaiting payment for ${args.hours} hours. Once it is paid, we release it to fulfilment straight away.`,
      `You can pay it from your wallet balance, or top up first if the balance does not cover it.`,
    ],
    panel: {
      title: "Order summary",
      rows: [
        { label: "Order", value: args.orderLabel },
        { label: "Amount due", value: usd(args.amount), strong: true },
      ],
    },
    button: { label: "Pay now", url: portalUrl(`/orders/${args.orderId}`) },
    note: `Unpaid orders are cancelled automatically ${args.autoCancelDays} days after they are created. Nothing is charged until you pay.`,
  });
}

/** Auto-cancellation notice after the payment window closes. */
export function orderCancelledEmail(args: {
  orderLabel: string;
  amount: number;
  autoCancelDays: number;
  orderId: string;
}): BuiltEmail {
  return build(`Order ${args.orderLabel} was cancelled`, {
    heading: "Order cancelled, nothing was charged",
    preheader: `Order ${args.orderLabel} closed after ${args.autoCancelDays} days without payment.`,
    paragraphs: [
      `Order ${args.orderLabel} was cancelled after ${args.autoCancelDays} days without payment. No money was taken and your wallet was not debited.`,
      "If you still want these units, place the order again from your product catalogue and we pick it up from there.",
    ],
    panel: {
      rows: [
        { label: "Order", value: args.orderLabel },
        { label: "Amount", value: usd(args.amount), strong: true },
        { label: "Status", value: "Cancelled" },
      ],
    },
    button: { label: "View your orders", url: portalUrl("/fulfilment/orders") },
  });
}

/** First tracking number on an order (webhook, poller or admin update). */
export function orderShippedEmail(args: {
  orderLabel: string;
  carrier: string;
  trackingNumber: string;
  orderId: string;
}): BuiltEmail {
  return build(`Your order ${args.orderLabel} is on its way`, {
    heading: "Your order is on its way",
    preheader: `${args.carrier} · ${args.trackingNumber}`,
    paragraphs: [
      `Order ${args.orderLabel} has left the supplier and is now with the carrier. Tracking usually starts updating within 24 to 48 hours.`,
    ],
    panel: {
      title: "Tracking",
      rows: [
        { label: "Order", value: args.orderLabel },
        { label: "Carrier", value: args.carrier },
        { label: "Tracking number", value: args.trackingNumber, strong: true },
      ],
    },
    button: { label: "Track this order", url: portalUrl(`/orders/${args.orderId}`) },
    note: "If the parcel arrives damaged, wrong, or does not arrive at all, open a claim from the order page and we resolve it.",
  });
}

/** Wallet top-up confirmed, with any orders it released. */
export function walletToppedUpEmail(args: {
  credited: number;
  balance: number;
  released: { label: string; amount: number }[];
}): BuiltEmail {
  const rows = [
    { label: "Amount credited", value: usd(args.credited), strong: true },
    { label: "New balance", value: usd(args.balance) },
  ];
  const paragraphs = [
    `Your top-up is confirmed and the funds are in your wallet, ready to pay for orders.`,
  ];
  if (args.released.length > 0) {
    paragraphs.push(
      `${args.released.length} order${args.released.length === 1 ? "" : "s"} awaiting payment ${
        args.released.length === 1 ? "was" : "were"
      } settled from this top-up and released to fulfilment.`,
    );
    for (const order of args.released) {
      rows.push({ label: `Order ${order.label}`, value: usd(order.amount) });
    }
  }
  return build("Your wallet was topped up", {
    heading: "Your wallet was topped up",
    preheader: `${usd(args.credited)} credited. New balance ${usd(args.balance)}.`,
    paragraphs,
    panel: { title: "Wallet", rows },
    button: { label: "View your wallet", url: portalUrl("/billing/wallet") },
    note: "A payment receipt for this top-up is available in Receipts.",
  });
}

/** Batch card payment settled (or fully credited back to the wallet). */
export function batchPaymentEmail(args: {
  settledCount: number;
  settledSum: number;
  leftover: number;
  skippedCount: number;
}): BuiltEmail {
  const rows = [] as { label: string; value: string; strong?: boolean }[];
  const paragraphs: string[] = [];
  if (args.settledCount === 0) {
    paragraphs.push(
      `None of the orders you selected were still awaiting payment, so the full amount was credited to your wallet instead. Nothing was lost and the funds stay yours.`,
    );
    rows.push({ label: "Credited to wallet", value: usd(args.leftover), strong: true });
  } else {
    paragraphs.push(
      `Your payment went through and ${args.settledCount} order${
        args.settledCount === 1 ? "" : "s"
      } ${args.settledCount === 1 ? "is" : "are"} now paid and released to fulfilment.`,
    );
    rows.push(
      { label: "Orders paid", value: String(args.settledCount) },
      { label: "Amount paid", value: usd(args.settledSum), strong: true },
    );
    if (args.leftover > 0) {
      paragraphs.push(
        `${args.skippedCount} selected order${
          args.skippedCount === 1 ? " was" : "s were"
        } no longer payable, so their share was credited to your wallet.`,
      );
      rows.push({ label: "Credited to wallet", value: usd(args.leftover) });
    }
  }
  return build("Your batch payment is processed", {
    heading: "Your batch payment is processed",
    preheader:
      args.settledCount === 0
        ? `${usd(args.leftover)} credited to your wallet.`
        : `${args.settledCount} order${args.settledCount === 1 ? "" : "s"} paid.`,
    paragraphs,
    panel: { title: "Payment summary", rows },
    button: { label: "View your orders", url: portalUrl("/fulfilment/orders") },
    note: "A payment receipt is issued for every paid order and is available in Receipts.",
  });
}

/** Workspace subscription is active after a successful checkout. */
export function subscriptionActiveEmail(args: {
  planLabel: string;
  priceUsd: number;
  nextBilling: string | null;
}): BuiltEmail {
  const rows = [
    { label: "Plan", value: args.planLabel, strong: true },
    { label: "Price", value: `${usd(args.priceUsd)} / month` },
  ];
  if (args.nextBilling) rows.push({ label: "Next billing date", value: args.nextBilling });
  return build(`Your ${args.planLabel} plan is active`, {
    heading: `Your ${args.planLabel} plan is active`,
    preheader: "Your quote allowance applies from now.",
    paragraphs: [
      "Your payment is confirmed and your plan is live. The new quote allowance applies immediately, so you can send your next request straight away.",
    ],
    panel: { title: "Subscription", rows },
    button: { label: "Request a quote", url: portalUrl("/sourcing/new") },
  });
}

/** SpyMarket subscription is active (access switched on at launch). */
export function spymarketActiveEmail(args: { planLabel: string }): BuiltEmail {
  return build("Your SpyMarket subscription is active", {
    heading: "Your SpyMarket subscription is active",
    preheader: "Billing has started. We email you the moment access is switched on.",
    paragraphs: [
      "Your payment is confirmed and billing has started. We email you the moment SpyMarket goes live and your access is switched on.",
    ],
    panel: { rows: [{ label: "Plan", value: `SpyMarket ${args.planLabel}`, strong: true }] },
    button: { label: "Open SpyMarket", url: portalUrl("/spymarket") },
  });
}

/** Subscription cancellation confirmed. */
export function subscriptionCancelledEmail(args: {
  periodEndDate: string | null;
}): BuiltEmail {
  return build("Your subscription cancellation is confirmed", {
    heading: "Your cancellation is confirmed",
    preheader: args.periodEndDate
      ? `Your plan stays active until ${args.periodEndDate}.`
      : "Your plan stays active until the end of the current billing period.",
    paragraphs: [
      args.periodEndDate
        ? `Your plan stays active until ${args.periodEndDate}, so nothing changes before then.`
        : "Your plan stays active until the end of the current billing period, so nothing changes before then.",
      "Your product catalogue and any open orders are unaffected, and your wallet balance stays yours. You can resubscribe whenever you want.",
    ],
    button: { label: "Manage billing", url: portalUrl("/billing/subscription") },
  });
}

/** Subscription invoice failed; the card needs attention. */
export function paymentFailedEmail(): BuiltEmail {
  return build("We could not charge your card", {
    heading: "We could not charge your card",
    preheader: "Update your payment method to keep your plan.",
    paragraphs: [
      "Your last subscription payment did not go through. We retry it automatically over the next few days, so there is nothing to pay twice.",
      "Update your saved card on the Billing page to keep your plan and your quote allowance active. Your wallet balance and paid orders are unaffected.",
    ],
    button: { label: "Update payment method", url: portalUrl("/billing/subscription") },
  });
}

/** Claim (dispute) resolved: outcome stated plainly. */
export function claimResolvedEmail(args: {
  orderLabel: string;
  resolution: "wallet_credit" | "reshipped" | "rejected" | string;
  creditAmount?: number | null;
  clientMessage?: string | null;
  disputeId: string;
}): BuiltEmail {
  const outcome =
    args.resolution === "wallet_credit"
      ? `We approved your claim and credited ${usd(args.creditAmount)} to your wallet. The funds are available now.`
      : args.resolution === "reshipped"
        ? "We approved your claim and a replacement shipment is on the way. You get a tracking number as soon as it leaves the supplier."
        : "After reviewing the evidence, we could not approve this claim. Nothing was charged and your wallet was not debited.";
  const rows = [
    { label: "Order", value: args.orderLabel },
    {
      label: "Outcome",
      value:
        args.resolution === "wallet_credit"
          ? "Approved, wallet credit"
          : args.resolution === "reshipped"
            ? "Approved, reshipment"
            : "Not approved",
      strong: true,
    },
  ];
  if (args.resolution === "wallet_credit") {
    rows.push({ label: "Credited", value: usd(args.creditAmount) });
  }
  const paragraphs = [`Your claim on order ${args.orderLabel} has been reviewed.`, outcome];
  if (args.clientMessage) paragraphs.push(args.clientMessage);
  return build(`Claim update: order ${args.orderLabel}`, {
    heading: "Your claim has been resolved",
    preheader: outcome,
    paragraphs,
    panel: { title: "Claim", rows },
    button: { label: "View the claim", url: portalUrl(`/disputes/${args.disputeId}`) },
    note: "Reply in the claim thread if anything looks wrong and we take another look.",
  });
}

/**
 * Inventory alert: a SKU crossed into AMBER (reorder window open) or RED
 * (reorder is already late). Sent once per state transition, never repeated
 * while the state holds.
 */
export function inventoryReorderEmail(args: {
  productName: string;
  sku: string;
  workspaceName: string | null;
  state: "amber" | "red";
  daysOfCover: number | null;
  totalLead: number;
  reorderBy: string | null;
  gapDays: number | null;
  suggestedQty: number;
}): BuiltEmail {
  const red = args.state === "red";
  const heading = red ? "Reorder this SKU now" : "Time to plan a reorder";
  const lead = red
    ? args.gapDays && args.gapDays > 0
      ? `Ordering today still leaves roughly ${args.gapDays} days out of stock.`
      : "Ordering today is the last moment to avoid running out."
    : `Your reorder window is open. Place the order by ${args.reorderBy ?? "soon"} to stay in stock.`;

  const rows = [
    { label: "Product", value: `${args.productName} (${args.sku})` },
    {
      label: "Days of cover",
      value: args.daysOfCover == null ? "No recent sales" : `${args.daysOfCover} days`,
      strong: true,
    },
    { label: "Lead time", value: `${args.totalLead} days` },
    { label: "Reorder by", value: args.reorderBy ?? "—" },
    { label: "Suggested quantity", value: `${args.suggestedQty} units` },
  ];
  if (args.workspaceName) rows.unshift({ label: "Workspace", value: args.workspaceName });

  return build(`${red ? "Reorder now" : "Reorder soon"}: ${args.sku}`, {
    heading,
    preheader: lead,
    paragraphs: [
      `Based on your current stock and the last 30 days of sales, ${args.productName} needs attention.`,
      lead,
    ],
    panel: { title: "Forecast", rows },
    button: { label: "Plan the reorder", url: portalUrl("/fulfilment/inventory") },
    note: "Days of cover use your recent sales velocity. Lead times combine production, transit and your safety margin.",
  });
}

/** Inbound shipment received and counted at the fulfilment centre. */
export function inboundReceivedEmail(args: {
  shipmentRef: string;
  countedPieces: number;
  declaredPieces: number;
  qc: boolean;
  fee: number;
  discrepancies: Array<{ sku: string; declared: number; counted: number }>;
}): BuiltEmail {
  const hasGap = args.discrepancies.length > 0;
  const rows = [
    { label: "Shipment", value: args.shipmentRef },
    { label: "Declared", value: `${args.declaredPieces} pieces` },
    { label: "Counted", value: `${args.countedPieces} pieces`, strong: true },
    { label: "Quality control", value: args.qc ? "Yes (+$0.20/piece)" : "No" },
    { label: "Service fee charged", value: usd(args.fee), strong: true },
  ];
  const paragraphs = [
    `We received and counted your shipment ${args.shipmentRef}. The stock is now available in your inventory.`,
    `The service fee is charged on counted pieces and has been taken from your wallet balance.`,
  ];
  if (hasGap) {
    paragraphs.push(
      `We counted a different quantity than declared on ${args.discrepancies.length} line(s): ` +
        args.discrepancies
          .map((d) => `${d.sku} declared ${d.declared}, counted ${d.counted}`)
          .join("; ") +
        ".",
    );
  }
  return build(`Shipment ${args.shipmentRef} received`, {
    heading: hasGap ? "Shipment received, with a count difference" : "Shipment received",
    preheader: `${args.countedPieces} pieces counted, ${usd(args.fee)} charged.`,
    paragraphs,
    panel: { title: "Receipt summary", rows },
    button: { label: "View the shipment", url: portalUrl("/fulfilment/inbound") },
    note: "Fees are always charged on the quantities we count, never on the declared quantities.",
  });
}

/** Inbound shipment refused at the warehouse (no tracking, no labels). */
export function inboundRefusedEmail(args: {
  shipmentRef: string;
  reason: string;
}): BuiltEmail {
  return build(`Shipment ${args.shipmentRef} was refused`, {
    heading: "Your shipment was refused at the warehouse",
    preheader: args.reason,
    paragraphs: [
      `Shipment ${args.shipmentRef} could not be accepted at our fulfilment centre.`,
      args.reason,
      "Nothing was charged. Fix the issue with your supplier and declare the shipment again.",
    ],
    panel: {
      title: "What we need",
      rows: [
        { label: "Labels", value: "Our SKU labels on every carton" },
        { label: "Tracking", value: "Supplier tracking added before arrival" },
        { label: "Minimum", value: "10 units per variation" },
      ],
    },
    button: { label: "Declare again", url: portalUrl("/fulfilment/inbound") },
  });
}

/** Balance too low to charge the inbound service fee. */
export function inboundPaymentNeededEmail(args: {
  shipmentRef: string;
  fee: number;
  balance: number;
}): BuiltEmail {
  return build(`Top up to release shipment ${args.shipmentRef}`, {
    heading: "Your shipment is counted and waiting for payment",
    preheader: `${usd(args.fee)} service fee, ${usd(args.balance)} available.`,
    paragraphs: [
      `We counted shipment ${args.shipmentRef} at the warehouse, but your wallet balance does not cover the service fee.`,
      "Top up and we charge the fee and release the stock into your inventory.",
    ],
    panel: {
      title: "Amount needed",
      rows: [
        { label: "Service fee", value: usd(args.fee), strong: true },
        { label: "Wallet balance", value: usd(args.balance) },
        { label: "To top up", value: usd(Math.max(args.fee - args.balance, 0)) },
      ],
    },
    button: { label: "Top up your wallet", url: portalUrl("/billing/wallet") },
  });
}

/** Internal: a client asked us to switch their ads dashboard on. */
export function adsActivationRequestedEmail(args: {
  workspaceName: string;
  workspaceId: string;
  note: string | null;
}): BuiltEmail {
  return build(`Ads activation requested — ${args.workspaceName}`, {
    heading: "A client requested their ads dashboard",
    preheader: `${args.workspaceName} is waiting for partner access to be confirmed.`,
    paragraphs: [
      `${args.workspaceName} clicked "Notify us" on the Ads page.`,
      "Check that partner access has landed in our Business Manager, then map their ad account to this workspace in the admin Ads page.",
      ...(args.note ? [`Their note: ${args.note}`] : []),
    ],
    panel: {
      title: "Workspace",
      rows: [
        { label: "Name", value: args.workspaceName, strong: true },
        { label: "ID", value: args.workspaceId },
      ],
    },
    button: { label: "Open admin Ads", url: portalUrl("/admin/ads") },
  });
}

/** The FlySales team replied in a quote conversation. */
export function quoteMessageEmail(args: {
  quoteId: string;
  productName: string;
  excerpt: string;
}): BuiltEmail {
  return build(`New message on your quote: ${args.productName}`, {
    heading: "The FlySales team replied",
    preheader: args.excerpt || "There is a new message on your quote request.",
    paragraphs: [
      `We posted a new message on your quote request for ${args.productName}.`,
      ...(args.excerpt ? [`"${args.excerpt}"`] : []),
    ],
    button: { label: "Open the conversation", url: portalUrl(`/quotes/${args.quoteId}`) },
    note: "Reply in the portal so everything stays on one thread with your quote.",
  });
}

/** Confirmation that a structured request on a quote reached the team. */
export function quoteRequestReceivedEmail(args: {
  quoteId: string;
  productName: string;
  requestLabel: string;
}): BuiltEmail {
  return build(`We received your request: ${args.requestLabel}`, {
    heading: "Your request is with the team",
    preheader: `${args.requestLabel} on ${args.productName}.`,
    paragraphs: [
      `We logged your request — ${args.requestLabel} — on the quote for ${args.productName}.`,
      "You will see our answer in the quote conversation.",
    ],
    button: { label: "Open the quote", url: portalUrl(`/quotes/${args.quoteId}`) },
  });
}

