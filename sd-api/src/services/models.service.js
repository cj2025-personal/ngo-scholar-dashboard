"use strict";

/**
 * A model router for one piece of work, built from the models policy as it
 * stands now. Every call it makes is logged as a line of numbers, and, when
 * the caller passes a list, collected so the work can record which models
 * answered it.
 */

const vertex = require("../lib/vertex");
const { createRouter } = require("../lib/modelRouter");
const { traced } = require("../lib/tracing");
const { env } = require("../config/env");
const { getPolicy } = require("./policy.service");
const { logModelCall } = require("./agentAudit.service");

const tracedGenerate = traced("model.generateContent", (req) => vertex.generateContent(req));

/**
 * @param {object} [p]
 * @param {import("mongodb").Db} [p.db]
 * @param {object[]} [p.collect]   every call's record is pushed here too
 */
async function routerFor({ db = null, collect = null } = {}) {
  const models = await getPolicy("models", { db });
  return createRouter({
    models,
    deploymentModel: env.llm.model,
    call: tracedGenerate,
    embedCall: (req) => vertex.embed(req),
    onCall: (e) => { logModelCall(e); if (collect) collect.push(e); },
  });
}

module.exports = { routerFor };
