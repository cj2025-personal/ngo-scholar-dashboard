import Topbar from "@/components/scholar/Topbar";
import StoryWorkspace from "@/components/editorial/StoryWorkspace";
import { getScholarProfile } from "@/lib/profile";

export default async function NewEditorialStoryPage() {
  const data = await getScholarProfile();
  const profile = data?.profile || {};
  const me = {
    initials: profile.initials || "SC",
    name: profile.name || "Scholar",
    institution: profile.institution || "",
  };

  return (
    <div className="sc-shell">
      <Topbar activeHref="/editorial" me={me} />
      <div className="sc-editorial">
        <StoryWorkspace />
      </div>
    </div>
  );
}
