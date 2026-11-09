import Topbar from "@/components/scholar/Topbar";
import ScholarProfileView from "@/components/profile/ScholarProfileView";
import { getScholarConsent, getScholarProfile } from "@/lib/profile";
import { getScholarCorrections } from "@/lib/corrections";

/* Never cached: a scholar checking this page is checking whether their
   correction has been answered yet, so a stale render defeats the purpose. */
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const [data, corrections, privacy] = await Promise.all([
    getScholarProfile(),
    getScholarCorrections(),
    getScholarConsent(),
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
          they are about, and counted in its tiles; what of the record others
          see sits beside it. */}
      <ScholarProfileView data={data} corrections={corrections} privacy={privacy} />
    </div>
  );
}
