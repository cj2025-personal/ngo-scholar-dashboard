"use strict";

/**
 * Which model does which job, and what happens when one is down.
 *
 * ── Routes ──────────────────────────────────────────────────────────────────
 * Every model call names a purpose — "reader.agent", "reader.sentinel",
 * "studio.converse" — and the models policy says, for each, a primary model,
 * the fallbacks to try in order, and the settings it runs with: reasoning
 * budget, temperature, output ceiling, timeout. The judge can be a different
 * model from the writer it judges; a cheap model can do a cheap job.
 *
 * ── When a model fails ──────────────────────────────────────────────────────
 * A failed call moves on to the next model in the route. A model that keeps
 * failing is skipped for a cooling-off period (a circuit breaker per model,
 * per process), so a provider outage costs one timeout, not one per request.
 * Two things are never retried on another model: the caller abandoning the
 * request, and a model declining on safety grounds — that is a decision
 * about the content, and asking a second model would be shopping for a yes.
 *
 * ── What is recorded ────────────────────────────────────────────────────────
 * Every call reports its purpose, the model that answered, whether it was a
 * fallback, its latency and its tokens to `onCall`, which the service turns
 * into a log line and an audit row.
 *
 * Pure: the transport, the clock and the policy are injected.
 */

const breakers = new Map(); // model -> { failures, openUntil }

/** A 4xx other than a timeout or a rate limit: the request, not the model. */
function isRequestError(error) {
  const s = Number(error?.status);
  return s >= 400 && s < 500 && s !== 408 && s !== 429;
}

function breakerOpen(model, now) {
  const b = breakers.get(model);
  return Boolean(b && b.openUntil && b.openUntil > now);
}
function breakerFailure(model, now, { failureThreshold, cooldownSeconds }) {
  const b = breakers.get(model) || { failures: 0, openUntil: 0 };
  b.failures += 1;
  if (b.failures >= failureThreshold) b.openUntil = now + cooldownSeconds * 1000;
  breakers.set(model, b);
}
function breakerSuccess(model) {
  breakers.delete(model);
}
function resetBreakers() {
  breakers.clear();
}

/** The reasoning budget a model will accept, given what the route asked for. */
function thinkingFor(model, asked, limits = {}) {
  const l = limits[model] || {};
  let budget = Math.max(0, Number(asked) || 0);
  if (l.minThinkingBudget && budget < l.minThinkingBudget) budget = l.minThinkingBudget;
  if (budget > 0 && l.minThinkingBudgetWhenOn && budget < l.minThinkingBudgetWhenOn) budget = l.minThinkingBudgetWhenOn;
  return budget;
}

/**
 * @param {object} p
 * @param {object} p.models                  the models policy
 * @param {(req:object)=>Promise<object>} p.call       vertex.generateContent
 * @param {(req:object)=>Promise<object>} [p.embedCall] vertex.embed
 * @param {string|null} [p.deploymentModel]  what a route with no primary means
 * @param {(e:object)=>void} [p.onCall]
 * @param {()=>number} [p.now]
 */
function createRouter({ models, call, embedCall = null, deploymentModel = null, onCall = () => {}, now = Date.now }) {
  const breaker = models.breaker || { failureThreshold: 3, cooldownSeconds: 60 };

  function routeFor(purpose) {
    const r = models.routes?.[purpose] || models.routes?.default;
    if (!r) throw new Error(`No model route for "${purpose}" and no default.`);
    return r;
  }

  /**
   * One generation, routed by purpose.
   * @param {string} purpose
   * @param {object} req   as vertex.generateContent takes it; route settings fill what it leaves out
   */
  async function generate(purpose, req = {}) {
    const route = routeFor(purpose);
    const chain = [route.primary || deploymentModel, ...(route.fallback || [])].filter(Boolean);
    const unique = [...new Set(chain)];
    let lastError = null;
    for (let i = 0; i < unique.length; i += 1) {
      const model = unique[i];
      const t = now();
      if (breakerOpen(model, t) && i < unique.length - 1) continue;
      try {
        const r = await call({
          ...req,
          model,
          temperature: req.temperature ?? route.temperature,
          maxOutputTokens: req.maxOutputTokens ?? route.maxOutputTokens,
          timeoutMs: req.timeoutMs ?? route.timeoutMs,
          thinkingBudget: thinkingFor(model, req.thinkingBudget ?? route.thinkingBudget, models.modelLimits),
        });
        breakerSuccess(model);
        onCall({ purpose, model, fallback: i > 0, ms: now() - t, usage: r.usage || null, ok: true });
        return { ...r, model, purpose, fallback: i > 0 };
      } catch (error) {
        if (error?.name === "AbortError" || error?.code === "BLOCKED") {
          onCall({ purpose, model, fallback: i > 0, ms: now() - t, usage: null, ok: false, error: error.code || error.name });
          throw error;
        }
        /* A request the model refused as malformed says nothing about the
           model's health, and the breaker is shared by every purpose: counting
           it would take the model away from routes whose requests are fine.
           The next model is still tried, in case the refusal is its own. */
        if (!isRequestError(error)) breakerFailure(model, now(), breaker);
        onCall({ purpose, model, fallback: i > 0, ms: now() - t, usage: null, ok: false, error: String(error.message).slice(0, 160), status: error?.status || null });
        lastError = error;
      }
    }
    throw lastError || new Error(`Every model for "${purpose}" is unavailable.`);
  }

  /** Embeddings, with the same fallback and breaker. */
  async function embed(texts, { taskType = "RETRIEVAL_DOCUMENT", signal = null, model: only = null } = {}) {
    if (!embedCall) throw new Error("This router was made without an embedding transport.");
    const e = models.embeddings || {};
    /* A query must be embedded by the model its index was built with, or the
       two live in different spaces; a caller that knows names it. */
    const chain = only ? [only] : [...new Set([e.primary, ...(e.fallback || [])].filter(Boolean))];
    let lastError = null;
    for (let i = 0; i < chain.length; i += 1) {
      const model = chain[i];
      const t = now();
      if (breakerOpen(model, t) && i < chain.length - 1) continue;
      try {
        const r = await embedCall({ texts, taskType, model, batchSize: e.batchSize, timeoutMs: e.timeoutMs, signal });
        breakerSuccess(model);
        onCall({ purpose: "embed", model, fallback: i > 0, ms: now() - t, usage: r.usage || null, ok: true });
        return { ...r, model };
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        breakerFailure(model, now(), breaker);
        onCall({ purpose: "embed", model, fallback: i > 0, ms: now() - t, usage: null, ok: false, error: String(error.message).slice(0, 160) });
        lastError = error;
      }
    }
    throw lastError || new Error("Every embedding model is unavailable.");
  }

  /** A generate function bound to one purpose, for code that takes `generate(req)`. */
  function bound(purpose, extra = {}) {
    return (req) => generate(purpose, { ...extra, ...req });
  }

  return { generate, embed, bound, routeFor };
}

module.exports = { createRouter, resetBreakers, thinkingFor, isRequestError };
