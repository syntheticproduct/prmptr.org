// Defaults applied on startup when running `next dev`. In production builds
// these are all no-ops (isDev === false).
//
// The dev file path is read from `NEXT_PUBLIC_PRMPTR_DEV_FILE` so we don't
// bake a user-specific filesystem path into the repo. Set it in `.env.local`
// (which is gitignored) — e.g.:
//
//   NEXT_PUBLIC_PRMPTR_DEV_FILE=/mnt/c/Users/me/Notes/scratch.md
//
// or on Windows:
//
//   NEXT_PUBLIC_PRMPTR_DEV_FILE=C:\\Users\\me\\Notes\\scratch.md
//
// The path must match the OS the Tauri backend runs on. Leave unset to skip
// auto-opening anything.

import type { ViewMode } from "@/components/ViewModeToggle";

export const isDev = process.env.NODE_ENV === "development";

function devEnv(name: string): string | null {
  if (!isDev) return null;
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const DEV_DEFAULT_FILE: string | null = devEnv(
  "NEXT_PUBLIC_PRMPTR_DEV_FILE",
);

function devViewMode(): ViewMode | null {
  const raw = devEnv("NEXT_PUBLIC_PRMPTR_DEV_VIEW_MODE");
  if (raw === "single" || raw === "cowork" || raw === "folder" || raw === "history") {
    return raw;
  }
  return isDev ? "folder" : null;
}

export const DEV_DEFAULT_VIEW_MODE: ViewMode | null = devViewMode();

// Folder shown by the FolderTreePane on dev startup. Derived from
// DEV_DEFAULT_FILE so the auto-opened file is visible in the tree.
export const DEV_DEFAULT_FOLDER_ROOT: string | null = DEV_DEFAULT_FILE
  ? DEV_DEFAULT_FILE.replace(/[\\/][^\\/]+$/, "")
  : null;
