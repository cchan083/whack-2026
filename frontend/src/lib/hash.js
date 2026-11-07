// URL state lives in the hash so links can be shared:
//   #wildfire            (original format, still supported)
//   #wildfire?gap=3      (also selects the gap ranked #3)
//   #wildfire?gap=3&year=2014   (timeline: papers published up to 2014)
// Field names are slugs ([a-z0-9-], optional "__cs.LG"), so "?" never clashes.

export function readHash() {
  const raw = window.location.hash.slice(1);
  const cut = raw.indexOf("?");
  const fieldPart = cut === -1 ? raw : raw.slice(0, cut);
  const params = new URLSearchParams(cut === -1 ? "" : raw.slice(cut + 1));
  let field = null;
  try {
    field = decodeURIComponent(fieldPart) || null;
  } catch {
    field = fieldPart || null;
  }
  const gap = Number.parseInt(params.get("gap") ?? "", 10);
  const year = Number.parseInt(params.get("year") ?? "", 10);
  return {
    field,
    gapRank: Number.isFinite(gap) && gap > 0 ? gap : null,
    year: Number.isFinite(year) && year > 1900 ? year : null,
  };
}

export function hashFor(field, gapRank, year = null) {
  if (!field) return "";
  const params = [];
  if (gapRank && gapRank > 1) params.push(`gap=${gapRank}`);
  if (year != null) params.push(`year=${year}`);
  return `#${encodeURIComponent(field)}${params.length ? `?${params.join("&")}` : ""}`;
}

/** Update the URL without adding history entries. */
export function writeHash(field, gapRank, year = null) {
  const next = hashFor(field, gapRank, year);
  const url = `${window.location.pathname}${window.location.search}${next}`;
  if (window.location.hash !== next) window.history.replaceState(null, "", url);
}
