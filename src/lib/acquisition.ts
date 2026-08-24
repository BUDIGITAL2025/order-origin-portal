/**
 * Acquisition context: UTM params and an optional plan hint captured from the
 * URL on the visitor's first landing, kept in sessionStorage so they survive
 * navigation into the signup form (and the paywall right after signup).
 *
 * Nothing is stored for visitors arriving without any of these params.
 */

const STORAGE_KEY = "fs_acquisition";

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;
export type UtmKey = (typeof UTM_KEYS)[number];

export type SignupSource = Partial<Record<UtmKey, string>>;
export type PlanHint = "basic" | "unlimited";

type Stored = SignupSource & { plan?: PlanHint };

function read(): Stored | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Stored;
  } catch {
    return null;
  }
}

/**
 * Called once on mount from the root route. Persists the params only when at
 * least one is present, and never overwrites an earlier capture (first touch
 * wins) — internal navigation without params leaves the stored value intact.
 */
export function captureAcquisitionFromUrl(): void {
  if (typeof window === "undefined") return;
  if (read()) return;

  const params = new URLSearchParams(window.location.search);
  const next: Stored = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key)?.trim();
    if (value) next[key] = value.slice(0, 200);
  }
  const plan = params.get("plan")?.trim().toLowerCase();
  if (plan === "basic" || plan === "unlimited") next.plan = plan;

  if (Object.keys(next).length === 0) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private-mode / storage-disabled browsers simply lose the context.
  }
}

/** UTM values to stamp on the profile at signup; null when none were captured. */
export function getSignupSource(): SignupSource | null {
  const stored = read();
  if (!stored) return null;
  const source: SignupSource = {};
  for (const key of UTM_KEYS) {
    const value = stored[key];
    if (typeof value === "string" && value) source[key] = value;
  }
  return Object.keys(source).length > 0 ? source : null;
}

/** Plan captured from ?plan=, used to pre-select a card on the paywall. */
export function getPlanHint(): PlanHint | null {
  const plan = read()?.plan;
  return plan === "basic" || plan === "unlimited" ? plan : null;
}

/** Human-readable tag, e.g. "website / pricing". */
export function formatSignupSource(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const parts = UTM_KEYS.map((key) => record[key]).filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(" / ") : null;
}
