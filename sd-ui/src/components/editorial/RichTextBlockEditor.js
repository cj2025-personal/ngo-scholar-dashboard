"use client";

import { useEffect, useRef } from "react";

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

  return {
    id,
    type: block?.type || "paragraph",
    html: block?.html || "",
  };
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
  };
}

export default function RichTextBlockEditor({
  blocks,
  onChange,
  activeBlockId,
  onActiveBlockChange,
}) {
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
    <div className="block-editor-shell">
      <div className="block-toolbar">
        <button
          type="button"
          className="toolbar-button"
          onClick={() => execFormattingCommand("bold")}
        >
          Bold
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => execFormattingCommand("italic")}
        >
          Italic
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => execFormattingCommand("underline")}
        >
          Underline
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => execFormattingCommand("strikeThrough")}
        >
          Strike
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={handleLink}
        >
          Link
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => execFormattingCommand("unlink")}
        >
          Unlink
        </button>
      </div>

      <div className="block-insert-row">
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            const nextBlock = getEmptyBlock("paragraph");
            onChange([...blocks, nextBlock]);
            onActiveBlockChange(nextBlock.id);
            focusElementById(nextBlock.id);
          }}
        >
          Add paragraph
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            const nextBlock = getEmptyBlock("heading");
            onChange([...blocks, nextBlock]);
            onActiveBlockChange(nextBlock.id);
            focusElementById(nextBlock.id);
          }}
        >
          Add heading
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            const nextBlock = getEmptyBlock("quote");
            onChange([...blocks, nextBlock]);
            onActiveBlockChange(nextBlock.id);
            focusElementById(nextBlock.id);
          }}
        >
          Add quote
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            const nextBlock = getEmptyBlock("image");
            onChange([...blocks, nextBlock]);
            onActiveBlockChange(nextBlock.id);
          }}
        >
          Add image
        </button>
      </div>

      <div className="block-editor-stack">
        {blocks.map((block, index) => (
          <div
            key={block.id}
            className="block-editor-row"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("text/plain", block.id);
            }}
            onDragOver={(event) => {
              event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              const draggedBlockId = event.dataTransfer.getData("text/plain");
              moveBlockToIndex(draggedBlockId, index);
            }}
          >
            <div className="block-editor-controls">
              <select
                value={block.type}
                onChange={(event) =>
                  handleTypeChange(block.id, event.target.value)
                }
                className="block-type-select"
              >
                {BLOCK_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <div className="block-order-controls">
                <span className="block-drag-handle">Drag</span>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => moveBlock(block.id, "up")}
                  disabled={index === 0}
                >
                  Up
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => moveBlock(block.id, "down")}
                  disabled={index === blocks.length - 1}
                >
                  Down
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => insertBlockAfter(block.id, "paragraph")}
                >
                  Add text
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => insertBlockAfter(block.id, "image")}
                >
                  Add image
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => removeBlock(block.id)}
                >
                  Remove
                </button>
              </div>
            </div>

            {block.type === "image" ? (
              <ImageBlockCard
                block={block}
                onChangeImageFile={handleImageFileChange}
                onUpdateBlock={updateBlock}
                onRemoveImageFile={handleImageRemoval}
              />
            ) : (
              <EditableTextBlock
                block={block}
                isActive={activeBlockId === block.id}
                onFocus={() => onActiveBlockChange(block.id)}
                onHtmlChange={(html) =>
                  updateBlock(block.id, {
                    html,
                  })
                }
                onKeyDown={(event) => handleTextBlockKeyDown(event, block, index)}
              />
            )}
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
