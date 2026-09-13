"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FaArrowUpRightFromSquare, FaUpload, FaWandMagicSparkles } from "react-icons/fa6";

/**
 * Papers: what we hold of the scholar's work, and what each may be used for.
 *
 * The table is the inventory the drafter reads; the drawer is one paper in
 * full: its licence in words, the stories drawn from it, and the one action
 * that applies. The reason under every pill is the eligibility rule's own
 * sentence, so what the scholar reads here is what the server will enforce.
 */

const DOCS_PORTAL_URL =
  process.env.NEXT_PUBLIC_DOCS_PORTAL_URL || "http://localhost:3000/scholar-documents";

const USE_PILL = {
  draftable: { cls: "is-published", text: "Draft from" },
  citable: { cls: "is-scheduled", text: "Quote only" },
  unusable: { cls: "", text: "Title only" },
};

const TABS = [
  { id: "all", label: "All" },
  { id: "draftable", label: "Ready to draft from" },
  { id: "citable", label: "Quotable" },
  { id: "pending", label: "In progress" },
];

function fmtWords(n) {
  return `${Number(n || 0).toLocaleString()}`;
}

export default function PapersLibrary({ inventory, stories }) {
  const all = useMemo(() => {
    if (!inventory) return [];
    return [...inventory.draftable, ...inventory.citable, ...inventory.unusable].map((s) => ({
      ...s,
      key: `${s.origin}:${s.id}`,
      stories: (stories || []).filter((st) => st.provenance?.sourceId === s.id),
    }));
  }, [inventory, stories]);

  const [tab, setTab] = useState("all");
  const [selectedKey, setSelectedKey] = useState(() => all.find((s) => s.use === "draftable")?.key || all[0]?.key || null);

  const rows = all.filter((s) => (tab === "all" ? true : tab === "pending" ? s.pending : s.use === tab));
  const selected = all.find((s) => s.key === selectedKey) || rows[0] || null;
  const counts = { all: all.length, draftable: all.filter((s) => s.use === "draftable").length, citable: all.filter((s) => s.use === "citable").length, pending: all.filter((s) => s.pending).length };
  const canDraft = Boolean(inventory?.eligible);

  if (!inventory) {
    return <p className="sc-write-msg is-error">We couldn&rsquo;t load your papers. Refresh to try again.</p>;
  }

  return (
    <div className="pp-wrap">
      <div className="pp-head">
        <div>
          <span className="sc-kicker">Papers</span>
          <h1 className="st-h1">What we hold of your work</h1>
          <p className="st-sub">Every paper, with what we are allowed to do with it. A paper with no known licence is “title only” until we know better; we never guess.</p>
          {!canDraft ? <p className="sc-src-gate" style={{ marginTop: 12 }}><b>Drafting is not open to you yet.</b> {inventory.gateReason}</p> : null}
        </div>
        <a href={DOCS_PORTAL_URL} target="_blank" rel="noreferrer" className="sc-write-publish pp-add"><FaUpload size={12} aria-hidden /> Add a paper</a>
      </div>

      <div className="pp-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "pp-tab on" : "pp-tab"} onClick={() => setTab(t.id)}>
            {t.label} · {counts[t.id]}
          </button>
        ))}
      </div>

      <div className="pp-grid">
        <div className="st-card pp-table-card">
          {rows.length === 0 ? (
            <p className="st-muted" style={{ padding: 12 }}>{tab === "all" ? "We hold nothing of your work yet. Add a paper you hold the rights to." : "Nothing here."}</p>
          ) : (
            <table className="pp-table">
              <thead>
                <tr><th style={{ width: "46%" }}>Paper</th><th>Year</th><th>Words</th><th>May be used for</th><th></th></tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const pill = s.pending ? { cls: "is-draft", text: "In progress" } : USE_PILL[s.use] || USE_PILL.unusable;
                  return (
                    <tr key={s.key} className={selected?.key === s.key ? "sel" : ""} onClick={() => setSelectedKey(s.key)}>
                      <td>
                        <div className="pp-title">{s.title}</div>
                        <div className="st-todo-detail">{s.origin === "contributed" ? "Uploaded by you" : "From public sources"}{s.stories.length ? ` · ${s.stories.length} stor${s.stories.length === 1 ? "y" : "ies"}` : ""}</div>
                      </td>
                      <td>{s.year || "—"}</td>
                      <td>{s.words ? fmtWords(s.words) : "—"}</td>
                      <td>
                        <span className={`sc-status ${pill.cls}`} style={{ marginLeft: 0 }}>{pill.text}</span>
                        <div className="st-todo-detail" style={{ marginTop: 4 }}>{s.reason}</div>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {s.use === "draftable" && canDraft ? (
                          <Link href={`/editorial/new?source=${encodeURIComponent(s.key)}`} className="sc-write-secondary st-btn"><FaWandMagicSparkles size={11} aria-hidden /> Start a story</Link>
                        ) : s.use === "citable" ? (
                          <a href={DOCS_PORTAL_URL} target="_blank" rel="noreferrer" className="st-link">Add a version you own</a>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {selected ? (
          <aside className="pp-drawer">
            <span className="sc-kicker">Selected paper</span>
            <h2 className="pp-drawer-title">{selected.title}</h2>
            <div className="pp-pills">
              <span className={`sc-status ${(selected.pending ? { cls: "is-draft" } : USE_PILL[selected.use] || USE_PILL.unusable).cls}`} style={{ marginLeft: 0 }}>{selected.pending ? "In progress" : USE_PILL[selected.use]?.text}</span>
              {selected.words ? <span className="sc-status" style={{ marginLeft: 0 }}>{fmtWords(selected.words)} words</span> : null}
              {selected.year ? <span className="sc-status" style={{ marginLeft: 0 }}>{selected.year}</span> : null}
            </div>
            <p className="st-sub" style={{ marginTop: 12 }}>{selected.reason}.</p>
            <div className="sc-divider" />
            <span className="sc-kicker">Stories drawn from it</span>
            {selected.stories.length === 0 ? (
              <p className="st-muted">None yet.</p>
            ) : (
              selected.stories.map((st) => (
                <div key={st.id} style={{ marginTop: 8 }}>
                  <Link href={`/editorial/${st.id}`} className="st-story-title">{st.title}</Link>
                  <div className="st-todo-detail">{st.status === "published" ? "Published" : st.status === "scheduled" ? "Scheduled" : "Draft"}</div>
                </div>
              ))
            )}
            <div className="st-actions" style={{ marginTop: 16 }}>
              {selected.use === "draftable" && canDraft ? (
                <Link href={`/editorial/new?source=${encodeURIComponent(selected.key)}`} className="sc-write-publish st-btn-primary"><FaWandMagicSparkles size={11} aria-hidden /> Start a story</Link>
              ) : null}
              {selected.use === "citable" ? (
                <a href={DOCS_PORTAL_URL} target="_blank" rel="noreferrer" className="sc-write-secondary st-btn">Add a version you own <FaArrowUpRightFromSquare size={10} aria-hidden /></a>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
