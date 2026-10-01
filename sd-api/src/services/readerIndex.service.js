"use strict";

/**
 * A published story, searchable by meaning.
 *
 * The blocks the reader is reading and the passages of the paper are
 * embedded once per story version and reading level, and kept; a question
 * is embedded when the companion searches, and the closest blocks and
 * passages come back with their similarity. The companion decides what to
 * read from them.
 *
 * The index is built the first time the companion searches a story, not on
 * every question, and it is rebuilt when the story changes version or when
 * the embedding model it was built with is no longer the one answering.
 */

const { COLLECTIONS } = require("../db/mongo");

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

async function build({ db, router, key, items, cacheDays, signal }) {
  const r = await router.embed(items.map((i) => i.text), { taskType: "RETRIEVAL_DOCUMENT", signal });
  const row = {
    ...key,
    model: r.model,
    items: items.map((i, n) => ({ id: i.id, kind: i.kind, text: i.text, vector: r.vectors[n] })),
    created_at: new Date(),
    expires_at: new Date(Date.now() + cacheDays * 24 * 60 * 60 * 1000),
  };
  await db.collection(COLLECTIONS.readerIndex).updateOne({ ...key, model: r.model }, { $set: row }, { upsert: true });
  return row;
}

/**
 * A search function over one story at one level, built lazily.
 *
 * @param {object} p
 * @param {import("mongodb").Db} p.db
 * @param {object} p.router
 * @param {{story_id, story_version, audience}} p.key
 * @param {{id,text}[]} p.blocks
 * @param {{id,text}[]} p.passages
 * @param {number} p.topK
 * @param {number} p.cacheDays
 * @param {AbortSignal} [p.signal]
 * @returns {(query: string) => Promise<{id, kind, text, score}[]>}
 */
function searcherFor({ db, router, key, blocks, passages, topK, cacheDays, signal = null }) {
  const items = [
    ...blocks.map((b) => ({ id: b.id, kind: "block", text: b.text })),
    ...passages.map((p) => ({ id: p.id, kind: "passage", text: p.text })),
  ];
  let index = null;
  return async function search(query) {
    if (!items.length) return [];
    if (!index) {
      index = await db.collection(COLLECTIONS.readerIndex).find(key).sort({ created_at: -1 }).limit(1).next();
      if (!index || index.items?.length !== items.length) index = await build({ db, router, key, items, cacheDays, signal });
    }
    let q;
    try {
      q = await router.embed([query], { taskType: "RETRIEVAL_QUERY", model: index.model, signal });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      /* The model the index was built with is down: rebuild with whichever answers. */
      index = await build({ db, router, key, items, cacheDays, signal });
      q = await router.embed([query], { taskType: "RETRIEVAL_QUERY", model: index.model, signal });
    }
    const v = q.vectors[0];
    return index.items
      .map((i) => ({ id: i.id, kind: i.kind, text: i.text, score: cosine(v, i.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  };
}

module.exports = { searcherFor, cosine };
