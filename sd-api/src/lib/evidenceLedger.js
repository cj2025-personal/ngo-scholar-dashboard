"use strict";

/**
 * The evidence ledger: what a published story rests on, signed.
 *
 * ── Why a manifest and not a page ───────────────────────────────────────────
 * The reader's "Show sources" toggle answers "where did this come from" for
 * one person, on one screen, by trusting us. A manifest answers it for
 * anyone, offline, without trusting us: every paragraph, the claims the
 * fact-checker found in it, the passage each claim rests on and the sentence
 * quoted from it, the chain of versions with who made each one, the version
 * the scholar approved and when, and the models that were involved. It is
 * signed with a key only this service holds, so a school, a journal or a
 * scholar's estate can check that this is what was approved and that it has
 * not been altered since. It does the job content credentials do for
 * photographs, for prose, at the level of the claim.
 *
 * ── What is deliberately in and out ─────────────────────────────────────────
 * In: hashes of the passages, so a verifier who fetches the passages can
 * confirm they are the ones the claims were checked against. Out: the
 * passage text itself, which may be reproducible only under the paper's
 * licence and is served separately with that in mind. In: the scholar's
 * email as the approver, because the point is that a named person approved
 * it. Out: anything a reader could not otherwise see.
 *
 * ── Canonical bytes ─────────────────────────────────────────────────────────
 * A signature is over bytes, so the manifest is serialised one way only:
 * keys sorted, no whitespace. Any verifier that does the same gets the same
 * bytes. Ed25519, because it is small, fast, and has no parameters to get
 * wrong.
 */

const crypto = require("crypto");

const LEDGER_VERSION = "evidence-ledger-2026.2";

/* ── canonical JSON ─────────────────────────────────────────────────────── */

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

const plain = (html) => String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/* ── keys ───────────────────────────────────────────────────────────────── */

let ephemeral = null;

function parsePrivateKey(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const pem = text.includes("-----BEGIN") ? text : Buffer.from(text, "base64").toString("utf8");
  return crypto.createPrivateKey({ key: pem, format: "pem" });
}

function keyIdFor(publicKey) {
  return `ed25519-${sha256(publicKey.export({ type: "spki", format: "der" })).slice(0, 16)}`;
}

/**
 * The signing key for this process.
 *
 * Configured: from LEDGER_SIGNING_KEY. Unconfigured outside production: one
 * key generated per process, so local runs and tests produce real signatures
 * that verify against the key the same process publishes. Unconfigured in
 * production: null, and manifests go out marked unsigned rather than not at
 * all; the boot log says why.
 *
 * @returns {{privateKey: object, publicKey: object, keyId: string, ephemeral: boolean}|null}
 */
function loadKeys({ privateKey = null, keyId = null, isProduction = false } = {}) {
  const configured = parsePrivateKey(privateKey);
  if (configured) {
    const publicKey = crypto.createPublicKey(configured);
    return { privateKey: configured, publicKey, keyId: keyId || keyIdFor(publicKey), ephemeral: false };
  }
  if (isProduction) return null;
  if (!ephemeral) {
    const pair = crypto.generateKeyPairSync("ed25519");
    ephemeral = { privateKey: pair.privateKey, publicKey: pair.publicKey, keyId: keyIdFor(pair.publicKey), ephemeral: true };
  }
  return ephemeral;
}

function publicKeyPem(keys) {
  return keys ? keys.publicKey.export({ type: "spki", format: "pem" }) : null;
}

/* ── the manifest ───────────────────────────────────────────────────────── */

/**
 * @param {object} p
 * @param {object} p.story        the story as mapped for a client: bodyBlocks with sourceRefs/fidelity, provenance, author, version, slug
 * @param {object[]} p.revisions  raw revision rows for the story, any order
 * @param {{id: string, text: string}[]} p.passages
 * @param {object} p.versions     { drafter, judge, agent } version strings, whichever are known
 * @param {string|null} p.keyId
 * @param {Date} [p.generatedAt]
 */
function buildManifest({ story, revisions = [], passages = [], versions = {}, keyId = null, generatedAt = new Date() }) {
  const blocks = Array.isArray(story?.bodyBlocks) ? story.bodyBlocks : [];
  const paragraphs = [];
  /* Two ledgers in one: claims drawn from the paper, judged supported or
     not; and claims that go beyond it, judged to follow from it or not.
     `cited` counts paragraphs drawn from the paper; `extension` counts
     those built on it. A reader who wants only what the paper says can
     tell the two apart, paragraph by paragraph. */
  let totals = { paragraphs: 0, cited: 0, extension: 0, uncited: 0, own_view: 0, context: 0, to_verify: 0, verified: 0, claims: 0, supported: 0, unsupported: 0, follows: 0, overreach: 0 };

  blocks.forEach((b, i) => {
    if (b.type === "image") return;
    const text = plain(b.html);
    const cited = (Array.isArray(b.sourceRefs) ? b.sourceRefs : []).map((r) => r.passageId);
    const extension = Boolean(b.extension);
    const claims = extension
      ? (Array.isArray(b.reach?.claims) ? b.reach.claims : []).map((c) => ({
          text: c.text,
          verdict: c.verdict,
          reason: c.reason || null,
          passage_ids: Array.isArray(c.anchorIds) ? c.anchorIds : [],
          evidence: "",
        }))
      : (Array.isArray(b.fidelity?.claims) ? b.fidelity.claims : []).map((c) => ({
          text: c.text,
          verdict: c.verdict,
          passage_ids: Array.isArray(c.passageIds) ? c.passageIds : [],
          evidence: c.evidence || "",
        }));
    const isProse = b.type === "paragraph";
    if (isProse) {
      totals.paragraphs += 1;
      if (!cited.length) totals.uncited += 1;
      else if (extension) totals.extension += 1;
      else totals.cited += 1;
      if (b.ownView) totals.own_view += 1;
      /* The author's own context: what it brought in, and what the author has stood behind. */
      if (b.ownView && b.context) {
        totals.context += 1;
        const tv = Array.isArray(b.context.toVerify) ? b.context.toVerify : [];
        totals.to_verify += tv.length;
        totals.verified += tv.filter((v) => v.verified).length;
      }
      totals.claims += claims.length;
      if (extension) {
        totals.follows += claims.filter((c) => c.verdict === "follows").length;
        totals.overreach += claims.filter((c) => c.verdict !== "follows").length;
      } else {
        totals.supported += claims.filter((c) => c.verdict === "supported").length;
        totals.unsupported += claims.filter((c) => c.verdict !== "supported").length;
      }
    }
    paragraphs.push({
      index: i + 1,
      kind: b.type,
      hash: sha256(text),
      words: text ? text.split(/\s+/).length : 0,
      cited,
      verdict: (extension ? b.reach?.verdict : b.fidelity?.verdict) || null,
      traceable: typeof b.traceable === "boolean" ? b.traceable : null,
      own_view: Boolean(b.ownView),
      extension,
      claims,
      /* The author's own context carries no passage; it carries the specifics
         a reader could check, and whether the author did. Only where it is. */
      ...(b.ownView && b.context
        ? {
            context: {
              verdict: b.context.verdict || null,
              to_verify: (Array.isArray(b.context.toVerify) ? b.context.toVerify : []).map((v) => ({ text: v.text, kind: v.kind || "other", verified: Boolean(v.verified) })),
            },
          }
        : {}),
    });
  });

  const history = revisions
    .slice()
    .sort((a, b) => a.version - b.version)
    .map((r) => ({
      version: r.version,
      source: r.source,
      by: r.created_by || null,
      at: r.created_at ? new Date(r.created_at).toISOString() : null,
      turn_id: r.turn_id ? String(r.turn_id) : null,
      note: r.note || null,
    }));
  const current = history.length ? history[history.length - 1] : null;

  return {
    ledger_version: LEDGER_VERSION,
    generated_at: generatedAt.toISOString(),
    key_id: keyId,
    story: {
      id: String(story.id),
      slug: story.slug || null,
      title: story.title || "",
      version: story.version ?? 1,
      status: story.status || "draft",
      published_at: story.publishedAt ? new Date(story.publishedAt).toISOString() : null,
      public_url: story.publicUrl || null,
    },
    author: story.author ? { name: story.author.name || null, profile_id: story.author.profileId || story.author.profile_id || null } : null,
    source: story.provenance
      ? {
          origin: story.provenance.origin || null,
          source_id: story.provenance.sourceId || null,
          title: story.provenance.title || null,
          year: story.provenance.year ?? null,
          url: story.provenance.url || null,
          licence: story.provenance.licence || null,
          audience: story.provenance.audience || null,
        }
      : null,
    /* The version a reader is looking at, and the person who made it so. */
    approval: current ? { version: current.version, by: current.by, at: current.at, source: current.source } : null,
    history,
    paragraphs,
    passages: passages.map((p) => ({ id: p.id, hash: sha256(String(p.text || "").replace(/\s+/g, " ").trim()), words: String(p.text || "").split(/\s+/).filter(Boolean).length })),
    totals,
    models: {
      drafter: versions.drafter || null,
      judge: versions.judge || null,
      reach: versions.reach || null,
      agent: versions.agent || null,
    },
    content_hash: sha256(canonicalJson(paragraphs.map((p) => [p.index, p.kind, p.hash]))),
  };
}

/* ── signing ────────────────────────────────────────────────────────────── */

function sign(manifest, keys) {
  const bytes = Buffer.from(canonicalJson(manifest), "utf8");
  return crypto.sign(null, bytes, keys.privateKey).toString("base64");
}

/**
 * @returns {{valid: boolean, reason: string|null}}
 */
function verify(manifest, signatureBase64, publicKeyPemText) {
  try {
    const publicKey = crypto.createPublicKey({ key: publicKeyPemText, format: "pem" });
    const bytes = Buffer.from(canonicalJson(manifest), "utf8");
    const ok = crypto.verify(null, bytes, publicKey, Buffer.from(String(signatureBase64 || ""), "base64"));
    return ok ? { valid: true, reason: null } : { valid: false, reason: "the signature does not match the manifest" };
  } catch (error) {
    return { valid: false, reason: `could not verify: ${error.message}` };
  }
}

/**
 * Check a set of passages against the hashes a manifest recorded, so a
 * verifier who fetched them can be sure they are the ones the claims were
 * judged against.
 * @returns {{matched: number, mismatched: string[], missing: string[]}}
 */
function checkPassages(manifest, passages) {
  const have = new Map((passages || []).map((p) => [p.id, sha256(String(p.text || "").replace(/\s+/g, " ").trim())]));
  const mismatched = [];
  const missing = [];
  let matched = 0;
  for (const p of manifest.passages || []) {
    const h = have.get(p.id);
    if (h === undefined) missing.push(p.id);
    else if (h !== p.hash) mismatched.push(p.id);
    else matched += 1;
  }
  return { matched, mismatched, missing };
}

/** What the reader's footer says, from the totals alone. */
function summarySentence(manifest) {
  const t = manifest?.totals || {};
  if (!t.paragraphs) return "This story carries no evidence ledger.";
  const claims = t.claims || 0;
  if (!claims) return `${t.paragraphs} paragraph${t.paragraphs === 1 ? "" : "s"}, ${t.cited} drawn from the paper; no individual claims were recorded.`;
  const beyond = t.follows || t.overreach ? `; ${t.follows || 0} implication${t.follows === 1 ? "" : "s"} follow${t.follows === 1 ? "s" : ""} from it` + (t.overreach ? `, ${t.overreach} ${t.overreach === 1 ? "goes" : "go"} too far` : "") : "";
  return `${claims} claim${claims === 1 ? "" : "s"} checked against the paper, ${t.supported} supported` + (t.unsupported ? `, ${t.unsupported} not` : "") + `${beyond}. Approved by ${manifest.approval?.by || "the author"} as version ${manifest.story?.version}.`;
}

module.exports = {
  LEDGER_VERSION,
  canonicalJson,
  sha256,
  loadKeys,
  publicKeyPem,
  keyIdFor,
  buildManifest,
  sign,
  verify,
  checkPassages,
  summarySentence,
};
