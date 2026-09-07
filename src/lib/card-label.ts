/** "VISA •••• 4242" — the one way we show a saved card across the app. */
export function cardLabel(card: { brand: string; last4: string }): string {
  return `${card.brand.toUpperCase()} •••• ${card.last4}`;
}
