const usdNumber = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** $1,234.56 — US style: period decimal, comma thousands. */
export function formatUSD(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  if (!Number.isFinite(n)) return "$0.00";
  return `$${usdNumber.format(n)}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** DD/MM/YYYY. Date-only strings (YYYY-MM-DD) are parsed as calendar dates, not instants. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** DD/MM/YYYY HH:mm */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDate(value)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** True when a quoted quote's validity date has passed. */
export function isQuoteExpired(status: string | null, validUntil: string | null | undefined): boolean {
  if (status !== "quoted" || !validUntil) return false;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(validUntil);
  if (!dateOnly) return false;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
  return validUntil < todayStr;
}
