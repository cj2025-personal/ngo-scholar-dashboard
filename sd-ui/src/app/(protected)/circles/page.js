import CirclesView from "@/components/circles/CirclesView";
import Topbar from "@/components/scholar/Topbar";
import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

/**
 * Circles: the groups of classes that read a scholar's stories. Made here,
 * joined by a teacher with the circle's code and approved by their school;
 * held by the learner app, where the classes are.
 */
export default async function CirclesPage() {
  const dashboard = await getDashboardData();
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
        <header className="dash-head">
          <div className="dash-head__copy">
            <p className="dash-date">Circles</p>
            <h1 className="dash-greet">Who reads with you</h1>
          </div>
        </header>
        <CirclesView />
      </div>
    </div>
  );
}
