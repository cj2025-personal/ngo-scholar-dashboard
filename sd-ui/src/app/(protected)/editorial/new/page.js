import { cookies } from "next/headers";

import StoryWorkspace from "@/components/editorial/StoryWorkspace";
import { getScholarProfile } from "@/lib/profile";
import { paneClosedIn } from "@/lib/kivyn/pane";

export const dynamic = "force-dynamic";

/**
 * New story: the editor, with the agent in the rail beside it.
 * `?source=origin:id` starts from a paper; `?job=<id>` picks up a paused
 * outline; `?circle=<id>` writes for one of the scholar's learning circles
 * (its page's "Write a story for this circle"). Any opens the rail — after
 * the terms, the first time.
 */
export default async function NewEditorialStoryPage({ searchParams }) {
  const params = await searchParams;
  const [data, cookieStore] = await Promise.all([getScholarProfile(), cookies()]);
  const profile = data?.profile || {};
  const me = {
    initials: profile.initials || "SC",
    name: profile.name || "Scholar",
    institution: profile.institution || "",
  };
  const initialSource = typeof params?.source === "string" ? params.source : null;
  const resumeJobId = typeof params?.job === "string" ? params.job : null;
  const initialCircle = typeof params?.circle === "string" && /^[a-f0-9]{24}$/i.test(params.circle) ? params.circle : null;
  /* `?propose=1` is the studio's "Suggest an angle": ask the agent what this
     paper could become, without the scholar writing a brief. Carried as
     intent rather than as a job, so the terms are settled here first. */
  const autoPropose = params?.propose === "1" && Boolean(initialSource);

  return (
    <div className="sc-shell">
      <div className="sc-editorial">
        <StoryWorkspace me={me} aiTerms={profile.aiTerms || null} initialSource={initialSource} initialCircle={initialCircle} resumeJobId={resumeJobId} autoPropose={autoPropose} paneClosed={paneClosedIn(cookieStore)} />
      </div>
    </div>
  );
}
