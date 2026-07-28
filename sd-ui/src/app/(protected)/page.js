import Topbar from "@/components/scholar/Topbar";
import HomeFeed from "@/components/scholar/HomeFeed";
import DiscoveryRail from "@/components/scholar/DiscoveryRail";
import { getDashboardData } from "@/lib/dashboard";

export default async function Home() {
  const dashboard = await getDashboardData();
  const profile = dashboard?.profile || {};
  const institution =
    (dashboard?.profileDetails || []).find((detail) => detail.label === "Institution")
      ?.value ||
    (Array.isArray(profile.tags) ? profile.tags[1] : "") ||
    "";
  const me = {
    initials: profile.initials || "SC",
    name: profile.name || "Scholar",
    institution,
  };

  return (
    <div className="sc-shell">
      <Topbar activeHref="/" me={me} />
      <div className="sc-wrap">
        <main className="sc-feed">
          <HomeFeed dashboard={dashboard} me={me} />
        </main>
        <DiscoveryRail dashboard={dashboard} />
      </div>
    </div>
  );
}
