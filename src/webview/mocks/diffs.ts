/**
 * Mock diff payloads keyed by file path.
 *
 * Each value is a tiny, hand-written diff snippet — enough to make the
 * diff pane feel real without committing to a diff format yet. When the
 * real git diff lands, this module disappears and the same `Diff` type
 * is produced by the git service.
 */
export type Diff = ReadonlyArray<DiffLine>;

export interface DiffLine {
  readonly kind: "context" | "add" | "del";
  readonly text: string;
}

export const MOCK_DIFFS: Readonly<Record<string, Diff>> = {
  "src/webview/App.tsx": [
    { kind: "context", text: "function App() {" },
    { kind: "del", text: "  const [selectedCount] = useState(0);" },
    { kind: "add", text: "  const selection = useSelection();" },
    {
      kind: "add",
      text: "  // A deliberately long line so the diff pane's horizontal scroll behaviour is exercised: the inserted-line background stripe must keep extending past the initial viewport width instead of stopping short.",
    },
    { kind: "context", text: '  return <div className="flex h-screen" />;' },
    { kind: "context", text: "}" },
  ],
  "src/webview/components/CommitComposer.tsx": [
    { kind: "context", text: "export function CommitComposer() {" },
    { kind: "del", text: "  // TODO: real draft" },
    { kind: "add", text: "  const draft = useCommitDraft();" },
    { kind: "add", text: "  return <textarea value={draft.message} />;" },
  ],
  "src/webview/hooks/useCommitDraft.ts": [
    { kind: "add", text: "+export function useCommitDraft() {" },
    { kind: "add", text: "+  const [message, set] = useState('');" },
    { kind: "add", text: "+  return { message, set };" },
    { kind: "add", text: "+}" },
  ],
  "src/webview/hooks/useSelection.ts": [
    { kind: "add", text: "+export function useSelection() {" },
    { kind: "add", text: "+  const [selected, set] = useState(() => new Set<string>());" },
    { kind: "add", text: "+  return { selected };" },
    { kind: "add", text: "+}" },
  ],
  "src/services/git.ts": [
    { kind: "context", text: "export class GitService {" },
    { kind: "del", text: "  // getChangedFiles not implemented yet" },
    { kind: "add", text: "  getChangedFiles: () => Effect.succeed([])," },
  ],
  "src/services/secret.ts": [
    { kind: "del", text: "-export class SecretService {" },
    { kind: "del", text: "-  // removed" },
    { kind: "del", text: "-}" },
  ],
  "src/mocks/changed-files.ts": [{ kind: "add", text: "+// new file, not yet staged" }],
};

export function getMockDiff(path: string): Diff | undefined {
  return MOCK_DIFFS[path];
}
