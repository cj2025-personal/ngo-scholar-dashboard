import Topbar from "@/components/scholar/Topbar";
import StoryWorkspace from "@/components/editorial/StoryWorkspace";
import { getScholarProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

/**
 * New story: the editor, with the agent in the rail beside it.
 * `?source=origin:id` starts from a paper; `?job=<id>` picks up a paused
 * outline. Either opens the rail — after the terms, the first time.
 */
export default async function NewEditorialStoryPage({ searchParams }) {
  const params = await searchParams;
  const data = await getScholarProfile();
  const profile = data?.profile || {};
  const me = {
    initials: profile.initials || "SC",
    name: profile.name || "Scholar",
    institution: profile.institution || "",
  };
  const initialSource = typeof params?.source === "string" ? params.source : null;
  const resumeJobId = typeof params?.job === "string" ? params.job : null;

  return (
    <div className="sc-shell">
      <Topbar activeHref="/editorial" me={me} />
      <div className="sc-editorial">
        <StoryWorkspace me={me} aiTerms={profile.aiTerms || null} initialSource={initialSource} resumeJobId={resumeJobId} />
      </div>
    </div>
  );
}
