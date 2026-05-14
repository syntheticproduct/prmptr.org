"use client";

import { useEffect, useMemo, useState } from "react";
import { MilkdownEditor } from "@/components/MilkdownEditor";
import { listCoworkSessions, type CoworkSummary } from "@/lib/tauri-fs";

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; session: CoworkSummary }
  | { kind: "missing" }
  | { kind: "err"; message: string };

function formatError(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

function synthesizeBody(s: CoworkSummary): string {
  const created = s.createdAt ? new Date(s.createdAt).toLocaleString() : "unknown";
  const lastActive = s.lastActivityAt
    ? new Date(s.lastActivityAt).toLocaleString()
    : "unknown";
  const meta = [
    `**Created**: ${created}`,
    `**Last active**: ${lastActive}`,
    s.model ? `**Model**: \`${s.model}\`` : null,
    s.isStarred ? "**★ Starred**" : null,
    s.isArchived ? "**Archived**" : null,
    s.cwd ? `**Working folder**: \`${s.cwd}\`` : null,
    `**Session ID**: \`${s.sessionId}\``,
  ]
    .filter(Boolean)
    .join(" · ");

  return `# ${s.title}\n\n${meta}\n\n## Initial prompt\n\n${
    s.initialMessage ?? "_(none recorded)_"
  }\n`;
}

export default function CoworkViewerPage() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (!id) {
      setState({ kind: "missing" });
      return;
    }
    listCoworkSessions()
      .then((listing) => {
        const found = listing.sessions.find((s) => s.sessionId === id);
        if (found) setState({ kind: "ok", session: found });
        else setState({ kind: "missing" });
      })
      .catch((e) => setState({ kind: "err", message: formatError(e) }));
  }, []);

  const body = useMemo(
    () => (state.kind === "ok" ? synthesizeBody(state.session) : ""),
    [state],
  );

  return (
    <main className="flex h-dvh flex-col bg-[var(--bg)] text-[var(--text)]">
      {state.kind === "loading" && (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-muted)]">
          Loading session…
        </div>
      )}
      {state.kind === "missing" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <div className="font-mono text-xs uppercase tracking-wider text-[var(--text-faint)]">
            Session not found
          </div>
          <div className="max-w-md text-sm text-[var(--text-dim)]">
            The Cowork session ID in the URL didn&apos;t match any active session.
            It may have been archived or deleted.
          </div>
        </div>
      )}
      {state.kind === "err" && (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--danger)]">
          {state.message}
        </div>
      )}
      {state.kind === "ok" && (
        <div className="prmptr-editor-host relative min-h-0 flex-1 overflow-y-auto">
          <MilkdownEditor defaultValue={body} onChange={() => {}} />
        </div>
      )}
    </main>
  );
}
