/**
 * Brand primitives: name + animated gear logo.
 * Used everywhere the product is identified — header, sidebar, login, footer.
 */

export const BRAND_NAME = "Forge";
export const BRAND_TAGLINE = "Many models. One conversation.";

export function BrandName({ className }: { className?: string }) {
  return <span className={className}>{BRAND_NAME}</span>;
}

/**
 * Animated gear logo — rotates slowly via inline CSS animation. The inner notch
 * counter-rotates so the mark feels alive rather than just spinning. Renders
 * crisply at 14–48px.
 */
export function BrandLogo({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="forge-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgb(var(--color-accent))" />
          <stop offset="1" stopColor="rgb(var(--color-accent) / 0.55)" />
        </linearGradient>
      </defs>
      <g
        style={{
          transformOrigin: "16px 16px",
          animation: "brand-spin 12s linear infinite",
        }}
      >
        <path
          d="M16 2.4l1.5 2.7 3.05-.4 1.05 2.9 2.95.95-.4 3.05 2.7 1.5-1.45 2.7 1.45 2.7-2.7 1.5.4 3.05-2.95.95-1.05 2.9-3.05-.4L16 29.6l-1.5-2.7-3.05.4-1.05-2.9-2.95-.95.4-3.05-2.7-1.5L6.6 16 5.15 13.3l2.7-1.5-.4-3.05 2.95-.95 1.05-2.9 3.05.4z"
          fill="url(#forge-grad)"
        />
        <circle
          cx="16"
          cy="16"
          r="6"
          fill="rgb(var(--color-bg-elev))"
        />
      </g>
      <g
        style={{
          transformOrigin: "16px 16px",
          animation: "brand-spin-rev 18s linear infinite",
        }}
      >
        <circle
          cx="16"
          cy="16"
          r="3.2"
          fill="rgb(var(--color-accent))"
          opacity="0.92"
        />
        <circle cx="16" cy="16" r="1.1" fill="rgb(var(--color-bg-elev))" />
      </g>
    </svg>
  );
}
