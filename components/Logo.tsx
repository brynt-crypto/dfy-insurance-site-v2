/**
 * The agency wordmark, rebuilt from the brand artwork in the hero footage:
 * a two-tone ribbon check (pale stroke flowing into a gold sweep), "Done" in a
 * high-contrast serif, "For You" in gold italic, and letterspaced "INSURANCE".
 *
 * Drawn as vector rather than lifted from the video frame, because the artwork
 * there is light-on-navy and the header is white — a raster crop would need
 * its colours inverted and would not scale cleanly.
 */
export default function Logo({
  tone = "dark",
  className,
}: {
  tone?: "dark" | "light";
  className?: string;
}) {
  const onNavy = tone === "light";

  // The ribbon's pale half and the primary wordmark flip with the background;
  // the gold stays gold, since it carries the brand on either.
  const primary = onNavy ? "#ffffff" : "var(--dfy-navy)";
  const ribbonPale = onNavy ? "#ffffff" : "var(--dfy-navy)";
  const gold = "var(--dfy-gold)";
  const goldDeep = onNavy ? "#c8912f" : "#a87b2a";

  return (
    <span
      className={`flex shrink-0 items-center gap-3 whitespace-nowrap ${className ?? ""}`}
    >
      <svg
        width="46"
        height="30"
        viewBox="0 0 140 90"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <defs>
          <linearGradient id="dfy-sweep" x1="30" y1="80" x2="134" y2="8" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={goldDeep} />
            <stop offset="55%" stopColor={gold} />
            <stop offset="100%" stopColor={gold} />
          </linearGradient>
        </defs>

        {/* The mark is one brush stroke shaped like a check: thin at the left
            tip, thickest at the bottom vertex, tapering to a point top-right.
            Drawn as two closed shapes meeting at the vertex so each half can
            carry its own colour. */}

        {/* Gold sweep: vertex up to the fine point at top right. */}
        <path
          d="M51 69 C78 58 110 32 137 4 C124 38 96 70 60 84 C57 79 53 74 51 69 Z"
          fill="url(#dfy-sweep)"
        />

        {/* Pale ribbon: thin left tip descending into the vertex. */}
        <path
          d="M3 32 C20 32 38 48 51 69 C53 73 55 78 56 82 C38 76 16 52 3 40 Z"
          fill={ribbonPale}
        />
      </svg>

      <span className="flex flex-col leading-none">
        <span
          className="font-[family-name:var(--font-playfair)] text-[1.25rem] font-bold leading-none tracking-[-0.005em]"
          style={{ color: primary }}
        >
          Done{" "}
          <span className="italic" style={{ color: gold }}>
            For You
          </span>
        </span>
        <span
          className="mt-[3px] text-[0.625rem] font-semibold uppercase leading-none tracking-[0.34em]"
          style={{ color: gold }}
        >
          Insurance
        </span>
      </span>
    </span>
  );
}
