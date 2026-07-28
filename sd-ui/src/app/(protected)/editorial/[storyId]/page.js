import Topbar from "@/components/scholar/Topbar";
import StoryWorkspace from "@/components/editorial/StoryWorkspace";
import { getEditorialStory } from "@/lib/editorial";
import { getScholarProfile } from "@/lib/profile";
import { notFound } from "next/navigation";

export default async function EditorialStoryPage({ params }) {
  const { storyId } = await params;
  const [storyResult, profileData] = await Promise.all([
    getEditorialStory(storyId),
    getScholarProfile(),
  ]);

  if (!storyResult?.story) {
    notFound();
  }

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
        <StoryWorkspace initialStory={storyResult.story} />
      </div>
    </div>
  );
}
