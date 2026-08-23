// Address and contact validation for manual orders. A bad address means a
// lost parcel and a dispute we pay for — these rules reject obviously wrong
// input instead of warning.

/** Countries where a state/province/region is mandatory in the address. */
export const STATE_REQUIRED: ReadonlySet<string> = new Set(["US", "CA", "AU", "BR"]);

/** Countries with no postal code system — postal code must NOT be required. */
export const NO_POSTAL_CODE: ReadonlySet<string> = new Set([
  "AE", "AG", "AO", "AW", "BS", "BZ", "BJ", "BO", "BW", "BF", "BI", "CM", "CF",
  "TD", "KM", "CG", "CI", "CW", "DJ", "DM", "GQ", "ER", "FJ", "GM", "GY", "HK",
  "JM", "KI", "KW", "LY", "MO", "MW", "ML", "MR", "MU", "PA", "QA", "RW", "KN",
  "LC", "ST", "SC", "SL", "SR", "SY", "TL", "TG", "TO", "TT", "TV", "UG", "VU",
  "YE", "ZW", "GD", "MS", "NR", "NU", "CK", "SX", "GH",
]);

const POSTAL_PATTERNS: Record<string, RegExp> = {
  US: /^\d{5}(-\d{4})?$/,
  CA: /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/,
  GB: /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/,
  DE: /^\d{5}$/,
  FR: /^\d{5}$/,
  ES: /^\d{5}$/,
  IT: /^\d{5}$/,
  PT: /^\d{4}-\d{3}$/,
  NL: /^\d{4}\s?[A-Za-z]{2}$/,
  BE: /^\d{4}$/,
  AT: /^\d{4}$/,
  CH: /^\d{4}$/,
  PL: /^\d{2}-\d{3}$/,
  BR: /^\d{5}-?\d{3}$/,
  AU: /^\d{4}$/,
  NZ: /^\d{4}$/,
  JP: /^\d{3}-?\d{4}$/,
  SE: /^\d{3}\s?\d{2}$/,
  NO: /^\d{4}$/,
  DK: /^\d{4}$/,
  IE: /^[A-Za-z0-9]{3}\s?[A-Za-z0-9]{4}$/,
};

const GENERIC_POSTAL = /^[A-Za-z0-9][A-Za-z0-9 -]{1,10}$/;

/** Returns an error message, or null when the postal code is acceptable. */
export function postalCodeError(country: string, code: string): string | null {
  const cc = country.trim().toUpperCase();
  const value = code.trim();
  if (NO_POSTAL_CODE.has(cc)) {
    return null; // not applicable — whatever was entered (or nothing) is fine
  }
  if (!value) return "Postal code is required for this country";
  const pattern = POSTAL_PATTERNS[cc];
  if (pattern) {
    return pattern.test(value) ? null : `Postal code doesn't look right for ${cc}`;
  }
  return GENERIC_POSTAL.test(value) ? null : "Postal code doesn't look valid";
}

/** International format with country dialling code, e.g. +14155552671. */
export function phoneError(phone: string): string | null {
  const value = phone.trim().replaceAll(/[\s()-]/g, "");
  if (!/^\+[1-9]\d{6,14}$/.test(value)) {
    return "Phone must be in international format with country code (e.g. +14155552671)";
  }
  return null;
}

export function emailError(email: string): string | null {
  const value = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return "Enter a valid email address";
  return null;
}

export interface AddressFields {
  name: string;
  email: string;
  phone: string;
  address1: string;
  address2: string;
  city: string;
  postal_code: string;
  state: string;
  country: string;
}

/** Validates a full end-customer address. Returns a field → message map. */
export function validateAddressFields(a: AddressFields): Partial<Record<keyof AddressFields, string>> {
  const errors: Partial<Record<keyof AddressFields, string>> = {};
  const cc = a.country.trim().toUpperCase();
  if (a.name.trim().length < 2) errors.name = "Full name is required";
  const emailErr = emailError(a.email);
  if (emailErr) errors.email = emailErr;
  const phoneErr = phoneError(a.phone);
  if (phoneErr) errors.phone = phoneErr;
  if (a.address1.trim().length < 3) errors.address1 = "Address line 1 is required";
  if (!a.city.trim()) errors.city = "City is required";
  if (!/^[A-Z]{2}$/.test(cc)) {
    errors.country = "Select a country";
  } else {
    if (STATE_REQUIRED.has(cc) && !a.state.trim()) {
      errors.state = `State/province is required for ${cc}`;
    }
    const postalErr = postalCodeError(cc, a.postal_code);
    if (postalErr) errors.postal_code = postalErr;
  }
  return errors;
}
