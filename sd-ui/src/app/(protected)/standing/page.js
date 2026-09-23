import Link from "next/link";
import { HiOutlineArrowRight, HiOutlineCheckCircle } from "react-icons/hi2";

import Topbar from "@/components/scholar/Topbar";
import { getScholarProfile } from "@/lib/profile";
import { getStanding, STANDING_LABEL } from "@/lib/standing";

export const dynamic = "force-dynamic";

/**
 * Where you stand.
 *
 * ── Why this page exists ───────────────────────────────────────────────────
 * Legacy decided whether a scholar could draft from their own research, and
 * nothing in the portal admitted it existed. A scholar outside it saw a
 * feature that did not work and one sentence of explanation on the Papers
 * page; a scholar inside it was never told why. Neither could act.
 *
 * A benchmark has to be legible to be a benchmark, so this page is the whole
 * of it: every gate, what it measured, whether it holds, and the one sentence
 * that says what would change it. Nothing here is a score and nothing is a
 * ranking against other scholars — both would be answers to a question nobody
 * asked, about work this product is in no position to judge.
 */
export default async function StandingPage() {
  const [profileData, standing] = await Promise.all([getScholarProfile(), getStanding()]);

  const profile = profileData?.profile || {};
  const me = {
    initials: profile.initials || "SC",
    name: profile.name || "Scholar",
    institution: profile.institution || "",
  };

  if (!standing) {
    return (
      <div className="sc-shell">
        <Topbar activeHref="/standing" me={me} />
        <div className="sc-page">
          <header className="sc-page-head">
            <span className="sc-kicker">Legacy</span>
            <h1>Where you stand</h1>
            <p>We could not read your standing just now. Reload the page, or come back shortly.</p>
          </header>
        </div>
      </div>
    );
  }

  const isLegacy = standing.standing === "legacy";
  const label = STANDING_LABEL[standing.standing] || standing.standing;

  return (
    <div className="sc-shell">
      <Topbar activeHref="/standing" me={me} />
      <div className="sc-page sd-stand">
        <header className="sc-page-head">
          <span className="sc-kicker">Legacy</span>
          <h1>Where you stand</h1>
          <p>
            Legacy is a reading of the work you have done — the papers on your record, and the work
            you do here. It decides one thing: whether Archivyn may draft articles from your own
            research. Everything else in this portal is open to every scholar.
          </p>
        </header>

        <section className={`sd-stand__now is-${standing.standing}`}>
          <div>
            <span className="sc-kicker">Your standing</span>
            <p className="sd-stand__label">{label}</p>
            <p className="sd-stand__count">
              {standing.met} of {standing.total} {standing.total === 1 ? "mark" : "marks"} met
            </p>
          </div>
          {/* A scholar who held Legacy before it was measured is told so
              plainly. Pretending they earned gates they have not met would be
              a compliment that falls apart the moment they read the gates. */}
          {standing.grandfathered ? (
            <p className="sd-stand__note">
              You held Legacy before it was measured this way, and you keep it. The marks below are
              shown so you can see what the benchmark now asks.
            </p>
          ) : isLegacy ? (
            <p className="sd-stand__note">Drafting from your own research is open to you.</p>
          ) : standing.nextStep ? (
            <p className="sd-stand__note">
              One mark left: <b>{standing.nextStep.title}</b>. {standing.nextStep.summary}
            </p>
          ) : (
            <p className="sd-stand__note">Each mark below says what it measured and what would move it.</p>
          )}
        </section>

        <div className="sd-gates">
          {(standing.gates || []).map((gate) => (
            <article key={gate.key} className={`sd-gate${gate.met ? " is-met" : ""}`}>
              <div className="sd-gate__head">
                <h2 className="st-h2">{gate.title}</h2>
                <span className="sd-gate__state">
                  {gate.met ? (
                    <>
                      <HiOutlineCheckCircle size={15} aria-hidden /> Met
                    </>
                  ) : (
                    "Not yet"
                  )}
                </span>
              </div>
              <p className="sd-gate__summary">{gate.summary}</p>
              {/* The blockers are the only actionable thing on this page, so
                  they are numbers and nouns rather than a progress bar. */}
              {gate.blockers?.length ? (
                <ul className="sd-gate__blockers">
                  {gate.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>

        <aside className="sd-stand__foot">
          <h2 className="st-h2">What this does and does not decide</h2>
          <p>
            Legacy opens drafting from your research. It does not affect reading levels, which every
            scholar can write and approve — putting your work in front of younger readers is the
            point of this product, not a privilege inside it. It does not affect your record, your
            corrections, or your right to see anything made in your name.
          </p>
          <p className="sd-stand__foot-links">
            <Link href="/papers" className="st-link">
              Your papers <HiOutlineArrowRight size={12} aria-hidden />
            </Link>
            <Link href="/editorial" className="st-link">
              Your stories <HiOutlineArrowRight size={12} aria-hidden />
            </Link>
          </p>
        </aside>
      </div>
    </div>
  );
}
