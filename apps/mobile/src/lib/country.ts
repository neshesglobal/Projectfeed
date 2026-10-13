/** Flag emoji from an ISO 3166-1 alpha-2 code ("IN" → 🇮🇳). */
export const flag = (code: string | null | undefined) =>
  code && /^[A-Z]{2}$/i.test(code) ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "";
