# Trust & Safety: moderation console, access tiers and upload screening

Status: built and tested (`apps/api/test/moderation.test.ts`, 18 tests). Screenshots: `docs/screenshots/moderation/`.

**Not legal advice.** The UK Online Safety Act 2023 (OSA), UK GDPR and the statutory reporting duties need sign-off from a UK solicitor and a data-protection specialist before launch. Ofcom's codes of practice also need to be checked.

---

## 1. Principles

1. **Public content is moderated openly. Private content is moderated by exception.**
   - Moderators can browse anything a logged-out visitor could see.
   - Moderators reach anything private only through a report or flag, at a higher role, with a written reason that is permanently logged.
2. **Screen before you store.** Known abuse imagery is blocked at upload, before a byte reaches public storage.
3. **Every decision is explained and appealable.** The user receives a *statement of reasons* (the policy cited plus a plain-English explanation). Appeals go to a different moderator.
4. **Nobody can quietly widen their own access.**
   - Roles are set only by admins, and admins can't change their own role.
   - The access log is append-only at the database level, so no one can edit or delete entries, admins included.

## 2. Staff roles

Roles are cumulative: each role has every power of the roles above it.

| Role | Can do |
|---|---|
| **Support** | View queues, public posts, images, videos and profiles, and account status. No personal data. Cannot act. |
| **Moderator** | + Remove and restore posts, label media sensitive, limit reach, warn, suspend for up to **7 days**, dismiss reports. |
| **Senior moderator** | + Suspend for longer or indefinitely, ban and unban, decide appeals. Can open a **reported or flagged protected-account post** with a justification (logged). |
| **Compliance** | + Open **reported DMs** with a justification (logged), reveal personal data such as email (logged), search by email (logged), freeze and unfreeze accounts, and handle the quarantine. |
| **Admin** | + Manage staff accounts and roles, and read the access log. |

The permission matrix is in `apps/api/src/lib/staff.ts` (`PERMS`). The console hides what a role can't do, and the API enforces it on every endpoint.

## 3. What moderators can see

| Content | Who | Conditions |
|---|---|---|
| Public posts, photos, videos, reels and profiles | Everyone with a staff role | Search by keyword, @handle, #hashtag, date range, media and state (reported, removed, sensitive or limited). There is also a *Latest uploads* stream. |
| Protected-account posts | Senior moderator and above | Only when the post is the subject of a report. The reveal needs a typed justification (15+ characters) and is logged. Protected accounts are excluded from browsing, search and the uploads stream. |
| Direct messages | Compliance and above | Only a **reported message**, or a legal request handled outside the console. The reveal shows the reported message plus up to 4 earlier messages, and only if the reporter is in the conversation, so it shows only what the reporter could already see. Messages sent after the reported one are never shown. There is **no endpoint to list or browse conversations**. Logged with justification. |
| Email address (personal data) | Compliance and above | Revealed per account with a justification, and logged. Searching by email is also logged. |
| Quarantined uploads | Compliance and above | **Metadata only**: list name, list reference, SHA-256, owner and time. The file itself is never stored, so there is nothing to display. |

## 4. Upload screening

Pipeline (`apps/api/src/services/screening.ts`):

1. **Images:**
   - The original bytes are hashed (SHA-256 and MD5) and the decoded image is perceptually hashed.
   - This happens *after* decoding and validation but *before* `storage.put`.
2. **Videos:**
   - The source file is streamed through SHA-256 and MD5.
   - The poster frame and keyframes at 10%, 50% and 90% are hashed.
   - This happens *after* transcoding but *before* the output moves to public storage.
3. **On a match:**
   - The bytes are discarded.
   - The `media` row becomes `quarantined` and a `media_scans` row records the match.
   - A **P0 report** is raised with `source=screening`.
   - The account is **frozen**: read-only and hidden from others.
   - The user sees only "This file can't be uploaded" and "Account under review". They are **not told why**, because alerting a suspect can prejudice a police investigation.
4. **If the scanner fails**, the upload is rejected with `503 SCREENING_UNAVAILABLE` (fail closed).
5. **In production, the API refuses to start** without a scanner configured (`SCREENING_HASH_LIST` or `SCREENING_PROVIDER`). It starts without one only if `SCREENING_DISABLED=true` is set deliberately.
6. **Compliance resolves each match** from the Quarantine page:
   - **Confirm:** bans the account and closes the report. The statutory report to the **NCA** (and to the **IWF** where relevant) is filed outside the system, and its reference goes in the justification.
   - **False positive:** unfreezes the account. The file stays rejected and the user can upload again.

Scanners:

- **`HashListScanner`:** a local list of `sha256:`, `md5:` and `dhash:` entries. It is for development and tests only, and uses **benign synthetic images**.
- **`PhotoDnaScanner`:** a stub. Microsoft PhotoDNA is available through IWF membership in the UK or NCMEC in the US, under a signed agreement. Thorn Safer is an alternative.
- **`NoopScanner`:** development default only.

> **Testing rule:** never create, download or store real abuse material, including for tests. The test suite generates synthetic patterns and puts *their* hashes in a test list.

**Known limitation.** dHash only stands in for PhotoDNA or PDQ. It survives re-encoding and resizing, but not crops or heavy edits, and it would have a higher false-positive rate on real traffic. Classifiers for *unknown* material (nudity, violence, new CSAM) are the next layer and plug into the same `MediaScanner` interface.

## 5. Decisions

| Action | Effect | Strike | User notified |
|---|---|---|---|
| Remove post | Shown to others as "removed for breaking the Projectfeed Rules"; dropped from feeds, search and trends | Yes | Yes |
| Label sensitive | Media shown behind a blurred "Sensitive content · Show" interstitial; excluded from Reels | — | Yes |
| Limit reach | Still visible to followers and by direct link; excluded from For You (out of network), Reels, search and trends | — | Yes |
| Warn | Notice only | Yes | Yes |
| Suspend (timed or indefinite) | **Read-only**: can sign in, read, appeal and sign out, but not post, like, follow or message. Others see "suspended account". Timed suspensions lift automatically. | Yes | Yes |
| Ban | Signed out everywhere and cannot sign in | — | Yes |
| Freeze | Read-only and hidden from others, pending compliance review | — | **No** (to avoid alerting a suspect) |

Every action needs a policy reason and a statement of at least 10 characters. Acting on a report closes every open report on the same item.

**Appeals:**

- Any notified decision except a freeze can be appealed once, within 90 days, including by a suspended user.
- Appeals are decided by a senior moderator who **did not make the original decision**.
- Overturning an appeal reverses the action (restore, unlabel, unlimit, unsuspend or unban) and removes the strike.

## 6. Service levels (targets)

| Priority | Reasons | Target |
|---|---|---|
| P0 | Hash match | Within 1 hour, 24/7 |
| P1 | Child safety, terrorism, self-harm | Within 1 hour |
| P2 | Scam or fraud, violence, illegal goods | Within 4 hours |
| P3 | Everything else | Within 24 hours |

## 7. Privacy policy disclosure (draft for counsel)

> **How we review content.** We check every photo and video when it is uploaded against databases of known child sexual abuse material. We do this before the file is published. If a file matches, we block it, may suspend the account and will report it to the UK National Crime Agency as the law requires.
>
> Our trained Trust & Safety staff review public posts, photos, videos and profiles to enforce the Projectfeed Rules.
>
> Posts from protected accounts are reviewed only if someone reports them or our systems flag them. Only senior staff can review them, and every review is recorded.
>
> We do not read your direct messages. A small number of compliance staff can view a specific message only if a participant in the conversation reports it, or if we receive a valid legal request. Even then, they see only the reported message and the messages immediately before it. Every such view is recorded with the reason for it.
>
> When we act on your content or account, we tell you which rule was broken and why. You can appeal within 90 days, and a different reviewer will look at your appeal.

## 8. Before launch

- [ ] Sign the PhotoDNA agreement (IWF or NCMEC) or the Thorn Safer agreement, and wire up `PhotoDnaScanner`.
- [ ] Set up an NCA reporting process. Decide evidence preservation with counsel: today the bytes are discarded on match and only the hashes and metadata are kept.
- [ ] Complete the OSA illegal-content and children's risk assessments, and record them.
- [ ] Add 2FA for staff (TOTP or WebAuthn) or SSO, IP allow-listing for the console, and session timeouts. Staff tokens currently last 8 hours and are stored in the browser session only.
- [ ] Ship the privacy policy disclosure (§7), with counsel's sign-off.
- [ ] Set access-log retention, and add periodic review by someone other than the person being audited.
- [ ] Recruit moderators and train them on wellbeing, including exposure limits and support.
