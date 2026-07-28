import Link from "next/link";
import {
  FaArrowRight,
  FaLayerGroup,
  FaMicrophone,
  FaPen,
} from "react-icons/fa6";

export default function DiscoveryRail({ dashboard }) {
  const summary = dashboard?.summaryCards || [];
  const profile = dashboard?.profile || {};
  const tags = Array.isArray(profile.tags) ? profile.tags : [];

  return (
    <aside className="sc-rail">
      {summary.length > 0 ? (
        <div className="sc-panel sc-impact">
          <h4>Your workspace</h4>
          <div className="psub">Everything you&rsquo;ve created</div>
          <div className="sc-stats">
            {summary.map((card) => (
              <div className="sc-stat" key={card.title}>
                <b>{card.value}</b>
                <span>{card.title}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {profile.name ? (
        <div className="sc-panel">
          <h4>Your profile</h4>
          <div className="psub">{profile.name}</div>
          {profile.summary ? (
            <p className="sc-rail-note">{profile.summary}</p>
          ) : null}
          {tags.length > 0 ? (
            <div className="sc-topics">
              {tags.map((tag) => (
                <span key={tag} className="sc-tag-static">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
          <Link href="/profile" className="sc-open sc-rail-link">
            View full profile <FaArrowRight size={11} aria-hidden />
          </Link>
        </div>
      ) : null}

      <div className="sc-panel">
        <h4>Create</h4>
        <div className="psub">Add to your commons</div>
        <div className="sc-quick">
          <Link href="/editorial/new">
            <FaPen size={14} aria-hidden /> Write an editorial
          </Link>
          <Link href="/editorial">
            <FaLayerGroup size={14} aria-hidden /> Manage editorials
          </Link>
          <Link href="/podcasts">
            <FaMicrophone size={14} aria-hidden /> Podcasts
          </Link>
        </div>
      </div>
    </aside>
  );
}
