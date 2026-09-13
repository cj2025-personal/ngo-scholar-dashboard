const { ObjectId } = require("mongodb");

const { COLLECTIONS, getDb } = require("../db/mongo");
const { ownedByScholarFilter } = require("../lib/identity");
const { ApiError } = require("../lib/api-error");
const { serializeMongoValue } = require("../lib/serialize");

function getScholarInitials(scholar) {
  const displayName =
    scholar?.name?.display ||
    scholar?.name?.full ||
    scholar?.about?.avatar_initial ||
    "";

  const parts = displayName
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return "SD";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function formatDuration(seconds) {
  if (!seconds || Number.isNaN(Number(seconds))) {
    return "Audio";
  }

  const totalSeconds = Math.round(Number(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  if (remainingSeconds === 0) {
    return `${minutes} min`;
  }

  return `${minutes} min ${remainingSeconds}s`;
}

function formatStoryMeta(story) {
  const parts = [];

  if (story?.status) {
    parts.push(String(story.status));
  }

  if (story?.updatedAt || story?.createdAt) {
    const date = new Date(story.updatedAt || story.createdAt);

    if (!Number.isNaN(date.getTime())) {
      parts.push(date.toISOString().slice(0, 10));
    }
  }

  return parts.join(" - ");
}

function buildSummaryCards(scholar, editorialStories) {
  const podcasts = scholar?.links_and_media?.podcasts || [];
  const profileSections = [
    scholar?.about?.short_bio,
    scholar?.background_and_work?.background_summary,
    Array.isArray(scholar?.milestones) && scholar.milestones.length > 0,
    Array.isArray(editorialStories) && editorialStories.length > 0,
    Array.isArray(podcasts) && podcasts.length > 0,
  ].filter(Boolean).length;

  return [
    {
      title: "Editorial Pieces",
      value: String(editorialStories.length),
      note: "AI-generated scholar editorial stories",
    },
    {
      title: "Podcast Episodes",
      value: String(podcasts.length),
      note: "Generated scholar audio and published conversations",
    },
    {
      title: "Profile Sections",
      value: String(profileSections),
      note: "Core scholar profile areas with visible content",
    },
  ];
}

function buildEditorialStories(stories) {
  return stories.slice(0, 6).map((story) => ({
    id: story._id,
    title: story.title || "Untitled editorial",
    status: story.status || "draft",
    meta: formatStoryMeta(story),
    note:
      story.excerpt ||
      story.content?.replace(/\s+/g, " ").slice(0, 160) ||
      "AI-generated scholar story record.",
    slug: story.slug || null,
  }));
}

function buildPodcastEpisodes(scholar) {
  const podcasts = scholar?.links_and_media?.podcasts || [];

  return podcasts.slice(0, 6).map((podcast) => ({
    title: podcast.title,
    length: formatDuration(
      podcast.duration_seconds || podcast?.asset?.duration_seconds,
    ),
    type: [podcast.media_type, podcast.source_kind].filter(Boolean).join(" - ") || "Scholar podcast episode",
    summary:
      podcast.transcript_excerpt ||
      podcast.description ||
      "Generated scholar podcast episode.",
    state: podcast.status || "available",
    audioUrl: podcast?.asset?.url || null,
  }));
}

function buildProfile(scholar) {
  const displayName =
    scholar?.name?.display || scholar?.name?.full || "Scholar profile";
  const summary =
    scholar?.description?.summary ||
    scholar?.about?.short_bio ||
    "Scholar profile information is available for this account.";

  const tags = [
    scholar?.about?.current_position,
    scholar?.about?.institution,
    scholar?.metadata?.field_of_study || scholar?.about?.field_of_study,
  ].filter(Boolean);

  return {
    initials: getScholarInitials(scholar),
    name: displayName,
    summary,
    tags,
  };
}

function buildProfileDetails(scholar, user) {
  const profileDetails = [
    { label: "Scholar Name", value: scholar?.name?.display || scholar?.name?.full },
    { label: "Institution", value: scholar?.about?.institution },
    { label: "Department", value: scholar?.about?.department },
    {
      label: "Focus Area",
      value: scholar?.metadata?.field_of_study || scholar?.about?.field_of_study,
    },
    { label: "Location", value: scholar?.about?.location },
    { label: "Login Email", value: user?.login_email },
  ];

  return profileDetails.filter((item) => item.value);
}

function buildProfileCoverage(scholar, editorialStories) {
  const items = [];

  if (scholar?.about?.short_bio) {
    items.push("Biography and scholar summary");
  }

  if (scholar?.background_and_work?.background_summary) {
    items.push("Background and current work overview");
  }

  if (Array.isArray(scholar?.milestones) && scholar.milestones.length > 0) {
    items.push("Career milestones and timeline");
  }

  if (
    Array.isArray(editorialStories) &&
    editorialStories.length > 0
  ) {
    items.push("AI-generated editorial story records");
  }

  if (
    Array.isArray(scholar?.links_and_media?.podcasts) &&
    scholar.links_and_media.podcasts.length > 0
  ) {
    items.push("Published and generated podcast episodes");
  }

  if (Array.isArray(scholar?.metadata?.expertise) && scholar.metadata.expertise.length > 0) {
    items.push("Expertise and research area tagging");
  }

  return items;
}

function buildScholarStoryFilters({ scholarId, profileId }) {
  /* One writer, one shape, one indexed equality.
     The six-way $or this replaces existed because the collection was shared
     with a service that keyed rows to `authorId` in the `users` namespace.
     Nothing writes that shape here, so matching on it could only ever return
     another service's rows. */
  return [ownedByScholarFilter(profileId)];
}

async function findScholarRecord({ scholarId, profileId }) {
  const db = await getDb();

  return db.collection("scholars").findOne({
    $or: [{ profile_id: profileId }, { scholar_id: scholarId }, { _id: profileId }],
  });
}

async function findScholarEditorialStories({ scholarId, profileId }) {
  const db = await getDb();
  const stories = await db
    .collection(COLLECTIONS.scholarEditorials)
    .find({
      $or: buildScholarStoryFilters({ scholarId, profileId }),
    })
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(20)
    .toArray();

  return stories;
}

async function getDashboardData({ scholarId, profileId, user = null }) {
  const scholar = await findScholarRecord({ scholarId, profileId });

  if (!scholar) {
    throw new ApiError(404, "Scholar profile was not found for this account.");
  }

  const scholarStories = await findScholarEditorialStories({
    scholarId,
    profileId,
  });
  const editorialStories = buildEditorialStories(scholarStories);

  return serializeMongoValue({
    summaryCards: buildSummaryCards(scholar, editorialStories),
    editorialStories,
    podcastEpisodes: buildPodcastEpisodes(scholar),
    profile: buildProfile(scholar),
    profileDetails: buildProfileDetails(scholar, user),
    profileCoverage: buildProfileCoverage(scholar, editorialStories),
    source: {
      scholar_id: scholarId,
      profile_id: profileId,
      editorial_collection: COLLECTIONS.scholarEditorials,
      profile_collection: "scholars",
    },
  });
}

module.exports = {
  getDashboardData,
};
