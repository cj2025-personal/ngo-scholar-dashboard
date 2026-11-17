const { ObjectId } = require("mongodb");

const { COLLECTIONS, getDb } = require("../db/mongo");
const { ownedByScholarFilter } = require("../lib/identity");
const { ApiError } = require("../lib/api-error");
const { serializeMongoValue } = require("../lib/serialize");
const { scholarInitials } = require("../lib/byline");

/* A recording's length as words, or null when the record does not give one (never a stand-in word). */
function formatDuration(seconds) {
  if (!seconds || Number.isNaN(Number(seconds))) {
    return null;
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
    /* Said as what is counted: not every story is AI-written, nor every recording generated. */
    {
      title: "Editorial Pieces",
      value: String(editorialStories.length),
      note: "Stories in your studio",
    },
    {
      title: "Podcast Episodes",
      value: String(podcasts.length),
      note: "Recordings on your public record",
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
    /* The story's own words, or nothing: not every story is AI-written. */
    note: story.excerpt || story.content?.replace(/\s+/g, " ").slice(0, 160) || null,
    slug: story.slug || null,
  }));
}

/**
 * The recordings on the scholar's public record (links_and_media.podcasts).
 *
 * What the record does not say is null, never a stand-in: these used to
 * read "Scholar podcast episode", "Generated scholar podcast episode." and
 * "available" when a field was missing, which put words on the page that no
 * record held (and called a real interview "generated"). The pages leave out
 * what is null. An entry with neither a title nor a link has nothing to show
 * and is dropped.
 */
function buildPodcastEpisodes(scholar) {
  const podcasts = scholar?.links_and_media?.podcasts || [];

  return podcasts
    .filter((podcast) => podcast?.title || podcast?.asset?.url)
    .slice(0, 6)
    .map((podcast) => ({
      /* Matches a released episode's recordId (podcasts.service) when it was mirrored from one. */
      podcastId: podcast.podcast_id || null,
      title: podcast.title || null,
      length: formatDuration(podcast.duration_seconds || podcast?.asset?.duration_seconds),
      type: [podcast.media_type, podcast.source_kind].filter(Boolean).join(" · ") || null,
      summary: podcast.transcript_excerpt || podcast.description || null,
      state: podcast.status || null,
      audioUrl: podcast?.asset?.url || null,
    }));
}

/* What the record says, and null where it says nothing: the pages decide how to show a gap
   (the bar falls back to "Scholar"), so no stand-in reads as the scholar's own name or words. */
function buildProfile(scholar) {
  const displayName = scholar?.name?.display || scholar?.name?.full || null;
  const summary = scholar?.description?.summary || scholar?.about?.short_bio || null;

  const tags = [
    scholar?.about?.current_position,
    scholar?.about?.institution,
    scholar?.metadata?.field_of_study || scholar?.about?.field_of_study,
  ].filter(Boolean);

  return {
    initials: scholarInitials(scholar),
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
  /* Exported for tests: what the record's recordings say, and that it never says more. */
  buildPodcastEpisodes,
};
