// Badges and Indian business registration formats (validated client- and server-side; a reviewer still checks
// the registration against the official registry before approving).

export const PAID_BADGES = ["business", "creator"] as const;
/** Granted by Projectfeed on published criteria. Never sold. */
export const GRANTED_BADGES = ["public_figure", "government", "news"] as const;
export type Badge = (typeof PAID_BADGES)[number] | (typeof GRANTED_BADGES)[number];

export const BADGE_LABEL: Record<Badge, string> = {
  business: "Verified business",
  creator: "Creator",
  public_figure: "Public figure",
  government: "Government",
  news: "News organisation",
};

export const REGISTRATION_TYPES = ["GSTIN", "CIN", "LLPIN", "UDYAM", "OTHER"] as const;
export type RegistrationType = (typeof REGISTRATION_TYPES)[number];

const B36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** GSTIN: state code + PAN + entity number + 'Z' + checksum (mod-36, as published by GSTN). */
export function isValidGstin(raw: string): boolean {
  const g = raw.trim().toUpperCase();
  if (!/^(0[1-9]|[1-3]\d)[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = B36.indexOf(g[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return B36[(36 - (sum % 36)) % 36] === g[14];
}

export function validateRegistration(type: RegistrationType, raw: string): string | null {
  const v = raw.trim().toUpperCase();
  switch (type) {
    case "GSTIN":
      return isValidGstin(v) ? null : "That GSTIN isn't valid. It has 15 characters, e.g. 27AAPFU0939F1ZV.";
    case "CIN":
      return /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/.test(v) ? null : "That CIN isn't valid. It has 21 characters, e.g. U74999MH2016PTC123456.";
    case "LLPIN":
      return /^[A-Z]{3}-\d{4}$/.test(v) ? null : "That LLPIN isn't valid, e.g. AAB-1234.";
    case "UDYAM":
      return /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/.test(v) ? null : "That Udyam number isn't valid, e.g. UDYAM-MH-19-0012345.";
    case "OTHER":
      return v.length >= 3 ? null : "Enter the company's registration number.";
  }
}
