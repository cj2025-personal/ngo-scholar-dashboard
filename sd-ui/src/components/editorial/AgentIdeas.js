"use client";

import { needsAttention } from "./ChecksRail";

/**
 * Ideas: what the agent could do next for this scholar, on this page.
 *
 * Not a menu of features. Each idea is an instruction the scholar could have
 * typed, built from what is in front of them: the paragraphs that need a
 * look, the paragraph they are on, a retraction on the record, the reader
 * the article is for, the paper they picked. Tapping one puts it in the
 * composer, or sends it, as the page decides. Nothing here calls a model.
 */

function plain(html) {
  return String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Ideas for a story that exists: things to change. */
export function reviewIdeas({ blocks = [], context = null, record = null, audience = "adults" }) {
  const out = [];
  const flagged = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.type === "paragraph" && needsAttention(b));
  if (flagged.length) {
    out.push({ group: "Needs a look", text: flagged.length === 1 ? `Rewrite paragraph ${flagged[0].i + 1} so every claim stays within the paper` : `Rewrite the ${flagged.length} paragraphs that need attention so every claim stays within the paper` });
    for (const { i } of flagged.slice(0, 3)) out.push({ group: "Needs a look", text: `Rewrite paragraph ${i + 1} so every claim stays within the paper` });
  }
  if (record?.alerts?.length) out.push({ group: "On the record", text: "Add a short notice at the top saying the paper behind this article has been updated on the record, and what that means for the reader" });
  if (context?.index && context.type === "paragraph") {
    out.push({ group: "The paragraph you are on", text: `Make paragraph ${context.index} plainer for a fifteen-year-old` }, { group: "The paragraph you are on", text: `Shorten paragraph ${context.index} to two sentences` }, { group: "The paragraph you are on", text: `Add an illustration after paragraph ${context.index}` });
  }
  const young = /ages_8|ages_12/.test(String(audience));
  out.push(
    { group: "The whole article", text: "Shorten the opening to two sentences" },
    { group: "The whole article", text: "Add a paragraph about the limitations, citing the paper" },
    { group: "The whole article", text: young ? "Explain every technical term with an example from daily life" : "Define each technical term in the sentence that introduces it" },
    { group: "The whole article", text: "Say what this work means for readers today, as an implication drawn from the paper" },
    { group: "In my own voice", text: "Add my own view at the end: " },
  );
  const headings = blocks.filter((b) => b.type === "subheading" || b.type === "heading").slice(0, 3);
  for (const h of headings) out.push({ group: "By section", text: `Tighten the section “${plain(h.html).replace(/[.?!]+$/, "")}”` });
  return out;
}

/** Ideas before there is a story: what the article could be. */
export function newStoryIdeas({ paper = null }) {
  const out = [];
  if (paper) out.push({ group: "Ask the agent", text: "What could this paper become?", propose: true });
  out.push(
    { group: "Briefs to start from", text: "Explain the key finding and how it was reached, for readers aged 12 to 14" },
    { group: "Briefs to start from", text: "Focus on the limitations: what was not tested, and what that means" },
    { group: "Briefs to start from", text: "Why this work matters today, drawn only from what the paper shows" },
    { group: "Briefs to start from", text: "A short piece on how the experiment was actually done, step by step" },
    { group: "Briefs to start from", text: "The one number in this paper a reader should remember, and why" },
  );
  return out;
}

/**
 * @param {object} p
 * @param {{group:string,text:string,propose?:boolean}[]} p.ideas
 * @param {(idea:{text:string,propose?:boolean})=>void} p.onPick
 * @param {boolean} [p.disabled]
 * @param {string} [p.note]
 */
export default function AgentIdeas({ ideas, onPick, disabled = false, note }) {
  const groups = [...new Set(ideas.map((s) => s.group))];
  return (
    <div className="rc-tab ws-ideas">
      <p className="rc-tab-title">Ideas</p>
      <p className="st-muted rc-tab-note">{note || "Things the agent could do next, made from what is on this page. Tap one to put it in the chat; change it before you send."}</p>
      {groups.map((g) => (
        <div key={g} className="rc-ask-group">
          <p className="rc-ask-group-title">{g}</p>
          <div className="ag-examples rc-examples">
            {ideas.filter((s) => s.group === g).map((s) => (
              <button key={s.text} type="button" className={`ag-example${s.propose ? " is-primary" : ""}`} disabled={disabled} onClick={() => onPick(s)}>{s.text}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
