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
 * ── The brief is the subject; the paper is the evidence ─────────────────────
 * An article is planned to answer what the scholar asked, organised by the
 * question rather than by the paper's own order, with the paper cited where
 * it carries a point. An article that retells the paper section by section
 * is what this file used to plan, and it is what a scholar means when they
 * say the agent "dumped the paper into the article".
 *
 * ── Three kinds of beat ─────────────────────────────────────────────────────
 * A `paper` beat makes its point with what the paper states; every
 * paragraph under it is checked by the fidelity judge. An `extension` beat
 * says what follows from the paper for the reader — implications only,
 * checked by the reach judge to follow from the passages and to bring in
 * nothing from outside. A `context` beat is the author's own context: what
 * they know about the world around the work — where the problem turns up in
 * practice, why a reader should care — written under their byline as their
 * own view. It may say what the paper does not; it may never present that
 * as the paper's finding, which the context judge checks, and every
 * specific it brings in is listed for the author to verify before the story
 * can be published. Beats of the last two kinds together may not outnumber
 * paper beats: an article that is mostly not the paper is no longer about
 * the paper. Without a brief there is nothing to answer, and every beat is
 * a paper beat.
 *
 * ── The brief is answered, not silently trimmed ─────────────────────────────
 * The outline records how far the brief was met. With the author's own
 * context available, little is out of reach; what is — a request contrary to
 * what the paper found, or unfit for the reader — the plan says so in a
 * sentence the scholar reads before a word is drafted. A brief that is
 * quietly dropped is the failure this guards.
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

const BEAT_KIND = { PAPER: "paper", EXTENSION: "extension", CONTEXT: "context" };

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
          kind: { type: "STRING", enum: ["paper", "extension", "context"] },
          passage_ids: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["heading", "goal", "kind", "passage_ids"],
      },
    },
    /* The brief, split into what it asks for, each mapped to the kind of
       section that answers it and that section's heading. The parser holds
       the beats to this map; a plan that says an ask needs the author's own
       context and then plans no such section is corrected or reported. */
    brief_map: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          ask: { type: "STRING" },
          answered_by: { type: "STRING", enum: ["paper", "extension", "context"] },
          section: { type: "STRING" },
        },
        required: ["ask", "answered_by", "section"],
      },
      nullable: true,
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
  required: ["title", "deck", "beats", "brief_map", "brief_coverage"],
};

function buildOutlinePrompt({ scholar = {}, source = {}, passages, truncated = false, audience, brief = null, voice = composer.DEFAULT_VOICE }) {
  const aud = composer.AUDIENCES[composer.normaliseAudience(audience)];
  const name = scholar.name || "the scholar";
  const authorVoice = composer.normaliseVoice(voice) === composer.VOICE.AUTHOR;
  const briefText = brief ? String(brief).trim() : "";
  const by = authorVoice ? "" : `, by ${name}`;
  return [
    briefText
      ? `Plan an article that answers the scholar's brief below, with the paper as its evidence${by}, for ${aud.brief}`
      : `Plan an article about the paper below${by}, for ${aud.brief}`,
    ...(authorVoice
      ? [
          "",
          `The article is the author's own account of their own work, published under their byline. Nothing in it`,
          `refers to them: no "${name}", no "the author", no "he" or "she". Headings and goals name the work, not`,
          `the worker — "A mixed window", not "${String(name).split(" ").pop()}'s mixed window".`,
        ]
      : []),
    ...(briefText
      ? [
          "",
          `The scholar's brief for this article: "${briefText}"`,
          "",
          "Work from the brief, not from the paper's table of contents:",
          "1. Split the brief into the things it asks for, and put them in brief_map: for each, the ask in a few words,",
          '   the kind of section that answers it ("paper", "extension" or "context"), and that section\'s heading. What',
          "   the paper states answers a paper ask. What follows from the paper answers an extension ask. What the world",
          "   is like — where the problem turns up today, who meets it, how the work helps them, how it sits beside other",
          "   approaches — answers a context ask: the author's own knowledge, which the paper does not have to state.",
          "2. Plan the sections so that every heading in brief_map is a section of the kind named there, in the order a",
          "   reader needs to follow the answer. Cite the paper's passages where they carry a point; leave out what the",
          "   paper says that the brief does not need. The title and deck say what the article answers.",
          "A plan whose sections follow the paper's own order — the problem, earlier methods, the method, the tests, the",
          "results — with no section of the kind an ask needs is a retelling of the paper. It is wrong for a brief, and",
          "the scholar will send it back.",
          "",
          "Three kinds of section:",
          '- "paper": makes its point with what the paper states. Its goal is the point, made from the passages it cites.',
          '- "extension": says what follows from the paper for the reader — why a finding matters, where the same problem',
          "  turns up — drawn only from the paper, as implication. Its goal says what follows from the passages it names.",
          '- "context": the author\'s own context — what they know about the world around the work that the paper does not',
          "  say: what the problem looks like in practice today, where the work would matter and to whom, how it sits",
          "  beside other approaches, what a reader needs before the paper makes sense. Said as the author's own view under",
          "  their byline, never as the paper's finding; every specific it brings in is listed for the author to verify",
          "  before publication. Its passage_ids name the passages the context relates to, so the writer keeps it tied to",
          "  the work. Plan a context section when the brief asks about the world beyond the paper; plan context a",
          "  careful author could stand behind.",
          "A brief that asks why the work matters, what it means for readers, where it is used or how it helps today has",
          "at least one extension or context ask. It is ANSWERED by planning the section that ask needs; the paper does",
          "not have to discuss society, industry or practice for you to plan it, and a plan of paper sections alone",
          "does not answer it.",
          'Reserve brief_coverage "part" or "none" for what neither an implication nor the author\'s own context can',
          "answer: a request contrary to what the paper found, or content unfit for the reader.",
        ]
      : ["", "No brief was given: every section is a paper section, and brief_coverage is null."]),
    "",
    "Return:",
    "- title: under 12 words, specific to " + (briefText ? "the article's answer" : "what the paper found") + ", no colon-and-subtitle pattern.",
    "- deck: one or two sentences saying what the article says. No claims about impact the paper does not make.",
    `- beats: ${OUTLINE.MIN_BEATS} to ${OUTLINE.MAX_BEATS} sections in reading order. Each has a short heading; a goal, which is the point the`,
    "  section makes, stated as one sentence a reader could disagree with, not a description of the section;",
    '  kind, "paper", "extension" or "context"; and passage_ids: the passages (by their [pN] label) the section will',
    "  draw on, build on, or relate to. Every beat must cite at least one passage. At least half the sections must be",
    "  paper sections.",
    briefText
      ? "  Open with the point from the paper that bears most on the brief. A paper section on what the paper says is"
      : "  Open with what the paper found. A paper section on what the paper says is",
    "  unknown or next belongs where the paper says it; an extension or context section may close the article.",
    ...(briefText
      ? [
          '- brief_coverage: met is "full" when the sections do what the brief asked, "part" when some of it is left',
          '  out, "none" when none of it could be answered; note is one sentence naming what was left out and why,',
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
 * @param {boolean} [opts.allowExtension]  false without a brief: a beat marked extension or context is planned as paper
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
  const beyondKinds = new Set([BEAT_KIND.EXTENSION, BEAT_KIND.CONTEXT]);
  /* The model's own account of what the brief asks and what answers each
     ask. A beat the map names as beyond the paper is beyond the paper,
     whatever kind the beat itself was given: the map is the decision, the
     beat's kind is the slip. */
  const briefMap = allowExtension && Array.isArray(data.brief_map)
    ? data.brief_map
        .map((m) => ({ ask: clean(m?.ask).slice(0, 160), kind: beyondKinds.has(m?.answered_by) ? m.answered_by : BEAT_KIND.PAPER, section: clean(m?.section).slice(0, 140) }))
        .filter((m) => m.ask)
        .slice(0, 8)
    : [];
  const key = (s) => clean(s).toLowerCase();
  const mappedKind = (heading) => briefMap.find((m) => m.kind !== BEAT_KIND.PAPER && m.section && key(m.section) === key(heading))?.kind || null;
  const all = data.beats
    .slice(0, OUTLINE.MAX_BEATS)
    .map((b) => ({
      heading: clean(b?.heading),
      goal: clean(b?.goal) || "",
      kind: allowExtension ? (mappedKind(b?.heading) || (beyondKinds.has(b?.kind) ? b.kind : BEAT_KIND.PAPER)) : BEAT_KIND.PAPER,
      passageIds: (Array.isArray(b?.passage_ids) ? b.passage_ids : []).map(String).filter((id) => known.has(id)),
    }))
    /* A beat that cites nothing we gave it would be drafted from nothing. */
    .filter((b) => b.passageIds.length > 0);

  /* The budget: no more beats beyond the paper than beats drawn from it.
     Extras are cut from the end, and the cut is counted so the run can say so. */
  const paper = all.filter((b) => b.kind === BEAT_KIND.PAPER).length;
  let allowed = paper;
  let dropped = 0;
  const beats = all
    .filter((b) => {
      if (b.kind === BEAT_KIND.PAPER) return true;
      if (allowed > 0) { allowed -= 1; return true; }
      dropped += 1;
      return false;
    })
    .map((b, i) => ({ index: i + 1, heading: b.heading || `Section ${i + 1}`, goal: b.goal, kind: b.kind, passageIds: b.passageIds }));

  if (beats.length < 2) {
    throw new Error("The outline cites too few passages to draft from.");
  }
  const c = data.brief_coverage;
  let coverage = allowExtension && c && typeof c === "object" && Object.values(COVERAGE).includes(c.met)
    ? { met: c.met, note: clean(c.note).slice(0, 300) }
    : null;
  /* An ask the map says needs a section beyond the paper, with no such
     section planned, is not answered — whatever the model wrote in
     brief_coverage. Said out loud, so the scholar sees it before a word is
     drafted and can send the plan back. */
  const unmet = briefMap.filter((m) => m.kind !== BEAT_KIND.PAPER && !beats.some((b) => b.kind === m.kind && key(b.heading) === key(m.section)));
  if (unmet.length && (!coverage || coverage.met === COVERAGE.FULL)) {
    coverage = { met: COVERAGE.PART, note: `Not planned: ${unmet.map((m) => m.ask).join("; ")}.` };
  }
  return {
    title: clean(data.title).slice(0, composer.LIMITS.MAX_TITLE_CHARS),
    deck: clean(data.deck).slice(0, composer.LIMITS.MAX_DECK_CHARS),
    beats,
    coverage,
    briefMap: briefMap.length ? briefMap : null,
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

/**
 * How the prose should move, for the reader it is for.
 *
 * Measured across seven drafts before this existed: mean sentence 12.6
 * words, a fifth of them eight words or shorter, one in seventy longer than
 * twenty-five. Every sentence the same length is a drone, and the only
 * instruction the pipeline ever gave about sentences fired when a draft was
 * too hard and said "shorten". Nothing asked for variety.
 *
 * Rhythm is not content: joining two sentences says what the two said.
 */
function rhythmFor(aud) {
  if (aud.grade <= 4) {
    return [
      "Rhythm: short sentences, one idea in each. Vary them a little so the page does not drone — a few of ten or",
      "twelve words among the short ones. Do not start three sentences in a row with the same word.",
    ];
  }
  if (aud.grade <= 7) {
    return [
      "Rhythm: around fourteen words on average. Join two short sentences where one idea leads to the other, and keep",
      "the short ones for the points that matter. Do not start three sentences in a row with the same word.",
    ];
  }
  return [
    "Rhythm: around eighteen words on average, and varied — at least one sentence per paragraph noticeably longer,",
    'carrying a clause ("which…", "because…", "while…"), and short ones where a point lands. A paragraph of sentences',
    "all the same length reads as a list. Do not start three sentences in a row with the same word, and do not open",
    'more than one paragraph in this section with "This".',
  ];
}

function buildSectionPrompt({ scholar = {}, beat, passages, outline, audience, brief = null, strictVoice = false, strictSelf = false, readabilityNote = null, fidelityNote = null, reachNote = null, contextNote = null, voice = composer.DEFAULT_VOICE, previously = null }) {
  const aud = composer.AUDIENCES[composer.normaliseAudience(audience)];
  const name = scholar.name || "the scholar";
  const authorVoice = composer.normaliseVoice(voice) === composer.VOICE.AUTHOR;
  const cited = passages.filter((p) => beat.passageIds.includes(p.id));
  const kind = beat.kind === BEAT_KIND.EXTENSION || beat.kind === BEAT_KIND.CONTEXT ? beat.kind : BEAT_KIND.PAPER;
  const briefText = brief ? String(brief).trim() : "";
  const lines = [
    authorVoice
      ? `Write section ${beat.index} of ${outline.beats.length} of an article, for ${aud.brief}`
      : `Write section ${beat.index} of ${outline.beats.length} of an article about a paper by ${name}, for ${aud.brief}`,
    ...(authorVoice
      ? ["", `This is the author's own account of their own work. Never refer to them: no "${name}", no "the author", no "he" or "she". The work is the subject of your sentences.`]
      : []),
    "",
    `Article title: ${outline.title}`,
    ...(briefText ? [`The scholar's brief for the whole article: "${briefText}"`, "This section serves that brief. Make its point; do not summarise the paper."] : []),
    `This section's heading: ${beat.heading}`,
    `This section's goal: ${beat.goal}`,
    `Section kind: ${kind}`,
    "",
  ];
  if (kind === BEAT_KIND.EXTENSION) {
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
  } else if (kind === BEAT_KIND.CONTEXT) {
    lines.push(
      "This section is the author's own context, under their byline: what they know about the world around this",
      "work that the paper does not say — where the problem turns up in practice, who meets it, why a reader should",
      "care, how the work sits beside what else is done. It is their view, and it may say what the paper does not.",
      "Return 1 to 3 paragraphs, 60 to 180 words each. For every paragraph list passage_ids: the passages below it",
      "relates to (an empty list if none). Quote: null.",
      "Rules:",
      "- Say it as the author's knowledge, never as the paper's finding. Nothing the passages do not state may be",
      '  introduced with "the paper shows", "the study found", "the results prove" or the like. Tie context to the',
      '  work the other way round: "The gain with two interferers is the situation a receiver in a crowded band meets."',
      "- Be concrete where you are confident: name the settings, systems and practices a reader would recognise.",
      "  Prefer durable general facts to precise figures. Every specific — a number, a named study, product, company,",
      "  standard, date or place — will be listed for the author to verify before publication, so include one only",
      "  where it earns its place, and none you are unsure of.",
      "- Keep to what serves the brief. No praise of the work; the reader decides what it is worth.",
      ...(aud.young ? ["- The reader is a child: nothing frightening, and nothing that assumes a world beyond theirs."] : []),
      "Do not repeat the heading. Do not summarise the paper; write this section only.",
    );
  } else {
    lines.push(
      "Return 1 to 3 paragraphs, 60 to 180 words each. For every paragraph list passage_ids: the passages below",
      "that every fact in it comes from. A paragraph may cite only passages shown here. Optionally one quote:",
      "a sentence copied exactly from one passage, with its passage_id; otherwise null.",
      "Write toward the section's goal: make its point with what the passages state, in the order the point needs,",
      "not the order the passages come in. Leave out what the passages say that the point does not need.",
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
  if (contextNote) {
    lines.push("", contextNote);
  }
  lines.push("", ...rhythmFor(aud));

  /* Each section is written by its own call, so without this one it knows
     nothing of the others: measured before it existed, 2 of 84 paragraphs
     opened with anything joining them to what came before, and terms were
     explained again in later sections. What is passed is text already
     written and already judged, never new material. */
  if (previously && (previously.headings?.length || previously.lastSentence)) {
    lines.push(
      "",
      "WHAT THE READER HAS ALREADY BEEN TOLD — do not explain any of it a second time, and do not repeat these points:",
      ...(previously.headings?.length ? [`Sections already written: ${previously.headings.join(" · ")}`] : []),
      ...(previously.terms?.length ? [`Terms already introduced and defined: ${previously.terms.join(", ")}. Use them plainly from here.`] : []),
      ...(previously.lastSentence ? [`The sentence immediately before this section: “${previously.lastSentence}”`, "Open in a way that follows from it. Do not restate it."] : []),
      /* Per-section instructions did not move this: measured after adding
         them, one article still opened 33 of its 117 sentences with "This",
         because each call only ever saw its own two or three paragraphs.
         What is already used has to be named across the whole article. */
      ...(previously.openers?.length
        ? [
            `Words that already open sentences elsewhere in this article: ${previously.openers.map((o) => `“${o.word}” ${o.n}×`).join(", ")}.`,
            `Do not begin any sentence in this section with ${previously.openers.slice(0, 3).map((o) => `“${o.word}”`).join(" or ")}. Begin with the subject you are talking about, or with a word that joins this to what came before — “But”, “So”, “Because”, “Once”, “Where”.`,
          ]
        : []),
    );
  }

  lines.push("", kind === BEAT_KIND.CONTEXT ? "=== PASSAGES THIS SECTION RELATES TO ===" : "=== PASSAGES THIS SECTION MAY USE ===", renderPassages(cited), "=== END ===");
  return lines.join("\n");
}

/**
 * One section, checked. Returns blocks (paragraph / quote) each with
 * `sourceRefs` — and `extension: true` on a paragraph that draws an
 * implication, in an extension beat; in a context beat, paragraphs are the
 * author's own (`ownView`) with a `context` record naming the passages they
 * relate to, and no `sourceRefs` — plus the first-person sentences found.
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
  const contextBeat = beat.kind === BEAT_KIND.CONTEXT;
  const authorVoice = composer.normaliseVoice(voice) === composer.VOICE.AUTHOR;
  const blocks = [];
  const violations = [];
  const selfReferences = [];
  const warnings = [];

  for (const para of data.paragraphs.slice(0, 3)) {
    const text = clean(para?.text);
    if (!text) continue;
    const refs = (Array.isArray(para?.passage_ids) ? para.passage_ids : []).map(String).filter((id) => allowed.has(id));
    if (refs.length === 0 && !contextBeat) {
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
    if (contextBeat) {
      /* The author's own: no citation, by design; the passages it relates to
         go to the context judge, not onto a chip. */
      blocks.push({ type: "paragraph", html: escapeHtml(text), ownView: true, context: { anchorIds: refs } });
      continue;
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
    /* `headingEdited` rides along so the drafter knows whose words these are;
       it is not stored on the story. */
    bodyBlocks.push({ type: "subheading", html: escapeHtml(beat.heading), sourceRefs: [], ...(beat.headingEdited ? { headingEdited: true } : {}) });
    bodyBlocks.push(...section.blocks);
  }
  const prose = bodyBlocks
    .filter((b) => b.type === "paragraph")
    .map((b) => unescapeHtml(b.html))
    .join("\n\n");
  const words = bodyBlocks.reduce((n, b) => n + (b.type === "subheading" ? 0 : unescapeHtml(b.html).split(/\s+/).filter(Boolean).length), 0);
  return { bodyBlocks, prose, words };
}

/** The same shape as `assemble`, from a block list already built — used when
    a heading has been repaired or removed and the counts must follow. */
function assembleFrom(bodyBlocks) {
  const prose = bodyBlocks
    .filter((b) => b.type === "paragraph")
    .map((b) => unescapeHtml(b.html))
    .join("\n\n");
  const words = bodyBlocks.reduce((n, b) => n + (b.type === "subheading" ? 0 : unescapeHtml(b.html).split(/\s+/).filter(Boolean).length), 0);
  /* The marker is for the drafter, not the story. */
  return { bodyBlocks: bodyBlocks.map(({ headingEdited: _e, ...b }) => b), prose, words };
}

/**
 * The technical terms a draft has already introduced, so a later section
 * does not stop to explain them again.
 *
 * Acronyms, and the expansion beside one — "Spectral Domain Sparse
 * Representation (SDSR)" yields both. A heuristic feeding a prompt hint, so
 * a miss costs nothing and a false one costs a term used plainly, which is
 * what should happen the second time anyway.
 */
function termsIntroduced(blocks) {
  const out = new Set();
  for (const b of blocks || []) {
    if (b.type !== "paragraph" && b.type !== "quote") continue;
    const text = unescapeHtml(String(b.html || "")).replace(/<[^>]+>/g, " ");
    for (const m of text.matchAll(/\b([A-Z][A-Za-z]*(?:[ -][A-Z][A-Za-z]*){0,4})\s*\(([A-Z]{2,6})\)/g)) {
      out.add(`${m[1]} (${m[2]})`);
    }
    for (const m of text.matchAll(/(?<![A-Za-z])([A-Z]{2,6})(?![A-Za-z])/g)) {
      if (!/^(?:A|I|THE|AND|OR|IT|IS)$/.test(m[1])) out.add(m[1]);
    }
  }
  /* The expansion supersedes the bare acronym it contains. */
  const full = [...out].filter((t) => t.includes("("));
  return [...out].filter((t) => t.includes("(") || !full.some((f) => f.includes(`(${t})`))).slice(0, 12);
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
  rhythmFor,
  termsIntroduced,
  buildOutlinePrompt,
  parseOutline,
  buildSectionPrompt,
  parseSection,
  assemble,
  assembleFrom,
};
