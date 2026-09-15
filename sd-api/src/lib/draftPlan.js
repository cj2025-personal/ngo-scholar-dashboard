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
 * ── Two kinds of beat ───────────────────────────────────────────────────────
 * A `paper` beat reports what the paper says; every paragraph under it is
 * checked by the fidelity judge. An `extension` beat says what follows from
 * the paper for the reader — why it matters, where the same problem turns
 * up — and is planned only when the scholar's brief asks for something the
 * paper does not state. Its paragraphs still cite passages: the ones they
 * build on. The reach judge checks that each claim follows from those
 * passages, is said as an implication, and brings in nothing from outside.
 * Extension beats may not outnumber paper beats; an article that is mostly
 * what follows from the paper is no longer about the paper.
 *
 * ── The brief is answered, not silently trimmed ─────────────────────────────
 * The outline records how far the brief was met. Where the brief asks for
 * something no beat of either kind can do without outside facts, the plan
 * says so in a sentence, and the scholar reads that sentence before a word
 * is drafted. A brief that is quietly dropped is the failure this guards.
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

const BEAT_KIND = { PAPER: "paper", EXTENSION: "extension" };

/** How far the plan meets the brief. Stable names: the composer shows them. */
const COVERAGE = { FULL: "full", PART: "part", NONE: "none" };

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
          kind: { type: "STRING", enum: ["paper", "extension"] },
          passage_ids: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["heading", "goal", "kind", "passage_ids"],
      },
    },
    brief_coverage: {
      type: "OBJECT",
      properties: {
        met: { type: "STRING", enum: ["full", "part", "none"] },
        note: { type: "STRING" },
      },
      required: ["met", "note"],
      nullable: true,
    },
  },
  required: ["title", "deck", "beats", "brief_coverage"],
};

function buildOutlinePrompt({ scholar = {}, source = {}, passages, truncated = false, audience, brief = null, voice = composer.DEFAULT_VOICE }) {
  const aud = composer.AUDIENCES[composer.normaliseAudience(audience)];
  const name = scholar.name || "the scholar";
  const authorVoice = composer.normaliseVoice(voice) === composer.VOICE.AUTHOR;
  const briefText = brief ? String(brief).trim() : "";
  return [
    authorVoice
      ? `Plan an article about the paper below, for ${aud.brief}`
      : `Plan an article about the paper below, by ${name}, for ${aud.brief}`,
    ...(authorVoice
      ? [
          "",
          `The article is the author's own account of their own paper, published under their byline. Nothing in it`,
          `refers to them: no "${name}", no "the author", no "he" or "she". Headings and goals name the work, not`,
          `the worker — "A mixed window", not "${String(name).split(" ").pop()}'s mixed window".`,
        ]
      : []),
    ...(briefText
      ? [
          "",
          `The scholar's brief for this article: "${briefText}"`,
          "Follow it. Where the brief asks for what the paper states, plan paper sections. Where it asks for what the paper",
          "does not state — why the work matters, what it means for readers, where the same problem turns up — plan",
          "extension sections: each names the passages whose findings it builds on, and its goal says what follows from",
          "them for the reader. An extension section may draw implications only from the paper; it may not need a",
          "product, event, statistic, or practice the paper does not mention.",
          "A brief that asks why the work matters, what it means for readers, or where it is useful is ANSWERED by an",
          "extension section — it is not a reason to leave the brief out. The paper does not have to discuss society,",
          "education or industry for you to plan one: the section draws out what the paper's own findings would mean",
          "for a reader who meets the same problem. Plan at least one extension section for such a brief.",
          'Reserve brief_coverage "part" or "none" for what no implication could reach — a request for a named product,',
          "a market figure, an event, or a claim about what people actually do today, none of which the paper states.",
        ]
      : ["", "No brief was given: every section is a paper section, and brief_coverage is null."]),
    "",
    "Return:",
    "- title: under 12 words, specific to what the paper found, no colon-and-subtitle pattern.",
    "- deck: one or two sentences saying what the paper did. No claims about impact the paper does not make.",
    `- beats: ${OUTLINE.MIN_BEATS} to ${OUTLINE.MAX_BEATS} sections in reading order. Each has a short heading; a goal, which is the point the`,
    "  section makes, stated as one sentence a reader could disagree with, not a description of the section;",
    '  kind, "paper" or "extension"; and passage_ids: the passages (by their [pN] label) the section will draw on',
    "  or build on. Every beat must cite at least one passage. At least half the sections must be paper sections.",
    "  Open with what the paper found. A paper section on what the paper says is unknown or next belongs where",
    "  the paper says it; an extension section may close the article.",
    ...(briefText
      ? [
          '- brief_coverage: met is "full" when the sections do what the brief asked, "part" when some of it is left',
          '  out, "none" when the paper cannot carry any of it; note is one sentence naming what was left out and why,',
          "  or an empty string when nothing was.",
        ]
      : []),
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

/**
 * @param {string} raw
 * @param {{id:string}[]} passages
 * @param {object} [opts]
 * @param {boolean} [opts.allowExtension]  false without a brief: a beat marked extension is planned as paper
 * @returns {{title, deck, beats, coverage, dropped: number}}
 */
function parseOutline(raw, passages, { allowExtension = true } = {}) {
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
  const all = data.beats
    .slice(0, OUTLINE.MAX_BEATS)
    .map((b) => ({
      heading: clean(b?.heading),
      goal: clean(b?.goal) || "",
      kind: allowExtension && b?.kind === BEAT_KIND.EXTENSION ? BEAT_KIND.EXTENSION : BEAT_KIND.PAPER,
      passageIds: (Array.isArray(b?.passage_ids) ? b.passage_ids : []).map(String).filter((id) => known.has(id)),
    }))
    /* A beat that cites nothing we gave it would be drafted from nothing. */
    .filter((b) => b.passageIds.length > 0);

  /* The budget: no more extension beats than paper beats. Extras are cut from
     the end, and the cut is counted so the run can say so. */
  const paper = all.filter((b) => b.kind === BEAT_KIND.PAPER).length;
  let allowed = paper;
  let dropped = 0;
  const beats = all
    .filter((b) => {
      if (b.kind !== BEAT_KIND.EXTENSION) return true;
      if (allowed > 0) { allowed -= 1; return true; }
      dropped += 1;
      return false;
    })
    .map((b, i) => ({ index: i + 1, heading: b.heading || `Section ${i + 1}`, goal: b.goal, kind: b.kind, passageIds: b.passageIds }));

  if (beats.length < 2) {
    throw new Error("The outline cites too few passages to draft from.");
  }
  const c = data.brief_coverage;
  const coverage = allowExtension && c && typeof c === "object" && Object.values(COVERAGE).includes(c.met)
    ? { met: c.met, note: clean(c.note).slice(0, 300) }
    : null;
  return {
    title: clean(data.title).slice(0, composer.LIMITS.MAX_TITLE_CHARS),
    deck: clean(data.deck).slice(0, composer.LIMITS.MAX_DECK_CHARS),
    beats,
    coverage,
    dropped,
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
          extension: { type: "BOOLEAN" },
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

function buildSectionPrompt({ scholar = {}, beat, passages, outline, audience, strictVoice = false, strictSelf = false, readabilityNote = null, fidelityNote = null, reachNote = null, voice = composer.DEFAULT_VOICE }) {
  const aud = composer.AUDIENCES[composer.normaliseAudience(audience)];
  const name = scholar.name || "the scholar";
  const authorVoice = composer.normaliseVoice(voice) === composer.VOICE.AUTHOR;
  const cited = passages.filter((p) => beat.passageIds.includes(p.id));
  const extension = beat.kind === BEAT_KIND.EXTENSION;
  const lines = [
    authorVoice
      ? `Write section ${beat.index} of ${outline.beats.length} of an article, for ${aud.brief}`
      : `Write section ${beat.index} of ${outline.beats.length} of an article about a paper by ${name}, for ${aud.brief}`,
    ...(authorVoice
      ? ["", `This is the author's own account of their own paper. Never refer to them: no "${name}", no "the author", no "he" or "she". The work is the subject of your sentences.`]
      : []),
    "",
    `Article title: ${outline.title}`,
    `This section's heading: ${beat.heading}`,
    `This section's goal: ${beat.goal}`,
    `Section kind: ${extension ? "extension" : "paper"}`,
    "",
  ];
  if (extension) {
    lines.push(
      "This section goes beyond the paper: it says what follows from the paper's findings for the reader, without",
      "adding any fact the paper does not state.",
      "Return 1 to 3 paragraphs, 60 to 180 words each. For every paragraph list passage_ids: the passages below it",
      "builds on; and extension: true for a paragraph that draws an implication, false for one that only states",
      "what the paper found. A paragraph may cite only passages shown here. Quote: null.",
      "Rules for a paragraph marked extension:",
      "- Start from what the paper established, then say what follows from it for the reader.",
      '- Say implications as implications: "which means", "would matter wherever", "the same problem faces any".',
      '  Never as findings: no "showed", "proved", "is used in", "has led to", "today engineers rely on".',
      "- Name no product, company, technology, event, place, number or study that is not in the passages. A",
      "  reader may think of examples; you may not supply them. An everyday comparison used only to explain an",
      "  idea the passages state is fine.",
      ...(aud.young ? ["- The reader is a child: nothing frightening, and nothing that assumes a world beyond theirs."] : []),
      "Do not repeat the heading. Do not summarise the whole paper; write this section only.",
    );
  } else {
    lines.push(
      "Return 1 to 3 paragraphs, 60 to 180 words each. For every paragraph list passage_ids: the passages below",
      "that every fact in it comes from. A paragraph may cite only passages shown here. Optionally one quote:",
      "a sentence copied exactly from one passage, with its passage_id; otherwise null.",
      "Do not repeat the heading. Do not summarise the whole paper; write this section only.",
    );
  }
  if (strictVoice) {
    lines.push(
      "",
      authorVoice
        ? `Your previous attempt used first-person language. This article is impersonal: no "I", "we", "my" or "our", and no reference to ${name} either. Make the work the subject.`
        : `Your previous attempt used first-person language. This article is written about ${name}, never as ${name}. Third person only.`,
    );
  }
  if (strictSelf) {
    lines.push(
      "",
      `Your previous attempt referred to the author. This article carries their byline, so the prose must never name them or stand a pronoun in for them.`,
      `Rewrite every such sentence with the work as its subject: not "${String(name).split(" ").pop()} built a dictionary", but "The method builds a dictionary".`,
    );
  }
  if (readabilityNote) {
    lines.push("", readabilityNote);
  }
  if (fidelityNote) {
    lines.push("", fidelityNote);
  }
  if (reachNote) {
    lines.push("", reachNote);
  }
  lines.push("", "=== PASSAGES THIS SECTION MAY USE ===", renderPassages(cited), "=== END ===");
  return lines.join("\n");
}

/**
 * One section, checked. Returns blocks (paragraph / quote) each with
 * `sourceRefs` — and `extension: true` on a paragraph that draws an
 * implication, in an extension beat — plus the first-person sentences found.
 */
function parseSection(raw, { beat, passages, voice = composer.DEFAULT_VOICE, scholarName = null }) {
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
  const extensionBeat = beat.kind === BEAT_KIND.EXTENSION;
  const authorVoice = composer.normaliseVoice(voice) === composer.VOICE.AUTHOR;
  const blocks = [];
  const violations = [];
  const selfReferences = [];
  const warnings = [];

  for (const para of data.paragraphs.slice(0, 3)) {
    const text = clean(para?.text);
    if (!text) continue;
    const refs = (Array.isArray(para?.passage_ids) ? para.passage_ids : []).map(String).filter((id) => allowed.has(id));
    if (refs.length === 0) {
      /* A paragraph that cites nothing it was allowed is kept but marked: the
         judge decides; the chip shows nothing. */
      warnings.push(`A paragraph in "${beat.heading}" cited no passage and is untraceable.`);
    }
    violations.push(...composer.firstPersonSentences(text));
    if (authorVoice) {
      /* Naming the author is sent back to the drafter; a bare pronoun may
         belong to someone else the paper names, so it is only reported. */
      const self = composer.selfReferenceSentences(text, scholarName);
      selfReferences.push(...self.named);
      for (const s of self.pronouns) warnings.push(`A sentence in "${beat.heading}" uses a personal pronoun: “${s.trim().slice(0, 120)}”. If it stands for you, rewrite it with the work as the subject.`);
    }
    /* Only an extension beat may hold an extension paragraph; a paper beat's
       paragraphs are the paper's, whatever the model marks them. */
    const extension = extensionBeat && para?.extension === true;
    blocks.push({ type: "paragraph", html: escapeHtml(text), sourceRefs: refs.map((id) => ({ passageId: id })), ...(extension ? { extension: true } : {}) });
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
  return { blocks, violations, selfReferences, warnings };
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
  BEAT_KIND,
  COVERAGE,
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
