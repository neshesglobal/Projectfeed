# Post translation

Status: built and tested (`apps/api/test/translation.test.ts`, 13 tests). Screenshots are in `docs/screenshots/translation/`.

## What users see

- **The Translate button.** Any post written in a language other than the reader's shows **"Translate post"**, or **"Translate · हिन्दी"** when translating into an Indian language. Tapping it shows the translation under the original, with "Translated from Hindi by Google" and a **Hide translation** link.
- **Choosing a language.** **Settings → Language** sets the language posts are translated into. The options are English plus the 22 scheduled languages of India, each shown in its own script. The default is **Automatic**, which uses the phone's language: a phone set to Tamil gets Tamil.
- **Tags, tickers, mentions and links are never translated.** `#EN590`, `$XAU`, `@amara_fuel`, `#भारत` and URLs come back unchanged and stay tappable.
- **Translation is on demand only.** Nothing is sent for translation until someone taps the button.

## How it works

1. **Language detection at posting.**
   - Every post gets a `lang` when it is created or edited. This is a free, offline guess from the dominant script: Devanagari → Hindi, Tamil script → Tamil, Gurmukhi → Punjabi, and so on (`packages/shared/src/languages.ts`).
   - The guess decides whether the Translate button appears.
   - Scripts shared by several languages are corrected on first translation. Devanagari, for example, could be Marathi or Nepali. The provider's detection is stored back on the post, so a Marathi post stops offering "Translate" to Marathi readers.
2. **Translation.**
   - `GET /v1/posts/:id/translation?to=hi` checks that the viewer can see the post (blocks, protected accounts and removed posts all apply).
   - It then returns a cached translation if there is one, or calls the provider.
   - Protected spans are sent to the provider as "do not translate".
3. **Caching.**
   - Translations are cached per **post, edit version and target language** (`post_translations`). Each post is paid for once per language, however many people read it.
   - Editing a post invalidates its cache.
4. **Cost controls.**
   - There is a daily character cap, `TRANSLATE_DAILY_CHAR_BUDGET`, default 2,000,000 characters (about $40/day at Google's list price).
   - Each user is limited to `TRANSLATE_RATE_LIMIT_PER_MIN` requests a minute, default 30.
   - When the cap is reached, users see "Translation is busy right now".

## Provider

| Setting | Behaviour |
|---|---|
| `TRANSLATE_PROVIDER=google` + `GOOGLE_TRANSLATE_API_KEY` | **Google Cloud Translation (Basic, v2).** Recommended for launch. |
| unset (development) | **Demo translator.** Hand-written Hindi, Tamil and English versions of the seed posts only. Any other post shows a clear "demo mode" message, never a fake translation. |
| unset (production) | Translation is off and the button is hidden. |

`TRANSLATE_LANGUAGES=en,hi,ta,...` limits the picker to the languages the chosen provider actually supports.

**Why Google for launch:**
- It is cheap (about $20 per million characters; a 280-character post costs fractions of a paisa).
- It responds in well under a second.
- It covers Hindi and the major Indian languages, and it supports HTML "do not translate" spans, which we use to protect tickers and tags.

**Before going live:**
- [ ] **Check language coverage.** Confirm Google's current list covers every code in `LANGUAGES`. Bodo (`brx`), Kashmiri (`ks`) and Santali (`sat`) are the least certain. Set `TRANSLATE_LANGUAGES` to match.
- [ ] **Commodity jargon.** Generic machine translation can mangle trade terms such as laytime, crack spread, backwardation and loco London. Tickers and tags are already protected. A **Google glossary** (Advanced, v3) would pin terms like "laytime → लेटाइम". It needs the v3 API, which is a small change to `GoogleTranslator`.
- [ ] **Alternatives worth a look:**
  - **Bhashini**, the Government of India's language mission: free, and focused on Indian languages, but with no commercial uptime commitment (SLA).
  - **AI4Bharat IndicTrans2**: open source and self-hostable, strong on Indian language pairs.
  - **An LLM** such as Claude: best with jargon and context, at a higher cost per character.
  The `Translator` interface takes any of these as a single adapter class.
- [ ] **Attribution.** Follow Google's attribution requirements. The app shows "Translated … by Google".
- [ ] **Privacy policy.** Only public post text is sent to the provider, but the privacy policy should name the provider as a processor (under the UK GDPR, and India's Digital Personal Data Protection Act 2023).

## Known limits

- **Romanised Hindi ("Hinglish")** in Latin script is guessed as English, so a reader whose language is English won't see the button on it. The provider detects it correctly when someone translates it.
- **DMs, bios and the app's own menus** are not translated. The app interface in Hindi and other Indian languages is a separate piece of work: interface localisation.
