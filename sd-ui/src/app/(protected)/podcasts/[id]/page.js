import { redirect } from "next/navigation";

/**
 * An episode's own address, kept so links to it still work.
 *
 * Since 2026-11-16 the transcript opens as a side panel over the Podcasts
 * list rather than as a page (see podcasts/page.js and TranscriptDrawer), so
 * this sends /podcasts/<id> to /podcasts?episode=<id>: the same episode, with
 * the list behind it. Whether it is the scholar's and released is decided
 * there, by the API, as for any other way in.
 */
export default async function EpisodePage({ params }) {
  const { id } = await params;
  redirect(`/podcasts?episode=${encodeURIComponent(id)}`);
}
