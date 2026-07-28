import { notFound } from "next/navigation";

import PublishedStoryReader from "@/components/editorial/PublishedStoryReader";
import { getPublishedStoryBySlug } from "@/lib/editorial";
import { getSiteUrl } from "@/lib/site";

function buildPublicImageUrl(url) {
  if (!url) {
    return null;
  }

  const siteUrl = getSiteUrl();
  const apiBase = process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4000";
  const normalizedUrl = url.replace(
    "/api/editorial-stories/images/",
    "/api/editorial-stories/public/images/",
  );

  if (normalizedUrl.startsWith("http")) {
    return normalizedUrl;
  }

  if (normalizedUrl.startsWith("/api/")) {
    return `${apiBase}${normalizedUrl}`;
  }

  return `${siteUrl}${normalizedUrl}`;
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const storyResult = await getPublishedStoryBySlug(slug);
  const story = storyResult?.story;

  if (!story) {
    return {
      title: "Story not found",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const siteUrl = getSiteUrl();
  const canonical = `${siteUrl}/stories/${story.slug}`;
  const image = buildPublicImageUrl(story.coverImage?.url);
  const title = story.title;
  const description =
    story.excerpt || "Published scholar story from Archivyn.";

  return {
    title,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      type: "article",
      url: canonical,
      title,
      description,
      siteName: "Archivyn Stories",
      publishedTime: story.publishedAt || undefined,
      modifiedTime: story.updatedAt || undefined,
      images: image ? [{ url: image, alt: title }] : [],
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : [],
    },
  };
}

export default async function PublicStoryPage({ params }) {
  const { slug } = await params;
  const storyResult = await getPublishedStoryBySlug(slug);

  if (!storyResult?.story) {
    notFound();
  }

  return <PublishedStoryReader story={storyResult.story} />;
}
