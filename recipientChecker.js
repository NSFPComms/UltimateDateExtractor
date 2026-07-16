// Parses "2020/21", "2020-21", or "2020-2021" style academic-year labels
// out of a Recipients tab block and checks whether the most recent one is
// stale relative to today.

const ACAD_YEAR_RE = /\b(20\d{2})[\/\-](\d{2}|20\d{2})\b/g;

function extractRecipientYears(text) {
  if (!text) return [];
  const years = [];
  let m;
  const re = new RegExp(ACAD_YEAR_RE.source, 'g');
  while ((m = re.exec(text))) {
    years.push(parseInt(m[1], 10)); // use the START year of the academic year as the sortable key
  }
  return [...new Set(years)].sort((a, b) => a - b);
}

// Academic year "starts" in August by NS&FP convention (matches CURRENT_CYCLE/
// NEXT_CYCLE pattern in the VBA extractor, e.g. "2025-26" begins ~Aug 2025).
function currentAcademicYearStart(today = new Date()) {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1; // 1-12
  return m >= 8 ? y : y - 1;
}

/**
 * @param {string} text - raw text of the Recipients tab
 * @param {number} lookbackYears - how many completed academic years back is
 *   still "fine". Per the user's rule ("beyond the academic year before the
 *   last one"): last completed cycle minus 1 more. Default 2.
 */
function checkRecipientStaleness(text, today = new Date(), lookbackYears = 2) {
  const years = extractRecipientYears(text);
  if (!years.length) {
    return { stale: null, mostRecentYear: null, reason: 'no_recipient_years_found' };
  }
  const mostRecentYear = years[years.length - 1];
  const currentStart = currentAcademicYearStart(today);
  const thresholdYear = currentStart - lookbackYears; // e.g. current=2025, lookback=2 -> 2023
  const stale = mostRecentYear < thresholdYear;
  return {
    stale,
    mostRecentYear,
    mostRecentLabel: `${mostRecentYear}/${String(mostRecentYear + 1).slice(-2)}`,
    thresholdYear,
    reason: stale
      ? `Most recent recipients listed are from ${mostRecentYear}/${String(mostRecentYear + 1).slice(-2)} — nothing newer than the ${thresholdYear}/${String(thresholdYear + 1).slice(-2)} cycle`
      : null,
  };
}

module.exports = { extractRecipientYears, checkRecipientStaleness, currentAcademicYearStart };
