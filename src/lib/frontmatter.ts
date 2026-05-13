export type FrontmatterParse = {
  // Exact original text from start through the trailing blank line(s) before
  // the body. Kept verbatim so save-time reassembly preserves spacing.
  prefix: string | null;
  // YAML payload between the `---` delimiters (no leading/trailing newline).
  frontmatter: string | null;
  body: string;
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

export function parseFrontmatter(text: string): FrontmatterParse {
  const m = FRONTMATTER_RE.exec(text);
  if (!m || m.index !== 0) {
    return { prefix: null, frontmatter: null, body: text };
  }
  // Consume any additional blank lines that visually separate frontmatter from
  // the body — they belong to the prefix so we can round-trip exactly.
  let end = m[0].length;
  while (end < text.length && (text[end] === "\n" || text[end] === "\r")) end++;
  return {
    prefix: text.slice(0, end),
    frontmatter: m[1],
    body: text.slice(end),
  };
}

export function joinFrontmatter(prefix: string | null, body: string): string {
  return (prefix ?? "") + body;
}

export type FrontmatterProp = { key: string; value: string };

// Lightweight YAML key extractor for the Properties panel preview. Handles
// top-level `key: value` pairs and flattens any nested block (one level deep)
// into a single space-joined string. Not a real YAML parser — good enough to
// help the user evaluate the visualization.
export function parseSimpleYaml(yaml: string): FrontmatterProp[] {
  const lines = yaml.split(/\r?\n/);
  const out: FrontmatterProp[] = [];
  let current: FrontmatterProp | null = null;
  let nested: string[] = [];

  const flush = () => {
    if (!current) return;
    if (nested.length > 0) {
      const joined = nested.join(" · ");
      current.value = current.value ? `${current.value} · ${joined}` : joined;
    }
    out.push(current);
    current = null;
    nested = [];
  };

  for (const line of lines) {
    if (!line.trim()) continue;
    const topLevel = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    const isIndented = /^\s/.test(line);
    if (topLevel && !isIndented) {
      flush();
      current = { key: topLevel[1], value: topLevel[2] };
    } else if (current) {
      nested.push(line.trim());
    }
  }
  flush();
  return out;
}
