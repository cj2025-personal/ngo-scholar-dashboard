"use strict";
/**
 * A scholar's own say over what is shown of them (shared consent SPEC v1).
 *
 * ── What it holds ───────────────────────────────────────────────────────────
 * Four layers on the scholar's record, `scholars.consent.<layer>`:
 *
 *   listing    whether they appear at all: in the directory, in students'
 *              stories, in search. Hidden, their studio and data stay.
 *   photo      whether a photo may be shown. Here the scholar can grant it
 *              for their current photo (basis "scholar"), or withdraw it.
 *   community  a community or heritage they say they belong to, in the
 *              registry's terms. Only the scholar can say this; nothing
 *              inferred ever counts.
 *   contact    whether their email, phone and office may be shown.
 *
 * Absent means the safe default (listed; no photo; no community; no contact
 * details), and every read of a layer goes through lib/scholarConsent.
 *
 * ── How a change is written ─────────────────────────────────────────────────
 * The new value of the one layer, and one row in `scholar_consent_events`
 * saying who changed it, to what, and when: in one transaction, so a change
 * without its proof cannot exist. The layer is compared and set, so a change
 * staff made while the scholar's page was open is not overwritten by a click
 * made against the old state; the scholar is told to reload instead. A click
 * that changes nothing (turning on what is already on) writes nothing.
 *
 * Nothing is removed or unset: a withdrawal is itself a value (a null basis,
 * `show: false`), recorded like any other change.
 *
 * ── Whose ───────────────────────────────────────────────────────────────────
 * Only the signed-in scholar's own record. The routes pass the profile id
 * from the session (lib/identity canonicalScholarId), never one from the
 * request, so there is no parameter that could name someone else.
 *
 * ── What the scholar cannot do here ─────────────────────────────────────────
 * Upload a new photo. The studio's upload path is the story composer's: it
 * writes story images to the editorial bucket under the story, which the
 * directory and the learner app do not read photos from, and a portrait
 * other people will see goes through the admin portal's review. So "Show my
 * photo" covers the photo already on the record, and says so when there is
 * none.
 */

const { env } = require("../config/env");
const { COLLECTIONS } = require("../db/mongo");
const { ApiError } = require("../lib/api-error");
const consent = require("../lib/scholarConsent");
const { COMMUNITIES, COMMUNITY_KEYS, isCommunityKey } = require("../lib/communities");
const { scholarFilter } = require("../lib/identity");
const { getStorageClient } = require("../lib/gcs");
const { serializeMongoValue } = require("../lib/serialize");

const LAYERS = ["listing", "photo", "community", "contact"];
/* The SPEC's actions, per layer. */
const ACTIONS = {
  listing: ["hide", "unhide"],
  photo: ["grant", "withdraw"],
  community: ["grant", "withdraw"],
  contact: ["grant", "withdraw"],
};
const HISTORY_LIMIT = 50;

/* The fields the directory reads for email, phone and office
   (ngo-profile-app routes/profiles.js mapContact), so the scholar is shown
   exactly what "Show my contact details" would show. */
const CONTACT_FIELDS = {
  email: ["email", "contact_email", "contactEmail"],
  phone: ["phone", "phone_number", "phoneNumber"],
  office: ["office", "office_location", "officeLocation"],
};

const PROJECTION = {
  _id: 1,
  profile_id: 1,
  consent: 1,
  "display.profile_image_object_key": 1,
  contact: 1,
  contact_info: 1,
  contactInfo: 1,
  ...Object.fromEntries(Object.values(CONTACT_FIELDS).flat().map((field) => [`about.${field}`, 1])),
};

/* The directory's pattern for an approved portrait in the headshots bucket;
   any other key a basis names is an uploaded picture. */
const HEADSHOT_KEY = /^(?:contemporary|legacy)\/[A-Za-z0-9_-]+\/headshot-[0-9a-f]{12}\.(jpg|jpeg|png|webp|gif)$/;
const IMAGE_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif" };

async function loadScholar(db, profileId) {
  if (typeof profileId !== "string" || !profileId.trim()) {
    throw new ApiError(401, "Authentication is required.");
  }
  const scholar = await db.collection("scholars").findOne(scholarFilter(profileId), { projection: PROJECTION });
  if (!scholar) throw new ApiError(404, "Scholar profile was not found for this account.");
  return scholar;
}

/** The key events are filed under: the record's own profile id, as staff file them. */
const eventKeyOf = (scholar) => String(scholar.profile_id || scholar._id);

/** The photo the panel shows: the one that is shown, else the one a grant would cover. */
function previewKey(scholar) {
  return consent.visiblePhotoKey(scholar) || scholar.display?.profile_image_object_key || null;
}

function contactDetails(scholar) {
  const sources = [scholar.about, scholar.contact, scholar.contact_info || scholar.contactInfo].filter((s) => s && typeof s === "object");
  const first = (fields) => {
    for (const source of sources) {
      for (const field of fields) {
        const value = source[field];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    }
    return null;
  };
  const details = Object.fromEntries(Object.entries(CONTACT_FIELDS).map(([name, fields]) => [name, first(fields)]));
  return Object.values(details).some(Boolean) ? details : null;
}

const stamp = (layer) => ({ at: layer?.at ?? null, by: layer?.by?.kind ?? null });

function viewState(scholar) {
  const c = scholar.consent || {};
  const basis = consent.photoBasis(scholar);
  return {
    listing: { listed: consent.isListed(scholar), reason: c.listing?.reason ?? null, ...stamp(c.listing) },
    photo: { shown: Boolean(basis), basis, hasPhoto: Boolean(previewKey(scholar)), credit: consent.photoCredit(scholar), ...stamp(c.photo) },
    community: { values: consent.communities(scholar), ...stamp(c.community) },
    contact: { shown: consent.showContact(scholar), details: contactDetails(scholar), ...stamp(c.contact) },
  };
}

function viewEvent(row) {
  const out = { id: String(row._id), layer: row.layer, action: row.action, at: row.at, by: row.by?.kind ?? null, source: row.source ?? null };
  if (row.layer === "community") out.values = Array.isArray(row.value?.values) ? row.value.values : [];
  if (row.layer === "photo") out.basis = row.value?.basis ?? null;
  return out;
}

/**
 * Where the scholar stands on each layer, the community choices, and what
 * changed, newest first.
 */
async function getConsent(db, profileId) {
  const scholar = await loadScholar(db, profileId);
  const rows = await db
    .collection(COLLECTIONS.consentEvents)
    .find({ profileId: eventKeyOf(scholar) })
    .sort({ at: -1, _id: -1 })
    .limit(HISTORY_LIMIT)
    .toArray();
  return serializeMongoValue({
    consent: viewState(scholar),
    communities: COMMUNITIES,
    history: rows.map(viewEvent),
  });
}

function parseCommunityValues(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new ApiError(400, "Choose at least one community, or turn this off instead.");
  }
  const wanted = new Set();
  for (const value of values) {
    const key = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!isCommunityKey(key)) throw new ApiError(400, "That community is not one Proj Arch knows.");
    wanted.add(key);
  }
  /* In the registry's order, so the same choice is always the same value. */
  return COMMUNITY_KEYS.filter((key) => wanted.has(key));
}

/** The layer's new value, or null when the action would change nothing. */
function nextValue(scholar, layer, action, { values, at, by }) {
  switch (layer) {
    case "listing": {
      const hide = action === "hide";
      if (hide === !consent.isListed(scholar)) return null;
      return hide
        ? { state: "hidden", reason: "scholar_request", requestId: null, at, by }
        : { state: "listed", reason: null, requestId: null, at, by };
    }
    case "photo": {
      const grant = action === "grant";
      if (grant === Boolean(consent.photoBasis(scholar))) return null;
      if (grant && !scholar.display?.profile_image_object_key) {
        throw new ApiError(409, "There is no photo on your record to show yet, so readers will keep seeing your initials.");
      }
      /* objectKey null: the basis covers the current display photo (SPEC). */
      return { basis: grant ? "scholar" : null, objectKey: null, license: null, attribution: null, evidenceUrl: null, at, by };
    }
    case "community": {
      if (action === "withdraw") {
        if (consent.communities(scholar).length === 0) return null;
        return { basis: null, values: [], at, by };
      }
      const chosen = parseCommunityValues(values);
      const current = consent.communities(scholar);
      if (current.length === chosen.length && current.every((v, i) => v === chosen[i])) return null;
      return { basis: "self_identified", values: chosen, at, by };
    }
    case "contact": {
      const show = action === "grant";
      if (show === consent.showContact(scholar)) return null;
      return { show, at, by };
    }
    default:
      return null;
  }
}

/** Run `work` in one transaction: both writes, or neither. */
async function inTransaction(db, work) {
  const session = db.client.startSession();
  try {
    return await session.withTransaction(work);
  } finally {
    await session.endSession();
  }
}

/**
 * Change one layer of the signed-in scholar's own consent.
 *
 * @param {import("mongodb").Db} db
 * @param {{ profileId: string, layer: string, action: string, values?: string[] }} p
 *   `profileId` is the session's, never the request's.
 * @returns the state as getConsent returns it, and whether anything changed.
 */
async function changeConsent(db, { profileId, layer, action, values } = {}) {
  if (!LAYERS.includes(layer)) throw new ApiError(404, "There is no such setting.");
  if (!ACTIONS[layer].includes(action)) {
    throw new ApiError(400, `That is not something this setting does (${ACTIONS[layer].join(" or ")}).`);
  }
  const scholar = await loadScholar(db, profileId);
  const at = new Date();
  const by = { kind: "scholar", id: profileId };
  const next = nextValue(scholar, layer, action, { values, at, by });
  if (!next) return { changed: false, ...(await getConsent(db, profileId)) };

  const path = `consent.${layer}`;
  const previous = scholar.consent?.[layer];
  await inTransaction(db, async (session) => {
    const result = await db.collection("scholars").updateOne(
      { _id: scholar._id, [path]: previous === undefined ? { $exists: false } : previous },
      { $set: { [path]: next } },
      { session },
    );
    if (result.matchedCount !== 1) {
      throw new ApiError(409, "This setting was changed somewhere else while your page was open. Reload the page and try again.");
    }
    await db.collection(COLLECTIONS.consentEvents).insertOne(
      { profileId: eventKeyOf(scholar), layer, action, value: next, by, at, evidenceUrl: null, note: null, source: "studio" },
      { session },
    );
  });
  return { changed: true, ...(await getConsent(db, profileId)) };
}

/**
 * The scholar's own photo, for the panel beside "Show my photo": the one shown
 * now, or the one a grant would cover. Private and never cached, because until
 * they say yes nobody else may see it.
 */
async function streamOwnPhoto(db, profileId, res, { storage = getStorageClient() } = {}) {
  const scholar = await loadScholar(db, profileId);
  const key = previewKey(scholar);
  const type = key ? IMAGE_TYPES[String(key.split(".").pop() || "").toLowerCase()] : null;
  if (!key || !type) throw new ApiError(404, "There is no photo on your record.");
  const bucket = HEADSHOT_KEY.test(key) ? env.scholarHeadshotsBucket : env.legendPicturesBucket;

  await new Promise((resolve, reject) => {
    const stream = storage.bucket(bucket).file(key).createReadStream();
    let started = false;
    stream.on("error", (error) => {
      if (started) {
        res.destroy(error);
        resolve();
        return;
      }
      reject(error?.code === 404 ? new ApiError(404, "There is no photo on your record.") : error);
    });
    stream.on("data", (chunk) => {
      if (!started) {
        started = true;
        res.set("Content-Type", type);
        res.set("Cache-Control", "private, no-store");
      }
      res.write(chunk);
    });
    stream.on("end", () => {
      if (!started) {
        reject(new ApiError(404, "There is no photo on your record."));
        return;
      }
      res.end();
      resolve();
    });
  });
}

module.exports = { LAYERS, ACTIONS, getConsent, changeConsent, streamOwnPhoto, contactDetails };
