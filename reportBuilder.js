const { extractDates } = require('./dateExtractor');
const { analyzeAward } = require('./discrepancyChecker');
const { checkRecipientStaleness } = require('./recipientChecker');

/**
 * @param {string} awardName
 * @param {object} fetchResults - per source: { status: 'ok'|'broken_link'|'fetch_error', text: string|null }
 *   sources expected: procedures, awardFinder, external
 * @param {string} recipientsText - text of the Recipients tab (award-finder page), may be ''
 * @param {number} inferredYear
 */
function buildAwardReport(awardName, fetchResults, recipientsText, inferredYear, sourceUrls = {}) {
  const texts = {};
  const sourceStatus = {};

  for (const [source, result] of Object.entries(fetchResults)) {
    if (!result) { sourceStatus[source] = 'not_tracked'; continue; } // e.g. spreadsheet had n/a
    if (result.status === 'broken_link' || result.status === 'fetch_error') {
      sourceStatus[source] = 'broken_link';
      continue;
    }
    const dates = extractDates(result.text || '', inferredYear);
    if (!dates.length) {
      sourceStatus[source] = 'no_dates_found'; // action item: wrong URL being tracked?
      continue;
    }
    sourceStatus[source] = 'ok';
    texts[source] = result.text;
  }

  const analysis = analyzeAward(awardName, texts, inferredYear);
  const recipientCheck = recipientsText ? checkRecipientStaleness(recipientsText) : null;

  // Action items: broken links, no-dates-found, stale recipients — these are
  // distinct from date discrepancies and always worth surfacing even if the
  // dates that DO exist all agree with each other.
  const actionItems = [];
  for (const [source, status] of Object.entries(sourceStatus)) {
    if (status === 'broken_link') actionItems.push({ type: 'broken_link', source });
    if (status === 'no_dates_found') actionItems.push({ type: 'no_dates_found', source });
  }
  if (recipientCheck && recipientCheck.stale) {
    actionItems.push({ type: 'stale_recipients', reason: recipientCheck.reason });
  }

  return {
    awardName,
    sourceStatus,
    sourceUrls,
    discrepancies: analysis.discrepancies,
    statuses: analysis.statuses,
    actionItems,
    recipientCheck,
    rawDates: analysis.bySource, // full dump for the bottom-of-email section
  };
}

module.exports = { buildAwardReport };
