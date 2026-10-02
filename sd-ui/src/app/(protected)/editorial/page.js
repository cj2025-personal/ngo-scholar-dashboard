import StoriesTable from "@/components/scholar/StoriesTable";
import Topbar from "@/components/scholar/Topbar";
import { getEditorialStories } from "@/lib/editorial";
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
          <section className="st-card dash-card stories-empty" aria-labelledby="stories-empty-title">
            <h2 id="stories-empty-title" className="dash-h2">Nothing written yet</h2>
            <p className="dash-muted">
              Every story starts from &ldquo;Write a story with Kivyn&rdquo;, at the top of this page: say what you want to write,
              or pick one of your papers, and Kivyn plans it with you before a word is drafted.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
