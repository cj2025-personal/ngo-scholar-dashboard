import ImpactView from "@/components/impact/ImpactView";
import Topbar from "@/components/scholar/Topbar";
import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

/**
 * Impact: what a scholar's work on Proj Arch reached - readers, readers who
 * understood, circles, contributions - as a signed record that is theirs to
 * share (sd-api services/impact.service).
 */
export default async function ImpactPage() {
  const dashboard = await getDashboardData();
  const profile = dashboard?.profile || {};
  const institution =
    (dashboard?.profileDetails || []).find((detail) => detail.label === "Institution")?.value ||
    (Array.isArray(profile.tags) ? profile.tags[1] : "") ||
    "";
  const me = { initials: profile.initials || "SC", name: profile.name || "Scholar", institution };

  return (
    <div className="sc-shell">
      <Topbar activeHref="/impact" me={me} />
      <div className="dash">
        <header className="dash-head">
          <div className="dash-head__copy">
            <p className="dash-date">Impact</p>
            <h1 className="dash-greet">What your work reached</h1>
          </div>
        </header>
        <ImpactView />
      </div>
    </div>
  );
}
