export const Spinner: React.FC<{ readonly size?: number }> = ({ size = 16 }) => {
  return (
    <svg
      viewBox="0 0 24 24"
      className="text-focus-border animate-spin"
      width={size}
      height={size}
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
        strokeOpacity="0.25"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
};
