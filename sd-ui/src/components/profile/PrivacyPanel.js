"use client";

import { useState } from "react";

import ProfileAvatar from "@/components/profile/ProfileAvatar";
import { changeConsent, consentPhotoUrl } from "@/lib/privacy";

/**
 * Privacy and visibility: what of the record others may see, the scholar's to
 * decide (sd-api services/consent.service).
 *
 * ── Beside the record, not instead of it ────────────────────────────────────
 * The record is drawn from public sources, and "Suggest an edit" is how a
 * scholar says it is wrong. This is the other half: whatever it says, which
 * parts of it are shown. So it sits beside the record, one switch per layer,
 * each saying in plain words what on and off mean, and nothing here deletes
 * anything: off is "not shown", and on again brings it back as it was.
 *
 * ── What each switch is ─────────────────────────────────────────────────────
 * One control per layer, saved as it is changed, the answer being the server's
 * own state (and history) again, so the page never shows a choice it only
 * hoped was saved. The community choice is a set of boxes rather than a switch
 * because the answer is which, not whether; no boxes ticked is not sharing.
 */

function day(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

/* What happened, as the scholar would say it: theirs or our team's. */
function describe(event, labelOf) {
  const you = event.by === "scholar";
  switch (`${event.layer}:${event.action}`) {
    case "photo:grant":
      return you ? "You turned on your photo" : "Our team recorded permission to show your photo";
    case "photo:withdraw":
      return you ? "You turned off your photo" : "Our team turned off your photo";
    case "community:grant":
      return `You shared your community: ${(event.values || []).map(labelOf).join(", ")}`;
    case "community:withdraw":
      return you ? "You stopped sharing your community" : "Our team stopped showing your community";
    case "contact:grant":
      return you ? "You turned on your contact details" : "Our team turned on your contact details";
    case "contact:withdraw":
      return you ? "You turned off your contact details" : "Our team hid your contact details";
    case "listing:hide":
      return you ? "You hid your profile" : "Our team hid your profile";
    case "listing:unhide":
      return you ? "You listed your profile again" : "Our team listed your profile again";
    default:
      return "A setting changed";
  }
}

/** An on/off switch, named by its row's label and described by its help. */
function Switch({ id, checked, disabled, busy, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      id={`${id}-switch`}
      aria-checked={checked}
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-help`}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      className={`prof-switch${checked ? " is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="prof-switch__track" aria-hidden><span className="prof-switch__thumb" /></span>
      <span className="prof-switch__state" aria-hidden>{checked ? "On" : "Off"}</span>
    </button>
  );
}

function Row({ id, label, help, control, children, error }) {
  return (
    <li className="prof-privacy__row">
      <div className="prof-privacy__line">
        <span id={`${id}-label`} className="prof-privacy__label">{label}</span>
        {control}
      </div>
      <div id={`${id}-help`} className="prof-privacy__help">{help}</div>
      {children}
      {error ? <p className="prof-privacy__error" role="alert">{error}</p> : null}
    </li>
  );
}

export default function PrivacyPanel({ data: initial, name, initials }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState("");
  const [errors, setErrors] = useState({});
  /* The choice just made, shown at once while it saves; the server's answer
     replaces it, and a refusal puts the old state back beside its reason. */
  const [pending, setPending] = useState({});

  if (!data?.consent) {
    return (
      <section className="st-card dash-card dash-side-card prof-privacy" id="privacy" aria-labelledby="privacy-title">
        <div className="dash-card__head">
          <h2 id="privacy-title" className="dash-h2">Privacy and visibility</h2>
        </div>
        <p className="dash-muted">
          We can&rsquo;t load these settings right now. Please try again shortly; nothing about them has changed.
        </p>
      </section>
    );
  }

  const { listing, photo, community, contact } = data.consent;
  const choices = Array.isArray(data.communities) ? data.communities : [];
  const labelOf = (key) => choices.find((c) => c.key === key)?.label || key;
  const history = Array.isArray(data.history) ? data.history : [];

  async function save(layer, action, values, shown) {
    setBusy(layer);
    setPending((p) => ({ ...p, [layer]: shown }));
    setErrors((e) => ({ ...e, [layer]: null }));
    const result = await changeConsent(layer, action, values);
    if (result.ok) setData(result.data);
    else setErrors((e) => ({ ...e, [layer]: result.error }));
    setPending((p) => {
      const next = { ...p };
      delete next[layer];
      return next;
    });
    setBusy("");
  }

  const isOn = (layer, saved) => (layer in pending ? pending[layer] : saved);
  const chosen = isOn("community", community.values);
  const photoOn = isOn("photo", photo.shown);
  const contactOn = isOn("contact", contact.shown);
  const listedOn = isOn("listing", listing.listed);

  function toggleCommunity(key, checked) {
    const next = choices.map((c) => c.key).filter((k) => (k === key ? checked : chosen.includes(k)));
    if (next.length) save("community", "grant", next, next);
    else save("community", "withdraw", undefined, []);
  }

  const contactLines = contact.details
    ? [["Email", contact.details.email], ["Phone", contact.details.phone], ["Office", contact.details.office]].filter(([, v]) => v)
    : [];
  const credit = photo.credit ? [photo.credit.attribution, photo.credit.license].filter(Boolean).join(" · ") : "";
  const shownHistory = history.slice(0, 4);
  const moreHistory = history.slice(4);
  const historyItem = (event) => (
    <li key={event.id}>
      {describe(event, labelOf)}
      {day(event.at) ? <> on <time dateTime={event.at} suppressHydrationWarning>{day(event.at)}</time></> : null}
    </li>
  );

  return (
    <section className="st-card dash-card dash-side-card prof-privacy" id="privacy" aria-labelledby="privacy-title">
      <div className="dash-card__head">
        <h2 id="privacy-title" className="dash-h2">Privacy and visibility</h2>
      </div>
      <p className="dash-muted">
        Your record is drawn from public sources. Here you choose what of it others see. Turning something off deletes nothing.
      </p>

      <ul className="prof-privacy__rows">
        <Row
          id="privacy-photo"
          label="Show my photo"
          error={errors.photo}
          control={<Switch id="privacy-photo" checked={photoOn} disabled={!photo.hasPhoto && !photo.shown} busy={busy === "photo"} onChange={(on) => save("photo", on ? "grant" : "withdraw", undefined, on)} />}
          help={
            !photo.hasPhoto
              ? "There is no photo on your record yet, so readers see your initials."
              : photoOn
                ? "Readers see this photo beside your name."
                : "Readers see your initials. Turn this on to show this photo instead."
          }
        >
          {photo.hasPhoto ? (
            <div className="prof-privacy__photo">
              <ProfileAvatar src={consentPhotoUrl()} initials={initials} name={name} className="is-small" />
              {photo.shown && photo.basis && photo.basis !== "scholar" ? (
                <span className="dash-muted">{credit ? `Shown with the credit ${credit}.` : "Shown with a permission our team recorded."}</span>
              ) : null}
            </div>
          ) : null}
        </Row>

        <Row
          id="privacy-community"
          label="Share my community or heritage"
          error={errors.community}
          help="Optional, and shown only if you choose. It helps students find researchers who share their background. Proj Arch never guesses it."
        >
          <fieldset className="prof-privacy__picks" aria-labelledby="privacy-community-label" aria-describedby="privacy-community-help" disabled={busy === "community"}>
            {choices.map((c) => (
              <label key={c.key} className={`prof-pick${chosen.includes(c.key) ? " is-on" : ""}`}>
                <input type="checkbox" checked={chosen.includes(c.key)} onChange={(e) => toggleCommunity(c.key, e.target.checked)} />
                <span>{c.label}</span>
              </label>
            ))}
          </fieldset>
        </Row>

        <Row
          id="privacy-contact"
          label="Show my contact details"
          error={errors.contact}
          control={<Switch id="privacy-contact" checked={contactOn} busy={busy === "contact"} onChange={(on) => save("contact", on ? "grant" : "withdraw", undefined, on)} />}
          help={
            contactLines.length
              ? contactOn
                ? "Shown on your profile:"
                : "Kept private. Turn this on to show them on your profile:"
              : "We hold no contact details for you, so nothing would be shown."
          }
        >
          {contactLines.length ? (
            <dl className="prof-privacy__contact">
              {contactLines.map(([label, value]) => (
                <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          ) : null}
        </Row>

        <Row
          id="privacy-listing"
          label="List my profile publicly"
          error={errors.listing}
          control={<Switch id="privacy-listing" checked={listedOn} busy={busy === "listing"} onChange={(on) => save("listing", on ? "unhide" : "hide", undefined, on)} />}
          help={
            listedOn
              ? "You appear in the directory, in student stories and in search. Turning this off removes you from all three; your studio, your stories and your data stay."
              : "Hidden: you are not in the directory, in student stories or in search. Your studio, your stories and your data are all still here, and turning this on brings them back."
          }
        />
      </ul>

      <div className="prof-privacy__history">
        <h3 className="prof-privacy__label">Recent changes</h3>
        {history.length ? (
          <>
            <ul>{shownHistory.map(historyItem)}</ul>
            {moreHistory.length ? (
              <details className="prof-more">
                <summary>Show {moreHistory.length} more</summary>
                <ul>{moreHistory.map(historyItem)}</ul>
              </details>
            ) : null}
          </>
        ) : (
          <p className="dash-muted">
            None yet. Until you choose, your name and public professional record are shown, and your photo, community and contact details are not.
          </p>
        )}
      </div>
    </section>
  );
}
