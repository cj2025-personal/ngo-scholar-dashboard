/**
 * The evidence ledger as a service: built from what is stored, signed with
 * this deployment's key, kept on the story, and served to anyone.
 *
 * It is derived data. It is rebuilt after every write that leaves a story
 * public and stored beside the story without touching the story's version,
 * because a save that bumped the version twice would refuse the editor's
 * next save. A draft's ledger is built on request and never stored: there is
 * no approval to record until the scholar publishes.
 */

const { COLLECTIONS } = require("../db/mongo");
const { ApiError } = require("../lib/api-error");
const { env } = require("../config/env");
const ledger = require("../lib/evidenceLedger");
const { FIDELITY_VERSION } = require("../lib/fidelity");
const { AGENT_VERSION } = require("../lib/storyAgent");
const checksLib = require("../lib/checks");
const { serializeMongoValue } = require("../lib/serialize");
const { passagesFor } = require("./passages.service");

let keysCache;

/** This process's signing key, loaded once. Null in production without one, and said so. */
function keys() {
  if (keysCache === undefined) {
    keysCache = ledger.loadKeys({ privateKey: env.ledger.privateKey, keyId: env.ledger.keyId, isProduction: env.isProduction });
    if (!keysCache) console.error("[ledger] LEDGER_SIGNING_KEY is not set: evidence manifests will be published unsigned.");
    else if (keysCache.ephemeral) console.warn(`[ledger] no LEDGER_SIGNING_KEY; signing with a key generated for this process (${keysCache.keyId}).`);
  }
  return keysCache;
}

/** The key anyone needs to verify what this deployment signed. */
function publicKey() {
  const k = keys();
  return { keyId: k ? k.keyId : null, publicKey: k ? ledger.publicKeyPem(k) : null, signed: Boolean(k), ledgerVersion: ledger.LEDGER_VERSION };
}

async function buildEvidence(db, storyDoc) {
  /* Lazy: editorial.service requires this module for the refresh after a write. */
  const editorial = require("./editorial.service");
  const [author, provenance, passages, revisions] = await Promise.all([
    editorial.resolveStoryAuthor(db, storyDoc.profile_id),
    editorial.resolveStoryProvenance(db, storyDoc.provenance),
    passagesFor(db, storyDoc),
    db.collection(COLLECTIONS.storyRevisions).find({ story_id: storyDoc._id }).sort({ version: 1 }).toArray(),
  ]);
  const mapped = editorial.mapStoryDocument(storyDoc, author, provenance);
  const k = keys();
  const manifest = ledger.buildManifest({
    story: mapped,
    revisions,
    passages,
    versions: { drafter: storyDoc.provenance?.graph_version || null, judge: FIDELITY_VERSION, agent: AGENT_VERSION },
    keyId: k ? k.keyId : null,
  });
  return {
    manifest,
    signature: k ? ledger.sign(manifest, k) : null,
    keyId: k ? k.keyId : null,
    signed: Boolean(k),
    publicKey: k ? ledger.publicKeyPem(k) : null,
    passages,
    checks: {
      numbers: checksLib.numericConsistency({ blocks: mapped.bodyBlocks, passages }),
      limitations: checksLib.limitationsCoverage({ blocks: mapped.bodyBlocks, passages }),
    },
  };
}

/**
 * Rebuild and store the ledger for a story that is, or has just become, public.
 * Safe to call for a story that is not: it does nothing.
 */
async function refreshStoryEvidence(db, storyId) {
  const collection = db.collection(COLLECTIONS.scholarEditorials);
  const storyDoc = await collection.findOne({ _id: storyId });
  if (!storyDoc || !["published", "scheduled"].includes(storyDoc.status)) return null;
  const built = await buildEvidence(db, storyDoc);
  await collection.updateOne(
    { _id: storyId },
    { $set: { evidence: { manifest: built.manifest, signature: built.signature, key_id: built.keyId, signed: built.signed, generated_at: new Date() } } },
  );
  return built;
}

/** What the reader, or anyone, gets for a public story. */
async function getPublicEvidence(db, slug) {
  const editorial = require("./editorial.service");
  const collection = db.collection(COLLECTIONS.scholarEditorials);
  const storyDoc = await collection.findOne({ slug, ...editorial.buildPublicStoryQuery() });
  if (!storyDoc) throw new ApiError(404, "Published story not found.");
  const stored = storyDoc.evidence;
  const built = stored?.manifest ? null : await refreshStoryEvidence(db, storyDoc._id);
  const evidence = stored?.manifest ? stored : { manifest: built.manifest, signature: built.signature, key_id: built.keyId, signed: built.signed, generated_at: new Date() };
  const k = keys();
  return serializeMongoValue({
    manifest: evidence.manifest,
    signature: evidence.signature,
    keyId: evidence.key_id,
    signed: Boolean(evidence.signed),
    generatedAt: evidence.generated_at,
    publicKey: k && k.keyId === evidence.key_id ? ledger.publicKeyPem(k) : null,
    summary: ledger.summarySentence(evidence.manifest),
  });
}

/** The scholar's view of their own story's ledger, built fresh, whether or not it is public yet. */
async function getOwnerEvidence(db, { storyId, scholarId, profileId }) {
  const editorial = require("./editorial.service");
  const storyDoc = await editorial.findOwnedStory({ storyId, scholarId, profileId });
  const built = await buildEvidence(db, storyDoc);
  const isPublic = ["published", "scheduled"].includes(storyDoc.status);
  return serializeMongoValue({
    manifest: built.manifest,
    signature: built.signature,
    keyId: built.keyId,
    signed: built.signed,
    preview: !isPublic,
    stored: Boolean(storyDoc.evidence?.manifest),
    storedVersion: storyDoc.evidence?.manifest?.story?.version ?? null,
    summary: ledger.summarySentence(built.manifest),
    passagesCheck: ledger.checkPassages(built.manifest, built.passages),
    checks: built.checks,
  });
}

/**
 * Verify a manifest and signature against this deployment's key. A verifier
 * can do the same offline with the published key; this is the convenience.
 */
function verifyEvidence({ manifest, signature }) {
  if (!manifest || typeof manifest !== "object") throw new ApiError(400, "A manifest is required.");
  const k = keys();
  if (!k) return { valid: false, reason: "this deployment has no signing key", keyId: null };
  if (manifest.key_id && manifest.key_id !== k.keyId) {
    return { valid: false, reason: `the manifest was signed with key ${manifest.key_id}; this deployment's key is ${k.keyId}`, keyId: k.keyId };
  }
  const result = ledger.verify(manifest, signature, ledger.publicKeyPem(k));
  return { ...result, keyId: k.keyId, contentHash: manifest.content_hash || null, summary: result.valid ? ledger.summarySentence(manifest) : null };
}

module.exports = { keys, publicKey, buildEvidence, refreshStoryEvidence, getPublicEvidence, getOwnerEvidence, verifyEvidence };
