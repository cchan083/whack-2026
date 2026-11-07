// Every tunable number for how papers look on the map, in one place.
// Sizes are marker diameters in px at the "M" dot size and the full-map zoom.

export const MAP_STYLE = {
  // The selected gap's two topics: the focus.
  pair: { size: 9, opacity: 0.95 },
  // 1px outline so overlapping dots in a dense cluster still read as separate dots.
  // "#1a1a19" (card background) looked cleaner than a light outline in screenshots.
  pairOutline: { width: 1, color: "#1a1a19" },
  // Soft glow under each focused topic: same hue, bigger, very transparent.
  halo: { sizeFactor: 2.4, opacity: 0.14 },
  // Context: other topics' papers, then unclustered papers (smaller and fainter).
  others: { size: 5, opacity: 0.35, color: "#898781" },
  noise: { size: 4, opacity: 0.22, color: "#898781" },
  // Ring around papers published in the timeline's current year.
  newcomer: { extraSize: 3, width: 1.5, color: "#f0efec" },
  // Dots grow a little as you zoom in: base x clamp((fullSpan / span) ^ exponent, 1, maxGrowth).
  zoom: { exponent: 0.3, maxGrowth: 1.6 },
};

/** The "Dot size" control: multipliers for every dot size above. */
export const DOT_SCALES = { S: 0.75, M: 1, L: 1.35 };
export const DEFAULT_DOT_SIZE = "M";

/** How much to grow dots at the current zoom (1 at full extent). */
export function zoomGrowth(fullSpan, span) {
  if (!(fullSpan > 0) || !(span > 0)) return 1;
  const { exponent, maxGrowth } = MAP_STYLE.zoom;
  return Math.min(maxGrowth, Math.max(1, (fullSpan / span) ** exponent));
}

/** Marker sizes for each kind of dot, given the size setting and zoom growth. */
export function dotSizes(scale = 1) {
  const pair = MAP_STYLE.pair.size * scale;
  return {
    noise: MAP_STYLE.noise.size * scale,
    others: MAP_STYLE.others.size * scale,
    pair,
    halo: pair * MAP_STYLE.halo.sizeFactor,
    newcomer: pair + MAP_STYLE.newcomer.extraSize,
  };
}
