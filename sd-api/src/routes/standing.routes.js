const express = require("express");

const { asyncHandler } = require("../lib/async-handler");
const { ApiError } = require("../lib/api-error");
const { requireAuth } = require("../middleware/auth.middleware");
const { canonicalScholarId } = require("../lib/identity");
const { listDraftSources } = require("../services/drafting.service");

const router = express.Router();

/**
 * Where a scholar stands against the Legacy benchmark.
 *
 * ── Why this is a scholar-facing endpoint at all ───────────────────────────
 * Legacy decided whether a scholar could draft from their own research, and
 * nothing anywhere told them it existed. A benchmark nobody can see is a
 * verdict, not a benchmark. This returns the gates, what each measured, and
 * the sentence that says what one act would change — the same shape
 * `voiceStanding` defines and, until now, nothing rendered.
 *
 * Assessing recomputes from live signals and records the result when it moves,
 * so simply looking at your own standing keeps it current. That is deliberate:
 * a nightly job would mean a scholar approves a reading level and watches
 * nothing happen.
 */
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const profileId = canonicalScholarId(req.auth.user);
    if (!profileId) throw new ApiError(403, "This session is not linked to a scholar profile.");

    /* The same inventory the Papers page and the composer read, so the
       benchmark counts what those surfaces show — and it already carries the
       assessment, made once, with the curated record's flag in hand. A scholar
       with no curated record at all gets a 404 from here, which is the
       truthful answer: there is nothing to measure yet. */
    const inventory = await listDraftSources({ profileId });

    res.status(200).json({ standing: inventory.standing });
  }),
);

module.exports = router;
