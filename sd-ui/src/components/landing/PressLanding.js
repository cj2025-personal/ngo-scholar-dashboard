import Link from "next/link";

import { BRAND_NAME, CONTACT_EMAIL, LOCKUP, PRODUCT_NAME, PUBLIC_SITE_URL } from "@/lib/brand";
import { DRAFT_AUDIENCES } from "@/lib/drafting";

import EditionStage from "./EditionStage";
import HowItsMade from "./HowItsMade";

const JOIN_HREF = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Joining ${PRODUCT_NAME}`)}`;

/* A count in words, as the page says it ("five editions"); figures past ten. */
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const inWords = (n) => WORDS[n] ?? String(n);
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* Cover colours, in turn, for however many reading ages the table holds. */
const TONES = ["is-navy", "is-red", "is-slate", "is-night"];

/*
 * The editions are the paper and one per reading age in the studio's own
 * table (DRAFT_AUDIENCES, the mirror of sd-api's lib/audiences.js), with the
 * grade each is written to. Add an age there and it is a cover here.
 */
function editionsFromAges(ages) {
  return [
    { key: "paper", label: "The paper", kind: "Original", tone: "is-paper", kicker: "The paper · original", title: "Your paper", by: "By you" },
    ...ages.map((age, i) => ({
      key: age.value,
      label: age.label,
      kind: "Edition",
      tone: TONES[i % TONES.length],
      kicker: `${age.label} · edition`,
      title: "Your research",
      by: `Written to grade ${age.grade} · approved by you`,
    })),
  ];
}

/*
 * The steps, each as the studio does it: the composer asks "Who is this
 * for?", proposes an outline the scholar approves before drafting, writes per
 * reading age with each claim's source and a check for going beyond it, waits
 * for approval, reports circles as counts only once a circle is past the
 * reader floor, and signs the impact record. Kivyn's pose is the one the
 * studio shows for that step.
 */
function stepsFor(ages) {
  const range = ages.length > 1 ? `, from ${ages[0].label.toLowerCase()} to ${ages[ages.length - 1].label.toLowerCase()}` : "";
  return [
    { label: "Bring a paper", pose: "reading", text: "Bring one of your papers, or a finding in your own words. Kivyn reads it before anything else happens." },
    { label: "Agree an outline with Kivyn", pose: "searching", text: "Kivyn asks who the story is for, and agrees an outline with you before a word is drafted." },
    { label: `${capital(inWords(ages.length))} editions, every sentence sourced`, pose: "writing", text: `A version for each reading age${range}, every sentence carrying the passage it rests on, and checked for going beyond it.` },
    { label: "You approve, or not", pose: "checking", text: "You read each version beside its passages, change what you like, and approve or discard it. Nothing reaches readers until you do." },
    { label: "Classes read in circles", pose: "neutral", text: "Classes read your stories in circles. Once enough have read to keep them anonymous, you see how many read and how many understood. No child is named." },
    { label: "A signed record comes back", pose: "done", text: `A record of what your work reached comes back, signed by ${BRAND_NAME}, for a grant panel or your dean to check.` },
  ];
}

/*
 * What a scholar gets with a conversation, as the Podcasts page does it:
 * only released episodes (podcasts.service RELEASED), the AI-voice label
 * (from audio.synthetic), the transcript in the side panel, and "Something’s
 * wrong?" writing to the editors.
 */
const CONVERSATION_FACTS = [
  ["What you see", "Only released episodes about your work."],
  ["Voices", "AI voices, labelled as AI."],
  ["Transcript", "Beside the player, turn by turn."],
  ["Something wrong?", "One button writes to the editors."],
];

function Lockup({ className }) {
  /* Vector, from the brand kit: sharp at every size. A plain <img>, because
     next/image has nothing to optimise in an SVG. */
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={LOCKUP.src} alt={BRAND_NAME} width={LOCKUP.width} height={LOCKUP.height} className={className} />;
}

/**
 * The press: one finding set as editions, the steps of making a story, the
 * conversations, and how to join. Drawn on the landing
 * canvas ("3 · The press") and chosen there on 2026-11-17. Nothing on it is a
 * sample: the editions and counts come from the reading-age table, and every
 * other line says what the studio does.
 */
export default function PressLanding({ className = "" }) {
  const editions = editionsFromAges(DRAFT_AUDIENCES);
  const steps = stepsFor(DRAFT_AUDIENCES);

  return (
    <div className={`pr ${className}`}>
      <div className="pr-wrap">
        <header className="pr-top">
          <Link href="/" className="pr-brand" aria-label={`${BRAND_NAME} ${PRODUCT_NAME}, home`}>
            <Lockup className="pr-brand__lockup" />
          </Link>
          <span className="pr-mono pr-top__name">{PRODUCT_NAME}</span>
          <span className="pr-mono pr-top__tag">The researchers’ studio</span>
          <Link className="pr-mono pr-top__signin" href="/login">[ Sign in ]</Link>
        </header>
      </div>

      <main>
        <div className="pr-wrap">
          <h1 className="sr-only">{PRODUCT_NAME}: your research, written for every reading age</h1>
          <EditionStage editions={editions} heading={`[ One finding, ${inWords(editions.length)} editions ]`} />
          <HowItsMade steps={steps} aside={`${capital(inWords(steps.length))} steps, you at each one`} />
        </div>

        <section className="pr-dark" aria-labelledby="pr-conv-title">
          <div className="pr-wrap pr-dark__in">
            <div className="pr-sect pr-sect--dark pr-mono">
              <span>[ Audio, in AI voices ]</span>
              <span className="pr-sect__aside">In the studio</span>
            </div>
            <h2 id="pr-conv-title" className="pr-giant">Conversations:</h2>
            <p className="pr-dark__lede">
              Some research is better heard. {BRAND_NAME} makes conversations about published work, and you hear the
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
                {CONVERSATION_FACTS.map(([term, text]) => (
                  <div key={term} className="pr-facts__row">
                    <dt className="pr-mono">{term}</dt>
                    <dd>{text}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        <div className="pr-wrap">
          <section aria-labelledby="pr-join-title">
            <div className="pr-sect pr-sect--spaced pr-mono">
              <h2 id="pr-join-title" className="pr-sect__title">[ Joining ]</h2>
              <span className="pr-sect__aside">By invitation</span>
            </div>
            <div className="pr-join">
              <p className="pr-closing">
                {PRODUCT_NAME} is the researchers’ studio of {BRAND_NAME}. Stories are drafted by an AI agent, Kivyn,
                and are yours only once you approve them. Readers are shown as counts; small groups, and every
                child’s name, never are.
              </p>
              <div className="pr-join__act">
                <a className="pr-mono pr-btn pr-btn--ink" href={JOIN_HREF}>[ Ask to join ]</a>
                <span className="pr-join__note">Joining is by invitation while the pilot runs.</span>
                <span className="pr-join__note">Have an invitation? Open the link in your email.</span>
              </div>
            </div>
          </section>
        </div>
      </main>

      <div className="pr-wrap">
        <footer className="pr-foot">
          <Link href="/" className="pr-brand" aria-label={`${BRAND_NAME} ${PRODUCT_NAME}, home`}>
            <Lockup className="pr-brand__lockup pr-brand__lockup--small" />
          </Link>
          <span className="pr-mono">© {new Date().getFullYear()} {BRAND_NAME}</span>
          <a className="pr-mono" href={`${PUBLIC_SITE_URL}/for-researchers`}>For researchers</a>
          <a className="pr-mono" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          <a className="pr-mono" href={`${PUBLIC_SITE_URL}/legal/privacy`}>Privacy</a>
        </footer>
      </div>
    </div>
  );
}
