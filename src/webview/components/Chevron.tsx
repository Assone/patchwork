import { cn } from "../utils/cn";

export const Chevron: React.FC<{ readonly expanded: boolean }> = ({ expanded }) => {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={cn(
        "text-foreground-muted size-3 shrink-0 transition-transform duration-100",
        expanded ? "rotate-90" : "rotate-0",
      )}
    >
      <path
        d="M6 4l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
