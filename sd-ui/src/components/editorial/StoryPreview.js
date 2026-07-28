"use client";

function renderBodyBlock(block, index) {
  if (block.type === "image") {
    const source = block.url
      ? block.url.startsWith("blob:") || block.url.startsWith("http")
        ? block.url
        : `${process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4000"}${block.url}`
      : "";

    return (
      <figure
        key={`${block.imageId || index}-${index}`}
        className={`preview-image-block preview-image-width-${block.width || "body"}`}
      >
        {source ? (
          <img
            src={source}
            alt={block.alt || block.filename || "Story image"}
            className="preview-inline-image"
          />
        ) : null}
        {block.caption ? <figcaption>{block.caption}</figcaption> : null}
      </figure>
    );
  }

  if (block.type === "heading") {
    return (
      <h2
        key={`heading-${index}`}
        className="preview-heading"
        dangerouslySetInnerHTML={{ __html: block.html || "" }}
      />
    );
  }

  if (block.type === "subheading") {
    return (
      <h3
        key={`subheading-${index}`}
        className="preview-subheading"
        dangerouslySetInnerHTML={{ __html: block.html || "" }}
      />
    );
  }

  if (block.type === "quote") {
    return (
      <blockquote
        key={`quote-${index}`}
        className="preview-quote"
        dangerouslySetInnerHTML={{ __html: block.html || "" }}
      />
    );
  }

  return (
    <p
      key={`paragraph-${index}`}
      className="preview-paragraph"
      dangerouslySetInnerHTML={{ __html: block.html || "" }}
    />
  );
}

export default function StoryPreview({
  title,
  subtitle,
  excerpt,
  coverImageUrl,
  coverImageFilename,
  bodyBlocks,
}) {
  return (
    <article className="panel preview-shell">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Live Preview</span>
          <h3>Reader view</h3>
        </div>
      </div>

      <div className="preview-story-layout">
        {coverImageUrl ? (
          <img
            src={coverImageUrl}
            alt={coverImageFilename || title || "Cover image"}
            className="preview-cover-image"
          />
        ) : null}

        <div className="preview-story-copy">
          <h1>{title || "Untitled story"}</h1>
          {subtitle ? <p className="preview-story-subtitle">{subtitle}</p> : null}
          {excerpt ? <p className="preview-story-excerpt">{excerpt}</p> : null}
        </div>

        <div className="preview-body-stack">
          {bodyBlocks.map((block, index) => renderBodyBlock(block, index))}
        </div>
      </div>
    </article>
  );
}
