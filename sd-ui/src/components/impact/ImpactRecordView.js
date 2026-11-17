import { BAND_LABELS, CONTRIBUTION_LABELS } from "@/lib/impact";

/*
 * A scholar's impact record as a person reads it: the totals, each published
 * story with its readers, the circles, and what they contributed. The same on
 * the scholar's own page and on a shared link. Counts only; under the floor a
 * count is said as "under 5", never as a number.
 *
 * ── Two counts of published stories (decided 2026-11-17) ───────────────────
 * The record carries two, and both are true: the totals count the stories
 * that are live when it is signed; the contributions count every story ever
 * published here, each once and for good, including any taken down since
 * (they are what a scholar is credited, and paid, for). Side by side under
 * the same words they read as a mistake, and hiding one would make the page
 * say less than the signature covers, on the one page a reader uses to check
 * it. So both are shown, each saying which it is: "live now" under the
 * total, "all time" in the contributions, and a line on how those count.
 */

const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null);

function Total({ label, value, floor, note }) {
  const counted = typeof value === "number";
  return (
    <div className={`imp-total${counted ? "" : " is-floor"}`}>
      <span className="imp-total__value">{counted ? value.toLocaleString() : `Under ${floor}`}</span>
      <span className="imp-total__label">{label}</span>
      {note ? <span className="imp-total__note">{note}</span> : null}
    </div>
  );
}

export default function ImpactRecordView({ record }) {
  const t = record.totals;
  const floor = record.floor;
  const contributions = Object.entries(record.contributions?.by_kind || {}).filter(([kind, n]) => n > 0 && CONTRIBUTION_LABELS[kind]);
  const share = typeof t.readers === "number" && typeof t.understood === "number" && t.readers ? `${Math.round((t.understood / t.readers) * 100)}% of readers` : null;

  return (
    <div className="imp-record">
      <section className="imp-totals" aria-label="Totals">
        <Total label="readers answered the questions" value={t.readers} floor={floor} note={typeof t.readers === "number" ? null : `Shown from ${floor} readers`} />
        <Total label="understood what they read" value={t.understood} floor={floor} note={share} />
        <Total label={t.stories_published === 1 ? "story published" : "stories published"} value={t.stories_published} floor={floor} note="live now" />
        <Total
          label={t.circles_led === 1 ? "learning circle" : "learning circles"}
          value={t.circles_led}
          floor={floor}
          note={t.circles_led ? `${t.classes_in_circles} ${t.classes_in_circles === 1 ? "class" : "classes"} · ${t.schools_in_circles} ${t.schools_in_circles === 1 ? "school" : "schools"}` : null}
        />
      </section>

      <section className="imp-section" aria-labelledby="imp-stories">
        <h2 className="imp-h2" id="imp-stories">Stories</h2>
        {record.stories.length ? (
          <ul className="imp-stories">
            {record.stories.map((s) => {
              const meta = [s.reading_ages.map((b) => BAND_LABELS[b] || b).join(", "), s.published_at ? `Published ${day(s.published_at)}` : null].filter(Boolean);
              return (
                <li key={s.slug || s.title} className="imp-story">
                  <span className="imp-story__title">{s.title}</span>
                  {meta.length ? <span className="imp-story__meta">{meta.join(" · ")}</span> : null}
                  <span className={`imp-story__reach${typeof s.readers === "number" ? "" : " is-floor"}`}>
                    {typeof s.readers === "number" ? (
                      <>
                        <b>{s.readers.toLocaleString()}</b> readers · <b>{s.understood.toLocaleString()}</b> understood
                      </>
                    ) : (
                      `Under ${floor} readers so far`
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="imp-quiet">No stories published yet.</p>
        )}
      </section>

      {contributions.length ? (
        <section className="imp-section" aria-labelledby="imp-contrib">
          <h2 className="imp-h2" id="imp-contrib">
            Contributions{record.contributions.first_at ? <span className="imp-h2__since"> since {day(record.contributions.first_at)}</span> : null}
          </h2>
          <ul className="imp-contrib">
            {contributions.map(([kind, n]) => (
              <li key={kind}>
                <b>{n.toLocaleString()}</b> {CONTRIBUTION_LABELS[kind][n === 1 ? 0 : 1]}
              </li>
            ))}
          </ul>
          <p className="imp-quiet">Each counts once and stays counted, even if a story is later taken down.</p>
        </section>
      ) : null}

      <details className="imp-terms">
        <summary>What the numbers mean</summary>
        <dl>
          <dt>Readers</dt>
          <dd>{record.terms.readers}</dd>
          <dt>Understood</dt>
          <dd>{record.terms.understood}</dd>
          <dt>Small numbers</dt>
          <dd>{record.terms.floor}</dd>
        </dl>
      </details>
    </div>
  );
}
