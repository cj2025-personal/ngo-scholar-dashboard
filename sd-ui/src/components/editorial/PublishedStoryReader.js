function buildPublicImageUrl(url) {
  if (!url) {
    return "";
  }

  const apiBase = process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4000";

  if (url.startsWith("http")) {
    return url;
  }

  return `${apiBase}${url.replace("/api/editorial-stories/images/", "/api/editorial-stories/public/images/")}`;
}

function buildStructuredData(story) {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    "http://localhost:3003";
  const canonical = `${siteUrl.replace(/\/+$/, "")}/stories/${story.slug}`;
  const image = buildPublicImageUrl(story?.coverImage?.url);

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: story.title,
    description: story.excerpt || undefined,
    datePublished: story.publishedAt || undefined,
    dateModified: story.updatedAt || undefined,
    image: image ? [image] : undefined,
    mainEntityOfPage: canonical,
    publisher: {
      "@type": "Organization",
      name: "Archivyn",
    },
  };
}

function formatDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function renderBodyBlock(block, index) {
  if (block.type === "image") {
    return (
      <figure
        key={`${block.imageId || index}-${index}`}
        className={`reader-image-block reader-image-width-${block.width || "body"}`}
      >
        <img
          src={buildPublicImageUrl(block.url)}
          alt={block.alt || block.filename || "Story image"}
          className="reader-inline-image"
        />
        {block.caption ? <figcaption>{block.caption}</figcaption> : null}
      </figure>
    );
  }

  if (block.type === "heading") {
    return (
      <h2
        key={`heading-${index}`}
        className="reader-heading"
        dangerouslySetInnerHTML={{ __html: block.html || "" }}
      />
    );
  }

  if (block.type === "subheading") {
    return (
      <h3
        key={`subheading-${index}`}
        className="reader-subheading"
        dangerouslySetInnerHTML={{ __html: block.html || "" }}
      />
    );
  }

  if (block.type === "quote") {
    return (
      <blockquote
        key={`quote-${index}`}
        className="reader-quote"
        dangerouslySetInnerHTML={{ __html: block.html || "" }}
      />
    );
  }

  return (
    <p
      key={`paragraph-${index}`}
      className="reader-paragraph"
      dangerouslySetInnerHTML={{ __html: block.html || "" }}
    />
  );
}

export default function PublishedStoryReader({ story }) {
  const publishedDate = formatDate(story?.publishedAt || story?.updatedAt);
  const coverImageUrl = buildPublicImageUrl(story?.coverImage?.url);
  const structuredData = buildStructuredData(story);

  return (
    <main className="public-story-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData),
        }}
      />
      <article className="public-story-article">
        <header className="public-story-header">
          <div className="public-story-brand">
            <span className="eyebrow">Archivyn Stories</span>
            <a href="/" className="public-story-brand-link">
              Scholar Dashboard
            </a>
          </div>

          <div className="public-story-headline">
            <h1>{story?.title || "Untitled story"}</h1>
            {story?.subtitle ? (
              <p className="public-story-subtitle">{story.subtitle}</p>
            ) : null}
            <div className="public-story-meta">
              {publishedDate ? <span>{publishedDate}</span> : null}
              <span>{story?.readingTimeMinutes || 0} min read</span>
              <span>{story?.wordCount || 0} words</span>
            </div>
          </div>
        </header>

        {coverImageUrl ? (
          <img
            src={coverImageUrl}
            alt={story?.coverImage?.filename || story?.title || "Cover image"}
            className="public-story-cover"
          />
        ) : null}

        <div className="public-story-body">
          {story?.bodyBlocks?.map((block, index) => renderBodyBlock(block, index))}
        </div>
      </article>
    </main>
  );
}
