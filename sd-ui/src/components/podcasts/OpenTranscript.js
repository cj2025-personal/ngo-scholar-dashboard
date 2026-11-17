"use client";

import Link, { useLinkStatus } from "next/link";

import { transcriptNav } from "@/lib/transcriptNav";

/** A small busy mark while the panel's content is on its way (the link's pending state). */
function Pending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={`pod-open__pending${pending ? " is-pending" : ""}`} />;
}

/**
 * Opens an episode's transcript in the side panel: the list's address with
 * ?episode=, so the panel has a link of its own and the back button closes
 * it. The page stays where it was scrolled. `data-transcript-trigger` is how
 * the panel finds this control again to hand focus back when it closes.
 */
export default function OpenTranscript({ id, className, children, ariaLabel }) {
  return (
    <Link
      href={`/podcasts?episode=${encodeURIComponent(id)}`}
      scroll={false}
      className={className}
      data-transcript-trigger={id}
      aria-label={ariaLabel}
      onClick={() => {
        transcriptNav.fromList = true;
      }}
    >
      {children}
      <Pending />
    </Link>
  );
}
