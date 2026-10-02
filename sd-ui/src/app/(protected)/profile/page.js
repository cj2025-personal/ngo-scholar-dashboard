import Topbar from "@/components/scholar/Topbar";
import ScholarProfileView from "@/components/profile/ScholarProfileView";
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
      {/* The corrections are drawn inside the view, at the foot of the record
          they are about, and counted in its tiles. */}
      <ScholarProfileView data={data} corrections={corrections} />
    </div>
  );
}
