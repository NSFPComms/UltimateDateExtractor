const { extractDates } = require('./dateExtractor');

/**
 * @param {Array<{tag: string, text: string}>} cellEntries - from fetchAnnualDeadlinesPage's byAward map
 * @param {number} inferredYear
 * @returns {Array} date objects matching extractDates' shape, with context forced to the column's known tag
 */
function extractAnnualDeadlinesDates(cellEntries, inferredYear) {
  const results = [];
  for (const entry of cellEntries || []) {
    const parsed = extractDates(entry.text, inferredYear);
    for (const p of parsed) {
      results.push(Object.assign({}, p, { context: entry.tag })); // override guessed context — the column tells us for certain
    }
  }
  return results;
}

module.exports = { extractAnnualDeadlinesDates };
