import { connect, TavoraError, THEME_TOKENS, type TavoraSDK, type TavoraTheme } from "@tavora/sdk";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cleanName, formatMegabytes, MAX_BOARD_BYTES, nextBoardName, sizeLevel, type BoardData, type BoardSummary } from "./boards";
import { unusedFiles } from "./pictures";
import type { Controls, Pictures, SaveState, View } from "./Board";
import BoardMenu from "./BoardMenu";
import { currentLanguage, setLanguage, t, type Language } from "./i18n";
import { createBoards, type Boards } from "./store";

// Excalidraw is large; the page shows the header first and the board when it has loaded.
const Board = lazy(() => import("./Board"));

interface PanelState {
  selected?: string;
  views?: Record<string, View>;
}

interface Shown {
  id: string;
  name: string;
  data: BoardData;
  /** Bumped to show the board again from what is stored (another panel changed it). */
  nonce: number;
}

interface Undo {
  id: number;
  message: string;
  run(): Promise<void>;
}

/** How long the Undo notice stays when left alone. */
const UNDO_MS = 10_000;

/** Sets the host's colours as CSS variables, like the other official modules. */
function applyTheme(theme: TavoraTheme): void {
  const root = document.documentElement;
  for (const name of THEME_TOKENS) {
    const value = theme.tokens?.[name];
    if (typeof value === "string" && value) root.style.setProperty(`--${name}`, value);
  }
  if (typeof theme.radius === "number" && Number.isFinite(theme.radius)) root.style.setProperty("--radius", `${theme.radius}px`);
  root.style.colorScheme = theme.mode === "light" ? "light" : "dark";
}

export default function App() {
  const [sdk, setSdk] = useState<TavoraSDK | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"light" | "dark">("dark");
  const [language, setLanguageState] = useState<Language>(currentLanguage());
  const [list, setList] = useState<BoardSummary[]>([]);
  const [shown, setShown] = useState<Shown | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [bytes, setBytes] = useState(0);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [pictures, setPictures] = useState<Pictures>({ count: 0, allLocked: false });
  const [picturesLoaded, setPicturesLoaded] = useState(0);
  const [empty, setEmpty] = useState(true);
  const [copying, setCopying] = useState(false);
  const copyRunning = useRef(false);
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(null);
  const controls = useRef<Controls | null>(null);
  const noticeCount = useRef(0);

  const boards = useMemo<Boards | null>(() => (sdk ? createBoards(sdk) : null), [sdk]);
  const revision = useRef(0);
  const dirty = useRef(false);
  const selectedId = useRef<string | null>(null);
  const names = useRef<Map<string, string>>(new Map());
  const views = useRef<Record<string, View>>({});
  const viewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const undoCount = useRef(0);

  const saveSelection = useCallback(() => {
    if (!sdk) return;
    void sdk.panel.setState({ selected: selectedId.current, views: views.current } as unknown as PanelState as never).catch(() => undefined);
  }, [sdk]);

  const refreshList = useCallback(async () => {
    if (!boards) return [];
    const next = await boards.list();
    names.current = new Map(next.map((board) => [board.id, board.name]));
    setList(next);
    return next;
  }, [boards]);

  /** Shows a board; what the current one has unsaved is stored first, when its panel closes. */
  const show = useCallback(
    async (id: string) => {
      if (!boards) return;
      const opened = await boards.open(id);
      if (!opened) return;
      selectedId.current = id;
      revision.current = opened.revision;
      dirty.current = false;
      setSaveState("idle");
      setPictures({ count: 0, allLocked: false });
      setPicturesLoaded(0);
      setBytes(JSON.stringify(opened.data).length);
      setShown((previous) => ({ id, name: names.current.get(id) ?? "", data: opened.data, nonce: (previous?.nonce ?? 0) + 1 }));
      saveSelection();
    },
    [boards, saveSelection],
  );

  const createBoard = useCallback(async () => {
    if (!boards) return;
    const created = await boards.create(nextBoardName([...names.current.values()], t("boardWord")));
    await refreshList();
    await show(created.id);
  }, [boards, refreshList, show]);

  // Connect, then show the board this panel had open, or the first one (made when there is none).
  useEffect(() => {
    let cancelled = false;
    connect()
      .then(async (connected) => {
        const theme = await connected.ui.getTheme();
        applyTheme(theme);
        setMode(theme.mode === "light" ? "light" : "dark");
        setLanguage(await connected.ui.getLanguage());
        setLanguageState(currentLanguage());
        connected.ui.onThemeChange((next) => {
          applyTheme(next);
          setMode(next.mode === "light" ? "light" : "dark");
        });
        connected.ui.onLanguageChange((code) => {
          setLanguage(code);
          setLanguageState(currentLanguage());
        });
        if (!cancelled) setSdk(connected);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sdk || !boards) return;
    let cancelled = false;
    void (async () => {
      const [state, existing] = await Promise.all([sdk.panel.getState<PanelState>(), refreshList()]);
      if (cancelled) return;
      views.current = state?.views && typeof state.views === "object" ? state.views : {};
      let id = existing.find((board) => board.id === state?.selected)?.id ?? existing[0]?.id;
      if (!id) {
        const created = await boards.create(`${t("boardWord")} 1`);
        await refreshList();
        id = created.id;
      }
      await show(id);
    })().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    return () => {
      cancelled = true;
    };
  }, [sdk, boards, refreshList, show]);

  // Another panel changed, renamed or deleted a board.
  useEffect(() => {
    if (!sdk || !boards) return;
    return sdk.documents.onChange((change) => {
      void (async () => {
        const next = await refreshList();
        if (change.id !== selectedId.current) return;
        if (change.deleted) {
          const fallback = next[0]?.id;
          if (fallback) await show(fallback);
          else await createBoard();
        } else if (!dirty.current) {
          // This panel has nothing unsaved, so it takes over what the other panel saved.
          await show(change.id);
        }
      })();
    });
  }, [sdk, boards, refreshList, show, createBoard]);

  // Pictures that no board uses any more (of a deleted board, or taken off a board) are cleared out when a panel opens.
  useEffect(() => {
    if (!sdk || !boards || !shown) return;
    let cancelled = false;
    void (async () => {
      const used = await boards.usedFiles();
      if (cancelled) return;
      for (const file of unusedFiles(await sdk.blobs.list(), used)) await sdk.blobs.delete(file.id);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Once per panel, when the first board has been shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdk, boards, shown === null]);

  // A notice (for example a picture that cannot be kept) goes away on its own too.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // The Undo notice goes away on its own.
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  const save = useCallback(
    async (data: BoardData) => {
      const id = selectedId.current;
      if (!boards || !id) return;
      revision.current = await boards.save(id, names.current.get(id) ?? "", data, revision.current);
    },
    [boards],
  );

  const rememberView = useCallback(
    (view: View) => {
      const id = selectedId.current;
      if (!id) return;
      views.current[id] = view;
      clearTimeout(viewTimer.current);
      viewTimer.current = setTimeout(saveSelection, 500);
    },
    [saveSelection],
  );

  const rename = useCallback(
    async (id: string, value: string) => {
      const name = cleanName(value);
      if (!boards || !name || name === names.current.get(id)) return;
      names.current.set(id, name);
      setShown((previous) => (previous && previous.id === id ? { ...previous, name } : previous));
      await boards.rename(id, name);
      await refreshList();
    },
    [boards, refreshList],
  );

  /** Copy as picture, from the header button or Shift+Alt+C; the host only takes it right after that press. */
  const copyAsPicture = useCallback(async () => {
    const board = controls.current;
    if (!board || copyRunning.current) return;
    copyRunning.current = true;
    setCopying(true);
    try {
      const copied = await board.copyAsPicture();
      setNotice({ id: ++noticeCount.current, message: t(copied === "selection" ? "copy.selection" : "copy.board") });
    } catch (reason: unknown) {
      const code = reason instanceof TavoraError ? reason.code : undefined;
      const message =
        code === "PERMISSION_DENIED" ? t("copy.slow") : code === "QUOTA_EXCEEDED" ? t("copy.tooBig") : t("copy.failed", { error: reason instanceof Error ? reason.message : String(reason) });
      setNotice({ id: ++noticeCount.current, message });
    } finally {
      copyRunning.current = false;
      setCopying(false);
    }
  }, []);

  const remove = useCallback(
    async (id: string) => {
      if (!boards) return;
      const opened = await boards.open(id);
      const name = names.current.get(id) ?? "";
      await boards.remove(id);
      delete views.current[id];
      const next = await refreshList();
      if (id === selectedId.current) {
        dirty.current = false;
        const fallback = next[0]?.id;
        if (fallback) await show(fallback);
        else await createBoard();
      }
      if (opened) {
        setUndo({
          id: ++undoCount.current,
          message: t("undo.deleted", { name }),
          run: async () => {
            await boards.restore(id, name, opened.data);
            await refreshList();
            await show(id);
          },
        });
      }
    },
    [boards, refreshList, show, createBoard],
  );

  if (error) return <p className="status">{t("connectError", { error })}</p>;
  if (!sdk || !shown) return <p className="status">{t("loading")}</p>;

  const level = sizeLevel(bytes);
  return (
    <div className="app" data-testid="whiteboard-app">
      <header className="bar">
        <BoardMenu
          boards={list}
          currentId={shown.id}
          currentName={shown.name}
          onSelect={(id) => void show(id)}
          onCreate={() => void createBoard()}
          onRename={(value) => void rename(shown.id, value)}
          onDelete={() => void remove(shown.id)}
        />
        <span className="grow" />
        {pictures.count > 0 ? (
          <button
            type="button"
            className="button picture-lock"
            title={t(pictures.allLocked ? "image.unlockHint" : "image.lockHint")}
            data-testid="picture-lock"
            data-locked={pictures.allLocked}
            onClick={() => controls.current?.setPicturesLocked(!pictures.allLocked)}
          >
            {t(pictures.allLocked ? "image.unlock" : "image.lock")}
          </button>
        ) : null}
        <button
          type="button"
          className="button copy-picture"
          title={t("copy.hint")}
          data-testid="copy-picture"
          disabled={empty || copying}
          onClick={() => void copyAsPicture()}
        >
          {t("copy.button")}
        </button>
        {level !== "ok" ? (
          <span className={level === "full" ? "size size-full" : "size"} role="status" data-testid="board-size">
            {t(level === "full" ? "size.full" : "size.warn", { used: formatMegabytes(bytes), max: formatMegabytes(MAX_BOARD_BYTES) })}
          </span>
        ) : null}
        <span className={saveState === "error" ? "save save-error" : "save"} role="status" data-testid="save-state" data-state={saveState}>
          {saveState === "idle" ? "" : t(`save.${saveState}` as "save.saved")}
        </span>
      </header>
      <main className="board" data-board={shown.id} data-pictures={picturesLoaded} data-testid="board">
        <Suspense fallback={<p className="status">{t("loading")}</p>}>
          <Board
            key={`${shown.id}:${shown.nonce}`}
            sdk={sdk}
            data={shown.data}
            view={views.current[shown.id]}
            mode={mode}
            language={language}
            onSave={save}
            onView={rememberView}
            onState={setSaveState}
            onSize={setBytes}
            onDirty={(value) => (dirty.current = value)}
            onPictures={setPictures}
            onEmpty={setEmpty}
            onCopyShortcut={() => void copyAsPicture()}
            onPicturesLoaded={setPicturesLoaded}
            onNotice={(message) => setNotice({ id: ++noticeCount.current, message })}
            onControls={(value) => (controls.current = value)}
          />
        </Suspense>
      </main>
      {notice && !undo ? (
        <div className="toast" role="status" data-testid="notice-toast" key={`n${notice.id}`}>
          <span className="toast-message">{notice.message}</span>
          <button type="button" className="icon-button" aria-label={t("undo.dismiss")} title={t("undo.dismiss")} onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      ) : null}
      {undo ? (
        <div className="toast" role="status" data-testid="undo-toast">
          <span className="toast-message">{undo.message}</span>
          <button
            type="button"
            className="button"
            data-testid="undo"
            onClick={() => {
              const offer = undo;
              setUndo(null);
              void offer.run().catch(() => undefined);
            }}
          >
            {t("undo.undo")}
          </button>
          <button type="button" className="icon-button" aria-label={t("undo.dismiss")} title={t("undo.dismiss")} onClick={() => setUndo(null)}>
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
