/**
 * Who wrote this, as a reader should see it.
 *
 * ── Why a published article needs this at all ──────────────────────────────
 * The scholar portal exists so that what Archivyn shows students under a named
 * person's name is something that person can see and stand behind. An article
 * published through it that carries no author defeats that on the one surface
 * where it matters most — and it was carrying none: the story document holds a
 * `profile_id`, and the serializer dropped it.
 *
 * ── Read-time, not write-time ──────────────────────────────────────────────
 * The byline is joined from the curated `scholars` record on every read rather
 * than copied onto the story when it is published. A scholar who moves
 * institution should not have to re-publish four-year-old articles to stop them
 * misstating where they work, and the curated record is the thing that gets
 * corrected — so it has to be the thing that is read.
 *
 * ── Silence over a guess ───────────────────────────────────────────────────
 * Every function here returns null rather than a placeholder when it has
 * nothing. "By Unknown Author" on a piece of scholarship reads as an error in
 * the work; an absent byline reads as an absent byline. And a wrong name is
 * worse than no name: attaching one real person's writing to another real
 * person's public record is the specific mistake this whole identity layer was
 * built to prevent.
 */

/** Separator between position and institution. Matches the profile header. */
const SEP = " · ";

function clean(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Initials for an avatar, from a display name.
 *
 * First and last rather than every word: "Inder Jeet Gupta" is IG, not IJG,
 * because the middle name is the part people drop.
 */
function initialsFrom(name) {
  const parts = clean(name)?.split(/\s+/).filter(Boolean);
  if (!parts || parts.length === 0) return null;
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/**
 * The byline for a curated scholar record.
 *
 * Returns null when there is no name, because a byline with an affiliation and
 * no person is not a byline.
 */
function buildByline(scholar) {
  if (!scholar || typeof scholar !== "object") return null;

  const name = clean(scholar.name?.display) || clean(scholar.name?.full);
  if (!name) return null;

  const position = clean(scholar.about?.current_position);
  const institution = clean(scholar.about?.institution);

  /* Deduplicated: some records carry the institution inside the position
     string, and "Professor at MIT · MIT" reads as a mistake by us. */
  const parts = [position, institution].filter(Boolean);
  const affiliation =
    parts.length === 2 && parts[1] && parts[0].toLowerCase().includes(parts[1].toLowerCase())
      ? parts[0]
      : parts.join(SEP);

  return {
    profileId: clean(scholar.profile_id) || null,
    name,
    position,
    institution,
    /* One pre-joined string so every surface renders the same affiliation
       rather than each deciding its own separator and order. */
    affiliation: affiliation || null,
    initials: clean(scholar.about?.avatar_initial) || initialsFrom(name),
  };
}

/**
 * The `author` node for schema.org Article markup.
 *
 * Omitted entirely when unresolved. Structured data asserting an unknown author
 * is a machine-readable version of the same false claim.
 */
function bylineStructuredData(byline) {
  if (!byline?.name) return undefined;

  const affiliation = byline.institution
    ? { "@type": "Organization", name: byline.institution }
    : undefined;

  return {
    "@type": "Person",
    name: byline.name,
    ...(byline.position ? { jobTitle: byline.position } : {}),
    ...(affiliation ? { affiliation } : {}),
  };
}

module.exports = { buildByline, bylineStructuredData, initialsFrom };
