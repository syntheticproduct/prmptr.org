// Defaults applied on startup when running `next dev`. Edit this file to
// change what dev sessions open with. In production builds these are all
// no-ops (isDev === false).

import type { ViewMode } from "@/components/ViewModeToggle";

export const isDev = process.env.NODE_ENV === "development";

// File auto-opened on startup when running in dev and Tauri is available,
// unless the app was launched with a CLI file path (that wins). Set to null
// to disable. The path must match the OS the Tauri backend runs on — use
// `/mnt/c/...` for a WSL/Linux build, `C:\\...` for a native Windows build.
export const DEV_DEFAULT_FILE: string | null = isDev
  ? "/mnt/c/Users/camil/OneDrive/Documents/Claude/Projects/⭐Resume, skills, search strategy/JobSearch_PathMap_RuthlessStrategist_2026-05-10.md"
  : null;

// View mode used on startup in dev. null = keep the production default.
export const DEV_DEFAULT_VIEW_MODE: ViewMode | null = isDev ? "folder" : null;

// Folder shown by the FolderTreePane on dev startup. Derived from
// DEV_DEFAULT_FILE so the auto-opened file is visible in the tree.
export const DEV_DEFAULT_FOLDER_ROOT: string | null = DEV_DEFAULT_FILE
  ? DEV_DEFAULT_FILE.replace(/[\\/][^\\/]+$/, "")
  : null;
