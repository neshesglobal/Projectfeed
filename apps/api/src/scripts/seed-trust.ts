// Demo data for "About this account", badges, trust and Community Notes. Run after seed.ts, seed-videos.ts and
// seed-moderation.ts. Fictional people and businesses only. Registration numbers are format-valid examples.

import { config } from "../config";
import { createDb, migrate } from "../db";
import { newId } from "../lib/ids";
import { recomputeConnectionCountry } from "../services/location";
import { refreshTrust } from "../services/trust";

const sql = createDb(config.databaseUrl);
await migrate(sql);
const [done] = await sql`SELECT 1 FROM users WHERE id_country IS NOT NULL LIMIT 1`;
if (done) {
  console.log("Trust demo data already present; skipping.");
  await sql.end();
  process.exit(0);
}
const users = await sql<{ id: string; handle: string }[]>`SELECT id, handle::text AS handle FROM users`;
const id = (h: string) => users.find((u) => u.handle === h)?.id;

// Established accounts (contributors need 30+ days), with ID country, phone country and where they connect from.
const PEOPLE: [handle: string, idCountry: string | null, phone: string | null, connects: string | null, ageDays: number][] = [
  ["demo", null, null, "IN", 40],
  ["amara_fuel", "NG", "NG", "NG", 320],
  ["hk_bullion", "EE", "CH", "CH", 410],
  ["priya_freight", "IN", "SG", "SG", 280], // Indian ID, lives in Singapore: shown truthfully, not as suspicious
  ["tf_carlos", "PT", "GB", "GB", 365],
  ["grainwatch", "BG", "BG", "BG", 190],
  ["lme_lena", "DE", "DE", "DE", 230],
  ["lng_omar", "AE", "AE", "AE", 150],
  ["rajesh_mundra", "IN", "IN", "IN", 260],
  ["kavya_agri", "IN", "IN", "IN", 210],
];
for (const [h, idc, phone, conn, age] of PEOPLE) {
  const uid = id(h);
  if (!uid) continue;
  await sql`UPDATE users SET id_country = ${idc}, id_verified_at = ${idc ? sql`now() - interval '20 days'` : null},
              phone_country = ${phone}, created_at = now() - make_interval(days => ${age}) WHERE id = ${uid}`;
  if (conn) {
    for (let d = 1; d <= 12; d++) {
      await sql`INSERT INTO connection_signals (user_id, day, country, anonymous) VALUES (${uid}, current_date - ${d}::int, ${conn}, false)`;
    }
    // Some VPN use too: ignored by design.
    await sql`INSERT INTO connection_signals (user_id, day, country, anonymous) VALUES (${uid}, current_date - 3, 'US', true)
              ON CONFLICT DO NOTHING`;
    await recomputeConnectionCountry(sql, uid);
  }
}
const fast = id("fast_deals_247");
if (fast) {
  // The scam account: passed no ID check, connects mostly through VPNs.
  for (let d = 1; d <= 8; d++) await sql`INSERT INTO connection_signals (user_id, day, country, anonymous) VALUES (${fast}, current_date - ${d}::int, 'NL', true)`;
}

// A username change on record.
if (id("lng_omar")) await sql`INSERT INTO handle_history (user_id, old_handle, new_handle, changed_at) VALUES (${id("lng_omar")!}, 'omar_gas', 'lng_omar', now() - interval '60 days')`;

// A verified business with an employee, and a creator.
const now = new Date();
const plus = (days: number) => new Date(now.getTime() + days * 86400_000);
const bizId = newId();
const [{ hash }] = (await sql`SELECT password_hash AS hash FROM users WHERE handle = 'rajesh_mundra'`) as unknown as [{ hash: string }];
await sql`INSERT INTO users (id, email, password_hash, handle, display_name, bio, company, sectors, kyc_level, account_type, badge, badge_granted_at,
                             id_country, phone_country, created_at)
          VALUES (${bizId}, 'desk@kutchpetro.example', ${hash}, 'kutchpetro', 'Kutch Petro Traders',
                  'Bonded storage and petroleum products trading. Mundra · Kandla.', 'Kutch Petro Traders Pvt Ltd', ${["Petroleum"]}, 2, 'business', 'business', now(),
                  'IN', 'IN', now() - interval '300 days')`;
await sql`INSERT INTO subscriptions (id, user_id, plan, status, provider, current_period_end) VALUES (${newId()}, ${bizId}, 'business', 'active', 'manual', ${plus(30)})`;
await sql`INSERT INTO verification_applications (id, user_id, kind, status, legal_name, reg_type, reg_number, country, signatory_name, signatory_role, review_note, decided_at)
          VALUES (${newId()}, ${bizId}, 'business', 'approved', 'Kutch Petro Traders Pvt Ltd', 'GSTIN', '27AAPFU0939F1ZV', 'IN', 'Rajesh Kumar', 'Director',
                  'GSTIN active on the GST portal; signatory matches ID.', now() - interval '10 days')`;
if (id("rajesh_mundra")) {
  await sql`INSERT INTO affiliations (org_id, member_id, title, status, accepted_at) VALUES (${bizId}, ${id("rajesh_mundra")!}, 'Director', 'active', now())`;
  await sql`UPDATE users SET affiliated_org_id = ${bizId} WHERE id = ${id("rajesh_mundra")!}`;
  await sql`INSERT INTO follows (follower_id, followee_id) SELECT id, ${bizId} FROM users WHERE id <> ${bizId} AND status = 'active' ON CONFLICT DO NOTHING`;
  await sql`UPDATE users SET followers_count = (SELECT count(*) FROM follows WHERE followee_id = ${bizId}) WHERE id = ${bizId}`;
}
await sql`INSERT INTO posts (id, author_id, text, conversation_id, lang, paid_partnership)
          VALUES (${newId()}, ${bizId}, 'Bonded tank space available at Kandla from 1 November: 20,000 m³ for EN590 and Jet A1. Enquiries via DM. #EN590', ${bizId}, 'en', true)`;
await sql`UPDATE posts SET conversation_id = id WHERE author_id = ${bizId}`;
if (id("lme_lena")) {
  await sql`UPDATE users SET badge = 'creator', badge_granted_at = now() WHERE id = ${id("lme_lena")!}`;
  await sql`INSERT INTO subscriptions (id, user_id, plan, status, provider, current_period_end) VALUES (${newId()}, ${id("lme_lena")!}, 'creator', 'active', 'manual', ${plus(30)})`;
}
// A pending application for the console queue.
if (id("amara_fuel")) {
  await sql`INSERT INTO verification_applications (id, user_id, kind, legal_name, reg_type, reg_number, country, website, signatory_name, signatory_role)
            VALUES (${newId()}, ${id("amara_fuel")!}, 'business', 'Lagoon Energy Ltd', 'OTHER', 'RC 1234567', 'NG', 'https://example.com', 'Amara Okafor', 'Head of Trading')`;
}

// An unverified "tips" account making a false-returns claim, with a Community Note shown under it.
// (Demo shortcut: the note's status is set directly; in the app it comes from the bridging scorer.)
const tipsId = newId();
await sql`INSERT INTO users (id, email, password_hash, handle, display_name, bio, created_at)
          VALUES (${tipsId}, 'tips@example.com', ${hash}, 'quickprofit_tips', 'Quick Profit Tips', 'Daily gold signals 📈', now() - interval '45 days')`;
for (let d = 1; d <= 8; d++) await sql`INSERT INTO connection_signals (user_id, day, country, anonymous) VALUES (${tipsId}, current_date - ${d}::int, 'US', true)`;
const tipPost = newId();
await sql`INSERT INTO posts (id, author_id, text, conversation_id, lang, like_count, view_count)
          VALUES (${tipPost}, ${tipsId}, 'Guaranteed 40% monthly returns trading gold! Send ₹50,000 today and we trade for you. Zero risk. DM now 🚀 #gold', ${tipPost}, 'en', 12, 340)`;
await sql`UPDATE users SET posts_count = 1 WHERE id = ${tipsId}`;
if (id("hk_bullion")) {
  const noteId = newId();
  await sql`INSERT INTO community_notes (id, post_id, author_id, classification, text, sources, status, intercept, factor, rating_count, status_changed_at)
            VALUES (${noteId}, ${tipPost}, ${id("hk_bullion")!}, 'misleading',
                    'No legitimate investment can guarantee 40% a month. Collecting money to trade on someone''s behalf requires SEBI registration, and "guaranteed returns" schemes are a common investment fraud pattern.',
                    ${["https://investor.sebi.gov.in/"]}, 'helpful', 0.52, 0.04, 9, now())`;
  for (const h of ["amara_fuel", "priya_freight", "tf_carlos", "grainwatch", "lme_lena", "lng_omar", "rajesh_mundra", "kavya_agri"]) {
    if (id(h)) await sql`INSERT INTO note_ratings (note_id, rater_id, helpful) VALUES (${noteId}, ${id(h)!}, 1)`;
  }
}
// A note still needing ratings, for the contributor queue.
const [jet] = await sql<{ id: string }[]>`SELECT id FROM posts WHERE text LIKE 'Jet A1 premiums in Rotterdam%' LIMIT 1`;
if (jet && id("lng_omar")) {
  await sql`INSERT INTO community_notes (id, post_id, author_id, classification, text, sources)
            VALUES (${newId()}, ${jet.id}, ${id("lng_omar")!}, 'not_misleading',
                    'Consistent with this week''s assessments: Jet A1 barge premiums in ARA held steady while Brent fell.', ${["https://www.argusmedia.com/"]})`;
}

for (const u of await sql<{ id: string }[]>`SELECT id FROM users`) await refreshTrust(sql, u.id);
await sql.end();
console.log("Trust, badges, location and Community Notes demo data ready.");
