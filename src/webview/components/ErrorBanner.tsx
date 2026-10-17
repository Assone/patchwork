import { cn } from "../utils/cn";

export interface ErrorBannerProps {
  readonly title: string;
  readonly message: string;
  readonly className?: string;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ title, message, className }) => {
  return (
    <div
      className={cn("border-border flex items-start gap-2 border-b px-2 py-2 text-xs", className)}
      style={{
        background: "var(--color-diff-delete-background)",
        color: "var(--color-badge-deleted)",
      }}
      role="alert"
    >
      <span aria-hidden className="shrink-0 leading-none">
        ⚠
      </span>
      <span className="flex-1 leading-snug break-words">
        <span className="font-medium">{title}</span> {message}
      </span>
    </div>
  );
};
