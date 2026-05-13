// Shared error-shape helpers. Tauri commands return errors as
// `{ kind, message }` (see e.g. `src-tauri/src/file.rs::FileError`'s Serialize
// impl); the JS side gets them as the rejection value from invoke(). This
// helper coerces both that tagged shape and plain Errors/strings into a
// flat message string suitable for putting in UI state.

export type TaggedError = { kind: string; message: string };

export function isTaggedError(e: unknown): e is TaggedError {
  return (
    !!e &&
    typeof e === "object" &&
    "kind" in e &&
    "message" in e &&
    typeof (e as { kind: unknown }).kind === "string" &&
    typeof (e as { message: unknown }).message === "string"
  );
}

export function formatError(e: unknown): string {
  if (isTaggedError(e)) {
    return e.message;
  }
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message: unknown }).message;
    return typeof m === "string" ? m : String(m);
  }
  if (typeof e === "string") {
    return e;
  }
  return String(e);
}
