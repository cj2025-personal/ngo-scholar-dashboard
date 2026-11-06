import { BAND_LABELS, CONTRIBUTION_LABELS, countOrFloor } from "@/lib/impact";

/*
 * A scholar's impact record as a person reads it: the totals, each published
 * story with its readers, the circles, and what they contributed. The same on
 * the scholar's own page and on a shared link. Counts only; under the floor a
 * count is said as "fewer than 5", never as a number.
 */

const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null);

function Total({ label, value, note }) {
  return (
    <div className="imp-total">
      <span className="imp-total__value">{value}</span>
      <span className="imp-total__label">{label}</span>
      {note ? <span className="imp-total__note">{note}</span> : null}
    </div>
  );
}

export default function ImpactRecordView({ record }) {
  const t = record.totals;
  const floor = record.floor;
  const contributions = Object.entries(record.contributions?.by_kind || {}).filter(([kind, n]) => n > 0 && CONTRIBUTION_LABELS[kind]);
  return (
    <div className="imp-record">
      <section className="imp-totals" aria-label="Totals">
        <Total label="readers answered the questions" value={countOrFloor(t.readers, floor)} />
        <Total label="understood what they read" value={countOrFloor(t.understood, floor)} note={typeof t.readers === "number" && typeof t.understood === "number" && t.readers ? `${Math.round((t.understood / t.readers) * 100)}% of readers` : null} />
        <Total label={t.stories_published === 1 ? "story published" : "stories published"} value={t.stories_published.toLocaleString()} />
        <Total
          label={t.circles_led === 1 ? "learning circle" : "learning circles"}
          value={t.circles_led.toLocaleString()}
          note={t.circles_led ? `${t.classes_in_circles} ${t.classes_in_circles === 1 ? "class" : "classes"} · ${t.schools_in_circles} ${t.schools_in_circles === 1 ? "school" : "schools"}` : null}
        />
      </section>

      <section className="imp-section" aria-labelledby="imp-stories">
        <h2 className="imp-h2" id="imp-stories">Stories</h2>
        {record.stories.length ? (
          <ul className="imp-stories">
            {record.stories.map((s) => (
              <li key={s.slug || s.title} className="imp-story">
                <span className="imp-story__title">{s.title}</span>
                <span className="imp-story__meta">
                  {s.reading_ages.map((b) => BAND_LABELS[b] || b).join(" · ")}
                  {s.published_at ? ` · published ${day(s.published_at)}` : ""}
                </span>
                <span className="imp-story__reach">
                  {typeof s.readers === "number" ? (
                    <>
                      <b>{s.readers.toLocaleString()}</b> readers · <b>{s.understood.toLocaleString()}</b> understood
                    </>
                  ) : (
                    `Fewer than ${floor} readers so far`
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="imp-quiet">No stories published yet.</p>
        )}
      </section>

      {contributions.length ? (
        <section className="imp-section" aria-labelledby="imp-contrib">
          <h2 className="imp-h2" id="imp-contrib">Contributions</h2>
          <ul className="imp-contrib">
            {contributions.map(([kind, n]) => (
              <li key={kind}>
                <b>{n.toLocaleString()}</b> {CONTRIBUTION_LABELS[kind][n === 1 ? 0 : 1]}
              </li>
            ))}
          </ul>
          {record.contributions.first_at ? <p className="imp-quiet">Since {day(record.contributions.first_at)}.</p> : null}
        </section>
      ) : null}

      <section className="imp-terms" aria-label="What the numbers mean">
        <p>{record.terms.readers}</p>
        <p>{record.terms.understood}</p>
        <p>{record.terms.floor}</p>
      </section>
    </div>
  );
}
