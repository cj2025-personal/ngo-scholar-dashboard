/**
 * The two-stage draft: an outline, then one section per beat. Pure.
 *
 * ── Why two stages ──────────────────────────────────────────────────────────
 * One call that writes the whole article cannot say where each paragraph
 * came from. Two can: the paper is split into numbered passages, the outline
 * names which passages each beat draws on, and every paragraph a section
 * returns cites the passages it used. That citation is what becomes a
 * provenance chip on the block, and what the fidelity judge checks a claim
 * against. Without it "supported / unsupported" has nothing to point at.
 *
 * The prompts here build on the rules in `draftComposer.js` — same system
 * instruction, same voice and quote checks — and add passage ids.
 */

const composer = require("./draftComposer");

/** How the paper is cut for citation. */
const PASSAGE = {
  /* A passage is a paragraph unless the paragraph is very long, in which case
     it is split at sentence ends so a citation points at something readable. */
  MAX_WORDS: 220,
  MIN_WORDS: 12,
};

const OUTLINE = { MIN_BEATS: 4, MAX_BEATS: 6 };

/**
 * Cut prepared source text into numbered passages.
 * @returns {{id: string, text: string, words: number}[]}
 */
function splitPassages(text) {
  const paragraphs = String(text || "")
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const out = [];
  let carry = "";
  const push = (t) => {
    const words = t.split(/\s+/).filter(Boolean).length;
    if (words < PASSAGE.MIN_WORDS) {
      carry = carry ? `${carry} ${t}` : t;
      return;
    }
    const full = carry ? `${carry} ${t}` : t;
    carry = "";
    out.push({ id: `p${out.length + 1}`, text: full, words: full.split(/\s+/).filter(Boolean).length });
  };

  for (const p of paragraphs) {
    const words = p.split(/\s+/).filter(Boolean).length;
    if (words <= PASSAGE.MAX_WORDS) {
      push(p);
      continue;
    }
    /* Long paragraph: pack sentences up to the cap. */
    const sentences = p.split(/(?<=[.!?])\s+/);
    let chunk = [];
    let count = 0;
    for (const s of sentences) {
      const n = s.split(/\s+/).filter(Boolean).length;
      if (count + n > PASSAGE.MAX_WORDS && chunk.length) {
        push(chunk.join(" "));
        chunk = [];
        count = 0;
      }
      chunk.push(s);
      count += n;
    }
    if (chunk.length) push(chunk.join(" "));
  }
  if (carry) {
    if (out.length) {
      const last = out[out.length - 1];
      last.text = `${last.text} ${carry}`;
      last.words = last.text.split(/\s+/).filter(Boolean).length;
    } else {
      out.push({ id: "p1", text: carry, words: carry.split(/\s+/).filter(Boolean).length });
    }
  }
  return out;
}

function renderPassages(passages) {
  return passages.map((p) => `[${p.id}] ${p.text}`).join("\n\n");
}

/* ── outline ─────────────────────────────────────────────────────────────── */

const OUTLINE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    deck: { type: "STRING" },
    beats: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          heading: { type: "STRING" },
          goal: { type: "STRING" },
          passage_ids: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["heading", "goal", "passage_ids"],
      },
    },
  },
  required: ["title", "deck", "beats"],
};

function buildOutlinePrompt({ scholar = {}, source = {}, passages, truncated = false, audience, brief = null }) {
  const aud = composer.AUDIENCES[composer.normaliseAudience(audience)];
  const name = scholar.name || "the scholar";
  return [
    `Plan an article about the paper below, by ${name}, for ${aud.brief}`,
    ...(brief ? ["", `The scholar's brief for this article: "${String(brief).trim()}". Follow it where the paper supports it; where it asks for something the paper does not say, leave that out.`] : []),
    "",
    "Return:",
    "- title: under 12 words, specific to what the paper found, no colon-and-subtitle pattern.",
    "- deck: one or two sentences saying what the paper did. No claims about impact the paper does not make.",
    `- beats: ${OUTLINE.MIN_BEATS} to ${OUTLINE.MAX_BEATS} sections in reading order. Each has a short heading, a one-sentence goal,`,
    "  and passage_ids: the passages (by their [pN] label) the section will draw on. Every beat must cite at",
    "  least one passage. Open with what the paper found; close with what the paper says is unknown or next, if it does.",
    "",
    `Paper title: ${source.title || "Untitled"}` + (source.year ? ` (${source.year})` : ""),
    truncated ? "NOTE: only the opening portion of the paper is provided. Plan from what is here." : "",
    "",
    "=== PAPER, IN NUMBERED PASSAGES ===",
    renderPassages(passages),
    "=== END ===",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function parseOutline(raw, passages) {
  let data;
  try {
    data = JSON.parse(stripFence(raw));
  } catch {
    throw new Error("The model did not return valid JSON for the outline.");
  }
  if (!data || !Array.isArray(data.beats) || data.beats.length === 0) {
    throw new Error("The outline is missing its beats.");
  }
  const known = new Set(passages.map((p) => p.id));
  const beats = data.beats
    .slice(0, OUTLINE.MAX_BEATS)
    .map((b, i) => ({
      index: i + 1,
      heading: clean(b?.heading) || `Section ${i + 1}`,
      goal: clean(b?.goal) || "",
      passageIds: (Array.isArray(b?.passage_ids) ? b.passage_ids : []).map(String).filter((id) => known.has(id)),
    }))
    /* A beat that cites nothing we gave it would be drafted from nothing. */
    .filter((b) => b.passageIds.length > 0);

  if (beats.length < 2) {
    throw new Error("The outline cites too few passages to draft from.");
  }
  return {
    title: clean(data.title).slice(0, composer.LIMITS.MAX_TITLE_CHARS),
    deck: clean(data.deck).slice(0, composer.LIMITS.MAX_DECK_CHARS),
    beats,
  };
}

/* ── one section ─────────────────────────────────────────────────────────── */

const SECTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    paragraphs: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          text: { type: "STRING" },
          passage_ids: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["text", "passage_ids"],
      },
    },
    quote: {
      type: "OBJECT",
      properties: {
        text: { type: "STRING" },
        passage_id: { type: "STRING" },
      },
      required: ["text", "passage_id"],
      nullable: true,
    },
  },
  required: ["paragraphs"],
};

function buildSectionPrompt({ scholar = {}, beat, passages, outline, audience, strictVoice = false, readabilityNote = null, fidelityNote = null }) {
  const aud = composer.AUDIENCES[composer.normaliseAudience(audience)];
  const name = scholar.name || "the scholar";
  const cited = passages.filter((p) => beat.passageIds.includes(p.id));
  const lines = [
    `Write section ${beat.index} of ${outline.beats.length} of an article about a paper by ${name}, for ${aud.brief}`,
    "",
    `Article title: ${outline.title}`,
    `This section's heading: ${beat.heading}`,
    `This section's goal: ${beat.goal}`,
    "",
    "Return 1 to 3 paragraphs, 60 to 180 words each. For every paragraph list passage_ids: the passages below",
    "that every fact in it comes from. A paragraph may cite only passages shown here. Optionally one quote:",
    "a sentence copied exactly from one passage, with its passage_id; otherwise null.",
    "Do not repeat the heading. Do not summarise the whole paper; write this section only.",
  ];
  if (strictVoice) {
    lines.push("", `Your previous attempt used first-person language. This article is written about ${name}, never as ${name}. Third person only.`);
  }
  if (readabilityNote) {
    lines.push("", readabilityNote);
  }
  if (fidelityNote) {
    lines.push("", fidelityNote);
  }
  lines.push("", "=== PASSAGES THIS SECTION MAY USE ===", renderPassages(cited), "=== END ===");
  return lines.join("\n");
}

/**
 * One section, checked. Returns blocks (paragraph / quote) each with
 * `sourceRefs`, plus the first-person sentences found.
 */
function parseSection(raw, { beat, passages }) {
  let data;
  try {
    data = JSON.parse(stripFence(raw));
  } catch {
    throw new Error(`The model did not return valid JSON for section ${beat.index}.`);
  }
  if (!data || !Array.isArray(data.paragraphs) || data.paragraphs.length === 0) {
    throw new Error(`Section ${beat.index} came back empty.`);
  }
  const allowed = new Set(beat.passageIds);
  const byId = new Map(passages.map((p) => [p.id, p]));
  const blocks = [];
  const violations = [];
  const warnings = [];

  for (const para of data.paragraphs.slice(0, 3)) {
    const text = clean(para?.text);
    if (!text) continue;
    const refs = (Array.isArray(para?.passage_ids) ? para.passage_ids : []).map(String).filter((id) => allowed.has(id));
    if (refs.length === 0) {
      /* A paragraph that cites nothing it was allowed is kept but marked: the
         fidelity judge (Phase 2) decides; the chip shows nothing. */
      warnings.push(`A paragraph in "${beat.heading}" cited no passage and is untraceable.`);
    }
    violations.push(...composer.firstPersonSentences(text));
    blocks.push({ type: "paragraph", html: escapeHtml(text), sourceRefs: refs.map((id) => ({ passageId: id })) });
  }

  const q = data.quote;
  if (q && typeof q === "object" && clean(q.text)) {
    const pid = String(q.passage_id || "");
    const passage = allowed.has(pid) ? byId.get(pid) : null;
    if (passage && composer.isVerbatim(q.text, passage.text)) {
      blocks.push({ type: "quote", html: escapeHtml(clean(q.text)), sourceRefs: [{ passageId: pid }] });
    } else {
      warnings.push(`A quotation in "${beat.heading}" was left out because it does not appear word for word in the passage it cited.`);
    }
  }

  if (!blocks.some((b) => b.type === "paragraph")) {
    throw new Error(`Section ${beat.index} has no prose.`);
  }
  return { blocks, violations, warnings };
}

/* ── assembly ────────────────────────────────────────────────────────────── */

/** Sections into the composer's block list, with a heading before each. */
function assemble({ outline, sections }) {
  const bodyBlocks = [];
  for (const beat of outline.beats) {
    const section = sections[beat.index];
    if (!section) continue;
    bodyBlocks.push({ type: "subheading", html: escapeHtml(beat.heading), sourceRefs: [] });
    bodyBlocks.push(...section.blocks);
  }
  const prose = bodyBlocks
    .filter((b) => b.type === "paragraph")
    .map((b) => unescapeHtml(b.html))
    .join("\n\n");
  const words = bodyBlocks.reduce((n, b) => n + (b.type === "subheading" ? 0 : unescapeHtml(b.html).split(/\s+/).filter(Boolean).length), 0);
  return { bodyBlocks, prose, words };
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function clean(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}
function stripFence(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1] : s;
}
function escapeHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function unescapeHtml(value) {
  return String(value || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

module.exports = {
  PASSAGE,
  OUTLINE,
  OUTLINE_SCHEMA,
  SECTION_SCHEMA,
  splitPassages,
  renderPassages,
  buildOutlinePrompt,
  parseOutline,
  buildSectionPrompt,
  parseSection,
  assemble,
};
