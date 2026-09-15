"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { chipFor } from "@/lib/provenance";

const BLOCK_TYPE_OPTIONS = [
  { value: "paragraph", label: "Paragraph" },
  { value: "heading", label: "Heading" },
  { value: "subheading", label: "Subheading" },
  { value: "quote", label: "Quote" },
  { value: "image", label: "Image" },
];

const IMAGE_WIDTH_OPTIONS = [
  { value: "body", label: "Body width" },
  { value: "wide", label: "Wide" },
  { value: "full", label: "Full bleed" },
];

let runtimeBlockCounter = 0;
let runtimeUploadCounter = 0;

function getRuntimeBlockId() {
  runtimeBlockCounter += 1;
  return `runtime-block-${runtimeBlockCounter}`;
}

function getRuntimeUploadKey() {
  runtimeUploadCounter += 1;
  return `inline-upload-${runtimeUploadCounter}`;
}

function getEmptyBlock(type = "paragraph", id = getRuntimeBlockId()) {
  if (type === "image") {
    return {
      id,
      type: "image",
      imageId: null,
      imageUrl: "",
      imageFilename: "",
      caption: "",
      alt: "",
      width: "body",
      file: null,
      previewUrl: "",
      uploadKey: "",
    };
  }

  return {
    id,
    type,
    html: "",
  };
}

function normalizeBlock(block, id) {
  if (block?.type === "image") {
    return {
      id,
      type: "image",
      imageId: block.imageId || null,
      imageUrl: block.url || block.imageUrl || "",
      imageFilename: block.filename || block.imageFilename || "",
      caption: block.caption || "",
      alt: block.alt || "",
      width: block.width || "body",
      file: null,
      previewUrl: "",
      uploadKey: "",
    };
  }

  const text = {
    id,
    type: block?.type || "paragraph",
    html: block?.html || "",
  };

  /* Provenance travels with a drafted block: which passages it cites, the
     text it had when drafted, and the fact-checker's verdict. Absent on a
     block the scholar wrote by hand. */
  if (Array.isArray(block?.sourceRefs) && block.sourceRefs.length > 0) {
    text.sourceRefs = block.sourceRefs.map((r) => ({ passageId: String(r?.passageId || "") })).filter((r) => r.passageId);
    text.draftedText = typeof block.draftedText === "string" ? block.draftedText : "";
    text.fidelity = block.fidelity || null;
  }
  /* The rest of a block's class travels too: whether it goes beyond the
     paper and what the reach judge said, whether it still traces, whether it
     is the scholar's own, and the context record behind an own-context
     paragraph. These were dropped here, so the next save put a paragraph
     beyond the paper back as the paper's and an own-view one back as nothing. */
  if (block?.extension) {
    text.extension = true;
    text.reach = block.reach || null;
  }
  if (typeof block?.traceable === "boolean") text.traceable = block.traceable;
  if (block?.ownView) {
    text.ownView = true;
    if (block.context) text.context = block.context;
  }
  return text;
}

/** Chip under a drafted block. Renders nothing for a hand-written one. */
function ProvenanceChip({ block, sourceLabel }) {
  const chip = chipFor(block, sourceLabel);
  if (!chip) return null;
  return (
    <div className="block-chip-row">
      <span
        className={chip.context ? "block-chip is-context" : chip.traceable ? (chip.partial ? "block-chip is-partial" : "block-chip") : "block-chip is-lost"}
        title={chip.title}
      >
        {chip.label}
        {chip.partial ? " · partly supported" : ""}
      </span>
      {chip.partial && chip.unsupportedClaims.length ? (
        <span className="block-chip-note" title={chip.unsupportedClaims.join(" — ")}>
          check: {chip.unsupportedClaims[0]}
          {chip.unsupportedClaims.length > 1 ? ` (+${chip.unsupportedClaims.length - 1})` : ""}
        </span>
      ) : null}
    </div>
  );
}

function getBlockPlaceholder(type) {
  switch (type) {
    case "heading":
      return "Section heading";
    case "subheading":
      return "Supporting line";
    case "quote":
      return "Pull quote or highlighted thought";
    default:
      return "Start writing...";
  }
}

function getTextFromHtml(html) {
  if (typeof document === "undefined") {
    return String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  const container = document.createElement("div");
  container.innerHTML = html || "";
  return (container.textContent || "").replace(/\s+/g, " ").trim();
}

function focusElementById(blockId) {
  if (typeof document === "undefined") {
    return;
  }

  window.requestAnimationFrame(() => {
    const element = document.querySelector(`[data-block-id="${blockId}"]`);

    if (element instanceof HTMLElement) {
      element.focus();
    }
  });
}

export function createInitialBlocks(blocks = [], seed = "block") {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return [getEmptyBlock("paragraph", `${seed}-0`)];
  }

  return blocks.map((block, index) =>
    normalizeBlock(block, `${seed}-${index}`),
  );
}

export function getPlainTextFromBlocks(blocks = []) {
  const html = blocks
    .filter((block) => block.type !== "image")
    .map((block) => String(block.html || ""))
    .join(" ");

  if (typeof document === "undefined") {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  const container = document.createElement("div");
  container.innerHTML = html;
  return (container.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

function execFormattingCommand(command, value) {
  if (typeof document === "undefined") {
    return;
  }

  document.execCommand(command, false, value);
}

/**
 * Inline formatting, shown only while text is selected.
 *
 * The row this replaces was always on screen and always enabled, including
 * with nothing selected — where "Bold" does nothing at all. A control that is
 * visible when it cannot act teaches people to ignore the toolbar.
 *
 * Positioned from the selection's own rectangle, clamped so it cannot sit off
 * the left edge on a selection that starts at the margin.
 */
/* Bubble height plus breathing room. Below this, it goes under the selection. */
const TOOLBAR_CLEARANCE = 46;

function SelectionToolbar({ containerRef, onCommand, onLink }) {
  const [rect, setRect] = useState(null);

  const sync = useCallback(() => {
    const selection = window.getSelection();
    const host = containerRef.current;

    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !host) {
      setRect(null);
      return;
    }

    /* Only for selections inside this editor — a selection in the title or
       anywhere else on the page must not raise it. */
    const range = selection.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer)) {
      setRect(null);
      return;
    }
    if (!String(selection.toString()).trim()) {
      setRect(null);
      return;
    }

    const bounds = range.getBoundingClientRect();
    const hostBounds = host.getBoundingClientRect();
    const top = bounds.top - hostBounds.top;

    /* Flip below when there is no room above. Selecting in the first block
       always lacks it, and the bubble would sit on top of the subtitle. */
    const flip = top < TOOLBAR_CLEARANCE;
    setRect({
      top: flip ? bounds.bottom - hostBounds.top : top,
      left: Math.max(0, bounds.left - hostBounds.left + bounds.width / 2),
      below: flip,
    });
  }, [containerRef]);

  useEffect(() => {
    document.addEventListener("selectionchange", sync);
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      document.removeEventListener("selectionchange", sync);
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [sync]);

  if (!rect) {
    return null;
  }

  const act = (fn) => (event) => {
    /* Keep the selection: losing it on mousedown would make every button a
       no-op, which is the classic way a floating toolbar ships broken. */
    event.preventDefault();
    fn();
    sync();
  };

  return (
    <div
      className={rect.below ? "sel-toolbar is-below" : "sel-toolbar"}
      style={{ top: rect.top, left: rect.left }}
      role="toolbar"
      aria-label="Formatting"
    >
      <button type="button" className="sel-btn" onMouseDown={act(() => onCommand("bold"))} aria-label="Bold"><b>B</b></button>
      <button type="button" className="sel-btn" onMouseDown={act(() => onCommand("italic"))} aria-label="Italic"><i>i</i></button>
      <button type="button" className="sel-btn" onMouseDown={act(() => onCommand("underline"))} aria-label="Underline"><u>U</u></button>
      <button type="button" className="sel-btn" onMouseDown={act(() => onCommand("strikeThrough"))} aria-label="Strikethrough"><s>S</s></button>
      <span className="sel-sep" aria-hidden="true" />
      <button type="button" className="sel-btn" onMouseDown={act(onLink)} aria-label="Add link">Link</button>
      <button type="button" className="sel-btn" onMouseDown={act(() => onCommand("unlink"))} aria-label="Remove link">Unlink</button>
    </div>
  );
}

function EditableTextBlock({
  block,
  isActive,
  onFocus,
  onHtmlChange,
  onKeyDown,
}) {
  const ref = useRef(null);

  useEffect(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    if (element.innerHTML !== (block.html || "")) {
      element.innerHTML = block.html || "";
    }
  }, [block.html]);

  return (
    <div
      ref={ref}
      data-block-id={block.id}
      contentEditable
      suppressContentEditableWarning
      className={
        isActive
          ? `block-editor-surface is-active block-type-${block.type}`
          : `block-editor-surface block-type-${block.type}`
      }
      data-placeholder={getBlockPlaceholder(block.type)}
      onFocus={onFocus}
      onInput={(event) => onHtmlChange(event.currentTarget.innerHTML)}
      onKeyDown={onKeyDown}
    />
  );
}

function ImageBlockCard({ block, onChangeImageFile, onUpdateBlock, onRemoveImageFile }) {
  const imageSource = block.previewUrl || block.imageUrl;

  return (
    <div className={`image-block-card image-width-${block.width}`}>
      <div className="image-block-frame">
        {imageSource ? (
          <img
            src={imageSource}
            alt={block.alt || block.imageFilename || "Story image"}
            className="inline-story-image"
          />
        ) : (
          <div className="inline-image-empty">
            <p>No data to show. Data will appear here once published.</p>
          </div>
        )}
      </div>

      <div className="image-block-tools">
        <label className="upload-button">
          {imageSource ? "Replace image" : "Upload image"}
          <input
            type="file"
            accept="image/*"
            onChange={(event) =>
              onChangeImageFile(block.id, event.target.files?.[0] || null)
            }
            hidden
          />
        </label>

        {imageSource ? (
          <button
            type="button"
            className="ghost-button"
            onClick={() => onRemoveImageFile(block.id)}
          >
            Remove image
          </button>
        ) : null}
      </div>

      <div className="image-block-meta">
        <input
          type="text"
          value={block.caption}
          onChange={(event) =>
            onUpdateBlock(block.id, { caption: event.target.value })
          }
          className="image-meta-input"
          placeholder="Write a caption"
        />
        <input
          type="text"
          value={block.alt}
          onChange={(event) => onUpdateBlock(block.id, { alt: event.target.value })}
          className="image-meta-input"
          placeholder="Alt text"
        />
        <select
          value={block.width}
          onChange={(event) =>
            onUpdateBlock(block.id, { width: event.target.value })
          }
          className="block-type-select"
        >
          {IMAGE_WIDTH_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function coerceBlockType(block, nextType) {
  if (nextType === "image") {
    return {
      id: block.id,
      type: "image",
      imageId: null,
      imageUrl: "",
      imageFilename: "",
      caption: "",
      alt: "",
      width: "body",
      file: null,
      previewUrl: "",
      uploadKey: "",
    };
  }

  return {
    id: block.id,
    type: nextType,
    html: block.type === "image" ? "" : block.html || "",
    /* A paragraph turned into a heading is still the paragraph that was
       drafted; its receipt comes along. */
    ...(block.sourceRefs ? { sourceRefs: block.sourceRefs, draftedText: block.draftedText, fidelity: block.fidelity } : {}),
  };
}

export default function RichTextBlockEditor({
  blocks,
  onChange,
  activeBlockId,
  onActiveBlockChange,
  /** Short label for provenance chips, e.g. "Gupta 2011". */
  sourceLabel = "",
}) {
  const shellRef = useRef(null);
  /* Which block's gutter menu is open. Null is the resting state, which is
     also the state the page loads in. */
  const [menuFor, setMenuFor] = useState(null);

  /* A click anywhere else closes it — a menu that only closes via its own
     button is one people leave open and then fight with. */
  useEffect(() => {
    if (!menuFor) return undefined;
    const close = (event) => {
      if (!event.target.closest?.(".block-menu, .gutter-btn")) setMenuFor(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuFor]);

  const activeBlock = blocks.find((block) => block.id === activeBlockId) || null;
  const activeBlockText =
    activeBlock && activeBlock.type !== "image"
      ? getTextFromHtml(activeBlock.html)
      : "";
  const showSlashMenu =
    Boolean(activeBlock) &&
    activeBlock?.type !== "image" &&
    activeBlockText.startsWith("/");

  function updateBlock(blockId, updates) {
    onChange(
      blocks.map((block) =>
        block.id === blockId ? { ...block, ...updates } : block,
      ),
    );
  }

  function insertBlockAfter(blockId, type = "paragraph") {
    const nextBlock = getEmptyBlock(type);
    const nextBlocks = [];

    for (const block of blocks) {
      nextBlocks.push(block);

      if (block.id === blockId) {
        nextBlocks.push(nextBlock);
      }
    }

    onChange(nextBlocks);
    onActiveBlockChange(nextBlock.id);

    if (type !== "image") {
      focusElementById(nextBlock.id);
    }
  }

  function moveBlock(blockId, direction) {
    const index = blocks.findIndex((block) => block.id === blockId);

    if (index < 0) {
      return;
    }

    const targetIndex = direction === "up" ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= blocks.length) {
      return;
    }

    const nextBlocks = [...blocks];
    const [movedBlock] = nextBlocks.splice(index, 1);
    nextBlocks.splice(targetIndex, 0, movedBlock);
    onChange(nextBlocks);
  }

  function moveBlockToIndex(blockId, targetIndex) {
    const index = blocks.findIndex((block) => block.id === blockId);

    if (index < 0 || targetIndex < 0 || targetIndex >= blocks.length) {
      return;
    }

    const nextBlocks = [...blocks];
    const [movedBlock] = nextBlocks.splice(index, 1);
    nextBlocks.splice(targetIndex, 0, movedBlock);
    onChange(nextBlocks);
  }

  function removeBlock(blockId) {
    if (blocks.length === 1) {
      onChange([getEmptyBlock()]);
      return;
    }

    const block = blocks.find((item) => item.id === blockId);

    if (block?.previewUrl) {
      URL.revokeObjectURL(block.previewUrl);
    }

    const nextBlocks = blocks.filter((item) => item.id !== blockId);
    const fallbackBlock = nextBlocks[0];
    onChange(nextBlocks);

    if (fallbackBlock) {
      onActiveBlockChange(fallbackBlock.id);

      if (fallbackBlock.type !== "image") {
        focusElementById(fallbackBlock.id);
      }
    }
  }

  function handleLink() {
    const url = window.prompt("Enter a URL");

    if (!url) {
      return;
    }

    execFormattingCommand("createLink", url);
  }

  function handleTypeChange(blockId, nextType) {
    onChange(
      blocks.map((block) => {
        if (block.id !== blockId) {
          return block;
        }

        if (block.previewUrl && nextType !== "image") {
          URL.revokeObjectURL(block.previewUrl);
        }

        return coerceBlockType(block, nextType);
      }),
    );
  }

  function handleSlashCommand(blockId, command) {
    if (command === "image") {
      onChange(
        blocks.map((block) =>
          block.id === blockId ? coerceBlockType(block, "image") : block,
        ),
      );
      onActiveBlockChange(blockId);
      return;
    }

    onChange(
      blocks.map((block) =>
        block.id === blockId
          ? {
              ...coerceBlockType(block, command),
              html: "",
            }
          : block,
      ),
    );
    onActiveBlockChange(blockId);
    focusElementById(blockId);
  }

  function handleImageFileChange(blockId, file) {
    onChange(
      blocks.map((block) => {
        if (block.id !== blockId || block.type !== "image") {
          return block;
        }

        if (block.previewUrl) {
          URL.revokeObjectURL(block.previewUrl);
        }

        if (!file) {
          return {
            ...block,
            file: null,
            previewUrl: "",
            uploadKey: "",
          };
        }

        return {
          ...block,
          imageId: null,
          imageUrl: "",
          imageFilename: file.name,
          file,
          previewUrl: URL.createObjectURL(file),
          uploadKey: getRuntimeUploadKey(),
        };
      }),
    );
  }

  function handleImageRemoval(blockId) {
    onChange(
      blocks.map((block) => {
        if (block.id !== blockId || block.type !== "image") {
          return block;
        }

        if (block.previewUrl) {
          URL.revokeObjectURL(block.previewUrl);
        }

        return {
          ...block,
          imageId: null,
          imageUrl: "",
          imageFilename: "",
          file: null,
          previewUrl: "",
          uploadKey: "",
        };
      }),
    );
  }

  function handleTextBlockKeyDown(event, block, index) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const nextBlock = getEmptyBlock("paragraph");
      const nextBlocks = [...blocks];
      nextBlocks.splice(index + 1, 0, nextBlock);
      onChange(nextBlocks);
      onActiveBlockChange(nextBlock.id);
      focusElementById(nextBlock.id);
      return;
    }

    if (event.key === "Backspace" && getTextFromHtml(block.html) === "" && blocks.length > 1) {
      event.preventDefault();
      removeBlock(block.id);
    }
  }

  const slashCommands = [
    { id: "paragraph", label: "Paragraph" },
    { id: "heading", label: "Heading" },
    { id: "subheading", label: "Subheading" },
    { id: "quote", label: "Quote" },
    { id: "image", label: "Image" },
  ];

  return (
    <div className="block-editor-shell" ref={shellRef}>
      <SelectionToolbar
        containerRef={shellRef}
        onCommand={execFormattingCommand}
        onLink={handleLink}
      />

      <div className="block-editor-stack">
        {blocks.map((block, index) => (
          <div
            key={block.id}
            className={
              activeBlockId === block.id ? "block-row is-active" : "block-row"
            }
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const draggedBlockId = event.dataTransfer.getData("text/plain");
              moveBlockToIndex(draggedBlockId, index);
            }}
          >
            {/* Gutter. Sits outside the text column and only appears on hover
                or focus, so the resting page is prose and nothing else. */}
            <div className="block-gutter">
              <button
                type="button"
                className="gutter-btn"
                aria-label="Insert a block below"
                onClick={() => setMenuFor(menuFor === block.id ? null : block.id)}
              >
                +
              </button>
              <span
                className="gutter-btn is-grab"
                draggable
                onDragStart={(event) => event.dataTransfer.setData("text/plain", block.id)}
                aria-label="Drag to reorder"
                role="button"
                tabIndex={-1}
              >
                ⠿
              </span>
            </div>

            {menuFor === block.id ? (
              <div className="block-menu" role="menu">
                <p className="block-menu-label">Insert below</p>
                {BLOCK_TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="block-menu-item"
                    onClick={() => {
                      insertBlockAfter(block.id, option.value);
                      setMenuFor(null);
                    }}
                  >
                    {option.label}
                  </button>
                ))}

                <p className="block-menu-label">This block</p>
                <select
                  value={block.type}
                  onChange={(event) => {
                    handleTypeChange(block.id, event.target.value);
                    setMenuFor(null);
                  }}
                  className="block-menu-select"
                  aria-label="Change block type"
                >
                  {BLOCK_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      Turn into {option.label.toLowerCase()}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="block-menu-item"
                  disabled={index === 0}
                  onClick={() => { moveBlock(block.id, "up"); setMenuFor(null); }}
                >
                  Move up
                </button>
                <button
                  type="button"
                  className="block-menu-item"
                  disabled={index === blocks.length - 1}
                  onClick={() => { moveBlock(block.id, "down"); setMenuFor(null); }}
                >
                  Move down
                </button>
                {/* The only destructive action here, and the only one in red. */}
                <button
                  type="button"
                  className="block-menu-item is-danger"
                  disabled={blocks.length === 1}
                  onClick={() => { removeBlock(block.id); setMenuFor(null); }}
                >
                  Delete block
                </button>
              </div>
            ) : null}

            <div className="block-body">
              {block.type === "image" ? (
                <ImageBlockCard
                  block={block}
                  onChangeImageFile={handleImageFileChange}
                  onUpdateBlock={updateBlock}
                  onRemoveImageFile={handleImageRemoval}
                />
              ) : (
                <>
                  <EditableTextBlock
                    block={block}
                    isActive={activeBlockId === block.id}
                    onFocus={() => {
                      onActiveBlockChange(block.id);
                      setMenuFor(null);
                    }}
                    onHtmlChange={(html) => updateBlock(block.id, { html })}
                    onKeyDown={(event) => handleTextBlockKeyDown(event, block, index)}
                  />
                  <ProvenanceChip block={block} sourceLabel={sourceLabel} />
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {showSlashMenu ? (
        <div className="slash-command-menu">
          {slashCommands.map((command) => (
            <button
              key={command.id}
              type="button"
              className="slash-command-item"
              onClick={() => handleSlashCommand(activeBlock.id, command.id)}
            >
              {command.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
