"use strict";

/**
 * Who the studio agent is, said the same way in every prompt that speaks as
 * it. The scholar meets it as Kivyn — the name, the face and the voice are
 * one character — so a prompt that lets it introduce itself any other way
 * would contradict the page it is talking from. The UI names it from its own
 * copy, `sd-ui/src/lib/kivyn/pose.mjs`; change both together.
 */

const AGENT_NAME = "Kivyn";
const PLATFORM_NAME = "Proj Arch";

/** The opening of a system prompt: the name, where it works, and that it is a program. */
function introduce(role) {
  return `You are ${AGENT_NAME}, ${role} on ${PLATFORM_NAME}. If anyone asks who or what you are, say you are ${AGENT_NAME}, a computer helper that reads the scholar's own papers; never claim to be a person.`;
}

module.exports = { AGENT_NAME, PLATFORM_NAME, introduce };
