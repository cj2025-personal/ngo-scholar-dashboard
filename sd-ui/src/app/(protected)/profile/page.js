import Topbar from "@/components/scholar/Topbar";
import ScholarProfileView from "@/components/profile/ScholarProfileView";
import CorrectionHistory from "@/components/profile/CorrectionHistory";
import { getScholarProfile } from "@/lib/profile";
import { getScholarCorrections } from "@/lib/corrections";

/* Never cached: a scholar checking this page is checking whether their
   correction has been answered yet, so a stale render defeats the purpose. */
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const [data, corrections] = await Promise.all([
    getScholarProfile(),
    getScholarCorrections(),
  ]);
  const profile = data?.profile || {};
  const me = {
    initials: profile.initials || "SC",
    name: profile.name || "Scholar",
    institution: profile.institution || "",
  };

  return (
    <div className="sc-shell">
      <Topbar activeHref="/profile" me={me} />
      <ScholarProfileView data={data} />
      {/* Below the profile, because it is the answer to something raised on it.
          Inside `sc-prof` so it sits in the same column as the cards above. */}
      <div className="sc-prof sc-prof--append">
        <CorrectionHistory data={corrections} />
      </div>
    </div>
  );
}
