"use client";

import { useEffect, useState } from "react";

import { CIRCLE_BANDS, listPublishedStories } from "@/lib/circles";

/*
 * A circle's name, purpose, reading ages and featured stories: to make one,
 * or to change one. The name and purpose are read by a model before any
 * learner sees them, so the button says it.
 */
export default function CircleForm({ initial = null, busy = false, error = null, submitLabel, onSubmit, onCancel = null }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [purpose, setPurpose] = useState(initial?.purpose ?? "");
  const [bands, setBands] = useState(initial?.bands ?? ["ages_8_11"]);
  const [featured, setFeatured] = useState(initial?.featuredEditorialIds ?? []);
  const [stories, setStories] = useState(null);

  useEffect(() => {
    let live = true;
    listPublishedStories().then((result) => {
      if (live) setStories(result.ok ? result.data : []);
    });
    return () => {
      live = false;
    };
  }, []);

  const toggle = (list, setList, value) => setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <form
      className="cc-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ name, purpose, bands, featuredEditorialIds: featured });
      }}
    >
      <label className="auth-field">
        <span className="auth-field__label">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Listening machines" required />
      </label>
      <label className="auth-field">
        <span className="auth-field__label">What the circle reads about</span>
        <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={400} rows={3} placeholder="Classes read how antennas pick one voice out of a crowd." required />
      </label>
      <fieldset className="cc-checks">
        <legend className="auth-field__label">Reading ages</legend>
        {CIRCLE_BANDS.map((band) => (
          <label key={band.value} className="cc-check">
            <input type="checkbox" checked={bands.includes(band.value)} onChange={() => toggle(bands, setBands, band.value)} />
            <span>{band.label}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="cc-checks">
        <legend className="auth-field__label">Stories it reads</legend>
        {stories === null ? <p className="st-muted">Reading your stories…</p> : null}
        {stories && stories.length === 0 ? <p className="st-muted">Publish a story to feature it here.</p> : null}
        {(stories || []).map((story) => (
          <label key={story.id} className="cc-check">
            <input type="checkbox" checked={featured.includes(story.id)} onChange={() => toggle(featured, setFeatured, story.id)} />
            <span>{story.title}</span>
          </label>
        ))}
      </fieldset>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <div className="cc-actions">
        <button type="submit" className="auth-submit" disabled={busy || bands.length === 0}>
          {busy ? "Checking the name and purpose…" : submitLabel}
        </button>
        {onCancel ? (
          <button type="button" className="ck-act" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
      <p className="st-muted">Before learners see it, the name and purpose are read for them: nothing asking them to contact you, nothing about themselves, nothing for sale.</p>
    </form>
  );
}
