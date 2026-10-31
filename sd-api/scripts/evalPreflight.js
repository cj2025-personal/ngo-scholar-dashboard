#!/usr/bin/env node
/**
 * Can this run reach the model? Exits 1 if not.
 *
 *   npm run eval:preflight
 *
 * The first step of the evals job in CI. That job used to skip itself
 * whenever its key secret was unset, and the secret never was: every eval
 * "passed" in 0 seconds and CI was green while measuring nothing. Now the
 * job authenticates without a key and this step fails, loudly, when it
 * cannot — so a missing credential is a red build, never a quiet skip.
 *
 * Makes no model call: it builds the client the evals will use and asks
 * Google for an access token with it. Touches no database.
 */

require("dotenv").config();

const vertex = require("../src/lib/vertex");

vertex.checkAccess().then(
  (result) => {
    if (result.ok) {
      console.log(`model        ${result.model}`);
      console.log(`credentials  ${result.credentials}: an access token was issued`);
      process.exit(0);
    }
    const message = `The evals cannot reach the model: ${result.problem}${result.credentials ? ` [client: ${result.credentials}]` : ""}`;
    /* An annotation on the run's summary in GitHub Actions; plain text elsewhere. */
    console.error(process.env.GITHUB_ACTIONS ? `::error::${message}` : message);
    process.exit(1);
  },
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
