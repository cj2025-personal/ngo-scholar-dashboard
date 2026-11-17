import CirclesView from "@/components/circles/CirclesView";
import Topbar from "@/components/scholar/Topbar";
import { getDashboardData } from "@/lib/dashboard";
import { getEditorialStories } from "@/lib/editorial";

export const dynamic = "force-dynamic";

/**
 * Circles: the groups of classes that read a scholar's stories. Made here,
 * joined by a teacher with the circle's code and approved by their school;
 * held by the learner app, where the classes are.
 *
 * Whether the scholar has published anything is read here, so a first visit
 * with nothing out is sent to publish before starting a circle. Unknown (the
 * stories could not be read) is null, and does not stop anyone.
 */
export default async function CirclesPage() {
  const [dashboard, published] = await Promise.all([getDashboardData(), getEditorialStories("published", { limit: 1 })]);
  const hasPublished = published?.failed ? null : (published?.stories || []).some((s) => s.status === "published");
  const profile = dashboard?.profile || {};
  const institution =
    (dashboard?.profileDetails || []).find((detail) => detail.label === "Institution")?.value ||
    (Array.isArray(profile.tags) ? profile.tags[1] : "") ||
    "";
  const me = { initials: profile.initials || "SC", name: profile.name || "Scholar", institution };

  return (
    <div className="sc-shell">
      <Topbar activeHref="/circles" me={me} />
      <div className="dash">
        {/* The header is the view's: its "Start a circle" shows only once there is a list. */}
        <CirclesView hasPublished={hasPublished} />
      </div>
    </div>
  );
}
