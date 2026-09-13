import Link from "next/link";
import { FaArrowUpRightFromSquare, FaBookOpen } from "react-icons/fa6";

/**
 * What this platform publishes under a scholar's name.
 *
 * ── The distinction the page turns on ──────────────────────────────────────
 * Content here comes in two kinds and they are not interchangeable:
 *
 *   authored — the scholar wrote it. Theirs to edit and unpublish.
 *   derived  — the platform adapted it from their published work. Theirs to
 *              correct or withdraw, but they did not write it.
 *
 * Most of what exists is derived: reading passages harvested from their
 * research and taught to children. A researcher opening this page has almost
 * certainly never seen them. Showing both kinds identically would imply they
 * approved material they have never read.
 *
 * ── Built from the existing vocabulary, not a new one ──────────────────────
 * `sc-page`, `sc-card`, `sc-status`, `sc-stat`, `sc-empty` and `sc-meta` are
 * already defined and already carry the app's look. Inventing parallel classes
 * here would fork the design system one page at a time, which is precisely the
 * drift that left this repo on a stale token sheet.
 */

function OriginTag({ origin }) {
  const derived = origin === "derived";
  return (
    <span className={derived ? "sc-origin is-derived" : "sc-origin is-authored"}>
      {derived ? "Adapted from your work" : "You wrote this"}
    </span>
  );
}

function PassageCard({ item }) {
  return (
    <article className="sc-card">
      <div className="sc-art no-cover">
        <div>
          <h3>{item.title || "Untitled passage"}</h3>
          {item.institution ? <p className="ex">{item.institution}</p> : null}
        </div>
      </div>

      <div className="sc-meta">
        <OriginTag origin={item.origin} />
        {item.targetGrade ? <span className="sc-chip">Grade {item.targetGrade}</span> : null}
        {item.words ? <span className="sc-mi">{item.words} words</span> : null}
        {/* How many children have actually read it — the most concrete answer
            to "is this really being used?" that we can give a researcher. */}
        <span className="sc-mi">
          {item.timesServed > 0
            ? `Read ${item.timesServed} ${item.timesServed === 1 ? "time" : "times"}`
            : "Not yet served"}
        </span>

        <span className="right">
          {item.sourceUrl ? (
            <a
              className="sc-open"
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Original source <FaArrowUpRightFromSquare aria-hidden="true" />
            </a>
          ) : null}
        </span>
      </div>
    </article>
  );
}

function EditorialCard({ item }) {
  return (
    <article className="sc-card">
      <div className="sc-art no-cover">
        <div>
          <h3>{item.title || "Untitled draft"}</h3>
        </div>
      </div>

      <div className="sc-meta">
        <OriginTag origin={item.origin} />
        <span className={item.visibleToStudents ? "sc-status is-published" : "sc-status is-draft"}>
          {item.visibleToStudents ? "Live to students" : "Not published"}
        </span>
        {item.lastEditedAt ? (
          <span className="sc-mi">
            Edited {new Date(item.lastEditedAt).toLocaleDateString()}
          </span>
        ) : null}

        <span className="right">
          <Link className="sc-open" href={`/editorial/${item.id}`}>
            Open
          </Link>
        </span>
      </div>
    </article>
  );
}

export default function ContentInventory({ data }) {
  if (!data) {
    return (
      <div className="sc-empty">
        <div className="ic">
          <FaBookOpen aria-hidden="true" />
        </div>
        <h3>We can&rsquo;t load this right now</h3>
        <p>
          Please try again shortly. This isn&rsquo;t a statement about what
          Archivyn publishes about you &mdash; we simply couldn&rsquo;t reach it.
        </p>
      </div>
    );
  }

  const passages = data.content?.passage ?? [];
  const editorials = data.content?.editorial ?? [];
  const total = passages.length + editorials.length;
  const live =
    passages.filter((item) => item.visibleToStudents).length +
    editorials.filter((item) => item.visibleToStudents).length;
  const unlinkedEditorials = data.coverage?.unattributed?.editorials ?? 0;

  return (
    <>
      <header className="sc-page-head">
        <span className="sc-kicker">Your work on Archivyn</span>
        <h1>Published under your name</h1>
        <p>
          Everything Archivyn currently shows students, drawn from your
          published research or written by you.
        </p>
      </header>

      {total > 0 ? (
        <section className="sc-panel sc-impact">
          <h4>At a glance</h4>
          <div className="sc-stats">
            <div className="sc-stat">
              <b>{total}</b>
              <span>Items</span>
            </div>
            <div className="sc-stat">
              <b>{live}</b>
              <span>Live to students</span>
            </div>
            <div className="sc-stat">
              <b>{passages.length}</b>
              <span>Adapted from your work</span>
            </div>
            <div className="sc-stat">
              <b>{editorials.length}</b>
              <span>Written by you</span>
            </div>
          </div>
        </section>
      ) : (
        <div className="sc-empty">
          <div className="ic">
            <FaBookOpen aria-hidden="true" />
          </div>
          <h3>Nothing yet</h3>
          <p>
            Archivyn hasn&rsquo;t published anything under your name. When it
            does, it will appear here &mdash; before most people see it.
          </p>
        </div>
      )}

      {passages.length > 0 ? (
        <section className="sc-podlist">
          <div className="sc-podlist-head">
            <div>
              <span className="sc-kicker">Adapted</span>
              <h2 className="sc-podlist-title">Reading passages</h2>
            </div>
            <span className="sc-count">{passages.length}</span>
          </div>
          <p className="sc-rail-note">
            Adapted from your published work and used in reading activities. You
            didn&rsquo;t write these &mdash; if any of them misrepresents your
            research, tell us and we&rsquo;ll correct or remove it.
          </p>
          {passages.map((item) => (
            <PassageCard key={item.id} item={item} />
          ))}
        </section>
      ) : null}

      {editorials.length > 0 ? (
        <section className="sc-podlist">
          <div className="sc-podlist-head">
            <div>
              <span className="sc-kicker">Written by you</span>
              <h2 className="sc-podlist-title">Your editorials</h2>
            </div>
            <span className="sc-count">{editorials.length}</span>
          </div>
          {editorials.map((item) => (
            <EditorialCard key={item.id} item={item} />
          ))}
        </section>
      ) : null}

      {/* Stated plainly rather than hidden. A scholar shown "8 items" while
          material exists that we cannot yet attribute has been given a true
          sentence and a false impression. */}
      {unlinkedEditorials > 0 ? (
        <p className="sc-rail-note">
          {unlinkedEditorials} editorial{unlinkedEditorials === 1 ? "" : "s"} on
          Archivyn predate scholar sign-in and aren&rsquo;t yet linked to a
          profile. If you wrote one, tell us and we&rsquo;ll connect it.
        </p>
      ) : null}
    </>
  );
}
