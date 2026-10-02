"use client";

import { useState } from "react";

/**
 * The scholar's headshot, or their initials when there is none or it fails to
 * load: never a blank box. The initials are the bar's own, on the same navy,
 * so the person in the corner and the person on the page are plainly one.
 */
export default function ProfileAvatar({ src, initials, name, className = "" }) {
  const [broken, setBroken] = useState(false);
  const showImage = src && !broken;

  return (
    <div className={`prof-avatar${className ? ` ${className}` : ""}`}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name ? `${name} headshot` : "Scholar headshot"}
          onError={() => setBroken(true)}
          loading="eager"
        />
      ) : (
        <span className="prof-avatar__initials" aria-hidden>{initials || "SC"}</span>
      )}
    </div>
  );
}
