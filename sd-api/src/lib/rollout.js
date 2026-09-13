/**
 * Who the drafter is open to right now. Pure.
 *
 * ── Why a list and not a flag ───────────────────────────────────────────────
 * The plan rolls the drafter out to three Legacy scholars, then ten, then all
 * of them. A boolean cannot express "these three", and a percentage cannot
 * express "these three, whom we have talked to". So the pilot is a list of
 * profile ids, and the mode says whether the list is the whole audience.
 *
 *   DRAFTING_ROLLOUT=pilot   only DRAFTING_PILOT_PROFILES may draft
 *   DRAFTING_ROLLOUT=all     every eligible scholar may draft (the default,
 *                            because the Legacy gate and the kill switch
 *                            already stand in front of this one)
 *
 * The daily cap applies in both modes; this file only answers "are they in".
 * A scholar outside the pilot still sees their inventory — the panel is the
 * reason uploads happen — with a sentence saying why the button is absent.
 */

const MODE = { PILOT: "pilot", ALL: "all" };

function parseProfileList(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normaliseMode(value) {
  const v = String(value || "").trim().toLowerCase();
  return v === MODE.PILOT ? MODE.PILOT : MODE.ALL;
}

/**
 * @param {object} p
 * @param {string} p.mode            "pilot" | "all"
 * @param {string[]} p.pilotProfiles
 * @param {string} p.profileId
 * @returns {{ok: true, mode: string} | {ok: false, mode: string, reason: string}}
 */
function rolloutAllows({ mode, pilotProfiles, profileId }) {
  const m = normaliseMode(mode);
  if (m === MODE.ALL) return { ok: true, mode: m };
  const list = Array.isArray(pilotProfiles) ? pilotProfiles : parseProfileList(pilotProfiles);
  if (profileId && list.includes(profileId)) return { ok: true, mode: m };
  return {
    ok: false,
    mode: m,
    reason:
      list.length === 0
        ? "Drafting is not yet open to anyone; the pilot list is empty."
        : `Drafting is being rolled out gradually and isn't open to you yet. ${list.length} scholar${list.length === 1 ? " is" : "s are"} in the pilot.`,
  };
}

module.exports = { MODE, parseProfileList, normaliseMode, rolloutAllows };
