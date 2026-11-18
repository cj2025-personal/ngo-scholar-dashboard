import { BRAND_NAME, CONTACT_EMAIL, PRODUCT_NAME } from "@/lib/brand";
import { DRAFT_AUDIENCES } from "@/lib/drafting";
import { READER_NAMES } from "@/lib/readingBands";

import EditionStage from "./EditionStage";
import LearningCircles from "./LearningCircles";
import MeetKivyn from "./MeetKivyn";
import PressHeader from "./PressHeader";
import SiteFooter from "./SiteFooter";

const JOIN_HREF = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Joining ${PRODUCT_NAME}`)}`;

/* Edition colours, in turn, for however many reading ages the table holds. */
const TONES = ["is-navy", "is-red", "is-slate", "is-night"];

/*
 * The editions are the paper and one per reading age in the studio's own
 * table (DRAFT_AUDIENCES, the mirror of sd-api's lib/audiences.js), with the
 * grade each is written to. Add an age there and it is an edition here.
 */
function editionsFromAges(ages) {
  return [
    { key: "paper", label: "Your paper", kind: "Original", tone: "is-paper", kicker: "The paper · original", title: "Your paper", by: "By you" },
    ...ages.map((age, i) => {
      const reader = READER_NAMES[age.value];
      return {
        key: age.value,
        label: reader?.name || age.label,
        kind: reader ? reader.tag || age.label : "Edition",
        age: age.label,
        tone: TONES[i % TONES.length],
        kicker: `${age.label} · edition`,
        title: "Your research",
        by: `Written to grade ${age.grade} · approved by you`,
        grade: age.grade,
      };
    }),
  ];
}

/*
 * What a scholar gets with an AI podcast, as the Podcasts page does it:
 * only released episodes (podcasts.service RELEASED), the AI-voice label
 * (from audio.synthetic), the transcript in the side panel, and "Something’s
 * wrong?" writing to the editors.
 */
const PODCAST_FACTS = [
  ["What you see", "Only released episodes about your work."],
  ["Voices", "AI voices, labelled as AI."],
  ["Transcript", "Beside the player, turn by turn."],
  ["Something wrong?", "One button writes to the editors."],
];

/**
 * The press: one finding set as editions, Kivyn at work and what it holds to, the
 * AI podcasts, and how to join. Drawn on the landing canvas ("3 · The
 * press") and chosen there on 2026-11-17; dressed in the public site's type
 * and colours (press.css) so the studio and projarch.org read as one place.
 * Nothing on it is a sample: the editions and counts come from the
 * reading-age table, and every other line says what the studio does.
 */
export default function PressLanding({ className = "" }) {
  const editions = editionsFromAges(DRAFT_AUDIENCES);

  return (
    <div className={`pr ${className}`}>
      {/* Where the page starts: once it scrolls out, the header lifts. */}
      <span id="pr-top-sentinel" className="pr-sentinel" aria-hidden="true" />
      <PressHeader />

      <main>
        <section id="editions" className="pr-band--hero" aria-labelledby="pr-title">
          <EditionStage editions={editions}>
            {/* The name first, as the product's own title; then what it is for, in
                the terms of Proj Arch's mission ("from archives to you"). */}
            <p className="pr-kicker">For scholars</p>
            <h1 id="pr-title" className="pr-title">
              <span>{PRODUCT_NAME}</span>
            </h1>
            <p className="pr-subtitle">
              Your research, <span className="pr-accent">written for every reading age.</span>
            </p>
            <p className="pr-lede">
              The invitation-only dashboard where scholars share what they know. Your work leaves the archive and
              reaches readers of every age: Kivyn writes each version from your paper, and nothing goes out until
              you approve it.
            </p>
          </EditionStage>
        </section>

        <MeetKivyn />
        <LearningCircles />

        <section id="podcasts" className="pr-dark" aria-labelledby="pr-conv-title">
          <div className="pr-wrap">
            <p className="pr-kicker">Audio, in AI voices</p>
            <h2 id="pr-conv-title" className="pr-h2">
              AI podcasts <span className="pr-accent">about your work.</span>
            </h2>
            <p className="pr-lede">
              Some research is better heard. {BRAND_NAME} makes AI podcasts about published work, and you hear the
              ones about yours where you write.
            </p>
            <div className="pr-player">
              <div className="pr-art" aria-hidden="true">
                <span className="pr-art__core" />
                <span style={{ width: "52%", height: "52%" }} />
                <span style={{ width: "70%", height: "70%" }} />
                <span style={{ width: "88%", height: "88%" }} />
                <span style={{ width: "106%", height: "106%" }} />
              </div>
              <dl className="pr-facts">
                {PODCAST_FACTS.map(([term, text]) => (
                  <div key={term} className="pr-facts__row">
                    <dt>{term}</dt>
                    <dd>{text}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        <section id="joining" className="pr-band--wash" aria-labelledby="pr-join-title">
          <div className="pr-wrap pr-join">
            <div>
              <p className="pr-kicker">Joining</p>
              <h2 id="pr-join-title" className="pr-h2">
                By invitation, <span className="pr-accent">while the pilot runs.</span>
              </h2>
              <p className="pr-lede">
                {PRODUCT_NAME} is the researchers’ studio of {BRAND_NAME}. Stories are drafted by an AI agent, Kivyn,
                and are yours only once you approve them. Readers are shown as counts; small groups, and every
                reader’s name, never are.
              </p>
            </div>
            <div className="pr-join__act">
              <a className="pr-btn" href={JOIN_HREF}>Ask to join</a>
              <span className="pr-join__note">Have an invitation? Open the link in your email.</span>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
