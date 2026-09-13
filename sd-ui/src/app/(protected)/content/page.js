import Topbar from "@/components/scholar/Topbar";
import ContentInventory from "@/components/scholar/ContentInventory";
import { getScholarContent } from "@/lib/content";
import { getScholarProfile } from "@/lib/profile";

export const metadata = {
  title: "Published under your name",
  description: "Everything Archivyn shows students from your work",
};

/**
 * Never cached: the list contains unpublished drafts and content awaiting this
 * scholar's consent, so a cached render is one that could reach another
 * session.
 */
export const dynamic = "force-dynamic";

export default async function ContentPage() {
  const [content, profileData] = await Promise.all([
    getScholarContent(),
    getScholarProfile(),
  ]);

  const profile = profileData?.profile || {};
  const me = {
    initials: profile.initials || "SC",
    name: profile.name || "Scholar",
    institution: profile.institution || "",
  };

  return (
    <div className="sc-shell">
      <Topbar activeHref="/content" me={me} />
      <main className="sc-page">
        <ContentInventory data={content} />
      </main>
    </div>
  );
}
