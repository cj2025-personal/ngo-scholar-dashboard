/**
 * Who is allowed to put a story in front of the public.
 *
 * ── The counter-example this is written against ─────────────────────────────
 * The legend pipeline carries `approval_required: true` and its stories were
 * approved by `approved_by: "system-legend-conversation-regeneration"` — a
 * machine countersigning a machine. Sixty-one stories sat in pending_review
 * with no reviewer. Nothing in that code was wrong by its own lights; the
 * convention that an approver is a person was never enforced, so it did not
 * survive contact with an automated caller.
 *
 * Here the rule is code. Publishing and scheduling require an actor that is
 * demonstrably a person with a scholar login: an email address, on a session
 * bound to a profile, that is not a service identity by name. A draft can be
 * saved by anyone the session admits — a draft reaches nobody — but the
 * transition to public is a human act and the record says whose.
 *
 * Pure. The service throws; this file only answers.
 */

/* Identities that are machines by their own naming. Matched on the local
   part and on the whole string, case-insensitively, so a future
   "svc-drafter@archivyn.com" is refused as readily as "system". */
const SERVICE_IDENTITY = /^(system|service|svc|bot|pipeline|worker|cron|agent|legend|automation|drafter|noreply|no-reply)([-_.@]|$)/i;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {object|null} user  the session's user, as `auth.middleware` attaches it
 * @returns {{ok: true, actor: string} | {ok: false, reason: string}}
 */
function humanPublisher(user) {
  if (!user || typeof user !== "object") {
    return { ok: false, reason: "no session user" };
  }
  const email = typeof user.login_email === "string" ? user.login_email.trim() : "";
  const profileId = typeof user.profile_id === "string" ? user.profile_id.trim() : "";

  if (!profileId) {
    return { ok: false, reason: "the session is not bound to a scholar profile" };
  }
  /* Named service identities are refused before the format check, so the
     reason says what was seen: "system-legend-…" is a machine by name
     whether or not it is shaped like an email. */
  if (email && (SERVICE_IDENTITY.test(email) || SERVICE_IDENTITY.test(email.split("@")[0]))) {
    return { ok: false, reason: `"${email}" is a service identity, not a person` };
  }
  if (!email || !EMAIL.test(email)) {
    return { ok: false, reason: "the session has no login email; publishing requires a person's credential" };
  }
  if (email === profileId) {
    return { ok: false, reason: "the login is the profile id itself, not a credential" };
  }
  return { ok: true, actor: email.toLowerCase() };
}

/** True for the statuses that make a story public now or at a set time. */
function makesPublic(status) {
  return status === "published" || status === "scheduled";
}

module.exports = { humanPublisher, makesPublic, SERVICE_IDENTITY };
