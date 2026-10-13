# Trust and identity: About this account, badges, trust score and Community Notes

Status: built and tested. The test files are `about`, `verification`, `trust` and `notes` under `apps/api/test/`; there are 112 API tests in total. Screenshots are in `docs/screenshots/trust/`.

Projectfeed's promise is that **every account that posts is a verified real person, and you can see where it's really based.** These four features make that visible and act on it.

---

## 1. About this account

Open it from any profile ("🇮🇳 Based in India · About this account") or from the profile menu.

| Signal | Source | Can a VPN fake it? |
|---|---|---|
| **Identity verified · country** | Issuing country of the KYC document | **No** |
| **Phone number · country** | Country code of the OTP-verified number | Only with a foreign SIM |
| **Usually connects from** | Majority country over 30 days, **excluding VPN, proxy, Tor and hosting addresses** | Those connections are ignored |

Plus: joined date, every username change (with a 30-day cooldown between changes) and "No rule violations in 12 months" for established accounts.

**Rules:**
- **Every account shows its actual country.** Founder's decision: no opt-out and no "region" substitute.
- **VPN use is legal and isn't labelled.** VPN connections are simply left out. An account that only uses VPNs shows "Not enough data yet". When no single country dominates, it shows "Varies".
- **Mismatches are shown as facts.** An Indian ID with a Singapore phone and connection means someone living abroad, and is shown that way, not as suspicious.
- **Country only.** No city and no GPS. Raw IP addresses are **never stored**: only daily per-country counts, which are deleted after 400 days.
- **No unfiltered country.** If VPN detection isn't configured, "Usually connects from" shows "Not available", so we never display a country a VPN could have faked.
- **Changes are visible.** A new majority country is logged and shown ("Changed 1 time in the past year").

**Production setup:**
- `GEOIP_COUNTRY_DB` points to MaxMind GeoIP2 or GeoLite2 Country.
- `GEOIP_ANONYMOUS_DB` points to MaxMind's GeoIP2 Anonymous IP database (paid), which does the VPN detection.
- The ID country comes from the KYC vendor and the phone country from the SMS one-time-code flow. **Neither vendor flow is built yet.** Today these fields are set by the seed and tests.

## 2. Badges

| Badge | Paid? | Granted when |
|---|---|---|
| Gold tick: ID verified | Free | The KYC check passes |
| 💼 Verified business (blue) | Monthly | Compliance checks the GSTIN, CIN, LLPIN or Udyam number on the official registry, and the authorised signatory |
| ⭐ Creator (violet) | Monthly | Compliance reviews an ID-verified applicant |
| Public figure / government / news | **Never sold** | Compliance grants it on published criteria (logged) |

How badges work:
- **Paid badges show only while the plan is active.** Payments are recorded manually by staff (invoice or bank transfer reference) until in-app billing is added: Razorpay on the web, or Apple and Google in-app purchases.
- **Registration numbers are checked as people type.** GSTINs are checked against the official mod-36 check digit, alongside format checks for CIN, LLPIN and Udyam numbers.
- **Affiliations.** A verified business invites people by username. Once they accept, the business's logo appears next to their name and "Works at …" on their profile. Either side can end it, and the logo disappears if the business's plan lapses.
- **Paid partnership.** Verified businesses and creators can label sponsored posts "Paid partnership", as the ASCI influencer guidelines require.
- **In the console:** a Verification queue (compliance role), plus an identity, badge and plan panel on each account page.

## 3. Private trust score (0–100)

It's never shown to other users. Each account holder sees their own score and its reasons on **Account status**, and staff see it in the console.

| Factor | Points |
|---|---|
| Starting score | 50 |
| ID verified / verified organisation | +15 / +5 |
| Account age | +1 per month (up to +10) |
| No rule violations in 12 months (accounts at least 90 days old) | +10 |
| Each upheld violation in 12 months (removal, warning, suspension, ban; overturned appeals excluded) | −15 |
| Upheld reports in 90 days | −5 each (up to −20) |
| Blocked by 3 or more people in 30 days | −2 each (up to −15) |
| Posts with a shown "misleading" Community Note in 90 days | −5 each (up to −15) |
| Suspended or under review | Capped at 10 |

Bands: **Excellent** (80+), **Good** (60+), **Fair** (40+), **Limited** (below 40).

| What it changes | How |
|---|---|
| For You | Ranking multiplier from 0.6 (score 0) to 1.4 (score 100). **Limited** accounts are never recommended outside their followers. |
| Replies | Limited accounts' replies are ranked below everyone else's, and engagement is weighted by trust. |
| DMs | New conversations per day: Excellent 100, Good 50, Fair 20, Limited 5. |
| Community Notes | Rating needs Fair or better; writing needs Good or better. |

The score is recalculated after moderation actions, blocks and note outcomes, and refreshed hourly in the background.

## 4. Community Notes

- **Who can contribute.** Contributors must be ID-verified, have an account at least 30 days old, and have trust of 40+ to rate or 60+ to write. They can write up to 10 notes a day. Nobody can write or rate notes on their own posts.
- **Note rules.** "Misleading" notes need at least one source link.
- **How notes are scored.** **Bridging**, X's open-source matrix-factorisation model:
  - The model learns the main axis along which raters disagree. A note is shown only if it is rated helpful **across** that axis: helpfulness score ≥ 0.40 and viewpoint factor below 0.5, with at least 5 ratings.
  - A note only one side likes is explained by the viewpoint factor and stays hidden.
  - The status thresholds are X's published values. The regularisation strength (how hard scores are pulled towards zero) is tuned to our implementation. The tests reproduce the behaviour with two polarised groups of raters.
- **Display.** Shown notes appear under the post as **"Readers added context"**. Contributors rate notes from the post menu or from **Settings → Community Notes**.
- **Scoring schedule.** Notes are re-scored a few seconds after new ratings and hourly. At scale this should move to a batch job.

## 5. Before launch

- [ ] Connect the KYC vendor (Indian options: HyperVerge, IDfy or Signzy, via DigiLocker, Aadhaar offline e-KYC or PAN) and SMS one-time codes for the ID and phone countries.
- [ ] Buy the MaxMind GeoIP2 Anonymous IP database; confirm current pricing.
- [ ] Set badge pricing after benchmarking what X and Meta charge for verification in India; add Razorpay plus Apple and Google in-app billing.
- [ ] Publish the badge criteria for public figure, government and news accounts.
- [ ] Update the privacy notice: KYC country, phone country, connection country (country level, VPN-filtered, no raw IPs), the trust score and Community Notes. Needs Indian (DPDP) and UK GDPR review.
- [ ] Seed an initial pool of Community Notes contributors with diverse viewpoints. The algorithm needs disagreement to learn from.
