import CircleBeams from "./CircleBeams";

/*
 * Learning circles, at a high level (the studio's components/circles; sd-api
 * lib/scholarCircles.js; the learner app's services/circles, CirclesCard and
 * PortalCirclesCard): a group a scholar starts around a theme of their work,
 * with its reading ages and the stories they share in it, each with its
 * questions; Kivyn can write for it. Said as "users", never tied to schools:
 * the platform has institutional and retail users alike (user, 2026-11-18).
 */

/**
 * The front page's section on learning circles: a heading and one line,
 * then the circle as a diagram (CircleBeams).
 */
export default function LearningCircles() {
  return (
    <section id="circles" className="pr-circles" aria-labelledby="pr-circles-title">
      <div className="pr-wrap">
        <div className="pr-circles__head">
          <div>
            <p className="pr-kicker">Learning circles</p>
            <h2 id="pr-circles-title" className="pr-h2">
              Your stories, <span className="pr-accent">read together.</span>
            </h2>
          </div>
          <p className="pr-lede">
            A circle is a group you start around a theme of your work. Users join to read what you share in it
            and answer its questions, at the ages you choose. Kivyn can write for it.
          </p>
        </div>
        <CircleBeams />
      </div>
    </section>
  );
}
