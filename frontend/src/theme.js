import { useEffect, useState } from "react";

// Map colours for light and dark mode (the CSS has matching variables).
// Only the two selected topics and the gaps get strong colours; everything
// else stays grey so the gaps stand out.
export const PALETTES = {
  light: { a: "#2a78d6", b: "#eb6834", gap: "#1baf7a", papers: "#898781",
           noise: "#c3c2b7", ink: "#0b0b0b", muted: "#52514e", ring: "#fcfcfb" },
  dark: { a: "#3987e5", b: "#d95926", gap: "#199e70", papers: "#898781",
          noise: "#52514e", ink: "#f0efec", muted: "#c3c2b7", ring: "#1a1a19" },
};

/** "light" or "dark", following the computer's setting (and updating if it changes). */
export function useColorScheme() {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = (event) => setDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return dark ? "dark" : "light";
}

/** First keyword of a cluster label: "sea ice · arctic · sic" -> "sea ice". */
export const shortName = (label) => (label || "").split(" · ")[0];
