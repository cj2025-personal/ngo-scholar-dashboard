/**
 * What Kivyn is seen doing, from what the agent is really doing.
 *
 * A pose is only ever shown for work that is happening: each step the
 * drafting pipeline and the edit agent stream maps to the pose that draws it,
 * and the page asks for a pose from the step it was just told, never from a
 * timer. Between steps Kivyn stands still. A finished piece of work gets a
 * moment — done, or open hands when the paper does not carry what was asked —
 * and then Kivyn is at rest again; nothing it shows rewards time spent.
 *
 * The name is here too, so every sentence that names the agent names it the
 * same way. The API says it from `sd-api/src/lib/agents/identity.js`; change
 * both together.
 */

export const AGENT_NAME = "Kivyn";

export const POSES = ["neutral", "reading", "searching", "writing", "checking", "tracing", "cant-answer", "done"];

/** How long a finished moment shows before Kivyn is at rest again. */
export const MOMENT_MS = 2400;

/**
 * Every step the agent reports, as a pose. The draft job's steps are the
 * pipeline's own (`sd-api/src/lib/draftGraph.js`, the job service); the edit
 * agent's are its turn's frames (`storyAgent.service.js`); the rest are the
 * page's own waits on a model. The browser suite holds this list to the
 * pipeline's, so a step added there cannot go undrawn.
 */
export const STEP_POSES = {
  /* the draft job */
  pick_source: "reading",
  plan_outline: "searching",
  draft_blocks: "writing",
  section_drafted: "writing",
  judge_voice: "checking",
  judge_fidelity: "checking",
  judge_reach: "checking",
  judge_context: "checking",
  assemble: "writing",
  review_article: "checking",
  verify: "checking",
  create_story: "writing",
  draft_levels: "writing",
  /* the edit agent's turn */
  read_draft: "reading",
  think: "reading",
  check_changes: "checking",
  illustrate: "writing",
  check_reading_level: "checking",
  /* the page waiting on a model */
  converse: "reading",
  resume: "reading",
  ideas: "reading",
};

/** The edit agent's tools, as what they look like being done. */
export const TOOL_POSES = {
  search_passages: "searching",
  replace_block: "writing",
  insert_block: "writing",
  delete_block: "writing",
  move_block: "writing",
  set_heading_fields: "writing",
  add_image: "writing",
  finish: "writing",
};

/** The pose for a step under way. A step this list has not met is drawn as reading: work, but no claim about which. */
export function poseForStep(step, tool = null) {
  if ((step === "tool" || step === "tool_done") && tool) return TOOL_POSES[tool] || "reading";
  return STEP_POSES[step] || "reading";
}

/** A pose this module draws, or rest. */
export function normalisePose(pose) {
  return POSES.includes(pose) ? pose : "neutral";
}

/** What a screen reader hears when Kivyn is the only thing saying it. */
export function poseLabel(pose) {
  return {
    neutral: AGENT_NAME,
    reading: `${AGENT_NAME}, reading`,
    searching: `${AGENT_NAME}, searching the paper`,
    writing: `${AGENT_NAME}, writing`,
    checking: `${AGENT_NAME}, checking`,
    tracing: `${AGENT_NAME}, tracing where a sentence came from`,
    "cant-answer": `${AGENT_NAME}: the paper does not say`,
    done: `${AGENT_NAME}, done`,
  }[normalisePose(pose)];
}
