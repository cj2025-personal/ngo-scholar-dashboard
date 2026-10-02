const { ObjectId } = require("mongodb");

const { COLLECTIONS, getDb } = require("../db/mongo");
const { ownedByScholarFilter } = require("../lib/identity");
const { toImageProxyPath } = require("../config/s3");
const { ApiError } = require("../lib/api-error");
const { serializeMongoValue } = require("../lib/serialize");
const { getAiTerms } = require("./aiTerms.service");
const { listEpisodesForScholar } = require("./podcasts.service");
const { scholarInitials } = require("../lib/byline");

/**
 * Resolve a scholar headshot into something the frontend can render.
 * Returns { url, external } or null. `url` is a root-relative /api/images/<key>
 * proxy path (external:false) unless the source is already an absolute http URL
 * (external:true), in which case it is passed through untouched.
 */
function resolveScholarPhoto(scholar) {
  const facultyImage = scholar?.faculty_image;

  if (facultyImage && typeof facultyImage === "object") {
    const proxyPath =
      toImageProxyPath(facultyImage.proxy_url) ||
      toImageProxyPath(facultyImage.s3_uri);

    if (proxyPath) {
      return { url: proxyPath, external: false };
    }
  }

  const avatarUrl = scholar?.about?.avatar_url;
  if (typeof avatarUrl === "string" && /^https?:\/\//i.test(avatarUrl)) {
    return { url: avatarUrl, external: true };
  }

  return null;
}

function buildScholarStoryFilters({ scholarId, profileId }) {
  /* One writer, one shape, one indexed equality.
     The six-way $or this replaces existed because the collection was shared
     with a service that keyed rows to `authorId` in the `users` namespace.
     Nothing writes that shape here, so matching on it could only ever return
     another service's rows. */
  return [ownedByScholarFilter(profileId)];
}

/* A deleted story is gone from every owner-facing read, the profile included:
   it was counted here, and listed as "deleted", after the scholar removed it. */
function liveStoryFilter({ scholarId, profileId }) {
  return { $and: [{ $or: buildScholarStoryFilters({ scholarId, profileId }) }, { status: { $ne: "deleted" } }] };
}

async function findScholarRecord({ scholarId, profileId }) {
  const db = await getDb();

  return db.collection("scholars").findOne({
    $or: [{ profile_id: profileId }, { scholar_id: scholarId }, { _id: profileId }],
  });
}

async function findScholarStories({ scholarId, profileId }) {
  const db = await getDb();

  return db
    .collection(COLLECTIONS.scholarEditorials)
    .find(liveStoryFilter({ scholarId, profileId }), {
      projection: { title: 1, slug: 1, status: 1, provenance: 1, createdAt: 1, updatedAt: 1, published_at: 1, scheduled_for: 1 },
    })
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(12)
    .toArray();
}

/**
 * How many stories, by where they stand, counted by the database. The count
 * used to be the length of a list capped at 24, so a scholar with thirty
 * stories was told they had twenty-four. "In review" is a draft Kivyn wrote
 * from a paper, the same line the Studio draws.
 */
async function tallyScholarStories({ scholarId, profileId }) {
  const db = await getDb();
  const is = (status) => ({ $cond: [{ $eq: ["$status", status] }, 1, 0] });
  const [tally] = await db
    .collection(COLLECTIONS.scholarEditorials)
    .aggregate([
      { $match: liveStoryFilter({ scholarId, profileId }) },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          published: { $sum: is("published") },
          scheduled: { $sum: is("scheduled") },
          drafts: { $sum: is("draft") },
          inReview: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "draft"] }, { $eq: [{ $type: "$provenance" }, "object"] }] }, 1, 0] } },
        },
      },
    ])
    .toArray();
  const { _id, ...counts } = tally || { _id: null, total: 0, published: 0, scheduled: 0, drafts: 0, inReview: 0 };
  return counts;
}

async function getScholarProfileData({ scholarId, profileId, user }) {
  const scholar = await findScholarRecord({ scholarId, profileId });

  if (!scholar) {
    throw new ApiError(404, "Scholar profile was not found for this account.");
  }

  const [scholarStories, storyCounts, conversations] = await Promise.all([
    findScholarStories({ scholarId, profileId }),
    tallyScholarStories({ scholarId, profileId }),
    /* The same episodes the Podcasts page lists, so the two can never disagree. */
    listEpisodesForScholar(profileId || scholarId),
  ]);
  /* Keyed the way the scholar record is found: the profile id, or the
     scholar id for an account that carries only that. */
  const aiTerms = await getAiTerms({ profileId: profileId || scholarId });
  const podcasts = Array.isArray(scholar?.links_and_media?.podcasts)
    ? scholar.links_and_media.podcasts
    : [];
  const featuredPublications = scholar?.publications?.featured_publications || [];
  const researchFocus = scholar?.background_and_work?.research_focus || [];
  const milestones = scholar?.milestones || [];
  const displayName =
    scholar?.name?.display || scholar?.name?.full || "Scholar profile";

  return serializeMongoValue({
    profile: {
      name: displayName,
      title: scholar?.name?.title || null,
      initials: scholarInitials(scholar),
      photo: resolveScholarPhoto(scholar),
      tagline:
        scholar?.description?.tagline ||
        [scholar?.about?.current_position, scholar?.about?.institution]
          .filter(Boolean)
          .join(" | "),
      summary:
        scholar?.description?.summary ||
        scholar?.about?.short_bio ||
        "Scholar profile information is available for this account.",
      institution: scholar?.about?.institution || null,
      department: scholar?.about?.department || null,
      fieldOfStudy:
        scholar?.metadata?.field_of_study || scholar?.about?.field_of_study || null,
      location: scholar?.about?.location || null,
      currentPosition: scholar?.about?.current_position || null,
      loginEmail: user?.login_email || null,
      /* Whether the agent may write with this scholar yet. */
      aiTerms,
      tags: [
        scholar?.about?.current_position,
        scholar?.about?.institution,
        scholar?.metadata?.field_of_study || scholar?.about?.field_of_study,
      ].filter(Boolean),
      counts: {
        stories: storyCounts,
        publications:
          scholar?.publications?.total_publications_count ||
          featuredPublications.length,
        /* What the Podcasts page shows: the conversations, then the catalogue. */
        podcasts: conversations.length + podcasts.length,
        conversations: {
          total: conversations.length,
          live: conversations.filter((c) => c.state === "live").length,
          pending: conversations.filter((c) => c.state === "pending").length,
        },
      },
    },
    about: {
      summary: scholar?.description?.summary || null,
      shortBio: scholar?.about?.short_bio || null,
      detailedBio: scholar?.about?.detailed_bio || null,
      longSummary: scholar?.description?.long_summary || null,
      researchOverview: scholar?.description?.research_overview || null,
      backgroundSummary: scholar?.background_and_work?.background_summary || null,
      currentWork: scholar?.background_and_work?.current_work || null,
      methodology: scholar?.background_and_work?.methodology || null,
    },
    researchFocus,
    education: scholar?.background_and_work?.education_summary || [],
    milestones,
    featuredPublications,
    linksAndMedia: {
      socialProfiles: Array.isArray(scholar?.links_and_media?.social_profiles)
        ? scholar.links_and_media.social_profiles
        : [],
      references: Array.isArray(scholar?.links_and_media?.references)
        ? scholar.links_and_media.references
        : [],
      featuredVideo: scholar?.links_and_media?.featured_video || null,
    },
    podcasts: podcasts.slice(0, 12),
    conversations: conversations.slice(0, 6).map((c) => ({
      id: c.id,
      title: c.title,
      state: c.state,
      with: c.with?.name || null,
      publishedAt: c.publishedAt,
      updatedAt: c.updatedAt,
    })),
    stories: scholarStories.map((story) => ({
      id: story._id,
      title: story.title || "Untitled story",
      slug: story.slug || null,
      status: story.status || "draft",
      inReview: story.status === "draft" && Boolean(story.provenance),
      createdAt: story.createdAt || null,
      updatedAt: story.updatedAt || null,
      publishedAt: story.published_at || null,
      scheduledFor: story.scheduled_for || null,
    })),
    source: {
      profile_collection: "scholars",
      editorial_collection: COLLECTIONS.scholarEditorials,
    },
  });
}

module.exports = {
  getScholarProfileData,
};
