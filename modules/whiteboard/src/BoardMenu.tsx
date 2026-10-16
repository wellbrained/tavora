// The board dropdown in the header: switch boards, make a new one, rename or delete the current one.

import { useEffect, useRef, useState } from "react";
import { MAX_NAME, type BoardSummary } from "./boards";
import { t } from "./i18n";

interface Props {
  boards: BoardSummary[];
  currentId: string;
  currentName: string;
  onSelect(id: string): void;
  onCreate(): void;
  onRename(name: string): void;
  onDelete(): void;
}

export default function BoardMenu({ boards, currentId, currentName, onSelect, onCreate, onRename, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // Closes on a click elsewhere or Escape.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        setRenaming(false);
      }
    };
    addEventListener("pointerdown", away, true);
    addEventListener("keydown", key, true);
    return () => {
      removeEventListener("pointerdown", away, true);
      removeEventListener("keydown", key, true);
    };
  }, [open]);

  useEffect(() => {
    if (renaming) input.current?.select();
  }, [renaming]);

  function finishRename(save: boolean) {
    setRenaming(false);
    if (save) onRename(draft);
  }

  return (
    <div className="menu" ref={root}>
      {renaming ? (
        <input
          ref={input}
          className="rename"
          value={draft}
          maxLength={MAX_NAME}
          aria-label={t("board.renameLabel")}
          data-testid="board-rename-input"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") finishRename(true);
            if (event.key === "Escape") finishRename(false);
          }}
          onBlur={() => finishRename(true)}
        />
      ) : (
        <button
          type="button"
          className="button name"
          aria-haspopup="menu"
          aria-expanded={open}
          title={t("board.switch")}
          data-testid="board-menu"
          onClick={() => setOpen(!open)}
        >
          <span className="name-text" data-testid="board-name">
            {currentName}
          </span>
          <span aria-hidden="true">▾</span>
        </button>
      )}
      {open ? (
        <div className="popover" role="menu" aria-label={t("board.switch")} data-testid="board-list">
          {boards.map((board) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={board.id === currentId}
              key={board.id}
              className={board.id === currentId ? "item current" : "item"}
              data-testid={`board-${board.id}`}
              onClick={() => {
                setOpen(false);
                if (board.id !== currentId) onSelect(board.id);
              }}
            >
              {board.name}
            </button>
          ))}
          <div className="separator" />
          <button type="button" role="menuitem" className="item" data-testid="board-new" onClick={() => (setOpen(false), onCreate())}>
            {t("board.new")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="item"
            data-testid="board-rename"
            onClick={() => {
              setOpen(false);
              setDraft(currentName);
              setRenaming(true);
            }}
          >
            {t("board.rename")}
          </button>
          <button type="button" role="menuitem" className="item danger" data-testid="board-delete" onClick={() => (setOpen(false), onDelete())}>
            {t("board.delete")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
