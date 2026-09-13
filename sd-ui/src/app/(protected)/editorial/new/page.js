import Topbar from "@/components/scholar/Topbar";
import NewStoryFlow from "@/components/editorial/NewStoryFlow";
import StoryWorkspace from "@/components/editorial/StoryWorkspace";
import { getScholarProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

/**
 * New story. By default the four-step flow from a paper; `?blank=1` opens
 * the plain editor for a story written by hand; `?source=origin:id`
 * preselects a paper; `?job=<id>` resumes a paused outline.
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
  const blank = params?.blank === "1";
  const initialSource = typeof params?.source === "string" ? params.source : null;
  const resumeJobId = typeof params?.job === "string" ? params.job : null;

  return (
    <div className="sc-shell">
      <Topbar activeHref="/editorial" me={me} />
      {blank ? (
        <div className="sc-editorial">
          <StoryWorkspace />
        </div>
      ) : (
        <NewStoryFlow initialSource={initialSource} resumeJobId={resumeJobId} />
      )}
    </div>
  );
}
