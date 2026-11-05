import CircleDetail from "@/components/circles/CircleDetail";
import Topbar from "@/components/scholar/Topbar";
import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

/** One circle: its classes, how many read each story, and its code. */
export default async function CirclePage({ params }) {
  const { id } = await params;
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
        <CircleDetail id={id} />
      </div>
    </div>
  );
}
