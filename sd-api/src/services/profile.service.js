const { ObjectId } = require("mongodb");

const { COLLECTIONS, getDb } = require("../db/mongo");
const { ownedByScholarFilter } = require("../lib/identity");
const { toImageProxyPath } = require("../config/s3");
const { ApiError } = require("../lib/api-error");
const { serializeMongoValue } = require("../lib/serialize");

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

function getInitials(name) {
  const parts = String(name || "")
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

async function findScholarStories({ scholarId, profileId }) {
  const db = await getDb();

  return db
    .collection(COLLECTIONS.scholarEditorials)
    .find({
      $or: buildScholarStoryFilters({ scholarId, profileId }),
    })
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(24)
    .toArray();
}

async function getScholarProfileData({ scholarId, profileId, user }) {
  const scholar = await findScholarRecord({ scholarId, profileId });

  if (!scholar) {
    throw new ApiError(404, "Scholar profile was not found for this account.");
  }

  const scholarStories = await findScholarStories({ scholarId, profileId });
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
      initials: scholar?.about?.avatar_initial || getInitials(displayName),
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
      tags: [
        scholar?.about?.current_position,
        scholar?.about?.institution,
        scholar?.metadata?.field_of_study || scholar?.about?.field_of_study,
      ].filter(Boolean),
      counts: {
        editorials: scholarStories.length,
        podcasts: podcasts.length,
        publications:
          scholar?.publications?.total_publications_count ||
          featuredPublications.length,
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
    editorials: scholarStories.slice(0, 12).map((story) => ({
      id: story._id,
      title: story.title || "Untitled editorial",
      slug: story.slug || null,
      status: story.status || "draft",
      createdAt: story.createdAt || null,
      updatedAt: story.updatedAt || null,
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
