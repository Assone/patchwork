import type { HighlighterCore } from "shiki/core";
import type { WordSegment } from "./diffWords";

// Grammars/themes are dynamic imports so they stay out of the initial
// bundle. Highlighting is best-effort; callers fall back to plain text.
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

export interface HighlightToken {
  readonly text: string;
  readonly color: string | undefined;
}

let highlighterPromise: Promise<HighlighterCore | undefined> | undefined;
const languageLoads = new Map<string, Promise<void>>();
const tokenCache = new Map<string, readonly HighlightToken[] | undefined>();
const TOKEN_CACHE_LIMIT = 2000;

async function getHighlighter(language: string): Promise<HighlighterCore | undefined> {
  const loader = LANG_LOADERS[language];
  if (loader === undefined) {
    return undefined;
  }

  highlighterPromise ??= (async () => {
    try {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
        import("shiki/core"),
        import("shiki/engine/javascript"),
      ]);
      return createHighlighterCore({
        themes: [THEME_LOADERS[THEME]()],
        langs: [],
        engine: createJavaScriptRegexEngine(),
      });
    } catch {
      // Allow a later render to retry the dynamic import.
      highlighterPromise = undefined;
      return undefined;
    }
  })();

  const highlighter = await highlighterPromise;
  if (highlighter === undefined) {
    return undefined;
  }

  if (!highlighter.getLoadedLanguages().includes(language)) {
    let load = languageLoads.get(language);
    if (load === undefined) {
      load = loader()
        .then((module) =>
          highlighter.loadLanguage(module as Parameters<typeof highlighter.loadLanguage>[0]),
        )
        .then(
          () => undefined,
          () => undefined,
        );
      languageLoads.set(language, load);
    }
    await load;
  }
  return highlighter;
}

// `dark-plus` matches VS Code's default dark theme; no light variant yet.
export async function highlightLine(
  text: string,
  language: string,
): Promise<readonly HighlightToken[] | undefined> {
  const key = `${language}\0${text}`;
  if (tokenCache.has(key)) {
    return tokenCache.get(key);
  }

  const highlighter = await getHighlighter(language);
  let result: readonly HighlightToken[] | undefined;
  if (highlighter !== undefined) {
    try {
      const { tokens } = highlighter.codeToTokens(text, { lang: language, theme: THEME });
      result = tokens[0]?.map((token) => ({ text: token.content, color: token.color }));
    } catch {
      result = undefined;
    }
  }

  if (tokenCache.size >= TOKEN_CACHE_LIMIT) {
    const oldest = tokenCache.keys().next().value;
    if (oldest !== undefined) {
      tokenCache.delete(oldest);
    }
  }
  tokenCache.set(key, result);
  return result;
}

export interface RenderPiece {
  readonly text: string;
  readonly color: string | undefined;
  readonly changed: boolean;
}

// Splits tokens at word-diff boundaries so changed words keep their colour.
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
