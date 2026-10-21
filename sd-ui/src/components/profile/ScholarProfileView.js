import Link from "next/link";
import {
  HiCheckBadge,
  HiOutlineArrowRight,
  HiOutlineArrowTopRightOnSquare,
  HiOutlineBriefcase,
  HiOutlineBuildingLibrary,
  HiOutlineIdentification,
  HiOutlineMapPin,
  HiOutlinePlayCircle,
  HiOutlineTag,
} from "react-icons/hi2";

import CorrectionHistory from "@/components/profile/CorrectionHistory";
import ProfileAvatar from "@/components/profile/ProfileAvatar";
import SuggestButton from "@/components/profile/SuggestButton";
import Tile from "@/components/scholar/Tile";

/**
 * Profile: who you are here, as Proj Arch holds it.
 *
 * ── What it is for ─────────────────────────────────────────────────────────
 * The record behind everything the platform says about a scholar, curated
 * from public sources, and the one place to say when it is wrong. So it reads
 * as the record, section by section, each with "Suggest an edit" in words,
 * and the answers to those suggestions under Corrections at the foot, where
 * the scholar raised them.
 *
 * ── What it is not ─────────────────────────────────────────────────────────
 * A second Studio. It used to carry its own "Write an editorial" button, a
 * third name for the door the Studio and Stories already have, and it called
 * stories "editorials". It now has neither: the work on Proj Arch is listed,
 * by the names the rest of the app uses, and writing starts where it starts
 * everywhere else.
 *
 * ── The numbers ─────────────────────────────────────────────────────────────
 * Every count is the API's, from the same sources the other pages read: the
 * stories as the Stories list counts them (a deleted story is gone, here as
 * everywhere), the conversations as the Podcasts page lists them, and the
 * corrections as they are answered.
 */

const IMG_BASE = process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4100";

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

/** Coerce a possibly-array field into clean display text (or ""). */
function text(value) {
  let v = value;
  if (Array.isArray(v)) v = v.filter((item) => typeof item === "string" && item.trim()).join("; ");
  return typeof v === "string" ? v.trim() : "";
}

/* A year as the record has it, or nothing: some records store a missing year as the word "null". */
function yearText(value) {
  const t = String(value ?? "").trim();
  return !t || /^(null|undefined|n\/a|none|-)$/i.test(t) ? "" : t;
}

/** Newest first by the first four-digit year in each; undated entries keep their order, last. */
function byYearDesc(items, yearOf) {
  const year = (item) => Number((yearText(yearOf(item)).match(/\d{4}/) || [])[0]) || null;
  return items
    .map((item, index) => ({ item, index, y: year(item) }))
    .sort((a, b) => (a.y === null) - (b.y === null) || (b.y || 0) - (a.y || 0) || a.index - b.index)
    .map((x) => x.item);
}

const plural = (n, one, many = `${one}s`) => `${Number(n || 0).toLocaleString()} ${n === 1 ? one : many}`;

/* The same four words, and the same pills, as the Studio and Stories. */
function storyStatus(story) {
  if (story.status === "published") return { label: "Published", tone: "published" };
  if (story.status === "scheduled") return { label: "Scheduled", tone: "scheduled" };
  if (story.inReview) return { label: "In review", tone: "review" };
  return { label: "Draft", tone: "draft" };
}

const CONVERSATION = {
  pending: { label: "Not yet released", pill: "dash-pill is-warn" },
  live: { label: "Released", pill: "dash-pill is-ok" },
  making: { label: "Being made", pill: "dash-pill is-info" },
  stopped: { label: "Stopped", pill: "dash-pill" },
};

/** A card in the record: its name, its "Suggest an edit", then what it holds. */
function RecordCard({ id, title, suggest, children, className = "" }) {
  const headingId = `prof-${id}-title`;
  return (
    <section className={`st-card dash-card${className ? ` ${className}` : ""}`} id={id} aria-labelledby={headingId}>
      <div className="dash-card__head">
        <h2 id={headingId} className="dash-h2">{title}</h2>
        {suggest ? <SuggestButton {...suggest} /> : null}
      </div>
      {children}
    </section>
  );
}

/** A timeline; past `limit` entries the rest wait behind "Show N more", so a long career does not bury the page. */
function Timeline({ items, yearOf, titleOf, subOf, bodyOf, limit = Infinity }) {
  const row = (item, index) => (
    <li key={`${titleOf(item)}-${index}`}>
      <span className="prof-timeline__year">{yearText(yearOf(item)) || "—"}</span>
      <div className="prof-timeline__body">
        <strong>{titleOf(item)}</strong>
        {subOf(item) ? <span>{subOf(item)}</span> : null}
        {bodyOf(item) ? <p>{bodyOf(item)}</p> : null}
      </div>
    </li>
  );
  const shown = items.slice(0, limit);
  const rest = items.slice(limit);
  return (
    <>
      <ol className="prof-timeline">{shown.map(row)}</ol>
      {rest.length ? (
        <details className="prof-more">
          <summary>Show {rest.length} more</summary>
          <ol className="prof-timeline">{rest.map((item, i) => row(item, i + shown.length))}</ol>
        </details>
      ) : null}
    </>
  );
}

export default function ScholarProfileView({ data, corrections }) {
  const profile = data?.profile;

  if (!profile) {
    return (
      <div className="dash prof">
        <section className="st-card dash-card prof-unavailable">
          <span className="prof-unavailable__icon" aria-hidden><HiOutlineIdentification size={26} /></span>
          <h1 className="dash-h2">Your profile could not be loaded</h1>
          <p className="dash-muted">Please refresh in a moment. If it keeps happening, sign out and back in.</p>
        </section>
      </div>
    );
  }

  const about = data.about || {};
  const researchFocus = Array.isArray(data.researchFocus) ? data.researchFocus.map(text).filter(Boolean) : [];
  const education = Array.isArray(data.education) ? data.education : [];
  const milestones = byYearDesc(Array.isArray(data.milestones) ? data.milestones : [], (i) => i.year);
  const publications = Array.isArray(data.featuredPublications) ? data.featuredPublications : [];
  const stories = Array.isArray(data.stories) ? data.stories : [];
  const conversations = Array.isArray(data.conversations) ? data.conversations : [];
  const recordings = Array.isArray(data.podcasts) ? data.podcasts : [];
  const links = data.linksAndMedia || {};
  const socialProfiles = Array.isArray(links.socialProfiles) ? links.socialProfiles.filter((item) => item && item.url) : [];
  const references = Array.isArray(links.references) ? links.references.filter((item) => item && item.url) : [];
  const featuredVideo = links.featuredVideo && links.featuredVideo.url ? links.featuredVideo : null;

  const counts = profile.counts || {};
  const storyCounts = counts.stories || { total: 0, published: 0, scheduled: 0, drafts: 0, inReview: 0 };
  const talkCounts = counts.conversations || { total: 0, live: 0, pending: 0 };
  const correctionItems = corrections?.suggestions || [];
  const openCorrections = correctionItems.filter((item) => item.status === "open").length;

  const photo = profile.photo;
  const photoSrc = photo ? (photo.external ? photo.url : `${IMG_BASE}${photo.url}`) : null;

  const bioLead = [about.detailedBio, about.longSummary, about.shortBio, about.summary].map(text).find(Boolean) || null;
  const aboutBlocks = [
    ["Background", about.backgroundSummary],
    ["Current work", about.currentWork],
    ["Research overview", about.researchOverview],
    ["Methodology", about.methodology],
  ]
    .map(([label, value]) => [label, text(value)])
    .filter(([, value]) => value && value !== bioLead);
  const hasAbout = Boolean(bioLead) || aboutBlocks.length > 0;
  const hasLinks = Boolean(featuredVideo) || socialProfiles.length > 0 || references.length > 0;
  const recordIsEmpty = !hasAbout && researchFocus.length === 0 && education.length === 0 && milestones.length === 0 && publications.length === 0 && !hasLinks;

  const heading = [profile.title, profile.name].filter(Boolean).join(" ");
  /* The headline once: the record's tagline when it has one, otherwise the facts are the headline. */
  const facts = [
    [HiOutlineBriefcase, profile.currentPosition],
    [HiOutlineBuildingLibrary, profile.institution],
    [HiOutlineTag, profile.fieldOfStudy],
    [HiOutlineMapPin, profile.location],
  ].filter(([, value]) => value);
  const tagline = profile.tagline && profile.tagline !== [profile.currentPosition, profile.institution].filter(Boolean).join(" | ") ? profile.tagline : null;
  /* Under a headline, only the facts it does not already say. */
  const newFacts = tagline ? facts.filter(([, value]) => !tagline.toLowerCase().includes(String(value).toLowerCase())) : facts;

  const detailItems = [
    ["Institution", profile.institution],
    ["Department", profile.department],
    ["Field of study", profile.fieldOfStudy],
    ["Location", profile.location],
    ["Signs in as", profile.loginEmail],
  ].filter(([, value]) => value);

  /* What each "Suggest an edit" quotes back, so the request says what it is about. */
  const snapshot = {
    identity: [heading, profile.tagline, [profile.currentPosition, profile.institution, profile.department, profile.location].filter(Boolean).join(" · ")].filter(Boolean).join("\n"),
    about: [bioLead, ...aboutBlocks.map(([l, v]) => `${l}: ${v}`)].filter(Boolean).join("\n\n"),
    research: researchFocus.join(", "),
    education: education.map((item) => [item.degree, item.institution, yearText(item.year)].filter(Boolean).join(" · ")).join("\n"),
    milestones: milestones.map((item) => [yearText(item.year), item.title].filter(Boolean).join(" — ")).join("\n"),
    publications: publications.map((item) => [item.title, item.year].filter(Boolean).join(" · ")).join("\n"),
    details: detailItems.map(([l, v]) => `${l}: ${v}`).join("\n"),
  };

  return (
    <div className="dash prof">
      {/* ── Who ─────────────────────────────────────────────────────────── */}
      <header className="prof-head">
        <ProfileAvatar src={photoSrc} initials={profile.initials} name={profile.name} />
        <div className="prof-head__id">
          <p className="dash-date">Your profile, as Proj Arch holds it</p>
          <h1 className="dash-greet prof-name">
            {heading}
            <span className="prof-verified" title="Verified Proj Arch scholar">
              <HiCheckBadge size={22} aria-hidden />
              <span className="sr-only">Verified Proj Arch scholar</span>
            </span>
          </h1>
          {tagline ? <p className="prof-tagline">{tagline}</p> : null}
          {newFacts.length ? (
            <ul className="prof-facts" aria-label="At a glance">
              {newFacts.map(([Icon, value]) => (
                <li key={value}><Icon size={15} aria-hidden />{value}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="prof-head__actions">
          <SuggestButton sectionKey="identity" label="Name and headline" currentText={snapshot.identity} />
          <Link href="/content" className="dash-btn">What Proj Arch says about you <HiOutlineArrowRight size={14} aria-hidden /></Link>
        </div>
      </header>

      {/* ── The record, in four numbers ─────────────────────────────────── */}
      <section className="dash-kpis prof-kpis" aria-label="Your record at a glance">
        <Tile
          label="Stories published"
          value={storyCounts.published.toLocaleString()}
          sub={[storyCounts.drafts ? plural(storyCounts.drafts, "draft") : null, storyCounts.scheduled ? `${storyCounts.scheduled} scheduled` : null].filter(Boolean).join(" · ") || (storyCounts.total ? "everything is out" : "none yet")}
          href="/editorial"
        />
        <Tile label="Publications" value={Number(counts.publications || 0).toLocaleString()} sub="on your public record" href={publications.length ? "#publications" : "/papers"} />
        <Tile
          label="Conversations"
          value={talkCounts.total.toLocaleString()}
          sub={talkCounts.total ? [talkCounts.live ? `${talkCounts.live} released` : null, talkCounts.pending ? `${talkCounts.pending} not yet released` : null].filter(Boolean).join(" · ") || "in the making" : "none in your name yet"}
          href="/podcasts"
          className={talkCounts.pending ? "is-attention" : ""}
        />
        <Tile
          label="Corrections"
          value={openCorrections.toLocaleString()}
          unit={correctionItems.length ? ` / ${correctionItems.length}` : null}
          sub={correctionItems.length ? (openCorrections ? "awaiting our reply" : "all answered") : "none asked for"}
          href="#corrections"
        />
      </section>

      <div className="dash-grid">
        {/* ── The record ─────────────────────────────────────────────────── */}
        <div className="dash-col-main">
          {recordIsEmpty ? (
            <section className="st-card dash-card prof-empty" aria-labelledby="prof-empty-title">
              <h2 id="prof-empty-title" className="dash-h2">Your record is still being assembled</h2>
              <p className="dash-muted">
                Your background, research focus, education, career and publications are drawn from public sources about you.
                Nothing has been found for them yet. If you know where something is, tell us and we will look.
              </p>
              <div className="dash-links">
                <SuggestButton sectionKey="about" label="Your record" currentText="" text="Tell us what is missing" />
              </div>
            </section>
          ) : null}

          {hasAbout ? (
            <RecordCard id="about" title="About" suggest={{ sectionKey: "about", label: "About", currentText: snapshot.about }}>
              {bioLead ? <p className="prof-lead">{bioLead}</p> : null}
              {/* The overview is the record's own summary; the rest is the long form, there when wanted. */}
              {aboutBlocks.length ? (
                <details className="prof-more" open={!bioLead}>
                  <summary>{aboutBlocks.map(([label]) => label.toLowerCase()).join(", ").replace(/^./, (c) => c.toUpperCase())}</summary>
                  <dl className="prof-blocks">
                    {aboutBlocks.map(([label, value]) => (
                      <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                    ))}
                  </dl>
                </details>
              ) : null}
            </RecordCard>
          ) : null}

          {researchFocus.length ? (
            <RecordCard id="research" title="Research focus" suggest={{ sectionKey: "research_focus", label: "Research focus", currentText: snapshot.research }}>
              <ul className="prof-chips">{researchFocus.map((item) => <li key={item}>{item}</li>)}</ul>
            </RecordCard>
          ) : null}

          {publications.length ? (
            <RecordCard id="publications" title="Publications" suggest={{ sectionKey: "publications", label: "Publications", currentText: snapshot.publications }}>
              <ul className="prof-pubs">
                {publications.map((item, index) => (
                  <li key={`${item.title}-${item.year || index}`}>
                    <div className="prof-pubs__meta">
                      <span className="dash-pill">{item.type || "Publication"}</span>
                      {[item.publisher, item.year].filter(Boolean).length ? <span>{[item.publisher, item.year].filter(Boolean).join(" · ")}</span> : null}
                    </div>
                    <strong>{item.title || "Untitled publication"}</strong>
                    {item.brief_description ? <p>{item.brief_description}</p> : null}
                  </li>
                ))}
              </ul>
              {counts.publications > publications.length ? (
                <p className="dash-faint prof-note">{publications.length} of {Number(counts.publications).toLocaleString()} shown: the ones your record features.</p>
              ) : null}
            </RecordCard>
          ) : null}

          {milestones.length ? (
            <RecordCard id="career" title="Career" suggest={{ sectionKey: "milestones", label: "Career timeline", currentText: snapshot.milestones }}>
              <Timeline items={milestones} limit={5} yearOf={(i) => i.year} titleOf={(i) => i.title || "Milestone"} subOf={(i) => i.type} bodyOf={(i) => i.description} />
            </RecordCard>
          ) : null}

          {hasLinks ? (
            <RecordCard id="links" title="Links and media" suggest={{ sectionKey: "links_and_media", label: "Links and media" }}>
              {featuredVideo ? (
                <a className="prof-video" href={featuredVideo.url} target="_blank" rel="noreferrer noopener">
                  <HiOutlinePlayCircle size={28} aria-hidden />
                  <span><strong>{featuredVideo.title || "Featured video"}</strong><span>Opens in a new tab</span></span>
                </a>
              ) : null}
              {socialProfiles.length ? (
                <ul className="prof-chips is-links">
                  {socialProfiles.map((item, index) => (
                    <li key={`${item.url}-${index}`}>
                      <a href={item.url} target="_blank" rel="noreferrer noopener">{item.platform || item.handle || item.url}<HiOutlineArrowTopRightOnSquare size={12} aria-hidden /></a>
                    </li>
                  ))}
                </ul>
              ) : null}
              {references.length ? (
                <ul className="prof-refs">
                  {references.map((item, index) => (
                    <li key={`${item.url}-${index}`}>
                      <a href={item.url} target="_blank" rel="noreferrer noopener">{item.title || item.url}</a>
                      {item.description ? <span>{item.description}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </RecordCard>
          ) : null}

          <CorrectionHistory data={corrections} />
        </div>

        {/* ── Beside it: the details, and your work here ──────────────────── */}
        <aside className="dash-col-side">
          <RecordCard id="details" title="Details" className="dash-side-card" suggest={{ sectionKey: "details", label: "Profile details", currentText: snapshot.details }}>
            {detailItems.length ? (
              <dl className="prof-details">
                {detailItems.map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
              </dl>
            ) : (
              <p className="dash-muted">No details on file yet.</p>
            )}
          </RecordCard>

          {education.length ? (
            <RecordCard id="education" title="Education" className="dash-side-card" suggest={{ sectionKey: "education", label: "Education", currentText: snapshot.education }}>
              <Timeline items={education} yearOf={(i) => i.year} titleOf={(i) => i.degree || "Degree"} subOf={(i) => i.institution} bodyOf={(i) => i.brief} />
            </RecordCard>
          ) : null}

          <section className="st-card dash-card dash-side-card" aria-labelledby="prof-stories-title">
            <div className="dash-card__head">
              <div className="dash-card__title">
                <h2 id="prof-stories-title" className="dash-h3">Your stories</h2>
                <span className="dash-count is-quiet">{storyCounts.total}</span>
              </div>
              <Link href="/editorial" className="dash-link">All stories <HiOutlineArrowRight size={12} aria-hidden /></Link>
            </div>
            {stories.length ? (
              <ul className="prof-list">
                {stories.slice(0, 5).map((story) => {
                  const status = storyStatus(story);
                  const when = story.status === "published" ? formatDate(story.publishedAt || story.updatedAt) : story.status === "scheduled" ? `For ${formatDate(story.scheduledFor)}` : formatDate(story.updatedAt);
                  return (
                    <li key={story.id}>
                      <Link href={`/editorial/${story.id}`} title={story.title}>{story.title}</Link>
                      <span className="prof-list__meta">
                        <span className={`dash-status is-${status.tone}`}>{status.label}</span>
                        {when ? <span>{when}</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="dash-muted">Nothing written here yet. Your first story starts from the Studio.</p>
            )}
          </section>

          <section className="st-card dash-card dash-side-card" aria-labelledby="prof-talks-title">
            <div className="dash-card__head">
              <div className="dash-card__title">
                <h2 id="prof-talks-title" className="dash-h3">Conversations</h2>
                <span className="dash-count is-quiet">{talkCounts.total}</span>
              </div>
              <Link href="/podcasts" className="dash-link">All <HiOutlineArrowRight size={12} aria-hidden /></Link>
            </div>
            {conversations.length ? (
              <ul className="prof-list">
                {conversations.slice(0, 4).map((c) => {
                  const state = CONVERSATION[c.state] || CONVERSATION.making;
                  return (
                    <li key={c.id}>
                      <Link href={`/podcasts/${c.id}`} title={c.title}>{c.title}</Link>
                      <span className="prof-list__meta">
                        <span className={state.pill}>{state.label}</span>
                        {c.with ? <span>with {c.with}</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="dash-muted">No conversation has been made in your name yet.</p>
            )}
            {recordings.length ? (
              <p className="dash-faint prof-note">Also on your record: {plural(recordings.length, "other recording")}.</p>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
