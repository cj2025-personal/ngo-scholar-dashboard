import Link from "next/link";
import {
  FaBookOpen,
  FaBriefcase,
  FaBuildingColumns,
  FaCircleCheck,
  FaFlag,
  FaGraduationCap,
  FaLink,
  FaLocationDot,
  FaMicrophone,
  FaPen,
  FaRegCirclePlay,
  FaRegIdCard,
  FaTag,
  FaWandMagicSparkles,
} from "react-icons/fa6";
import ProfileAvatar from "@/components/profile/ProfileAvatar";
import SuggestButton from "@/components/profile/SuggestButton";

const IMG_BASE =
  process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4100";

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/** Coerce a possibly-array/object field into clean display text (or ""). */
function text(value) {
  let v = value;
  if (Array.isArray(v)) {
    v = v.filter((item) => typeof item === "string" && item.trim()).join("; ");
  }
  return typeof v === "string" ? v.trim() : "";
}

function statusLabel(status) {
  const s = String(status || "").toLowerCase();
  if (s === "published") return "Published";
  if (s === "draft") return "Draft";
  if (s === "in_review" || s === "review") return "In review";
  return status ? String(status) : "Draft";
}

function SectionCard({ icon, kicker, title, suggest, children }) {
  return (
    <article className="sc-prof-card">
      <header className="sc-prof-card-head">
        <div className="sc-prof-card-heading">
          <span className="sc-prof-kicker">
            {icon}
            {kicker}
          </span>
          {title ? <h2>{title}</h2> : null}
        </div>
        {suggest ? <SuggestButton {...suggest} /> : null}
      </header>
      {children}
    </article>
  );
}

export default function ScholarProfileView({ data }) {
  const profile = data?.profile;

  if (!profile) {
    return (
      <div className="sc-prof">
        <div className="sc-empty">
          <div className="ic" aria-hidden>
            <FaRegIdCard size={24} />
          </div>
          <h3>Profile unavailable</h3>
          <p>
            We couldn&rsquo;t load your scholar profile right now. Please refresh,
            or sign in again if the problem persists.
          </p>
        </div>
      </div>
    );
  }

  const about = data.about || {};
  const researchFocus = Array.isArray(data.researchFocus) ? data.researchFocus : [];
  const education = Array.isArray(data.education) ? data.education : [];
  const milestones = Array.isArray(data.milestones) ? data.milestones : [];
  const publications = Array.isArray(data.featuredPublications)
    ? data.featuredPublications
    : [];
  const editorials = Array.isArray(data.editorials) ? data.editorials : [];
  const podcasts = Array.isArray(data.podcasts) ? data.podcasts : [];
  const links = data.linksAndMedia || {};
  const socialProfiles = Array.isArray(links.socialProfiles)
    ? links.socialProfiles.filter((item) => item && item.url)
    : [];
  const references = Array.isArray(links.references)
    ? links.references.filter((item) => item && item.url)
    : [];
  const featuredVideo = links.featuredVideo && links.featuredVideo.url ? links.featuredVideo : null;

  const photo = profile.photo;
  const photoSrc = photo
    ? photo.external
      ? photo.url
      : `${IMG_BASE}${photo.url}`
    : null;

  const bioLead =
    [about.detailedBio, about.longSummary, about.shortBio, about.summary]
      .map(text)
      .find(Boolean) || null;
  const aboutBlocks = [
    ["Background", about.backgroundSummary],
    ["Current work", about.currentWork],
    ["Research overview", about.researchOverview],
    ["Methodology", about.methodology],
  ]
    .map(([label, value]) => [label, text(value)])
    .filter(([, value]) => value && value !== bioLead);
  const hasAbout = Boolean(bioLead) || aboutBlocks.length > 0;

  const facts = [
    [<FaBriefcase size={13} aria-hidden key="pos" />, profile.currentPosition],
    [<FaBuildingColumns size={13} aria-hidden key="inst" />, profile.institution],
    [<FaTag size={13} aria-hidden key="field" />, profile.fieldOfStudy],
    [<FaLocationDot size={13} aria-hidden key="loc" />, profile.location],
  ].filter(([, value]) => value);

  const detailItems = [
    ["Institution", profile.institution],
    ["Department", profile.department],
    ["Field of study", profile.fieldOfStudy],
    ["Location", profile.location],
    ["Login email", profile.loginEmail],
  ].filter(([, value]) => value);

  const hasLinks = Boolean(featuredVideo) || socialProfiles.length > 0 || references.length > 0;
  const mainIsEmpty =
    !hasAbout &&
    researchFocus.length === 0 &&
    education.length === 0 &&
    milestones.length === 0 &&
    publications.length === 0 &&
    !hasLinks;

  const heading = [profile.title, profile.name].filter(Boolean).join(" ");

  // Concise text snapshots handed to the "suggest an edit" modal for context.
  const identitySnapshot = [
    heading,
    profile.tagline,
    [profile.currentPosition, profile.institution, profile.department, profile.location]
      .filter(Boolean)
      .join(" · "),
  ]
    .filter(Boolean)
    .join("\n");
  const aboutSnapshot = [bioLead, ...aboutBlocks.map(([l, v]) => `${l}: ${v}`)]
    .filter(Boolean)
    .join("\n\n");
  const researchSnapshot = researchFocus.map(text).filter(Boolean).join(", ");
  const educationSnapshot = education
    .map((item) => [item.degree, item.institution, item.year].filter(Boolean).join(" · "))
    .join("\n");
  const milestonesSnapshot = milestones
    .map((item) => [item.year, item.title].filter(Boolean).join(" — "))
    .join("\n");
  const publicationsSnapshot = publications
    .map((item) => [item.title, item.year].filter(Boolean).join(" · "))
    .join("\n");
  const detailsSnapshot = detailItems.map(([l, v]) => `${l}: ${v}`).join("\n");

  return (
    <div className="sc-prof">
      {/* ---------- Hero ---------- */}
      <header className="sc-prof-hero">
        <div className="sc-prof-hero-band" aria-hidden />
        <div className="sc-prof-hero-body">
          <ProfileAvatar
            src={photoSrc}
            initials={profile.initials}
            name={profile.name}
          />
          <div className="sc-prof-hero-main">
            <div className="sc-prof-name">
              <h1>{heading}</h1>
              <FaCircleCheck size={19} className="sc-prof-verified" aria-hidden />
              <span className="sc-sr-only">Verified Archivyn scholar</span>
              <span className="sc-prof-name-edit">
                <SuggestButton
                  sectionKey="identity"
                  label="Name & headline"
                  currentText={identitySnapshot}
                />
              </span>
            </div>
            {profile.tagline ? (
              <p className="sc-prof-tagline">{profile.tagline}</p>
            ) : null}
            {facts.length > 0 ? (
              <div className="sc-prof-facts">
                {facts.map(([icon, value]) => (
                  <span className="sc-prof-fact" key={value}>
                    {icon}
                    {value}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="sc-prof-stats">
            <div className="sc-prof-stat">
              <b>{profile.counts?.editorials ?? 0}</b>
              <span>Editorials</span>
            </div>
            <div className="sc-prof-stat">
              <b>{profile.counts?.publications ?? 0}</b>
              <span>Publications</span>
            </div>
            <div className="sc-prof-stat">
              <b>{profile.counts?.podcasts ?? 0}</b>
              <span>Podcasts</span>
            </div>
          </div>
        </div>
      </header>

      {/* ---------- Body ---------- */}
      <div className="sc-prof-grid">
        <div className="sc-prof-main">
          {hasAbout ? (
            <SectionCard
              icon={<FaRegIdCard size={13} aria-hidden />}
              kicker="About"
              title="Scholar overview"
              suggest={{ sectionKey: "about", label: "About", currentText: aboutSnapshot }}
            >
              {bioLead ? <p className="sc-prof-lead">{bioLead}</p> : null}
              {aboutBlocks.length > 0 ? (
                <div className="sc-prof-blocks">
                  {aboutBlocks.map(([label, value]) => (
                    <div className="sc-prof-block" key={label}>
                      <strong>{label}</strong>
                      <p>{value}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </SectionCard>
          ) : null}

          {researchFocus.length > 0 ? (
            <SectionCard
              icon={<FaWandMagicSparkles size={13} aria-hidden />}
              kicker="Research focus"
              title="Fields & themes"
              suggest={{
                sectionKey: "research_focus",
                label: "Research focus",
                currentText: researchSnapshot,
              }}
            >
              <div className="sc-prof-chips">
                {researchFocus.map((item) => (
                  <span className="sc-prof-chip" key={item}>
                    {item}
                  </span>
                ))}
              </div>
            </SectionCard>
          ) : null}

          {education.length > 0 ? (
            <SectionCard
              icon={<FaGraduationCap size={13} aria-hidden />}
              kicker="Education"
              title="Academic background"
              suggest={{
                sectionKey: "education",
                label: "Education",
                currentText: educationSnapshot,
              }}
            >
              <div className="sc-prof-timeline">
                {education.map((item, index) => (
                  <div className="sc-prof-tl-item" key={`${item.degree}-${item.year || index}`}>
                    <span className="sc-prof-tl-year">{item.year || "—"}</span>
                    <div className="sc-prof-tl-body">
                      <strong>{item.degree || "Degree"}</strong>
                      {item.institution ? <span className="sc-prof-tl-sub">{item.institution}</span> : null}
                      {item.brief ? <p>{item.brief}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          ) : null}

          {milestones.length > 0 ? (
            <SectionCard
              icon={<FaFlag size={13} aria-hidden />}
              kicker="Career timeline"
              title="Milestones"
              suggest={{
                sectionKey: "milestones",
                label: "Career timeline",
                currentText: milestonesSnapshot,
              }}
            >
              <div className="sc-prof-timeline">
                {milestones.map((item, index) => (
                  <div className="sc-prof-tl-item" key={`${item.title}-${item.year || index}`}>
                    <span className="sc-prof-tl-year">{item.year || "Current"}</span>
                    <div className="sc-prof-tl-body">
                      <strong>{item.title || "Milestone"}</strong>
                      {item.type ? <span className="sc-prof-tl-sub">{item.type}</span> : null}
                      {item.description ? <p>{item.description}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          ) : null}

          {publications.length > 0 ? (
            <SectionCard
              icon={<FaBookOpen size={13} aria-hidden />}
              kicker="Publications"
              title="Featured publications"
              suggest={{
                sectionKey: "publications",
                label: "Publications",
                currentText: publicationsSnapshot,
              }}
            >
              <div className="sc-prof-pubs">
                {publications.map((item, index) => (
                  <article className="sc-prof-pub" key={`${item.title}-${item.year || index}`}>
                    <div className="sc-prof-pub-meta">
                      <span className="sc-prof-pub-type">{item.type || "Publication"}</span>
                      {[item.publisher, item.year].filter(Boolean).length > 0 ? (
                        <span className="sc-prof-pub-src">
                          {[item.publisher, item.year].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </div>
                    <h3>{item.title || "Untitled publication"}</h3>
                    {item.brief_description ? <p>{item.brief_description}</p> : null}
                  </article>
                ))}
              </div>
            </SectionCard>
          ) : null}

          {hasLinks ? (
            <SectionCard
              icon={<FaLink size={13} aria-hidden />}
              kicker="Links & media"
              title="Around the web"
              suggest={{ sectionKey: "links_and_media", label: "Links & media" }}
            >
              {featuredVideo ? (
                <a
                  className="sc-prof-video"
                  href={featuredVideo.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <span className="sc-prof-video-ic" aria-hidden>
                    <FaRegCirclePlay size={20} />
                  </span>
                  <span className="sc-prof-video-txt">
                    <strong>{featuredVideo.title || "Featured video"}</strong>
                    <span>Watch now</span>
                  </span>
                </a>
              ) : null}
              {socialProfiles.length > 0 ? (
                <div className="sc-prof-links">
                  {socialProfiles.map((item, index) => (
                    <a
                      className="sc-prof-linkchip"
                      key={`${item.url}-${index}`}
                      href={item.url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <FaLink size={12} aria-hidden />
                      {item.platform || item.handle || item.url}
                    </a>
                  ))}
                </div>
              ) : null}
              {references.length > 0 ? (
                <ul className="sc-prof-refs">
                  {references.map((item, index) => (
                    <li key={`${item.url}-${index}`}>
                      <a href={item.url} target="_blank" rel="noreferrer noopener">
                        {item.title || item.url}
                      </a>
                      {item.description ? <span>{item.description}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </SectionCard>
          ) : null}

          {mainIsEmpty ? (
            <SectionCard
              icon={<FaWandMagicSparkles size={13} aria-hidden />}
              kicker="Getting started"
              title="Your profile is taking shape"
            >
              <p className="sc-prof-lead">
                As your record grows, your research focus, education, milestones,
                and publications will appear here automatically. Publish an
                editorial or podcast to start building your scholar commons.
              </p>
              <Link href="/editorial/new" className="sc-prof-cta">
                <FaPen size={13} aria-hidden /> Write an editorial
              </Link>
            </SectionCard>
          ) : null}
        </div>

        <aside className="sc-prof-side">
          <SectionCard
            icon={<FaRegIdCard size={13} aria-hidden />}
            kicker="Details"
            suggest={{
              sectionKey: "details",
              label: "Profile details",
              currentText: detailsSnapshot,
            }}
          >
            {detailItems.length > 0 ? (
              <dl className="sc-prof-details">
                {detailItems.map(([label, value]) => (
                  <div className="sc-prof-detail" key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="sc-prof-muted">No profile details on file yet.</p>
            )}
          </SectionCard>

          {editorials.length > 0 ? (
            <SectionCard
              icon={<FaPen size={13} aria-hidden />}
              kicker="Editorials"
            >
              <div className="sc-prof-mini">
                {editorials.map((item) => {
                  const href = item.slug ? `/stories/${item.slug}` : `/editorial/${item.id}`;
                  const date = formatDate(item.updatedAt || item.createdAt);
                  return (
                    <Link href={href} className="sc-prof-mini-item" key={item.id}>
                      <strong>{item.title}</strong>
                      <span>
                        {statusLabel(item.status)}
                        {date ? <> · {date}</> : null}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </SectionCard>
          ) : null}

          {podcasts.length > 0 ? (
            <SectionCard
              icon={<FaMicrophone size={13} aria-hidden />}
              kicker="Podcasts"
            >
              <div className="sc-prof-mini">
                {podcasts.map((item, index) => (
                  <div className="sc-prof-mini-item" key={item.podcast_id || item.title || index}>
                    <strong>{item.title || "Untitled episode"}</strong>
                    <span>{item.status || item.media_type || "audio"}</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
