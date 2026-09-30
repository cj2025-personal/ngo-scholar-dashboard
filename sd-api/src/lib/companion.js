"use strict";

/**
 * One question, answered and checked: the agent, then the Sentinel, then
 * at most one more round of each.
 *
 * Shared by the reader service, which wires it to stories and a database,
 * and the eval script, which wires it to a dataset and nothing else. What
 * the reader sees is decided here and nowhere else: an answer the Sentinel
 * passed, or nothing.
 *
 * Pure: the model, the judge, the progress callback and the abort signal are
 * injected. An abort ends the work between calls; the model client ends the
 * call in flight.
 */

const agent = require("./readingAgent");
const sentinel = require("./sentinel");

const MAX_ATTEMPTS = 2;

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
 * @param {Function} p.generate      the agent's model
 * @param {Function} [p.judge]       the Sentinel's model; the agent's when absent
 * @param {AbortSignal} [p.signal]
 * @param {(e:{type:string,tool:string,summary:string,result?:string})=>Promise<void>} [p.onProgress]
 * @returns {Promise<{answer: object|null, check: object|null, attempts: number, steps: object[], calls: object[], usage: object[]}>}
 *   `answer` is null unless the Sentinel passed it.
 */
async function answerQuestion({ blocks, passages, question, audience = "adults", storyTitle = "", focusIndex = null, history = [], generate, judge = generate, signal = null, onProgress = async () => {} }) {
  const steps = [];
  const calls = [];
  const usage = [];
  const progress = async (e) => {
    steps.push(e);
    await onProgress({ type: "step", tool: e.tool, summary: e.summary });
  };
  const gen = signal ? (req) => generate({ ...req, signal }) : generate;
  const jud = signal ? (req) => judge({ ...req, signal }) : judge;

  let answer = null;
  let check = null;
  let revise = [];
  let attempts = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw abortError(signal);
    attempts += 1;
    const run = await agent.runReadingAgent({ blocks, passages, question, storyTitle, focusIndex, history, audience, revise, generate: gen, onProgress: progress });
    calls.push(...run.calls);
    usage.push(...run.usage);
    if (!run.answer) {
      check = { verdict: sentinel.VERDICT.REFUSE, reasons: ["no_answer"], claims: [], judged: false, call: null };
      break;
    }
    if (signal?.aborted) throw abortError(signal);
    const reading = { tool: "sentinel", summary: "Reading my answer back before you see it", result: "" };
    steps.push(reading);
    await onProgress({ type: "step", tool: reading.tool, summary: reading.summary });
    check = await sentinel.checkAnswer({ answer: run.answer, blocks, passages, question, audience, generate: jud });
    if (check.call?.usage) usage.push(check.call.usage);
    if (check.verdict === sentinel.VERDICT.PASS) { answer = run.answer; break; }
    if (check.verdict === sentinel.VERDICT.REFUSE) break;
    revise = sentinel.reviseNote({ ...check, audience });
  }

  return { answer, check, attempts, steps, calls, usage };
}

module.exports = { answerQuestion, MAX_ATTEMPTS };
