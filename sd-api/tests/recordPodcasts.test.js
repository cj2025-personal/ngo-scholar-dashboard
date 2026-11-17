/**
 * The recordings on a scholar's public record, as the Podcasts page lists
 * them under "Also on your record".
 *
 * The failure this file exists to prevent is the page saying what the record
 * does not: a missing field used to come back as "Scholar podcast episode",
 * "Generated scholar podcast episode.", "available" or "Audio", which called
 * a real interview "generated" and put a type on entries that had none.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

/* Placeholders, as in podcasts.test.js: nothing connects, but config is read at require time. */
process.env.MONGODB_URI ||= "mongodb://localhost:27017/record-podcasts-test";
process.env.MONGODB_DB ||= "record-podcasts-test";

const { buildPodcastEpisodes } = require("../src/services/dashboard.service");

const record = (podcasts) => ({ links_and_media: { podcasts } });

test("a recording is said as the record gives it", () => {
  const [one] = buildPodcastEpisodes(
    record([{ podcast_id: "pod-1", title: "Radio interview", media_type: "audio", source_kind: "interview", duration_seconds: 1860, status: "published", description: "On listening machines.", asset: { url: "https://x/a.mp3" } }]),
  );
  assert.deepEqual(one, {
    podcastId: "pod-1",
    title: "Radio interview",
    length: "31 min",
    type: "audio · interview",
    summary: "On listening machines.",
    state: "published",
    audioUrl: "https://x/a.mp3",
  });
});

test("what the record does not say is null, never a stand-in", () => {
  const [bare] = buildPodcastEpisodes(record([{ title: "Only a title" }]));
  assert.deepEqual(bare, { podcastId: null, title: "Only a title", length: null, type: null, summary: null, state: null, audioUrl: null });
  const said = JSON.stringify(bare);
  for (const invented of ["Scholar podcast episode", "Generated", "available", "Audio"]) assert.equal(said.includes(invented), false, invented);
});

test("an entry with neither a title nor a link has nothing to show, and is dropped", () => {
  const list = buildPodcastEpisodes(record([{ media_type: "audio" }, { asset: { url: "https://x/b.mp3" } }, { title: "Kept" }]));
  assert.deepEqual(list.map((r) => [r.title, r.audioUrl]), [[null, "https://x/b.mp3"], ["Kept", null]]);
});

test("no record, or no recordings, is an empty list", () => {
  assert.deepEqual(buildPodcastEpisodes(null), []);
  assert.deepEqual(buildPodcastEpisodes(record([])), []);
});
