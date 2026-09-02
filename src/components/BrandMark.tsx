/**
 * Minder's wordless mark: three connected nodes — the platform is a mesh of
 * independently-running services the user owns and correlates, and the accent
 * ramp (index.css) was chosen to read the same way. Drawn in `currentColor`
 * so it inherits the accent from whatever wraps it; the fill nodes use the
 * same color at partial opacity so it works in both themes without a variant.
 */
export function BrandMark({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M7 8.5 12 5.5 17 8.5" />
      <path d="M6.5 15 12 18.5 17.5 15" />
      <path d="M5.5 9v6" />
      <path d="M18.5 9v6" />
      <circle cx="12" cy="5" r="2.2" fill="currentColor" fillOpacity="0.18" />
      <circle cx="5" cy="15.5" r="2.2" fill="currentColor" fillOpacity="0.18" />
      <circle cx="19" cy="15.5" r="2.2" fill="currentColor" fillOpacity="0.18" />
    </svg>
  );
}
