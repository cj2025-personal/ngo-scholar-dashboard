import Topbar from "@/components/scholar/Topbar";
import StudioHome from "@/components/scholar/StudioHome";
import { getDraftJobsServer, getDraftSourcesServer, getReadsTimelineServer } from "@/lib/drafting-server";
import { getEditorialStories } from "@/lib/editorial";
import { getScholarProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

/* The windows the reads chart offers; anything else in the address is 30. */
const RANGES = [7, 30, 90];

export default async function Home({ searchParams }) {
  const params = await searchParams;
  const asked = Number(params?.range);
  const range = RANGES.includes(asked) ? asked : 30;

  /* No episodes: the Studio listed unreleased conversations as things to do,
     and since 2026-11-16 a scholar sees only released ones, on Podcasts. */
  const [profileData, sources, jobsResult, storiesResult, reads] = await Promise.all([
    getScholarProfile(),
    getDraftSourcesServer(),
    getDraftJobsServer(10),
    getEditorialStories("all"),
    getReadsTimelineServer(range),
  ]);

  const profile = profileData?.profile || {};
  const me = {
    initials: profile.initials || "SC",
    name: profile.name || "Scholar",
    institution: profile.institution || "",
  };

  return (
    <div className="sc-shell">
      {/* No `write`: the Studio's head carries "Write a story with Kivyn" as a nudge. */}
      <Topbar activeHref="/" me={me} />
      <StudioHome
        me={me}
        sources={sources}
        jobs={jobsResult?.jobs || []}
        stories={storiesResult?.stories || []}
        reads={reads}
        range={range}
        ranges={RANGES}
      />
    </div>
  );
}
