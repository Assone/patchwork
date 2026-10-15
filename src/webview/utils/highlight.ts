import type { HighlighterCore } from "shiki/core";
import type { WordSegment } from "./diffWords";

/**
 * Syntax highlighting for diff lines, loaded on demand.
 *
 * Shiki is used through `shiki/core` with the JavaScript regex engine so
 * the grammars and themes are *dynamic* imports — rspack splits them
 * into separate chunks that only load when a diff is actually rendered.
 * Importing the `shiki` entry point instead would pull every language
 * into the initial webview bundle.
 *
 * Highlighting is best-effort and never fatal: if a grammar is missing
 * or the language is unknown, callers fall back to plain text.
 */

/** Maps a file extension to a Shiki language id we actually bundle. */
const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  html: "html",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  sh: "shell",
};

/**
 * The shape a `@shikijs/langs/*` module resolves to. Declared
 * structurally so we don't add a dependency on `@shikijs/types` just
 * for one type.
 */
interface LanguageModule {
  readonly default: unknown;
}

const LANG_LOADERS: Readonly<Record<string, () => Promise<LanguageModule>>> = {
  typescript: () => import("@shikijs/langs/typescript"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  css: () => import("@shikijs/langs/css"),
  html: () => import("@shikijs/langs/html"),
  markdown: () => import("@shikijs/langs/markdown"),
  yaml: () => import("@shikijs/langs/yaml"),
  python: () => import("@shikijs/langs/python"),
  rust: () => import("@shikijs/langs/rust"),
  go: () => import("@shikijs/langs/go"),
  java: () => import("@shikijs/langs/java"),
  shell: () => import("@shikijs/langs/shell"),
};

/** The one theme we load. See `highlightLine` for why there's only one. */
const THEME = "dark-plus";

const THEME_LOADERS = {
  "dark-plus": () => import("@shikijs/themes/dark-plus"),
} as const;

export function languageForPath(path: string): string | undefined {
  const name = path.split("/").at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return undefined;
  }
  return LANGUAGE_BY_EXTENSION[name.slice(dot + 1).toLowerCase()];
}

/** One token: its text and the colour Shiki assigned it. */
export interface HighlightToken {
  readonly text: string;
  readonly color: string | undefined;
}

let highlighterPromise: Promise<HighlighterCore> | undefined;

/**
 * Creates (once) and returns the shared highlighter.
 *
 * `shiki/core` itself is imported dynamically so the engine doesn't land
 * in the initial webview chunk — it only loads when a diff is actually
 * rendered, and it resolves to undefined if anything goes wrong.
 */
async function getHighlighter(language: string): Promise<HighlighterCore | undefined> {
  const loader = LANG_LOADERS[language];
  if (loader === undefined) {
    return undefined;
  }

  highlighterPromise ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
    ]);
    return createHighlighterCore({
      themes: [THEME_LOADERS[THEME]()],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  })();

  const highlighter = await highlighterPromise;

  // The highlighter is the single source of truth for what's loaded;
  // tracking that separately here would be a second copy to keep in sync.
  if (!highlighter.getLoadedLanguages().includes(language)) {
    const module = await loader();
    await highlighter.loadLanguage(module as Parameters<typeof highlighter.loadLanguage>[0]);
  }
  return highlighter;
}

/**
 * Tokenizes one line of source.
 *
 * Uses `dark-plus`, VS Code's own dark colour scheme, so the pane matches
 * the editor the user is already looking at. There is no light variant
 * yet — no caller asks for one, and loading a second theme would pull it
 * into the bundle for nothing.
 */
export async function highlightLine(
  text: string,
  language: string,
): Promise<readonly HighlightToken[] | undefined> {
  const highlighter = await getHighlighter(language);
  if (highlighter === undefined) {
    return undefined;
  }
  try {
    const { tokens } = highlighter.codeToTokens(text, { lang: language, theme: THEME });
    return tokens[0]?.map((token) => ({ text: token.content, color: token.color }));
  } catch {
    return undefined;
  }
}

/**
 * Overlays word-diff segments onto highlighted tokens.
 *
 * Shiki gives us colours; the word diff tells us which parts changed.
 * We split tokens at segment boundaries so a changed word keeps its
 * syntax colour while still getting the change background.
 */
export interface RenderPiece {
  readonly text: string;
  readonly color: string | undefined;
  readonly changed: boolean;
}

export function mergeSegments(
  tokens: readonly HighlightToken[],
  segments: readonly WordSegment[] | undefined,
): readonly RenderPiece[] {
  if (segments === undefined) {
    return tokens.map((token) => ({ ...token, changed: false }));
  }
  if (tokens.length === 0) {
    return segments.map((segment) => ({
      text: segment.text,
      color: undefined,
      changed: segment.changed,
    }));
  }

  const pieces: RenderPiece[] = [];
  let tokenIndex = 0;
  let tokenOffset = 0;

  for (const segment of segments) {
    let remaining = segment.text.length;
    while (remaining > 0 && tokenIndex < tokens.length) {
      const token = tokens[tokenIndex]!;
      const available = token.text.length - tokenOffset;
      const take = Math.min(available, remaining);
      pieces.push({
        text: token.text.slice(tokenOffset, tokenOffset + take),
        color: token.color,
        changed: segment.changed,
      });
      remaining -= take;
      tokenOffset += take;
      if (tokenOffset >= token.text.length) {
        tokenIndex++;
        tokenOffset = 0;
      }
    }
  }
  return pieces;
}
