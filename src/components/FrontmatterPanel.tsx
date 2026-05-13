"use client";

import { parseSimpleYaml } from "@/lib/frontmatter";
import type { FrontmatterMode } from "@/components/FrontmatterModeToggle";

type Props = {
  mode: FrontmatterMode;
  frontmatter: string | null;
};

export function FrontmatterPanel({ mode, frontmatter }: Props) {
  if (!frontmatter || mode === "hide") return null;

  if (mode === "code") {
    return (
      <pre className="m-0 whitespace-pre-wrap break-words border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 font-mono text-[11px] leading-relaxed text-[var(--text-dim)]">
        <span className="text-[var(--text-muted)]">{"---\n"}</span>
        {frontmatter}
        <span className="text-[var(--text-muted)]">{"\n---"}</span>
      </pre>
    );
  }

  // mode === "properties"
  const props = parseSimpleYaml(frontmatter);
  if (props.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2">
      {props.map((p) => (
        <div key={p.key} className="flex items-baseline gap-3 text-xs">
          <span className="w-28 flex-shrink-0 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            {p.key}
          </span>
          <span className="min-w-0 flex-1 truncate text-[var(--text-dim)]">
            {p.value || <span className="text-[var(--text-muted)]">—</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
