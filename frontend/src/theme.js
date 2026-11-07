// Map colours (dark theme only; the CSS tokens in tokens.css match these).
// Only the two selected topics and the gaps get strong colours; everything
// else stays grey so the gaps stand out.
export const COLOURS = {
  a: "#3987e5",
  b: "#d95926",
  gap: "#199e70",
  papers: "#898781",
  noise: "#52514e",
  ink: "#f0efec",
  muted: "#a09e98",
  card: "#1a1a19",
  ring: "#1a1a19",
  raised: "#232321",
  hairline: "rgba(240,239,236,0.14)",
};

export const FONT_UI = "Inter Variable, Inter, system-ui, sans-serif";
export const FONT_MONO = "JetBrains Mono, ui-monospace, monospace";

/** First keyword of a cluster label: "sea ice · arctic · sic" -> "sea ice". */
export const shortName = (label) => (label || "").split(" · ")[0];

/** True when the user asked the OS for less motion. */
export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
