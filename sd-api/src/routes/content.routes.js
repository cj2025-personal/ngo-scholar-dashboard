const express = require("express");

const { asyncHandler } = require("../lib/async-handler");
const { ApiError } = require("../lib/api-error");
const { requireAuth } = require("../middleware/auth.middleware");
const { canonicalScholarId } = require("../lib/identity");
const {
  CONTENT_KINDS,
  listScholarContent,
  countUnattributedContent,
} = require("../services/content.service");

const router = express.Router();

/**
 * What this platform publishes under my name.
 *
 * ── Scoped to the session, never to a parameter ────────────────────────────
 * The profile id comes from `req.auth`, not from the query string or the body.
 * A route that accepted `?profileId=` would let any authenticated scholar read
 * another scholar's content inventory by changing one character — and the
 * inventory includes unpublished drafts.
 *
 * This is the highest-value guard in the service, so it is one line, in one
 * place, with nothing configurable about it.
 */
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const profileId = canonicalScholarId(req.auth.user);
    if (!profileId) {
      /* An authenticated session that resolves to no scholar is a broken
         credential, not an anonymous caller. Failing loudly beats returning an
         empty inventory, which would read as "nothing is published about you". */
      throw new ApiError(403, "This session is not linked to a scholar profile.");
    }

    const kind = typeof req.query.kind === "string" ? req.query.kind : "all";
    if (kind !== "all" && !CONTENT_KINDS.includes(kind)) {
      throw new ApiError(400, `Unknown content kind: ${kind}`);
    }

    const content = await listScholarContent({
      profileId,
      kind,
      limit: req.query.limit,
    });

    /* Reported alongside, not hidden. A scholar told "here are your 3 items"
       when 3,572 passages exist that we cannot yet attribute has been given a
       true sentence and a false impression. */
    const unattributed = await countUnattributedContent();

    res.status(200).json({
      profileId,
      content,
      coverage: {
        unattributed,
        note:
          "Content we cannot yet link to any scholar. Curated passages are " +
          "attributed in full; editorials written before scholar sign-in was " +
          "linked carry an authoring account rather than a profile.",
      },
    });
  }),
);

module.exports = router;
