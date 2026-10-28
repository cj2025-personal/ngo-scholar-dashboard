/**
 * The story agent, wired to stories: ask, propose, accept or reject.
 *
 * ── The contract with the scholar ──────────────────────────────────────────
 * An instruction produces a PROPOSAL, stored as a turn: what was asked, what
 * the agent did (tool by tool), the resulting blocks, and the checks on what
 * it wrote — the fact-checker's verdict on every paragraph it changed, the
 * reading level, and anything it refused. The stored story does not change.
 * Accepting applies the proposal through the same path a hand edit takes;
 * rejecting discards it and deletes any illustration it generated. A
 * proposal made against a story that has since changed is refused rather
 * than applied to text the scholar no longer has.
 *
 * ── What the agent is given ─────────────────────────────────────────────────
 * The story's blocks with their citations, the passages of the paper it was
 * drawn from (the same numbering the chips use), and the last few turns so
 * "no, shorter" means something. A story with no source paper can still be
 * edited, but the agent can then only write the scholar's own view.
 */

const { ObjectId } = require("mongodb");

const { COLLECTIONS, getCollections } = require("../db/mongo");
const { ApiError } = require("../lib/api-error");
const storyVersion = require("../lib/storyVersion");
const { serializeMongoValue } = require("../lib/serialize");
const composer = require("../lib/draftComposer");
const plan = require("../lib/draftPlan");
const fidelity = require("../lib/fidelity");
const reach = require("../lib/reach");
const checksLib = require("../lib/checks");
const { caveatsFor } = require("./agentRulings.service");
const { assessDraftReadability, placeReadability, VERDICT } = require("../lib/draftReadability");
const bandJudge = require("../lib/agents/bandJudge");
const agent = require("../lib/storyAgent");
const imageGen = require("../lib/imageGen");
const vertex = require("../lib/vertex");
const editorial = require("./editorial.service");
const { getPolicy } = require("./policy.service");
const { routerFor } = require("./models.service");
const { searcherFor } = require("./readerIndex.service");

const TURN_STATUS = { PROPOSED: "proposed", ACCEPTED: "accepted", REJECTED: "rejected" };

const { passagesFor } = require("./passages.service");

function serializeBlock(b) {
  if (b.type === "image") {
    return { type: "image", imageId: b.imageId || null, url: b.url || null, caption: b.caption || "", alt: b.alt || "", width: b.width || "body", generated: Boolean(b.generated), changed: Boolean(b.changed) };
  }
  return {
    type: b.type, html: b.html,
    sourceRefs: Array.isArray(b.sourceRefs) ? b.sourceRefs : [],
    draftedText: b.draftedText || "",
    fidelity: b.fidelity || null,
    ownView: Boolean(b.ownView),
    ...(b.ownView && b.context ? { context: b.context } : {}),
    ...(b.extension ? { extension: true, reach: b.reach || null } : {}),
    changed: Boolean(b.changed),
  };
}

function viewTurn(doc, { withProposal = true } = {}) {
  return serializeMongoValue({
    id: doc._id,
    storyId: doc.story_id,
    instruction: doc.instruction,
    summary: doc.summary,
    status: doc.status,
    changes: doc.changes || [],
    calls: (doc.calls || []).map((c) => ({ name: c.name, result: c.result })),
    checks: doc.checks || null,
    warnings: doc.warnings || [],
    createdAt: doc.created_at,
    resolvedAt: doc.resolved_at || null,
    ...(withProposal && doc.status === TURN_STATUS.PROPOSED ? { proposal: doc.proposal } : {}),
  });
}

/* What each tool is, said as the step under way. The page shows these while
   the turn runs, and draws Kivyn doing the same thing. */
const TOOL_STEPS = {
  search_passages: "Searching the paper",
  replace_block: "Rewriting a block",
  insert_block: "Writing a new block",
  delete_block: "Removing a block",
  move_block: "Moving a block",
  set_heading_fields: "Changing the heading",
  add_image: "Planning an illustration",
  finish: "Summing up what changed",
};

/** A tool's result, short enough to show as it lands: a search says how much it found, never the passages. */
function stepDetail(tool, result) {
  const text = String(result || "");
  if (tool === "search_passages") {
    const found = (text.match(/^\[[^\]]+\]/gm) || []).length;
    return found ? `${found} passage${found === 1 ? "" : "s"} close to it` : "nothing close to it in the paper";
  }
  const said = text.replace(/^(ok|refused):\s*/, "");
  return said.length > 160 ? `${said.slice(0, 159).trim()}…` : said;
}

/**
 * What an account's edit turns have cost since midnight UTC: the usage each
 * stored turn recorded, summed. Nothing is counted twice and nothing is kept
 * apart from the turns themselves, so the figure is exactly what the record
 * says was spent.
 * @returns {Promise<{tokens: number, turns: number}>}
 */
async function spentToday(db, { profileId, now = new Date() }) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [row] = await db.collection(COLLECTIONS.storyTurns).aggregate([
    { $match: { profile_id: profileId, created_at: { $gte: start } } },
    { $group: { _id: null, input: { $sum: "$usage.input" }, output: { $sum: "$usage.output" }, turns: { $sum: 1 } } },
  ]).toArray();
  return { tokens: (row?.input || 0) + (row?.output || 0), turns: row?.turns || 0 };
}

/**
 * The day's budget, from the studio policy, checked before the first model
 * call: a turn that reaches the model costs what it costs. Near the budget,
 * one log line per turn says so, which is what an alert reads.
 */
async function assertEditBudget(db, { profileId, studio, now = new Date() }) {
  const budget = studio.budget?.edit;
  if (!budget || !(budget.tokensPerDay > 0)) return;
  const spent = await spentToday(db, { profileId, now });
  if (spent.tokens >= budget.tokensPerDay) {
    console.warn(`[studio-budget] profile ${profileId} over the day's edit budget: ${spent.tokens} of ${budget.tokensPerDay} tokens in ${spent.turns} turns`);
    throw new ApiError(429, "Kivyn has used today's budget on your stories. It can take instructions again tomorrow; the draft and every proposal are kept.");
  }
  if (spent.tokens >= budget.tokensPerDay * (budget.warnAt || 1)) {
    console.warn(`[studio-budget] profile ${profileId} near the day's edit budget: ${spent.tokens} of ${budget.tokensPerDay} tokens in ${spent.turns} turns`);
  }
}

/**
 * @param {object} p
 * @param {(e:{step:string, message?:string, tool?:string, refused?:boolean, detail?:string})=>Promise<void>} [p.onProgress]
 *        the turn as it happens, each step said before it is done: reading,
 *        the agent's own tool calls and what each found, then the checks.
 */
async function askStoryAgent({ storyId, scholarId, profileId, user, instruction, requestKey = null, signal = null, onProgress = async () => {} }) {
  if (!vertex.isConfigured()) throw new ApiError(503, `The story agent is not available on this deployment. ${vertex.describeMissingConfig()}`);
  /* The turn stops when the scholar goes or the route's deadline passes:
     every model call carries the signal, and the loop and the checks look
     at it between calls. Nothing is stored for a stopped turn, because a
     proposal half-checked is not one the scholar can accept. */
  const withSignal = (fn) => (signal ? (req) => fn({ ...req, signal }) : fn);
  const stopped = () => { if (signal?.aborted) throw agent.abortError(signal); };

  const { db } = await getCollections();
  const storyDoc = await editorial.findOwnedStory({ storyId, scholarId, profileId });
  await onProgress({ step: "read_draft", message: "Reading the draft and the paper" });
  const mapped = editorial.mapStoryDocument(storyDoc, null, null);
  const passages = await passagesFor(db, storyDoc);
  const turns = db.collection(COLLECTIONS.storyTurns);

  /* The same ask again — a double tap, a request the page retried after the
     stream dropped — is the turn already made, not a second run and a
     second bill. The key is the page's, one per ask; the index below makes
     two runs racing on one key end as one turn. */
  if (requestKey) {
    const made = await turns.findOne({ story_id: storyDoc._id, request_key: requestKey });
    if (made) return { turn: viewTurn(made), repeated: true };
  }

  const studio = await getPolicy("studio", { db });
  await assertEditBudget(db, { profileId, studio });
  const prior = await turns.find({ story_id: storyDoc._id }).sort({ created_at: -1 }).limit(studio.edit.historyTurns).toArray();
  const history = prior.reverse().flatMap((t) => [{ role: "user", text: t.instruction }, { role: "model", text: t.summary || "" }]);

  const byId = new Map(passages.map((p) => [p.id, p]));
  const isVerbatim = (text, id) => byId.has(id) && composer.isVerbatim(text, byId.get(id).text);
  const modelCalls = [];
  const router = await routerFor({ db, collect: modelCalls });
  const generate = withSignal(router.bound("studio.edit"));
  const reader = await getPolicy("reader", { db });
  /* The paper, searchable by meaning, built once per story version. */
  const search = searcherFor({ db, router, key: { story_id: storyDoc._id, story_version: mapped.version, audience: "workspace" }, blocks: [], passages, topK: studio.edit.searchTopK, cacheDays: reader.index.cacheDays, signal });
  const audience = storyDoc.provenance?.audience || "general";
  const startedAt = new Date();

  const stateBefore = agent.stateFromStory(mapped);
  /* The agent edits in whatever voice the article was drafted in, and needs
     the scholar's name to know which name it must not write. */
  const voice = composer.normaliseVoice(storyDoc.provenance?.voice || composer.VOICE.ABOUT);
  const author = await editorial.resolveStoryAuthor(db, storyDoc.profile_id);
  const result = await agent.runStoryAgent({
    state: stateBefore, passages, instruction, history, audience, voice, scholarName: author?.name || null, generate,
    judgeVoice: withSignal(router.bound("drafting.voice")), imagesAllowed: imageGen.isConfigured(), isVerbatim, search, limits: studio.edit, signal,
    onProgress: async (e) => {
      if (e.phase === "think") await onProgress({ step: "think", message: e.round === 1 ? "Deciding what to change" : "Deciding what to do next" });
      else if (e.phase === "start") await onProgress({ step: "tool", tool: e.tool, message: TOOL_STEPS[e.tool] || "Working" });
      else if (e.phase === "done") await onProgress({ step: "tool_done", tool: e.tool, refused: /^refused/.test(String(e.result || "")), detail: stepDetail(e.tool, e.result) });
    },
  });

  /* Check what the agent wrote, and only that: paragraphs drawn from the
     paper for fidelity, paragraphs that go beyond it for reach. Each judge
     skips the other's kind. */
  const changed = result.state.blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.changed && b.type === "paragraph" && !b.ownView && b.sourceRefs?.length);
  let judgeCall = null;
  let reachCall = null;
  if (changed.length && passages.length) {
    stopped();
    await onProgress({ step: "check_changes", message: `Checking ${changed.length === 1 ? "the change" : `${changed.length} changed paragraphs`} against the passages` });
    const judged = await fidelity.judgeSection({ blocks: changed.map(({ b }) => b), passages, generate: withSignal(router.bound("drafting.fidelity")) });
    const reached = await reach.judgeSection({ blocks: judged.blocks, passages, audience, generate: withSignal(router.bound("drafting.reach")) });
    reached.blocks.forEach((jb, k) => { result.state.blocks[changed[k].i] = { ...result.state.blocks[changed[k].i], fidelity: jb.fidelity || null, reach: jb.reach || null }; });
    judgeCall = judged.call;
    reachCall = reached.call;
  }

  /* Illustrations: generate, upload as inline images of this story, label.
     Until the proposal is accepted the image belongs to no story, so it is
     served through the proposal's own preview route. */
  const turnId = new ObjectId();
  const newImages = [];
  const assetDocuments = [];
  const imageFailures = [];
  const failedImageIndexes = new Set();
  let imageIndex = 0;
  /* Before any picture is drawn and uploaded: a stopped turn must leave no
     asset that belongs to no proposal. */
  stopped();
  if (result.state.blocks.some((b) => b.type === "image" && b.pending)) await onProgress({ step: "illustrate", message: "Drawing the illustration" });
  for (let i = 0; i < result.state.blocks.length; i += 1) {
    const b = result.state.blocks[i];
    if (b.type !== "image" || !b.pending) continue;
    imageIndex += 1;
    /* An illustration that cannot be made must not cost the scholar the rest
       of the turn: the text edits the agent made alongside it are good work.
       The picture is dropped from the proposal and said out loud instead. */
    let made;
    try {
      made = await imageGen.generateImage({ description: b.pending.description });
    } catch (error) {
      console.warn("[story-agent] illustration could not be generated:", error.message);
      imageFailures.push(b.pending.description);
      failedImageIndexes.add(i);
      continue;
    }
    const uploaded = await editorial.uploadBufferToCloudStorage({
      scholarId, profileId, storyId: storyDoc._id, storySlug: storyDoc.slug, kind: "inline",
      uploadKey: `agent-${Date.now()}-${imageIndex}`,
      file: { buffer: made.buffer, mimetype: made.mimeType, originalname: `illustration-${imageIndex}.${made.mimeType === "image/jpeg" ? "jpg" : "png"}`, size: made.buffer.length },
      user,
    });
    newImages.push(uploaded.storyImage);
    assetDocuments.push(uploaded.assetDocument);
    const caption = b.pending.caption && /^illustration/i.test(b.pending.caption) ? b.pending.caption : `Illustration: ${b.pending.caption || b.pending.description}`;
    result.state.blocks[i] = {
      key: b.key, type: "image", imageId: String(uploaded.storyImage.file_id),
      url: `/api/editorial-stories/${storyDoc._id}/agent/turns/${turnId}/images/${uploaded.storyImage.file_id}`,
      caption, alt: b.pending.alt || b.pending.description, width: "body", generated: true, changed: true, model: made.model, description: b.pending.description,
    };
  }
  if (failedImageIndexes.size) {
    /* The picture is gone from the proposal, so it must be gone from the diff
       the scholar reads too, and the blocks after it renumbered. */
    result.state.blocks = result.state.blocks.filter((_, i) => !failedImageIndexes.has(i));
    result.changes = agent.diffStates(stateBefore, result.state);
  }
  if (assetDocuments.length) await editorial.insertAssetDocuments(db.collection(COLLECTIONS.editorialImageAssets), assetDocuments);

  /* Reading level over the whole draft as it would be. */
  const prose = result.state.blocks.filter((b) => b.type === "paragraph").map((b) => agent.plain(b.html)).join("\n\n");
  /* An editor model reads the draft as it would be, for its reader; the formula's grade is evidence and display. */
  let readability = null;
  if (prose) {
    await onProgress({ step: "check_reading_level", message: "Reading it as its reader would" });
    const measured = assessDraftReadability({ text: prose, audience });
    const ruling = await bandJudge.judgeBand({ text: prose, audience, measured, generate: withSignal(router.bound("drafting.band")) });
    readability = placeReadability(measured, ruling);
  }

  const paperChanged = changed.filter(({ i }) => !result.state.blocks[i].extension);
  const reachChanged = changed.filter(({ i }) => result.state.blocks[i].extension);
  const verdicts = paperChanged.map(({ i }) => result.state.blocks[i].fidelity?.verdict || null);
  const reachVerdicts = reachChanged.map(({ i }) => result.state.blocks[i].reach?.verdict || null);
  const checks = {
    paragraphsChanged: paperChanged.length,
    supported: verdicts.filter((v) => v === "supported").length,
    partial: verdicts.filter((v) => v === "partial").length,
    unsupported: verdicts.filter((v) => v === "unsupported").length,
    /* Paragraphs that go beyond the paper, judged for reach rather than fidelity. */
    extensionsChanged: reachChanged.length,
    follows: reachVerdicts.filter((v) => v === "follows").length,
    reachPartial: reachVerdicts.filter((v) => v === "partial").length,
    overreach: reachVerdicts.filter((v) => v === "overreach").length,
    worldClaims: checksLib.worldClaims({ blocks: reachChanged.map(({ i }) => result.state.blocks[i]) }),
    readability: readability ? { verdict: readability.verdict, reason: readability.reason || null, fkGrade: readability.fkGrade, targetGrade: readability.targetGrade } : null,
    imagesGenerated: newImages.length,
    imagesFailed: imageFailures.length,
    refused: result.calls.filter((c) => String(c.result).startsWith("refused")).length,
    /* Every number the agent wrote must be in a passage it cited. A rule,
       not a model, because a fluent wrong number is the one that gets past. */
    numbers: checksLib.numericConsistency({ blocks: changed.map(({ b }) => b), passages }),
    /* Whether the article, as it would be, cites any of the paper's own caveats, as the caveat judge found them. */
    limitationsCited: checksLib.limitationsCoverage({ blocks: result.state.blocks, caveats: await caveatsFor(db, passages, { subject: { kind: "story", id: String(storyDoc._id) } }) }).ok,
  };
  const warnings = [];
  if (checks.unsupported) warnings.push(`${checks.unsupported} changed paragraph${checks.unsupported === 1 ? " is" : "s are"} not supported by the paper.`);
  if (checks.partial) warnings.push(`${checks.partial} changed paragraph${checks.partial === 1 ? " is" : "s are"} only partly supported; the claims are marked.`);
  if (checks.overreach) warnings.push(`${checks.overreach} changed paragraph${checks.overreach === 1 ? " goes" : "s go"} beyond what the paper supports.`);
  if (checks.reachPartial) warnings.push(`${checks.reachPartial} changed paragraph${checks.reachPartial === 1 ? " draws" : "s draw"} an implication the paper only partly supports; the claims that go too far are marked.`);
  if (checks.worldClaims && checks.worldClaims.ok === false) {
    warnings.push(`${checks.worldClaims.hits.length === 1 ? "A sentence" : `${checks.worldClaims.hits.length} sentences`} in this change read${checks.worldClaims.hits.length === 1 ? "s" : ""} as a claim about the world rather than an implication: ${checks.worldClaims.hits.map((h) => `"${h.sentence}"`).join("; ")}.`);
  }
  if (checks.numbers && !checks.numbers.ok) {
    warnings.push(
      `${checks.numbers.misses.length === 1 ? "A number" : `${checks.numbers.misses.length} numbers`} in this change ${checks.numbers.misses.length === 1 ? "is" : "are"} not in the passages cited: ` +
      `${checks.numbers.misses.map((m) => `${m.number} (block ${m.block})`).join(", ")}. Check ${checks.numbers.misses.length === 1 ? "it" : "them"} against the paper.`,
    );
  }
  if (imageFailures.length) {
    warnings.push(
      `${imageFailures.length === 1 ? "An illustration" : `${imageFailures.length} illustrations`} could not be generated, so ` +
      `${imageFailures.length === 1 ? "it was" : "they were"} left out. Everything else in this change stands.`,
    );
  }
  if (readability && readability.verdict !== VERDICT.PASS && readability.reason) warnings.push(`After this change the draft ${readability.reason}.`);
  if (!passages.length && changed.length) warnings.push("This story has no source paper on record, so nothing the agent wrote could be checked against one.");

  const now = new Date();
  const doc = {
    _id: turnId,
    story_id: storyDoc._id,
    profile_id: profileId,
    request_key: requestKey,
    story_updated_at: storyDoc.updatedAt || null,
    /* The version the proposal was computed against. Accepting checks it. */
    story_version: storyVersion.versionOf(storyDoc),
    instruction,
    summary: result.summary,
    changes: result.changes,
    calls: result.calls,
    proposal: {
      title: result.state.title, subtitle: result.state.subtitle, excerpt: result.state.excerpt,
      blocks: result.state.blocks.map(serializeBlock),
      newImages,
    },
    checks,
    warnings,
    status: TURN_STATUS.PROPOSED,
    agent_version: result.agentVersion,
    judge_version: fidelity.FIDELITY_VERSION,
    model_requested: vertex.resolveResourceName(),
    models_used: [...new Set(modelCalls.filter((c) => c.ok).map((c) => c.model))],
    usage: [...result.usage, ...(judgeCall?.usage ? [judgeCall.usage] : []), ...(reachCall?.usage ? [reachCall.usage] : [])].reduce(
      (acc, u) => ({ input: acc.input + (u.input || 0), output: acc.output + (u.output || 0) }),
      { input: 0, output: 0 },
    ),
    created_at: now,
    duration_ms: now - startedAt,
    resolved_at: null,
  };
  try {
    await turns.insertOne(doc);
  } catch (error) {
    /* Two runs on one key: the other finished first, and its turn is the
       one the scholar gets. Anything this run made — an illustration — is
       left for the turn's own reject to discard, since it is not referenced. */
    if (error?.code !== 11000 || !requestKey) throw error;
    const made = await turns.findOne({ story_id: storyDoc._id, request_key: requestKey });
    if (!made) throw error;
    return { turn: viewTurn(made), repeated: true };
  }
  return { turn: viewTurn(doc) };
}

async function listStoryTurns({ storyId, scholarId, profileId }) {
  const { db } = await getCollections();
  const storyDoc = await editorial.findOwnedStory({ storyId, scholarId, profileId });
  const rows = await db.collection(COLLECTIONS.storyTurns).find({ story_id: storyDoc._id }).sort({ created_at: -1 }).limit(20).toArray();
  return { turns: rows.map((r) => viewTurn(r)) };
}

async function resolveStoryTurn({ storyId, turnId, scholarId, profileId, user, action }) {
  const { db } = await getCollections();
  const storyDoc = await editorial.findOwnedStory({ storyId, scholarId, profileId });
  if (!ObjectId.isValid(String(turnId))) throw new ApiError(404, "No such proposal.");
  const turns = db.collection(COLLECTIONS.storyTurns);
  const turn = await turns.findOne({ _id: new ObjectId(String(turnId)), story_id: storyDoc._id });
  if (!turn) throw new ApiError(404, "No such proposal.");
  if (turn.status !== TURN_STATUS.PROPOSED) throw new ApiError(409, `That proposal was already ${turn.status}.`);

  const now = new Date();
  if (action === "reject") {
    const ids = (turn.proposal?.newImages || []).map((img) => img.file_id);
    if (ids.length) {
      const assetCollection = db.collection(COLLECTIONS.editorialImageAssets);
      const assets = await editorial.fetchAssetDocumentsByImageIds(assetCollection, ids);
      await editorial.markAssetDocumentsDeleted({ assetCollection, assets, updatedBy: user?.login_email || scholarId });
    }
    await turns.updateOne({ _id: turn._id }, { $set: { status: TURN_STATUS.REJECTED, resolved_at: now } });
    return { turn: viewTurn({ ...turn, status: TURN_STATUS.REJECTED, resolved_at: now }) };
  }

  /* Accept: only onto the story the proposal was made against.
     The version is the authority; the timestamp is kept for older turns that
     were recorded before versions existed. */
  const proposedAgainst = storyVersion.isVersion(turn.story_version) ? turn.story_version : null;
  const nowAt = storyVersion.versionOf(storyDoc);
  if (proposedAgainst !== null && proposedAgainst !== nowAt) {
    throw new ApiError(409, "The story changed after this proposal was made. Ask again so the agent works from the current text.");
  }
  if (proposedAgainst === null) {
    const then = turn.story_updated_at ? new Date(turn.story_updated_at).getTime() : null;
    const current = storyDoc.updatedAt ? new Date(storyDoc.updatedAt).getTime() : null;
    if (then !== null && current !== null && then !== current) {
      throw new ApiError(409, "The story changed after this proposal was made. Ask again so the agent works from the current text.");
    }
  }
  const applied = await editorial.applyStoryRevision({
    storyId, scholarId, profileId, user,
    fields: { title: turn.proposal.title, subtitle: turn.proposal.subtitle, excerpt: turn.proposal.excerpt },
    blocks: turn.proposal.blocks,
    newImages: turn.proposal.newImages || [],
    baseVersion: proposedAgainst,
    turnId: turn._id,
    note: turn.instruction ? String(turn.instruction).slice(0, 200) : null,
  });
  await turns.updateOne({ _id: turn._id }, { $set: { status: TURN_STATUS.ACCEPTED, resolved_at: now } });
  return { turn: viewTurn({ ...turn, status: TURN_STATUS.ACCEPTED, resolved_at: now }, { withProposal: false }), story: applied.story };
}

/** An illustration a proposal generated, before it belongs to any story. */
async function streamProposalImage({ storyId, turnId, fileId, scholarId, profileId, res }) {
  const { db } = await getCollections();
  const storyDoc = await editorial.findOwnedStory({ storyId, scholarId, profileId });
  if (!ObjectId.isValid(String(turnId)) || !ObjectId.isValid(String(fileId))) throw new ApiError(404, "Image not found.");
  const turn = await db.collection(COLLECTIONS.storyTurns).findOne({ _id: new ObjectId(String(turnId)), story_id: storyDoc._id }, { projection: { "proposal.newImages": 1 } });
  const listed = (turn?.proposal?.newImages || []).some((img) => String(img.file_id) === String(fileId));
  if (!listed) throw new ApiError(404, "Image not found.");
  const asset = await db.collection(COLLECTIONS.editorialImageAssets).findOne({ _id: new ObjectId(String(fileId)), status: "active" });
  if (!asset) throw new ApiError(404, "Image not found.");
  await editorial.streamAssetToResponse({ asset, cacheControl: "private, no-store", res });
}

/** The passages of a story's source paper, for the source rail and the reader's Sources toggle. */
async function storyPassages({ storyId, scholarId, profileId }) {
  const { db } = await getCollections();
  const storyDoc = await editorial.findOwnedStory({ storyId, scholarId, profileId });
  return { passages: await passagesFor(db, storyDoc) };
}

async function publicStoryPassages({ slug }) {
  const { db } = await getCollections();
  const { story } = await editorial.getPublishedStoryBySlug(slug);
  const storyDoc = await db.collection(COLLECTIONS.scholarEditorials).findOne({ _id: new ObjectId(String(story.id)) }, { projection: { provenance: 1 } });
  return { passages: await passagesFor(db, storyDoc || {}) };
}

module.exports = { askStoryAgent, listStoryTurns, resolveStoryTurn, streamProposalImage, storyPassages, publicStoryPassages, TURN_STATUS };
