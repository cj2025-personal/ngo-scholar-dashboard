"use strict";

/**
 * Rulings a judge gives once and the page reads many times, cached.
 *
 * The paper's caveats depend only on the paper, so they are kept per set of
 * passages; the article review depends on the article, so it is kept per
 * story version and voice. A ruling that could not be had is never cached:
 * the next read asks again.
 */

const crypto = require("crypto");

const { COLLECTIONS } = require("../db/mongo");
const vertex = require("../lib/vertex");
const caveatJudge = require("../lib/agents/caveatJudge");
const articleReviewer = require("../lib/agents/articleReviewer");
const checks = require("../lib/checks");
const { getPolicy } = require("./policy.service");
const { routerFor } = require("./models.service");
const { recordDecision } = require("./agentAudit.service");

const plain = (html) => String(html || "").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

async function cached(db, { key, kind, make, subject }) {
  const coll = db.collection(COLLECTIONS.agentRulings);
  const hit = await coll.findOne({ key });
  if (hit) return { ...hit.ruling, cached: true };
  const made = await make();
  const { calls = [], ...ruling } = made;
  if (!ruling.unchecked) {
    const drafting = await getPolicy("drafting", { db });
    const now = new Date();
    await coll.updateOne({ key }, { $set: { key, kind, ruling, created_at: now, expires_at: new Date(now.getTime() + drafting.rulingCacheDays * 24 * 60 * 60 * 1000) } }, { upsert: true });
  }
  if (subject) {
    void recordDecision({ agent: `drafting.${kind}`, subject, decision: kind === "caveats" ? { caveats: ruling.ids || [] } : { headings: (ruling.headings || []).filter((h) => h.promisesUnsaid).length, pronouns: (ruling.pronouns || []).length, droning: ruling.rhythm?.droning ?? null }, rationale: ruling.unchecked ? "unchecked" : null, model: calls[calls.length - 1]?.model || null, promptVersion: ruling.version || null, usage: calls[0]?.usage || null }, { db });
  }
  return { ...ruling, cached: false };
}

/**
 * Where this paper states its own caveats.
 * @param {import("mongodb").Db} db
 * @param {{id:string, text:string}[]} passages
 */
async function caveatsFor(db, passages, { subject = null } = {}) {
  if (!vertex.isConfigured()) return { ids: [], caveats: [], unchecked: true, version: caveatJudge.CAVEAT_VERSION };
  const digest = crypto.createHash("sha256").update(passages.map((p) => `${p.id}\u0000${p.text}`).join("\u0001")).digest("hex").slice(0, 32);
  return cached(db, {
    key: `caveats:${digest}:${caveatJudge.CAVEAT_VERSION}`,
    kind: "caveats",
    subject,
    make: async () => caveatJudge.findCaveats({ passages, generate: (await routerFor({ db })).bound("drafting.review") }),
  });
}

/**
 * The article reviewer's reading of a saved story version.
 * @param {import("mongodb").Db} db
 * @param {object} p
 * @param {string} p.storyId
 * @param {number} p.version
 * @param {string|null} p.title
 * @param {object[]} p.blocks      mapped blocks
 * @param {{id:string, text:string}[]} p.passages
 * @param {"author"|"about"} p.voice
 * @param {string|null} p.scholarName
 */
async function reviewFor(db, { storyId, version, title, blocks, passages, voice, scholarName }) {
  if (!vertex.isConfigured()) return { headings: [], pronouns: [], rhythm: null, unchecked: true, version: articleReviewer.REVIEW_VERSION };
  return cached(db, {
    key: `review:${storyId}:${version}:${voice}:${articleReviewer.REVIEW_VERSION}`,
    kind: "review",
    subject: { kind: "story", id: String(storyId) },
    make: async () => {
      const { sentences, runs } = checks.repeatedRuns(blocks);
      return articleReviewer.reviewArticle({
        title, voice, scholarName, passages,
        blocks: blocks.map((b) => ({ type: b.type, text: b.type === "image" ? `(illustration) ${b.caption || ""}`.trim() : plain(b.html) })),
        openers: checks.openerCounts(blocks).slice(0, 3), repeatedRuns: runs, sentences,
        generate: (await routerFor({ db })).bound("drafting.review"),
      });
    },
  });
}

module.exports = { caveatsFor, reviewFor };
