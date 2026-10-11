// "Translate post": on-demand, cached per post version and target language, with a daily spend cap.

import type { FastifyPluginAsync } from "fastify";
import { isLanguageCode, type PostTranslation, type TranslationConfig } from "@projectfeed/shared";
import { requireUser } from "../lib/auth";
import { AppError, badRequest, notFound } from "../lib/errors";
import { isId } from "../lib/ids";
import { hydratePosts } from "../services/hydrate";
import { TranslationUnavailable, segment } from "../services/translate";

/** Google Cloud Translation Basic is about $20 per million characters: the default cap is roughly $40/day. */
const DAILY_CHAR_BUDGET = Number(process.env.TRANSLATE_DAILY_CHAR_BUDGET ?? 2_000_000);

const translateRoutes: FastifyPluginAsync = async (app) => {
  const { sql, storage, translator } = app.ctx;
  const hctx = { db: sql, storage };

  app.get("/translation/config", async (): Promise<TranslationConfig> => ({
    enabled: !!translator,
    provider: translator?.name ?? "none",
    languages: translator?.languages ?? [],
  }));

  app.get<{ Params: { id: string }; Querystring: { to?: string } }>(
    "/posts/:id/translation",
    { config: { rateLimit: { max: Number(process.env.TRANSLATE_RATE_LIMIT_PER_MIN ?? 30), timeWindow: "1 minute" } } },
    async (req): Promise<PostTranslation> => {
      const me = requireUser(req);
      if (!translator) throw new AppError(503, "TRANSLATION_DISABLED", "Translation is not available");
      const to = req.query.to;
      if (!isLanguageCode(to) || !translator.languages.includes(to)) throw badRequest("Unsupported language");
      if (!isId(req.params.id)) throw notFound("Post");
      const post = (await hydratePosts(hctx, me.id, [req.params.id])).get(req.params.id);
      if (!post || post.unavailable) throw notFound("Post");
      if (!post.text.trim()) throw badRequest("This post has no text to translate");

      const base = { postId: post.id, targetLang: to };
      if (post.lang === to) return { ...base, text: post.text, sourceLang: to, sameLanguage: true, provider: "none" };

      const [cached] = await sql<{ text: string; source_lang: string | null; provider: string }[]>`
        SELECT text, source_lang, provider FROM post_translations
        WHERE post_id = ${post.id} AND target_lang = ${to} AND version = ${post.editCount}`;
      if (cached) {
        return { ...base, text: cached.text, sourceLang: cached.source_lang, sameLanguage: cached.source_lang === to, provider: cached.provider };
      }

      // Spend cap: reserve the characters atomically before calling the provider.
      const chars = post.text.length;
      const reserved = await sql`
        INSERT INTO translation_usage AS u (day, chars, calls) VALUES (current_date, ${chars}, 1)
        ON CONFLICT (day) DO UPDATE SET chars = u.chars + excluded.chars, calls = u.calls + 1
        WHERE u.chars + excluded.chars <= ${DAILY_CHAR_BUDGET}
        RETURNING 1`;
      if (reserved.count === 0 || chars > DAILY_CHAR_BUDGET) {
        throw new AppError(503, "TRANSLATION_BUDGET", "Translation is busy right now. Please try again later.");
      }

      let result;
      try {
        result = await translator.translate(segment(post.text), to, post.lang);
      } catch (e) {
        req.log.warn(e);
        if (e instanceof TranslationUnavailable) throw new AppError(503, "TRANSLATION_UNAVAILABLE", e.message);
        throw new AppError(502, "TRANSLATION_FAILED", "Couldn't translate this post. Please try again.");
      }

      const source = result.detectedSource;
      const same = source === to;
      const text = same ? post.text : result.text;
      await sql`
        INSERT INTO post_translations (post_id, version, target_lang, source_lang, provider, text)
        VALUES (${post.id}, ${post.editCount}, ${to}, ${source}, ${translator.name}, ${text})
        ON CONFLICT DO NOTHING`;
      // Learn from the provider's detection (e.g. Devanagari that is actually Marathi).
      if (source && isLanguageCode(source) && source !== post.lang) {
        await sql`UPDATE posts SET lang = ${source} WHERE id = ${post.id} AND edit_count = ${post.editCount}`;
      }
      return { ...base, text, sourceLang: source, sameLanguage: same, provider: translator.name };
    },
  );
};

export default translateRoutes;
