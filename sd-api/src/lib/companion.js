"use strict";

/**
 * One question, answered and ruled on: the agent writes, the Sentinel rules,
 * and the agent revises on the Sentinel's guidance for as many rounds as the
 * policy allows. A refused answer is replaced by a refusal a model writes
 * from the reasons.
 *
 * Shared by the reader service, which wires it to stories and a database,
 * and the eval script, which wires it to a dataset and nothing else. What
 * the reader sees is decided here: an answer the Sentinel passed, or the
 * refusal.
 *
 * Pure: the models, the search, the policy limits, the progress callback and
 * the abort signal are injected.
 */

const agent = require("./readingAgent");
const sentinel = require("./sentinel");

function abortError(signal) {
  const e = new Error(signal?.reason instanceof Error ? signal.reason.message : String(signal?.reason || "The question was abandoned."));
  e.name = "AbortError";
  return e;
}

/**
 * @param {object} p
 * @param {object[]} p.blocks
 * @param {{id,text}[]} p.passages
 * @param {string} p.question
 * @param {string} [p.audience]
 * @param {string} [p.storyTitle]
 * @param {number|null} [p.focusIndex]
 * @param {{role,text}[]} [p.history]
 * @param {string|null} [p.threadSummary]
 * @param {(q:string)=>Promise<object[]>} [p.search]
 * @param {{agent:{maxSteps,maxToolCalls,maxFollowUps}, sentinel:{maxRevisions,maxClaims,claimChars}}} p.limits
 * @param {Function} p.generate        the agent's model
 * @param {Function} p.judge           the Sentinel's model
 * @param {Function} [p.refusal]       the refusal writer's model
 * @param {string} [p.refusalFallback] what to say if even the refusal cannot be written
 * @param {AbortSignal} [p.signal]
 * @param {(e:{type:string,tool:string,summary:string})=>Promise<void>} [p.onProgress]
 */
async function answerQuestion({ blocks, passages, question, audience = "adults", storyTitle = "", focusIndex = null, history = [], threadSummary = null, search = null, limits, generate, judge = generate, refusal = null, refusalFallback = "", signal = null, onProgress = async () => {} }) {
  const steps = [];
  const calls = [];
  const usage = [];
  const models = [];
  const rulings = [];
  const progress = async (e) => {
    steps.push(e);
    await onProgress({ type: "step", tool: e.tool, summary: e.summary });
  };
  const gen = signal ? (req) => generate({ ...req, signal }) : generate;
  const jud = signal ? (req) => judge({ ...req, signal }) : judge;

  let answer = null;
  let check = null;
  let revise = [];
  const rounds = 1 + Math.max(0, Number(limits.sentinel.maxRevisions) || 0);
  let attempts = 0;
  for (let round = 0; round < rounds; round += 1) {
    if (signal?.aborted) throw abortError(signal);
    attempts += 1;
    const run = await agent.runReadingAgent({ blocks, passages, question, storyTitle, focusIndex, history, threadSummary, audience, revise, limits: limits.agent, search, generate: gen, onProgress: progress });
    calls.push(...run.calls);
    usage.push(...run.usage);
    models.push(...run.models);
    if (!run.answer) {
      check = { verdict: sentinel.VERDICT.REFUSE, reasons: ["unclear"], guidance: "", rationale: "The companion did not reach an answer within its budget.", claims: [], overall: null, judged: false };
      break;
    }
    if (signal?.aborted) throw abortError(signal);
    await progress({ tool: "sentinel", summary: "Having my answer checked before you see it", result: "" });
    check = await sentinel.checkAnswer({ answer: run.answer, blocks, passages, question, audience, limits: limits.sentinel, generate: jud });
    rulings.push({ verdict: check.verdict, reasons: check.reasons, rationale: check.rationale, model: check.model });
    if (check.usage) usage.push(check.usage);
    if (check.model) models.push(check.model);
    if (check.verdict === sentinel.VERDICT.PASS) { answer = run.answer; break; }
    if (check.verdict === sentinel.VERDICT.REFUSE) break;
    revise = [check.guidance || "", ...check.reasons.map((r) => `Concern: ${r.replace(/_/g, " ")}`)].filter(Boolean);
  }

  /* Refused, or still not right when the rounds ran out: a model says so, kindly. */
  let refusalText = null;
  if (!answer) {
    const reasons = check?.reasons?.length ? check.reasons : ["unclear"];
    const written = refusal ? await sentinel.writeRefusal({ reasons, audience, storyTitle, generate: signal ? (req) => refusal({ ...req, signal }) : refusal }) : { text: null };
    if (written.usage) usage.push(written.usage);
    if (written.model) models.push(written.model);
    refusalText = written.text || refusalFallback || null;
  }

  return { answer, check, attempts, rulings, refusalText, steps, calls, usage, models };
}

module.exports = { answerQuestion };
