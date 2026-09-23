import Link from "next/link";
import { HiOutlineSparkles } from "react-icons/hi2";

/**
 * "Suggest an angle" — the agent reads the paper and comes back with one.
 *
 * ── The gap this fills ─────────────────────────────────────────────────────
 * The studio's lead item used to say a paper was *ready* to draft from — a
 * fact about its licence, not a reason to write today — and offer "Start a
 * story", which opens an empty conversation asking what the article should
 * be. That is a blank page with extra steps, and it asks the scholar for the
 * one thing the research says they find hardest: the framing for a reader
 * outside their field. Nothing in a scholar's career trains that or rewards
 * it.
 *
 * The Conversation, where academics write for the public at scale, commissions
 * roughly seven articles in ten: an editor reads the work and proposes the
 * piece. This is that, in one click. The scholar still decides — what comes
 * back is an outline they approve, argue with or discard, with the same
 * passage-by-passage backing as a draft they asked for themselves. It removes
 * the blank page, not the author.
 *
 * ── Why this is a link and not a button that calls the API ─────────────────
 * It was a button first. It created the proposal from the studio, and the
 * scholar then arrived at a workspace that asked them to agree to the agent's
 * terms — the terms whose whole subject is that the paper's text gets sent to
 * a model provider. The paper had already been sent. Asking permission after
 * doing the thing is worse than not asking, and it would have been this
 * product doing it, whose every other screen is an argument that it does not
 * work that way.
 *
 * So nothing is requested from here. This is a link that carries the intent;
 * the workspace shows the terms if they are owed, and asks the agent only
 * once they are settled. One path for a scholar who has agreed and one who
 * has not, and no way to spend a model call on either before they have.
 */
export default function ProposeButton({ origin, sourceId, className = "st-btn-xl" }) {
  const href = `/editorial/new?source=${encodeURIComponent(`${origin}:${sourceId}`)}&propose=1`;
  return (
    <Link href={href} className={className}>
      <HiOutlineSparkles size={15} aria-hidden />
      Suggest an angle
    </Link>
  );
}
