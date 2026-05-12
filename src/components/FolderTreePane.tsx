"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  listDir,
  pickFolderToOpen,
  type DirChild,
} from "@/lib/tauri-fs";

const ROOT_STORAGE_KEY = "prmptr.folder-pane.root";

type Props = {
  onOpenFile: (path: string) => Promise<void> | void;
  selectedPath: string | null;
};

function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}

function formatError(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

export function FolderTreePane({ onOpenFile, selectedPath }: Props) {
  const [root, setRoot] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [cache, setCache] = useState<Map<string, DirChild[]>>(new Map());
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const queryInputRef = useRef<HTMLInputElement>(null);

  // Restore root from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(ROOT_STORAGE_KEY);
    if (saved) {
      setRoot(saved);
      void loadInto(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadInto = useCallback(async (path: string) => {
    setLoading((s) => new Set(s).add(path));
    try {
      const children = await listDir(path);
      setCache((c) => new Map(c).set(path, children));
      setError(null);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setLoading((s) => {
        const next = new Set(s);
        next.delete(path);
        return next;
      });
    }
  }, []);

  const openRoot = useCallback(async () => {
    const picked = await pickFolderToOpen();
    if (!picked) return;
    setRoot(picked);
    setExpanded(new Set());
    setCache(new Map());
    localStorage.setItem(ROOT_STORAGE_KEY, picked);
    await loadInto(picked);
  }, [loadInto]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  const toggleNode = useCallback(
    async (path: string, isDir: boolean) => {
      if (!isDir) {
        await onOpenFile(path);
        return;
      }
      const isOpen = expanded.has(path);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (isOpen) next.delete(path);
        else next.add(path);
        return next;
      });
      if (!isOpen && !cache.has(path)) {
        await loadInto(path);
      }
    },
    [expanded, cache, loadInto, onOpenFile],
  );

  // Compute filter visibility set: a path is visible if its name matches
  // OR any visible (cached + expanded) descendant matches. Walks only
  // expanded subtrees — collapsed children don't count toward visibility.
  const filterMatches = useMemo<Set<string> | null>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const matches = new Set<string>();

    function walk(nodes: DirChild[]): boolean {
      let anyChildMatches = false;
      for (const node of nodes) {
        const selfMatch = node.name.toLowerCase().includes(q);
        let childMatch = false;
        if (node.isDir && expanded.has(node.path)) {
          const kids = cache.get(node.path);
          if (kids) childMatch = walk(kids);
        }
        if (selfMatch || childMatch) {
          matches.add(node.path);
          anyChildMatches = true;
        }
      }
      return anyChildMatches;
    }

    if (root) {
      const rootKids = cache.get(root);
      if (rootKids) walk(rootKids);
    }
    return matches;
  }, [query, cache, expanded, root]);

  // Keyboard: Ctrl+F focuses filter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        // Only when focus is somewhere within our pane area; check ancestor
        // chain isn't necessary — a global Ctrl+F binding for this pane is
        // useful even when focus is in the editor.
        e.preventDefault();
        queryInputRef.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === queryInputRef.current) {
        setQuery("");
        queryInputRef.current?.blur();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <aside className="flex w-[280px] flex-shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg)] text-xs">
      {/* Header */}
      <header className="flex h-[36px] flex-shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-3">
        <span
          className="truncate font-mono text-[11px] text-[var(--text)]"
          title={root || ""}
        >
          {root ? basename(root) : "No folder"}
        </span>
        <div className="flex flex-shrink-0 items-center gap-0.5">
          <IconBtn label="Open folder" onClick={openRoot}>
            📂
          </IconBtn>
          <IconBtn
            label="Collapse all"
            onClick={collapseAll}
            disabled={expanded.size === 0}
          >
            ⇤
          </IconBtn>
          <IconBtn
            label={showHidden ? "Hide hidden files" : "Show hidden files"}
            onClick={() => setShowHidden((v) => !v)}
          >
            {showHidden ? "👁" : "○"}
          </IconBtn>
        </div>
      </header>

      {/* Search */}
      <div className="flex h-[32px] flex-shrink-0 items-center gap-1 border-b border-[var(--border)] px-2">
        <input
          ref={queryInputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          className="flex-1 rounded bg-[var(--surface)] px-2 py-0.5 text-[11px] text-[var(--text)] outline-none ring-1 ring-transparent placeholder:text-[var(--text-muted)] focus:ring-[var(--accent)]/40"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="text-[var(--text-muted)] hover:text-[var(--text)]"
            aria-label="Clear filter"
          >
            ✕
          </button>
        )}
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto">
        {!root && (
          <div className="flex h-full items-center justify-center px-4">
            <button
              onClick={openRoot}
              className="rounded-md bg-[var(--surface-2)] px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--surface-3)]"
            >
              Open folder…
            </button>
          </div>
        )}
        {error && (
          <div className="px-3 py-2 text-[10px] text-[var(--danger)]">
            {error}
          </div>
        )}
        {root && cache.has(root) && (
          <TreeLevel
            entries={cache.get(root)!}
            depth={0}
            expanded={expanded}
            cache={cache}
            loading={loading}
            selectedPath={selectedPath}
            showHidden={showHidden}
            filterMatches={filterMatches}
            onToggle={toggleNode}
          />
        )}
        {root && !cache.has(root) && loading.has(root) && (
          <SkeletonRows />
        )}
      </div>
    </aside>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="rounded p-1 text-[var(--text-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-1 p-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-5 animate-pulse rounded bg-[var(--surface-2)]"
          style={{ width: `${50 + (i % 3) * 15}%` }}
        />
      ))}
    </div>
  );
}

type LevelProps = {
  entries: DirChild[];
  depth: number;
  expanded: Set<string>;
  cache: Map<string, DirChild[]>;
  loading: Set<string>;
  selectedPath: string | null;
  showHidden: boolean;
  filterMatches: Set<string> | null;
  onToggle: (path: string, isDir: boolean) => void | Promise<void>;
};

function TreeLevel(props: LevelProps) {
  const {
    entries,
    depth,
    expanded,
    cache,
    loading,
    selectedPath,
    showHidden,
    filterMatches,
    onToggle,
  } = props;

  const visible = entries.filter((e) => {
    if (!showHidden && e.isHidden) return false;
    if (filterMatches && !filterMatches.has(e.path)) return false;
    return true;
  });

  if (visible.length === 0) return null;

  return (
    <ul>
      {visible.map((e) => {
        const isOpen = expanded.has(e.path);
        const isSelected = selectedPath === e.path;
        const isLoading = loading.has(e.path);
        const childList = e.isDir && isOpen ? cache.get(e.path) : undefined;

        return (
          <li key={e.path}>
            <button
              onClick={() => onToggle(e.path, e.isDir)}
              title={e.name}
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
              className={`flex h-6 w-full items-center gap-1 pr-2 text-left transition ${
                isSelected
                  ? "bg-[var(--accent-tint)] text-[var(--text)]"
                  : "text-[var(--text-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
              }`}
            >
              <span className="w-3 flex-shrink-0 text-[10px] text-[var(--text-muted)]">
                {e.isDir ? (isLoading ? "…" : isOpen ? "▼" : "▶") : ""}
              </span>
              <span className="flex-shrink-0 text-[var(--text-muted)]">
                {e.isDir ? "📁" : "📄"}
              </span>
              <span className="truncate">{e.name}</span>
            </button>
            {isOpen && childList && childList.length === 0 && (
              <div
                className="text-[10px] italic text-[var(--text-muted)]"
                style={{ paddingLeft: `${(depth + 1) * 16 + 24}px` }}
              >
                empty folder
              </div>
            )}
            {isOpen && childList && childList.length > 0 && (
              <TreeLevel
                {...props}
                entries={childList}
                depth={depth + 1}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
