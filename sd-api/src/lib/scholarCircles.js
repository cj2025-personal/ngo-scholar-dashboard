"use strict";

/**
 * The learning circles a scholar leads, as Kivyn writes for them: read from
 * the learner app, where the circles live (lib/learnerApi; its
 * services/circles). A circle archived by the scholar or paused by Archivyn
 * is not written for.
 *
 * Each circle as the writer needs it: its name and what it reads (checked by
 * a model there before any learner saw them), its reading ages, and - when it
 * is shown in a community's portal, or waiting on Archivyn for it - how that
 * portal frames its reading (the community registry's generationFraming).
 */

const { ApiError } = require("./api-error");
const { callLearnerApi } = require("./learnerApi");

const WRITABLE = new Set(["open", "draft"]);

/** One circle from the learner app's scholar view, as the writer reads it. */
function forWriting(c) {
  const p = c.placement;
  const inPortal = p && !p.withdrawn && (p.status === "placed" || p.status === "review");
  const portal = inPortal ? (c.portals || []).find((x) => x.community === p.community) || null : null;
  return {
    id: String(c.id),
    name: String(c.name || ""),
    purpose: String(c.purpose || ""),
    bands: Array.isArray(c.bands) ? c.bands.map(String) : [],
    portal: portal ? { community: portal.community, name: portal.name, framing: String(portal.framing || "") } : null,
  };
}

/* Kivyn reads the circles on every turn of a conversation: kept a minute, and
   asked for with a short wait, so a slow learner app never holds a turn up. */
const CACHE_MS = 60_000;
const READ_MS = 4_000;
const cache = new Map();

/**
 * The circles the scholar may write for. Never throws: the conversation goes
 * on without them. `fresh` reads past the minute kept (a circle the page names
 * that was made since).
 */
async function circlesFor(profileId, { call = callLearnerApi, now = Date.now(), fresh = false } = {}) {
  const hit = cache.get(profileId);
  if (hit && !fresh && now - hit.at < CACHE_MS) return hit.circles;
  try {
    const { circles } = await call("GET", "/circles", { profileId, timeoutMs: READ_MS });
    const writable = (Array.isArray(circles) ? circles : []).filter((c) => WRITABLE.has(c.status)).map(forWriting);
    cache.set(profileId, { at: now, circles: writable });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return writable;
  } catch (error) {
    console.warn(`[circles] the scholar's circles could not be read: ${error.message}`);
    return [];
  }
}

/** One circle the scholar leads and may write for; 404 when it is not one, the learner app's failure as it came. */
async function circleFor(profileId, circleId, { call = callLearnerApi } = {}) {
  if (!/^[a-f0-9]{24}$/i.test(String(circleId || ""))) throw new ApiError(404, "That circle is not one of yours.");
  const { circles } = await call("GET", "/circles", { profileId });
  const found = (Array.isArray(circles) ? circles : []).find((c) => String(c.id) === String(circleId) && WRITABLE.has(c.status));
  if (!found) throw new ApiError(404, "That circle is not one of yours, or it is closed.");
  return forWriting(found);
}

module.exports = { circlesFor, circleFor, forWriting, _resetCircleCache: () => cache.clear() };
