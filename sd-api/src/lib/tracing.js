/**
 * LangSmith tracing, on when configured and invisible when not.
 *
 * Traces you didn't collect are traces you can't analyse, so this is wired
 * before any evaluator exists. Set LANGSMITH_API_KEY (and optionally
 * LANGSMITH_PROJECT) and every model call the drafter makes is recorded with
 * its prompt, output and token usage. Unset, `traced()` returns the function
 * it was given and costs nothing.
 */

let traceableFn = null;

function isTracingConfigured() {
  return Boolean(process.env.LANGSMITH_API_KEY || process.env.LANGCHAIN_API_KEY) &&
    String(process.env.LANGSMITH_TRACING ?? process.env.LANGCHAIN_TRACING_V2 ?? "true").toLowerCase() !== "false";
}

/**
 * @template {Function} F
 * @param {string} name
 * @param {F} fn
 * @param {object} [options]  passed to langsmith's traceable (run_type, metadata, tags)
 * @returns {F}
 */
function traced(name, fn, options = {}) {
  if (!isTracingConfigured()) return fn;
  if (!traceableFn) {
    try {
      traceableFn = require("langsmith/traceable").traceable;
    } catch (error) {
      console.warn(`[tracing] langsmith unavailable (${error.message}); running untraced`);
      return fn;
    }
  }
  return traceableFn(fn, { name, run_type: "llm", ...options });
}

module.exports = { traced, isTracingConfigured };
