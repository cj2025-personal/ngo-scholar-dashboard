/**
 * The communities a scholar may say they belong to.
 *
 * The same keys as the platform's community registry, which lives in the
 * learner app (user-dashboard-api, backend/src/modules/community/
 * community.registry.ts: COMMUNITY_KEYS) and drives its community portals,
 * filters and spotlights. A scholar's self-identification is matched against
 * those portals by key, so a key that is not in the registry would be a
 * choice that silently does nothing: only these four are accepted.
 *
 * `indigenous` is in the registry but not yet open to learner memberships
 * (`active: false` there, until it has its own legends and content). That
 * gates who may join a portal, not who a scholar is, so a scholar may still
 * say it of themselves.
 *
 * The labels are the registry's display names, in its order.
 */
const COMMUNITIES = Object.freeze([
  Object.freeze({ key: "black", label: "Black" }),
  Object.freeze({ key: "latino", label: "Latino / Latina / Latinx" }),
  Object.freeze({ key: "asian", label: "Asian / Asian American" }),
  Object.freeze({ key: "indigenous", label: "Indigenous" }),
]);

const COMMUNITY_KEYS = Object.freeze(COMMUNITIES.map((c) => c.key));

function isCommunityKey(value) {
  return typeof value === "string" && COMMUNITY_KEYS.includes(value);
}

module.exports = { COMMUNITIES, COMMUNITY_KEYS, isCommunityKey };
