const { extractDates } = require('./dateExtractor');
const { analyzeAward } = require('./discrepancyChecker');
const { checkRecipientStaleness } = require('./recipientChecker');

// A crude but cheap signal that extracted text is corrupted (e.g. a PDF
// exported with a font that lacks a proper ToUnicode map, producing
// mojibake instead of real text) rather than genuinely just lacking dates.
// Real English prose of any real length will almost always contain a few of
// these common short words; garbled text won't.
function looksGarbled(text) {
  if (!text || text.length < 100) return false;
  return !/\b(the|and|of|to|in|for|is|are|this|that|application|deadline|award|date)\b/i.test(text);
}

// Some external sites hardcode the application year directly into the URL
// path (e.g. ".../2025JamesMadisonGraduateFellowship" needing manual update
// to ".../2027JamesMadisonGraduateFellowship" each cycle). A stale year here
// means the whole page is probably an old cycle's copy — flag it so it can
// be checked even if the page itself still returns 200 OK with content.
function checkStaleUrlYear(url, currentYear) {
  if (!url) return null;
  const m = url.match(/\b(20\d{2})/);
  if (!m) return null;
  const urlYear = parseInt(m[1], 10);
  if (urlYear >= currentYear) return null; // current or future year in the URL — fine
  // Different sites use different conventions for the year in a URL (the
  // application year vs. the program's start year, often one year later) —
  // offer both nearby candidates rather than confidently guessing wrong.
  return {
    urlYear,
    suggested: url.replace(m[1], String(currentYear)),
    suggestedAlt: url.replace(m[1], String(currentYear + 1)),
  };
}

/**
 * @param {string} awardName
 * @param {object} fetchResults - per source: { status: 'ok'|'broken_link'|'fetch_error', text: string|null }
 *   sources expected: procedures, awardFinder, external
 * @param {string} recipientsText - text of the Recipients tab (award-finder page), may be ''
 * @param {number} inferredYear
 * @param {object} sourceUrls
 * @param {Array|undefined} annualDeadlinesDates - pre-extracted dates for this award from
 *   the annual deadlines page; undefined = award not found on that page at all.
 */
function buildAwardReport(awardName, fetchResults, recipientsText, inferredYear, sourceUrls, annualDeadlinesDates) {
  if (!sourceUrls) sourceUrls = {};
  const texts = {};
  const rawTexts = {}; // ALL successfully-fetched text, even with zero dates found — needed for pause detection, which usually has no dates to find at all
  const sourceStatus = {};
  const sourceDetail = {};

  for (const [source, result] of Object.entries(fetchResults)) {
    if (!result) { sourceStatus[source] = 'not_tracked'; continue; } // e.g. spreadsheet had n/a
    if (result.status === 'broken_link' || result.status === 'fetch_error') {
      sourceStatus[source] = 'broken_link';
      sourceDetail[source] = result.httpStatus ? `HTTP ${result.httpStatus}` : (result.error || 'unknown error');
      continue;
    }
    rawTexts[source] = result.text;
    const dates = extractDates(result.text || '', inferredYear);
    if (!dates.length) {
      // "No dates found" used to be a dead end — genuinely empty page,
      // garbled PDF text, and a blocked/different response all looked
      // identical. Now it's self-diagnosing: a text sample shows exactly
      // what was actually received, and garbled text gets called out
      // explicitly instead of silently blending into "no dates."
      sourceStatus[source] = 'no_dates_found';
      const sample = (result.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      sourceDetail[source] = sample ? `sample: "${sample}${(result.text || '').length > 200 ? '…' : ''}"` : '(page had no text content at all)';
      if (looksGarbled(result.text)) {
        sourceDetail[source] = `TEXT APPEARS GARBLED/CORRUPTED (likely a PDF font encoding issue, not actually empty) — ${sourceDetail[source]}`;
      }
      continue;
    }
    sourceStatus[source] = 'ok';
    texts[source] = result.text;
  }

  // Annual deadlines page: undefined means this award wasn't found in the
  // table at all (not_tracked); empty array means it was found but every
  // cell was a placeholder (N/A, TBA, Paused, etc.) worth flagging.
  const preExtracted = {};
  if (annualDeadlinesDates === undefined) {
    sourceStatus.annualDeadlines = 'not_tracked';
  } else if (!annualDeadlinesDates.length) {
    sourceStatus.annualDeadlines = 'no_dates_found';
  } else {
    sourceStatus.annualDeadlines = 'ok';
    preExtracted.annualDeadlines = annualDeadlinesDates;
  }

  const analysis = analyzeAward(awardName, texts, inferredYear, preExtracted, rawTexts);
  const recipientCheck = recipientsText ? checkRecipientStaleness(recipientsText) : null;

  // Action items: broken links, no-dates-found, stale recipients — these are
  // distinct from date discrepancies and always worth surfacing even if the
  // dates that DO exist all agree with each other.
  const actionItems = [];
  for (const [source, status] of Object.entries(sourceStatus)) {
    if (status === 'broken_link') actionItems.push({ type: 'broken_link', source, detail: sourceDetail[source] });
    if (status === 'no_dates_found') actionItems.push({ type: 'no_dates_found', source, detail: sourceDetail[source] });
  }
  if (recipientCheck && recipientCheck.stale) {
    actionItems.push({ type: 'stale_recipients', reason: recipientCheck.reason });
  }
  for (const [key, url] of Object.entries(sourceUrls)) {
    if (key === 'cascadeEdit') continue; // internal edit link, not an award-facing URL with a "cycle year" concept
    const stale = checkStaleUrlYear(url, inferredYear);
    if (stale) {
      actionItems.push({ type: 'stale_url_year', source: key, urlYear: stale.urlYear, suggested: stale.suggested, suggestedAlt: stale.suggestedAlt });
    }
  }

  return {
    awardName,
    sourceStatus,
    sourceDetail,
    sourceUrls,
    discrepancies: analysis.discrepancies,
    overallStatus: analysis.overallStatus,
    overallMin: analysis.overallMin,
    overallMax: analysis.overallMax,
    actionItems,
    recipientCheck,
    rawDates: analysis.bySource, // full dump for the bottom-of-email section
  };
}

module.exports = { buildAwardReport };
