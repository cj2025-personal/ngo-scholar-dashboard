import Topbar from "@/components/scholar/Topbar";
import PapersLibrary from "@/components/papers/PapersLibrary";
import { getDraftSourcesServer } from "@/lib/drafting-server";
import { getEditorialStories } from "@/lib/editorial";
import { getScholarProfile } from "@/lib/profile";

export const metadata = {
  title: "Your papers",
  description: "What Archivyn holds of your work, and what it may be used for",
};

export const dynamic = "force-dynamic";

export default async function PapersPage() {
  const [inventory, storiesResult, profileData] = await Promise.all([
    getDraftSourcesServer(),
    getEditorialStories("all"),
    getScholarProfile(),
  ]);
  const profile = profileData?.profile || {};
  const me = { initials: profile.initials || "SC", name: profile.name || "Scholar", institution: profile.institution || "" };

  return (
    <div className="sc-shell">
      <Topbar activeHref="/papers" me={me} />
      <PapersLibrary inventory={inventory} stories={storiesResult?.stories || []} />
    </div>
  );
}
