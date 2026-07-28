import Topbar from "@/components/scholar/Topbar";
import ScholarProfileView from "@/components/profile/ScholarProfileView";
import { getScholarProfile } from "@/lib/profile";

export default async function ProfilePage() {
  const data = await getScholarProfile();
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
    </div>
  );
}
