import { LuBadgeCheck, LuFileSearch, LuGauge, LuPenLine, LuShieldCheck, LuUsers } from "react-icons/lu";

import { BRAND_NAME } from "@/lib/brand";
import { DRAFT_AUDIENCES, DRAFT_VOICES } from "@/lib/drafting";
import { READER_NAMES, READING_BANDS, splitBrief } from "@/lib/readingBands";

import GradeLadder from "./GradeLadder";
import KivynTrace from "./KivynTrace";

/**
 * Meet Kivyn: the studio's AI writing assistant, at a high level. What it is
 * (the headline), how it writes for each reading age (GradeLadder, from the
 * API's own briefs and bands), what it does on a paper (KivynTrace, the
 * pipeline's own steps), and what holds every time (the six cards). Every
 * line says what the studio does; nothing is a sample.
 */
export default function MeetKivyn() {
  const bands = DRAFT_AUDIENCES.filter((a) => READING_BANDS[a.value]).map((a) => ({
    value: a.value,
    label: a.label,
    grade: a.grade,
    name: READER_NAMES[a.value]?.name || a.label,
    ...READING_BANDS[a.value],
    ...splitBrief(READING_BANDS[a.value].brief),
  }));
  const first = DRAFT_AUDIENCES[0];
  const last = DRAFT_AUDIENCES[DRAFT_AUDIENCES.length - 1];
  const young = bands.filter((b) => b.young).map((b) => b.label.replace(/^Ages\s+/i, ""));
  const ownVoice = DRAFT_VOICES.find((v) => v.value === "author");

  const PILLARS = [
    {
      icon: LuFileSearch,
      title: "Every sentence sourced",
      text: "Each sentence carries the passage of your paper it rests on, and is checked for going beyond it.",
    },
    {
      icon: LuGauge,
      title: "Measured to the grade",
      text: `Each edition is written to a grade, from grade ${first.grade} for ${first.label.toLowerCase()} to grade ${last.grade} for ${last.label.toLowerCase()}, and its reading level is measured against it.`,
    },
    {
      icon: LuShieldCheck,
      title: "Safe for young readers",
      text: `For ages ${young.join(" and ")}, anything beyond your paper is also judged for suitability: nothing frightening, nothing beyond the reader’s world.`,
    },
    {
      icon: LuPenLine,
      title: "In your voice",
      text: ownVoice ? ownVoice.hint : "Published under your byline.",
    },
    {
      icon: LuBadgeCheck,
      title: "Approved by you",
      text: "You read each version beside its passages, change what you like, and approve or discard it. Nothing reaches readers until you do.",
    },
    {
      icon: LuUsers,
      title: "Reach, signed",
      text: `Users read your stories in circles. You see how many read and understood once enough have read to stay anonymous, never anyone’s name, and a record signed by ${BRAND_NAME} comes back.`,
    },
  ];

  return (
    <section id="kivyn" className="pr-kivyn" aria-labelledby="pr-kivyn-title">
      <div className="pr-wrap">
        <div className="pr-kivyn__head">
          <p className="pr-kicker">Meet Kivyn</p>
          <h2 id="pr-kivyn-title" className="pr-h2">
            An AI writing assistant <span className="pr-accent">for every grade.</span>
          </h2>
          <p className="pr-lede">
            Kivyn turns your research into articles each grade can read. It writes to the reading level of the
            readers you choose, ties every sentence to your paper, and nothing it writes reaches a reader until
            you approve it.
          </p>
        </div>

        <div className="pr-kivyn__demo">
          <GradeLadder bands={bands} />
          <KivynTrace />
        </div>

        <ul className="pr-pillars">
          {PILLARS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="pr-pillar pr-reveal">
              <span className="pr-pillar__icon" aria-hidden="true"><Icon size={20} /></span>
              <h3 className="pr-pillar__title">{title}</h3>
              <p className="pr-pillar__text">{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
