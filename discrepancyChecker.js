const { extractDates, classifyStatus, STALE_STATUSES } = require('./dateExtractor');

/**
 * @param {string} awardName
 * @param {object} texts - raw text per source, e.g. {procedures, awardFinder, external}
 * @param {number} inferredYear
 * @param {object} preExtracted - pre-tagged date arrays for sources that already
 *   have reliable tags (e.g. annualDeadlines, tagged by known table column),
 *   bypassing re-extraction/re-guessing.
 */
function analyzeAward(awardName, texts, inferredYear, preExtracted) {
  if (!preExtracted) preExtracted = {};
  const bySource = {};
  for (const [source, text] of Object.entries(texts)) {
    if (!text) continue;
    bySource[source] = extractDates(text, inferredYear);
  }
  for (const [source, dates] of Object.entries(preExtracted)) {
    if (dates && dates.length) bySource[source] = dates;
  }

  const deadlineTag = (d) => d.context === 'deadline' || d.context === 'internal_deadline' || d.context === 'feedback_deadline';

  // Group by source AND by specific context category — comparisons only
  // happen WITHIN the same category. Merging "deadline", "internal_deadline",
  // and "feedback_deadline" into one pool caused false positives: e.g. a
  // feedback deadline has no business being compared against an unrelated
  // final deadline on a source that never mentions feedback at all.
  const COMPARABLE_CATEGORIES = ['deadline', 'internal_deadline', 'feedback_deadline'];
  const bySourceByCategory = {}; // { source: { category: [dates] } }
  for (const [source, dates] of Object.entries(bySource)) {
    bySourceByCategory[source] = {};
    for (const cat of COMPARABLE_CATEGORIES) {
      bySourceByCategory[source][cat] = dates.filter((d) => d.context === cat).map((d) => d.date).filter(Boolean);
    }
  }
  // Keep deadlinesBySource for backward-compat display purposes (all categories combined)
  const deadlinesBySource = {};
  for (const [source, dates] of Object.entries(bySource)) {
    deadlinesBySource[source] = dates.filter(deadlineTag).map((d) => d.date).filter(Boolean);
  }

  // Flag: within a category, sources don't all agree on the exact same
  // date, but their values ARE all close together (within NEAR_DAYS) — the
  // signature of "same real deadline, stated slightly wrong somewhere" as
  // opposed to "different deadline entirely" (e.g. China track vs US track,
  // months apart, which stays unflagged since the spread exceeds NEAR_DAYS).
  //
  // Previously this ran pairwise per source-combination, so a mismatch
  // spanning 3 sources produced 2-3 separate rows for what a human reads as
  // ONE issue. Now it's one consolidated row per award+category showing
  // every source's value at once.
  const NEAR_DAYS = 5;
  const dayDiff = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);

  // Explicit "paused" statements override normal date-based classification
  // entirely — a program that says "Scholarship Paused" shouldn't be
  // classified as "Application Open" or "Dormant" based on date arithmetic
  // over old/current dates; the program itself is telling us its status.
  // Checked across ALL sources (including external), since real examples
  // showed this stated on the external site, not just our own pages.
  const PAUSE_RE = /\b(program (has been |was )?paused|scholarship paused|placed on pause|currently paused|application(s)? (are|is) paused)\b/i;
  let pauseEntry = null;
  for (const [source, text] of Object.entries(texts)) {
    if (!text) continue;
    const m = PAUSE_RE.exec(text);
    if (m) {
      const start = Math.max(0, m.index - 60);
      const end = Math.min(text.length, m.index + m[0].length + 60);
      pauseEntry = { source, snippet: text.slice(start, end).replace(/\s+/g, ' ').trim() };
      break;
    }
  }

  const discrepancies = [];
  const sources = Object.keys(bySourceByCategory);
  for (const category of COMPARABLE_CATEGORIES) {
    // Flatten to {source, date} pairs (deduped per source) and sort by date.
    const entries = [];
    for (const source of sources) {
      for (const date of new Set(bySourceByCategory[source][category])) {
        entries.push({ source, date });
      }
    }
    if (entries.length < 2) continue;
    entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    // Greedy-cluster: start a new cluster whenever the gap to the previous
    // entry exceeds NEAR_DAYS. This keeps genuinely separate events (e.g. a
    // China-track deadline months away from a US-track one) from masking a
    // real near-miss elsewhere in the same category — each cluster is
    // judged independently instead of checking one spread across everything.
    const clusters = [];
    let current = [entries[0]];
    for (let i = 1; i < entries.length; i++) {
      if (dayDiff(entries[i].date, entries[i - 1].date) <= NEAR_DAYS) {
        current.push(entries[i]);
      } else {
        clusters.push(current);
        current = [entries[i]];
      }
    }
    clusters.push(current);

    for (const cluster of clusters) {
      const uniqueDates = new Set(cluster.map((e) => e.date));
      const uniqueSources = new Set(cluster.map((e) => e.source));
      if (uniqueDates.size <= 1) continue; // everyone in this cluster agrees exactly
      if (uniqueSources.size < 2) continue; // same source repeating itself isn't a cross-source discrepancy

      const values = {};
      for (const { source, date } of cluster) {
        if (!values[source]) values[source] = [];
        if (!values[source].includes(date)) values[source].push(date);
      }
      const dates = [...uniqueDates].sort();
      discrepancies.push({
        type: 'deadline_mismatch',
        category,
        values,
        daysApart: dayDiff(dates[0], dates[dates.length - 1]),
      });
    }
  }

  // Consolidated overall status — mirrors your MS List's single MinDate/MaxDate
  // per award. Two important restrictions on which dates are allowed to
  // drive this:
  //
  // 1. ONLY "our" resources (procedures, award finder, annual deadlines) —
  //    NOT the external site. An external site's own unrelated dates (a
  //    founding year, a stale prior cycle nobody's updated) have nothing to
  //    do with whether OUR tracking is stale, and were corrupting status
  //    (e.g. EAB showing "Urgent" driven entirely by the external site's own
  //    old content, not any actual problem with our pages).
  // 2. Only 'deadline' and 'internal_deadline' feed MaxDate — NOT
  //    'feedback_deadline'. A feedback deadline is a soft internal courtesy
  //    step ("last day to request advising"), not the actual application
  //    window boundary. A future feedback deadline was making an
  //    already-closed cycle look like it was still "Application Open".
  const OUR_SOURCES = new Set(['procedures', 'awardFinder', 'annualDeadlines']);
  const STATUS_DEADLINE_TAGS = new Set(['deadline', 'internal_deadline']);

  const allTaggedDates = [];
  for (const [source, dates] of Object.entries(bySource)) {
    for (const d of dates) allTaggedDates.push(Object.assign({}, d, { source }));
  }
  const ourDates = allTaggedDates.filter((d) => OUR_SOURCES.has(d.source));
  const opens = ourDates.filter((d) => d.context === 'open' && d.date).sort((a, b) => a.date < b.date ? -1 : 1);
  const deadlines = ourDates.filter((d) => STATUS_DEADLINE_TAGS.has(d.context) && d.date).sort((a, b) => a.date < b.date ? -1 : 1);
  const allDatesFlat = ourDates.filter((d) => d.date).sort((a, b) => a.date < b.date ? -1 : 1);

  let overallStatus = 'No Dates Found';
  let overallMin = null;
  let overallMax = null;
  let overallMinEntry = null;
  let overallMaxEntry = null;
  if (allDatesFlat.length) {
    overallMinEntry = opens.length ? opens[0] : allDatesFlat[0];
    overallMaxEntry = deadlines.length ? deadlines[deadlines.length - 1] : allDatesFlat[allDatesFlat.length - 1];
    overallMin = overallMinEntry.date;
    overallMax = overallMaxEntry.date;
    overallStatus = classifyStatus(overallMin, overallMax);
  }

  if (STALE_STATUSES.has(overallStatus)) {
    discrepancies.push({
      type: 'stale', status: overallStatus, min: overallMin, max: overallMax,
      minSource: overallMinEntry && overallMinEntry.source, minRaw: overallMinEntry && overallMinEntry.raw,
      maxSource: overallMaxEntry && overallMaxEntry.source, maxRaw: overallMaxEntry && overallMaxEntry.raw,
    });
  }

  if (pauseEntry) {
    overallStatus = 'Paused';
    discrepancies.push({ type: 'paused', source: pauseEntry.source, snippet: pauseEntry.snippet });
  }

  return { awardName, bySource, deadlinesBySource, overallStatus, overallMin, overallMax, discrepancies };
}

module.exports = { analyzeAward };
