// World regions for "Who can reply". A person's region comes from the country on their verified ID (or, failing
// that, their verified phone number), so a VPN can't change it.

export const REGIONS = [
  "south_asia",
  "central_asia",
  "west_asia",
  "east_asia",
  "southeast_asia",
  "europe",
  "africa",
  "north_america",
  "south_america",
  "australasia",
] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_LABEL: Record<Region, string> = {
  south_asia: "South Asia",
  central_asia: "Central Asia",
  west_asia: "West Asia",
  east_asia: "East Asia",
  southeast_asia: "Southeast Asia",
  europe: "Europe",
  africa: "Africa",
  north_america: "North America",
  south_america: "South America",
  australasia: "Australasia",
};

/** Short description of each region for the picker. */
export const REGION_HINT: Record<Region, string> = {
  south_asia: "India, Pakistan, Bangladesh, Sri Lanka, Nepal, Bhutan, Maldives, Afghanistan",
  central_asia: "Kazakhstan, Uzbekistan, Kyrgyzstan, Tajikistan, Turkmenistan",
  west_asia: "Gulf states, Iran, Iraq, Türkiye, Israel, Levant, Caucasus",
  east_asia: "China, Japan, South Korea, Taiwan, Hong Kong, Mongolia",
  southeast_asia: "Indonesia, Malaysia, Singapore, Thailand, Vietnam, Philippines and neighbours",
  europe: "EU, UK, Norway, Switzerland, Russia, Ukraine and the Balkans",
  africa: "All African countries, including North Africa",
  north_america: "USA, Canada, Mexico, Central America and the Caribbean",
  south_america: "Brazil, Argentina, Chile, Colombia, Peru and neighbours",
  australasia: "Australia, New Zealand and the Pacific islands",
};

const COUNTRIES: Record<Region, string> = {
  south_asia: "IN PK BD LK NP BT MV AF",
  central_asia: "KZ UZ KG TJ TM",
  west_asia: "SA AE QA KW BH OM YE IQ IR IL PS JO LB SY TR AM AZ GE",
  east_asia: "CN JP KR KP TW HK MO MN",
  southeast_asia: "ID MY SG TH VN PH MM KH LA BN TL",
  europe:
    "GB IE FR DE NL BE LU AT CH LI IT ES PT AD MC SM VA MT GR CY DK SE NO FI IS EE LV LT PL CZ SK HU SI HR BA RS ME MK AL XK RO BG MD UA BY RU GI IM JE GG FO AX",
  africa:
    "DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU YT MA MZ NA NE NG RE RW SH ST SN SC SL SO ZA SS SD TZ TG TN UG EH ZM ZW",
  north_america:
    "US CA MX GT BZ SV HN NI CR PA CU JM HT DO PR BS BB TT AG DM GD KN LC VC AI AW BM BQ VG KY CW GP MQ MS BL MF PM SX TC VI GL",
  south_america: "BR AR CL CO PE VE EC BO PY UY GY SR GF FK",
  australasia: "AU NZ PG FJ SB VU NC PF WS TO KI FM MH PW NR TV CK NU GU MP AS WF NF",
};

const BY_COUNTRY = new Map<string, Region>();
for (const r of REGIONS) for (const cc of COUNTRIES[r].split(" ")) BY_COUNTRY.set(cc, r);

/** Region for an ISO 3166-1 alpha-2 country code, or null if unknown. */
export function regionOf(country: string | null | undefined): Region | null {
  return country ? (BY_COUNTRY.get(country.toUpperCase()) ?? null) : null;
}
