import { createElement } from "react";

import { FIGURE_BOX, MARK_BOX, figure, mark, smallMark } from "@/lib/kivyn/art.mjs";
import { normalisePose, poseLabel } from "@/lib/kivyn/pose.mjs";

/**
 * Kivyn, inline, in a pose.
 *
 * Inline SVG rather than an image, so the theme colours it (`.kv` and its
 * `--kv-*` variables) and CSS can move its parts: a blink, the eyes along a
 * line, a pencil, a thread drawing itself. Every motion is in the stylesheet
 * under `prefers-reduced-motion: no-preference`, so a reader who asked for
 * less motion gets the pose, still.
 *
 * Decorative unless given a `label`: wherever Kivyn sits beside words saying
 * what it is doing, the words are what a screen reader should hear.
 *
 * @param {object} p
 * @param {string} [p.pose]       one of POSES; anything else is rest
 * @param {"figure"|"mark"} [p.variant]   the whole figure, or the page and its face
 * @param {number} [p.size]       height in CSS pixels; a mark under 33 px draws the small mark
 * @param {"light"|"on-dark"} [p.tone]    on a navy surface, the line darkens so the page reads
 * @param {string|boolean} [p.label]      an accessible name, or `true` for the pose's own
 * @param {boolean} [p.live]     moves: for the one Kivyn showing what the agent is doing now.
 *                               A face beside each message in a thread stays still, or a
 *                               conversation would blink at the reader from every line.
 */
export default function Kivyn({ pose = "neutral", variant = "figure", size = 48, tone = "light", label = null, live = false, className = "" }) {
  const p = normalisePose(pose);
  const small = variant === "mark" && size <= 32;
  const viewBox = variant === "mark" ? MARK_BOX : FIGURE_BOX;
  const [, , vw, vh] = viewBox.split(" ").map(Number);
  /* A figure drawn small keeps its lines at a pixel and a half or so, or it fades to a sketch. */
  const drawing = variant === "mark" ? (small ? smallMark(p) : mark(p)) : figure(p, { weight: size <= 64 ? 1.5 : 1 });
  const name = label === true ? poseLabel(p) : label || null;
  const classes = ["kv", `kv-${variant}`, small ? "kv-small" : "", `kv-pose-${p}`, live ? "kv-live" : "", tone === "on-dark" ? "kv-on-dark" : "", className].filter(Boolean).join(" ");
  return (
    <svg
      className={classes}
      data-pose={p}
      viewBox={viewBox}
      width={Math.round((size * vw) / vh)}
      height={size}
      {...(name ? { role: "img", "aria-label": name } : { "aria-hidden": true, focusable: "false" })}
    >
      {drawing.map((node, i) => draw(node, i))}
    </svg>
  );
}

/* A drawing node as a React element: its paint and its layer become classes. */
function draw([tag, attrs, children], key) {
  const { k, part, ...rest } = attrs;
  const classes = [];
  if (k) classes.push(`kv-${k}`);
  if (part) {
    classes.push(`kv-p-${part}`);
    /* `eye-left` is also an `eye`, so one rule moves both. */
    const family = part.replace(/-(left|right|\d+)$/, "");
    if (family !== part) classes.push(`kv-p-${family}`);
  }
  return createElement(tag, { key, ...rest, className: classes.length ? classes.join(" ") : undefined }, children.length ? children.map((c, i) => draw(c, i)) : undefined);
}
