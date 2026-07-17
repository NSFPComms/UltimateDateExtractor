const { extractDates, classifyStatus, STALE_STATUSES } = require('./dateExtractor');

/**
 * @param {string} awardName
 * @param {{procedures: string, awardFinder: string, external: string}} texts - raw text per source
 * @param {number} inferredYear
 */
function analyzeAward(awardName, texts, inferredYear) {
  const bySource = {};
  for (const [source, text] of Object.entries(texts)) {
    if (!text) continue;
    bySource[source] = extractDates(text, inferredYear);
  }

  // Group deadline-type dates by source for comparison
  const deadlineTag = (d) => d.context === 'deadline' || d.context === 'internal_deadline';
  const deadlinesBySource = {};
  for (const [source, dates] of Object.entries(bySource)) {
    deadlinesBySource[source] = dates.filter(deadlineTag).map((d) => d.date).filter(Boolean);
  }

  // Flag: a deadline date in one source has NO exact match in another source,
  // but DOES have a "near miss" within NEAR_DAYS — this is the signature of
  // "same deadline, stated wrong" (e.g. Sept 9 vs Sept 10) as opposed to
  // "different deadline entirely" (e.g. China track vs US track, months apart).
  const NEAR_DAYS = 5;
  const dayDiff = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);

  const discrepancies = [];
  const sources = Object.keys(deadlinesBySource);
  const flaggedPairs = new Set();
  for (let i = 0; i < sources.length; i++) {
    for (let j = 0; j < sources.length; j++) {
      if (i === j) continue;
      const aDates = deadlinesBySource[sources[i]];
      const bDates = deadlinesBySource[sources[j]];
      if (!aDates.length || !bDates.length) continue;
      for (const d of aDates) {
        if (bDates.includes(d)) continue; // exact match exists somewhere — fine
        const nearest = bDates.reduce((best, b) => {
          const diff = dayDiff(d, b);
          return diff < best.diff ? { date: b, diff } : best;
        }, { date: null, diff: Infinity });
        if (nearest.diff > 0 && nearest.diff <= NEAR_DAYS) {
          const pairKey = [sources[i], d, sources[j], nearest.date].sort().join('|');
          if (flaggedPairs.has(pairKey)) continue;
          flaggedPairs.add(pairKey);
          discrepancies.push({
            type: 'deadline_mismatch',
            [sources[i]]: d,
            [sources[j]]: nearest.date,
            daysApart: nearest.diff,
          });
        }
      }
    }
  }

  // Consolidated overall status — mirrors your MS List's single MinDate/MaxDate
  // per award, rather than a separate noisy status per source. MinDate =
  // earliest "open"-tagged date across all sources; MaxDate = latest
  // "deadline"/"internal_deadline"-tagged date. Falls back to the full date
  // range if a source doesn't have explicit open/deadline tags.
  const allTaggedDates = Object.values(bySource).flat();
  const opens = allTaggedDates.filter((d) => d.context === 'open' && d.date).map((d) => d.date).sort();
  const deadlines = allTaggedDates.filter((d) => (d.context === 'deadline' || d.context === 'internal_deadline') && d.date).map((d) => d.date).sort();
  const allDatesFlat = allTaggedDates.filter((d) => d.date).map((d) => d.date).sort();

  let overallStatus = 'No Dates Found';
  let overallMin = null;
  let overallMax = null;
  if (allDatesFlat.length) {
    overallMin = opens.length ? opens[0] : allDatesFlat[0];
    overallMax = deadlines.length ? deadlines[deadlines.length - 1] : allDatesFlat[allDatesFlat.length - 1];
    overallStatus = classifyStatus(overallMin, overallMax);
  }

  if (STALE_STATUSES.has(overallStatus)) {
    discrepancies.push({ type: 'stale', status: overallStatus, min: overallMin, max: overallMax });
  }

  return { awardName, bySource, deadlinesBySource, overallStatus, overallMin, overallMax, discrepancies };
}

module.exports = { analyzeAward };
