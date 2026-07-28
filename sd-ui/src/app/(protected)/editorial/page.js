import Topbar from "@/components/scholar/Topbar";
import PublishedStoriesOverview from "@/components/editorial/PublishedStoriesOverview";
import { getEditorialStories } from "@/lib/editorial";
import { getScholarProfile } from "@/lib/profile";

export default async function EditorialPage() {
  const [publishedResult, draftResult, scheduledResult, profileData] = await Promise.all([
    getEditorialStories("published"),
    getEditorialStories("draft"),
    getEditorialStories("scheduled"),
    getScholarProfile(),
  ]);

  const profile = profileData?.profile || {};
  const me = {
    initials: profile.initials || "SC",
    name: profile.name || "Scholar",
    institution: profile.institution || "",
  };

  return (
    <div className="sc-shell">
      <Topbar activeHref="/editorial" me={me} />
      <div className="sc-editorial">
        <PublishedStoriesOverview
          publishedStories={publishedResult?.stories || []}
          scheduledStories={scheduledResult?.stories || []}
          draftStories={draftResult?.stories || []}
        />
      </div>
    </div>
  );
}
