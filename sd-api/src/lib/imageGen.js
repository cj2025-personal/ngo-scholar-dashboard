/**
 * Illustrations on request, from Vertex Imagen.
 *
 * ── What an illustration is here ────────────────────────────────────────────
 * A picture the scholar asked for in words: "a four-element antenna array on
 * a mast". It is generated, and it is labelled as generated in the block's
 * provenance and in the caption's prefix, because a reader of a scholarly
 * article must never take an illustration for a figure from the paper. The
 * only route to a real figure is the paper itself, which is a later feature.
 *
 * Same env as the text model (project, location, credentials); the model is
 * IMAGE_MODEL, default imagen-3.0-generate-002. LLM_PROVIDER=fake returns a
 * small placeholder PNG so the loop runs in tests.
 */

const { env } = require("../config/env");

const DEFAULT_MODEL = "imagen-3.0-generate-002";

function isFake() {
  return env.llm.provider === "fake" && !env.isProduction;
}

function isConfigured() {
  if (isFake()) return true;
  return env.llm.provider === "vertex" && Boolean(env.llm.project) && env.images.enabled;
}

/* A 4x3 grey PNG, valid, tiny. */
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEklEQVR4nGP4//8/AwMDAxUJAJ5rCf1lqXmpAAAAAElFTkSuQmCC",
  "base64",
);

/**
 * @param {object} p
 * @param {string} p.description   what to draw
 * @returns {Promise<{buffer: Buffer, mimeType: string, model: string}>}
 */
async function generateImage({ description }) {
  if (!isConfigured()) throw new Error("Image generation is not configured.");
  if (isFake()) return { buffer: PLACEHOLDER_PNG, mimeType: "image/png", model: "fake/imagen" };

  const vertex = require("./vertex");
  const model = env.images.model || DEFAULT_MODEL;
  const url = `https://${env.llm.location}-aiplatform.googleapis.com/v1/projects/${env.llm.project}/locations/${env.llm.location}/publishers/google/models/${model}:predict`;
  const token = await vertex.getAccessToken();
  const prompt =
    `${description}. Clean editorial illustration for a science article, no text, no logos, no watermarks, ` +
    "no real people's faces, muted palette.";
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio: "16:9", safetySetting: "block_medium_and_above", personGeneration: "dont_allow", addWatermark: true },
    }),
  });
  if (!res.ok) throw new Error(`Imagen error ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const payload = await res.json();
  const pred = payload?.predictions?.[0];
  const b64 = pred?.bytesBase64Encoded;
  if (!b64) throw new Error(`Imagen returned no image${pred?.raiFilteredReason ? ` (${pred.raiFilteredReason})` : ""}.`);
  return { buffer: Buffer.from(b64, "base64"), mimeType: pred.mimeType || "image/png", model };
}

module.exports = { isConfigured, generateImage, DEFAULT_MODEL };
