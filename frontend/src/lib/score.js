// Score breakdown, rebuilt from the API's `base_score`, `score`, `literature_count`
// and `reasons` strings. The API has no structured breakdown, so the rule
// constants below are COPIED from the backend. Keep them in sync with:
//   pipeline/validation.py  (TAXONOMY_PENALTY, taxonomy_check, SWEET_SPOT,
//                            SATURATED_ABOVE, literature_check, funding_check)
// Any step we can't attribute exactly ends up in "Other adjustments" (the
// remaining ratio), so the bars always multiply out to the real final score.

/** Literature "Goldilocks zone": pipeline/validation.py SWEET_SPOT = (5, 100). */
export const GOLDILOCKS = { low: 5, high: 100 };
/** pipeline/validation.py SATURATED_ABOVE = 500. */
export const SATURATED_ABOVE = 500;

/** Multiplier for the literature rule, mirroring literature_check(). */
export function literatureMultiplier(count) {
  if (count == null) return null; // not checked
  if (count === 0) return 0.5;
  if (count < GOLDILOCKS.low) return 1.1;
  if (count <= GOLDILOCKS.high) return 1.5;
  if (count <= SATURATED_ABOVE) return 0.85;
  return 0.3;
}

const TAXONOMY = [
  // [reason prefix, multiplier, short label] from taxonomy_check()
  [/^Valid:/, 1.0, "Method + problem pairing"],
  [/^Uncertain:/, 0.7, "Unclear method/problem type"],
  [/^(Demoted|Rejected): two /, 0.25, "Two of the same kind"],
];

/**
 * Steps from the map score to the final score:
 *   [{ kind: "start"|"step"|"end", label, detail, multiplier, value }]
 * Each step's `value` is the running score after applying it.
 */
export function scoreBreakdown(gap) {
  const base = gap.base_score;
  if (base == null || !(base > 0)) return null;
  const reasons = gap.reasons ?? [];
  const steps = [];
  let running = base;
  const push = (label, detail, multiplier) => {
    running *= multiplier;
    steps.push({ kind: "step", label, detail, multiplier, value: running });
  };

  // 1. Method/problem taxonomy.
  for (const reason of reasons) {
    const rule = TAXONOMY.find(([re]) => re.test(reason));
    if (rule) {
      push(rule[2], reason, rule[1]);
      break;
    }
  }

  // 2. Funding domain: the multiplier is written in the reason ("(x1.25)").
  const funding = reasons.find((r) => /funding domain/.test(r));
  const fundingMatch = funding?.match(/'([^']+)'.*\(x([\d.]+)\)/);
  if (fundingMatch) push(`Funding: ${fundingMatch[1]}`, funding, Number(fundingMatch[2]));

  // 3. Literature density (Goldilocks).
  const litMult = literatureMultiplier(gap.literature_count);
  if (litMult != null) {
    const n = gap.literature_count;
    const label =
      n === 0 ? "No papers on both (speculative)"
        : n < GOLDILOCKS.low ? "Emerging niche"
          : n <= GOLDILOCKS.high ? "Goldilocks zone"
            : n <= SATURATED_ABOVE ? "Established"
              : "Saturated";
    const detail = reasons.find((r) => /papers|literature/i.test(r) && !/funding/.test(r));
    push(label, detail, litMult);
  }

  // 4. Whatever is left (e.g. abstract-theory or no-funding penalties, rejections).
  const final = gap.score;
  const residual = running > 0 ? final / running : 0;
  if (Math.abs(residual - 1) > 0.01) {
    const unexplained = reasons.filter(
      (r) => !TAXONOMY.some(([re]) => re.test(r)) && r !== funding && !/papers|literature|^Not checked/i.test(r),
    );
    running = final;
    steps.push({
      kind: "step",
      label: "Other adjustments",
      detail: unexplained.join("; ") || "Remaining difference between map score and final score",
      multiplier: residual,
      value: final,
    });
  }

  return [
    { kind: "start", label: "Map score", detail: "Relatedness × emptiness between the two topics", value: base },
    ...steps,
    { kind: "end", label: "Gap score", value: final },
  ];
}

/** Short "why it's promising" signals for chips. */
export function promisingSignals(gap) {
  const out = [];
  const n = gap.literature_count;
  if (n != null && n >= GOLDILOCKS.low && n <= GOLDILOCKS.high) out.push(`Goldilocks zone · ${n} papers`);
  else if (n != null && n > 0 && n < GOLDILOCKS.low) out.push(`Emerging · ${n} paper${n === 1 ? "" : "s"}`);
  for (const r of gap.reasons ?? []) {
    const m = r.match(/funding domain '([^']+)'/);
    if (m) out.push(`Funding: ${m[1]}`);
    if (/^Valid: method/.test(r)) out.push("Method meets problem");
  }
  return out;
}
