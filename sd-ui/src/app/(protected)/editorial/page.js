import { HiOutlineArrowUpRight } from "react-icons/hi2";

import Kivyn from "@/components/kivyn/Kivyn";
import StoriesTable from "@/components/scholar/StoriesTable";
import Topbar from "@/components/scholar/Topbar";
import { DRAFT_AUDIENCES } from "@/lib/drafting";
import { getEditorialStories } from "@/lib/editorial";
import { AGENT_NAME } from "@/lib/kivyn/pose.mjs";
import { getScholarProfile } from "@/lib/profile";
import { buildStoryRows, STORY_GROUPS } from "@/lib/storyRows";

export const dynamic = "force-dynamic";

/**
 * Stories: everything the scholar has written here, and what came of it.
 *
 * ── Why it changed ─────────────────────────────────────────────────────────
 * It was a list of tall rows that said less than the Studio's own table: a
 * status, a date and an excerpt cut mid-word, with half of every row empty
 * and the actions hidden until hover. The page meant for stories should say
 * more about them than the dashboard does, so it is now the same table at
 * full length: every story, with its reading ages, reads and questions, a
 * search, a sort, a cover, and Edit, View live and Delete in plain sight.
 *
 * One fetch of every story (the API caps it at 500) rather than three by
 * status: the tabs are filters on one list, and three lists of fifty could
 * not show a scholar their fifty-first draft.
 *
 * The bar carries "Write a story with Kivyn" on this page, so the page does
 * not repeat it.
 */
const TAB_ALIASES = { drafts: "draft" };

/**
 * A scholar with no stories yet: what this page will hold, and how a story
 * gets here, in the three steps it actually takes. It points at the bar's
 * "Write a story with Kivyn" rather than repeating it (one control per action).
 * The reading ages come from the list the drafting uses, so they can't drift.
 */
function StoriesEmpty() {
  const youngest = DRAFT_AUDIENCES[0].label.toLowerCase();
  const oldest = DRAFT_AUDIENCES[DRAFT_AUDIENCES.length - 1].label.toLowerCase();
  const steps = [
    { title: "Plan it together", text: `Say what you want to write, or pick one of your papers. ${AGENT_NAME} agrees an outline with you before a word is drafted.` },
    { title: "Approve every reading age", text: `${AGENT_NAME} writes it for the ages you choose, from ${youngest} to ${oldest}. Nothing reaches a reader until you approve that version.` },
    { title: "See what readers made of it", text: "Each story you publish shows its reads here, with the questions readers asked and the ones it couldn’t answer." },
  ];
  return (
    <section className="st-card dash-card es" aria-labelledby="stories-empty-title">
      <div className="es-intro">
        <Kivyn pose="writing" size={64} />
        <div>
          <h2 id="stories-empty-title" className="dash-h2">Your first story is one conversation away</h2>
          <p className="es-lead">
            {AGENT_NAME} helps you turn your research into a story young readers can follow. This is how a story gets from you to them,
            and every one you start appears here from its first draft on.
          </p>
        </div>
      </div>
      <ol className="es-steps">
        {steps.map((s, i) => (
          <li key={s.title}>
            <span className="es-n" aria-hidden>{i + 1}</span>
            <div>
              <h3 className="es-h3">{s.title}</h3>
              <p>{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="es-foot">
        <HiOutlineArrowUpRight size={16} aria-hidden />
        <span>Start with <strong>Write a story with {AGENT_NAME}</strong>, the red button at the top of the page.</span>
      </p>
    </section>
  );
}

export default async function EditorialPage({ searchParams }) {
  const params = await searchParams;
  const [result, profileData] = await Promise.all([getEditorialStories("all", { limit: 500 }), getScholarProfile()]);

  const profile = profileData?.profile || {};
  const me = { initials: profile.initials || "SC", name: profile.name || "Scholar", institution: profile.institution || "" };

  const stories = result?.stories || [];
  const rows = buildStoryRows(stories);
  const asked = TAB_ALIASES[params?.tab] || params?.tab;
  const initialTab = ["all", ...STORY_GROUPS.map((g) => g.key)].includes(asked) ? asked : "all";

  const published = rows.filter((r) => r.group === "published").length;
  const reads = rows.reduce((n, r) => n + (r.reads?.total || 0), 0);
  const questions = rows.reduce((n, r) => n + (r.questions?.total || 0), 0);
  const unanswered = rows.reduce((n, r) => n + (r.questions?.notHere || 0), 0);

  return (
    <div className="sc-shell">
      {/* `write`: this list has no other way to start the next story. */}
      <Topbar activeHref="/editorial" me={me} write />
      <div className="dash stories">
        <header className="dash-head">
          <div>
            <p className="dash-date">Stories</p>
            <h1 className="dash-greet">Your stories</h1>
            <p className="pods-intro">Everything you have written, drafted and published here, and what came of it.</p>
          </div>
          {rows.length ? (
            <dl className="stories-sum" aria-label="Across all your stories">
              <div><dt>Published</dt><dd>{published.toLocaleString()}</dd></div>
              <div><dt>Reads</dt><dd>{reads.toLocaleString()}</dd></div>
              <div><dt>Questions</dt><dd>{questions.toLocaleString()}{unanswered ? <small>{unanswered} unanswered</small> : null}</dd></div>
            </dl>
          ) : null}
        </header>

        {result?.failed ? (
          /* Not the empty state: a list that failed to load is not a scholar who has written nothing. */
          <section className="st-card dash-card stories-empty" role="alert">
            <h2 className="dash-h2">Your stories couldn&rsquo;t be loaded just now</h2>
            <p className="dash-muted">Nothing has been lost. Refresh the page in a moment to try again.</p>
          </section>
        ) : rows.length ? (
          <StoriesTable rows={rows} total={rows.length} variant="full" initialTab={initialTab} />
        ) : (
          <StoriesEmpty />
        )}
      </div>
    </div>
  );
}
