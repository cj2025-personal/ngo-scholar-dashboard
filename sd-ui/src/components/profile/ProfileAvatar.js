"use client";

import { useState } from "react";
import { avatarClass } from "@/lib/format";

/**
 * Scholar headshot with a graceful fallback. Renders the S3-proxied photo when
 * one exists and loads; on a missing/broken image it falls back to an initials
 * tile (deterministic gradient) — never a blank box.
 */
export default function ProfileAvatar({ src, initials, name, className = "" }) {
  const [broken, setBroken] = useState(false);
  const showImage = src && !broken;

  return (
    <div className={`sc-prof-avatar ${className}`}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name ? `${name} headshot` : "Scholar headshot"}
          onError={() => setBroken(true)}
          loading="eager"
        />
      ) : (
        <span className={`sc-prof-initials ${avatarClass(name || initials || "")}`}>
          {initials || "SC"}
        </span>
      )}
    </div>
  );
}
