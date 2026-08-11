// ==========================================================================
// dateExtractor.js
// Ported from the NS&FP Word/VBA Procedure Date Extractor.
// Same core ideas, re-expressed for plain-text sources (PDF text, HTML text,
// external site text) instead of a Word Document/Range object:
//   - regex date/range/period/TBA detection
//   - "context tag" from surrounding text (what is this date FOR)
//   - MinDate/MaxDate -> status classification (ported from the MS List formula)
// ==========================================================================

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12
};

const MONTH_RE = 'January|February|March|April|May|June|July|August|September|Sept|Sep|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Oct|Nov|Dec';

// "Month Day, Year" or "Month Day" (year inferred from context if absent)
const DATE_RE = new RegExp(`(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4}))?`, 'gi');

// Day-first format ("29th of September 2026", "1st October 2026") — common
// on UK-based award sites (Marshall, Rhodes, etc.) where DATE_RE's
// month-first assumption never matches at all.
const DAY_FIRST_DATE_RE = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)\\s+(?:of\\s+)?(${MONTH_RE})\\.?\\s*,?\\s*(20\\d{2})?\\b`, 'gi');

// Ranges: "September 29 - October 6, 2026" / "Sept 2-15, 2026" / "Sep. 22- Oct 1"
const RANGE_RE = new RegExp(
  `(between\\s+|from\\s+|week of\\s+)?(${MONTH_RE})\\.?\\s+(\\d{1,2})\\s*(-|–|—|to|and)\\s*(?:(${MONTH_RE})\\.?\\s+)?(\\d{1,2})(?:,?\\s*(\\d{4}))?`,
  'gi'
);

// Bare month-to-month ranges: "May – July 2026"
const MONTH_RANGE_RE = new RegExp(
  `(${MONTH_RE})\\.?\\s*[-–—]\\s*(${MONTH_RE})\\.?\\s+(\\d{4})`,
  'gi'
);

// "TBA"
const TBA_RE = /(\w+)\s+(?:APPLICATION\s+DUE\s+DATE|DUE\s+DATE|DEADLINE|DATES|DATE)\s+TBA/gi;

// Dates embedded in legal/regulatory citations are correctly formatted but
// not real award dates at all — e.g. "63 Federal Register 265 (January 5,
// 1998)" cited in boilerplate NSF compliance language. These get discarded
// entirely rather than mis-tagged, since they're meaningless for min/max
// status classification and just add noise.
const CITATION_CONTEXT_RE = /federal register|u\.s\.c\.|c\.f\.r\.|public law|system of record|\bnotices\b|\bstat\.\s*\d/i;

// Seasonal periods: "Fall 2026", "Early Spring 2027", "Mid-to-late Summer 2026".
// Ported from the VBA's FindPeriods, which explicitly handled season words —
// missed in the initial JS port, which only recognized month names. A phrase
// like "will be available Fall 2026" carries real signal even with no exact
// date, and shouldn't produce nothing.
const SEASON_RE = /\b(early|late|mid(?:-to-late)?)?[\s-]*(spring|summer|fall|autumn|winter)\.?\s+(\d{4})\b/gi;
// Representative day-of-year per season (astronomical-ish, "mid" of season),
// shifted earlier/later for Early/Late modifiers. Good enough for min/max
// date-range classification — not meant to be a precise calendar date.
const SEASON_ANCHOR = { spring: [3, 20], summer: [6, 21], fall: [9, 22], autumn: [9, 22], winter: [12, 21] };

// Bare year-to-year ranges: "the 2025-2027 class", "2025-2026 cycle" — a
// cohort/program span, not itself a deadline. Requires a following word
// like "class"/"cohort"/"cycle" to avoid false-matching things like page
// numbers or unrelated hyphenated number pairs.
const YEAR_RANGE_RE = /\b(20\d{2})\s*[-–—]\s*(20\d{2})\b(?=\s*\w*\s*(class|cohort|cycle|program))/gi;

// Modifier + bare year with no month/season word: "late 2026", "early 2027".
const MODIFIER_YEAR_RE = /\b(early|late|mid(?:-to-late)?)\s+(20\d{2})\b/gi;
// Rough anchor point within the year per modifier (month, day).
const MODIFIER_YEAR_ANCHOR = { early: [2, 15], mid: [6, 15], 'mid-to-late': [8, 1], late: [10, 15] };

// Month + Year with no day number: "will open again in September 2026".
// DATE_RE requires a day between month and year, so this never matched at
// all — a genuinely common way of stating a vague future period.
const MONTH_YEAR_RE = new RegExp(`\\b(${MONTH_RE})\\.?\\s+(20\\d{2})\\b`, 'gi');

// Rhythm dates ("Last Friday in January", "First week in March") — ported
// from the VBA's NthWeekdayLabel/FindNthWeekday. These describe a REAL
// calendar date via a rule rather than stating one directly; resolving them
// to an actual date (for whatever year context applies) is what the VBA did
// for its "Rhythm" date type.
const WEEKDAY_NUMS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const ORDINAL_INDEX = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4 };
const RHYTHM_WEEKDAY_RE = new RegExp(
  `\\b(first|second|third|fourth|fifth|last)\\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\\s*(?:of|in)?\\s*(${MONTH_RE})\\b`,
  'gi'
);
const RHYTHM_WEEK_RE = new RegExp(`\\b(first|second|third|fourth|last)\\s+week\\s+(?:of|in)\\s+(${MONTH_RE})\\b`, 'gi');

// Returns the day-of-month (1-31) for the Nth occurrence of a weekday in a
// given month/year, or the LAST occurrence if ordinal === 'last'.
function nthWeekdayOfMonth(year, monthNum, weekdayNum, ordinal) {
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const matches = [];
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(Date.UTC(year, monthNum - 1, d)).getUTCDay() === weekdayNum) matches.push(d);
  }
  if (ordinal === 'last') return matches[matches.length - 1] || null;
  const idx = ORDINAL_INDEX[ordinal];
  return idx !== undefined && matches[idx] !== undefined ? matches[idx] : null;
}

// Context keyword categories — ported from GetContextTag/GetVerbNounTag.
// ORDER MATTERS: most specific first. A bare "deadline" is the least
// informative signal and must be checked LAST among the meaningful
// categories, otherwise "Recommendation letters deadline: Jan 11" gets
// swallowed into generic "deadline" before ever reaching "recommenders".
//
// Two categories worth flagging as still-uncertain assumptions:
//  - internal_deadline: "deadline to apply for/receive Emory's internal
//    endorsement" (confirmed distinct from feedback_deadline below).
//  - feedback_deadline: "deadline to begin advising process to receive
//    feedback on drafts" — split out from internal_deadline after
//    confirming these are NOT the same gate in your process.
const CONTEXT_CATEGORIES = [
  {
    tag: 'recommenders',
    patterns: [
      /letters?\s+of\s+recommendation/i,
      /recommendation\s+letters?/i,
      /recommenders?.{0,25}(due|deadline|submit|upload)/i,
      /(due|deadline|submit).{0,25}recommenders?/i,
      /follow.?up\s+with\s+recommenders/i,
      /letter.{0,20}(due|deadline)/i,
    ],
  },
  {
    tag: 'feedback_deadline',
    patterns: [
      /receive\s+feedback/i,
      /request\s+feedback/i,
      /feedback\s+(deadline|due|on)/i,
      /begin\s+the\s+advising\s+process/i,
    ],
  },
  {
    tag: 'internal_deadline',
    patterns: [
      /internal\s*(application)?\s*deadline/i,
      /institutional\s+endorsement(\s+deadline)?/i,
      /indicate\s+your\s+intent\s+to\s+apply/i,
      /internal\s+application/i,
      /campus\s+deadline/i,
    ],
  },
  { tag: 'interview', patterns: [/campus\s+interview/i, /practice\s+interview/i, /\binterview/i] },
  { tag: 'results', patterns: [/admissions?\s+decisions?/i, /selection\s+cycle/i, /notification/i, /finalists?/i, /awardees?\s+announced/i, /scholars?\s+announced/i] },
  { tag: 'open', patterns: [/application(s)?\s+open/i, /open\s+date/i, /application\s+period/i, /now\s+open/i, /begin\s+online\s+application/i, /register\s+and\s+begin/i, /\bopens\b/i, /will\s+open/i, /will\s+be\s+available/i, /available\s+(starting|beginning|in)/i] },
  {
    tag: 'deadline', // generic catch-all — deliberately last
    patterns: [/external\s*(application)?\s*deadline/i, /final\s+application\s+deadline/i, /application\s+deadline/i, /submission\s+date/i, /submit.{0,20}online\s+application/i, /submit.{0,15}application/i, /must\s+be\s+submitted/i, /nomination\s+submission\s+deadline/i, /due\s+date/i, /\bdeadline/i],
  },
];

// Deadline-flavored tags that only make sense for a PUNCTUAL date, not a
// span of time. A date RANGE describes a period (e.g. a program's session
// dates), not a due date — so even if "deadline" happens to appear nearby
// (e.g. a page-level header bleeding in), a range should never be tagged as
// one of these. This is what was misfiring on Amgen's page: 14 program-date
// RANGES were getting tagged "deadline" because a single "APPLICATION
// DEADLINE:" header sat at the top of an otherwise separator-free block.
const PUNCTUAL_ONLY_TAGS = new Set(['deadline', 'internal_deadline', 'feedback_deadline', 'recommenders']);

function tagContext(snippet, opts) {
  const isRange = opts && opts.isRange;
  for (const cat of CONTEXT_CATEGORIES) {
    if (isRange && PUNCTUAL_ONLY_TAGS.has(cat.tag)) continue;
    if (cat.patterns.some((p) => p.test(snippet))) return cat.tag;
  }
  return 'other';
}

// Proximity-based tagging: for sentences like "the internal deadline is
// January 23 and the external deadline is January 30", checking "does
// 'internal deadline' appear ANYWHERE in the shared sentence" tags BOTH
// dates as internal — the qualifier's mere presence, not its distance from
// this specific date, decided the tag. This finds the CLOSEST matching
// qualifier to the actual date position instead, so each date picks up
// whichever label is actually next to it.
function tagContextByProximity(text, matchPos, opts) {
  const isRange = opts && opts.isRange;
  const WINDOW = 200; // chars each direction to search for qualifying phrases
  const winStart = Math.max(0, matchPos - WINDOW);
  const winEnd = Math.min(text.length, matchPos + WINDOW);
  // Don't search across a sentence boundary — a qualifier in a PRIOR
  // unrelated sentence shouldn't out-compete one in this date's own sentence.
  let searchStart = winStart, searchEnd = winEnd;
  for (let i = matchPos - 1; i >= winStart; i--) {
    if (text[i] === '\n' || text[i] === '\r' || text[i] === '.' || text[i] === '\t') { searchStart = i + 1; break; }
  }
  for (let i = matchPos; i < winEnd; i++) {
    if (text[i] === '\n' || text[i] === '\r' || text[i] === '.' || text[i] === '\t') { searchEnd = i; break; }
  }
  const window = text.slice(searchStart, searchEnd);
  const relPos = matchPos - searchStart;

  let bestTag = null, bestDist = Infinity, bestPriority = Infinity;
  CONTEXT_CATEGORIES.forEach((cat, priority) => {
    if (isRange && PUNCTUAL_ONLY_TAGS.has(cat.tag)) return;
    for (const pattern of cat.patterns) {
      const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
      const re = new RegExp(pattern.source, flags);
      let pm;
      while ((pm = re.exec(window))) {
        const matchStart = pm.index, matchEnd = pm.index + pm[0].length;
        const dist = relPos < matchStart ? matchStart - relPos : (relPos > matchEnd ? relPos - matchEnd : 0);
        if (dist < bestDist || (dist === bestDist && priority < bestPriority)) {
          bestDist = dist; bestTag = cat.tag; bestPriority = priority;
        }
        if (pm.index === re.lastIndex) re.lastIndex++; // avoid infinite loop on zero-width matches
      }
    }
  });
  return bestTag || 'other';
}

// Sentence-boundary extraction — ported from the VBA's GetSentenceAtPosition.
// Walks outward from a match position to the nearest boundary character
// (newline, period, tab, or middle-dot), rather than a fixed character
// radius — but capped at MAX_WALK so a boundary-free block of text (e.g. a
// densely packed table with no periods) can't let a distant, unrelated
// header bleed all the way into every date's context.
const MAX_WALK = 150;
function getSentenceAt(text, pos, matchLen) {
  const isBoundary = (ch) => ch === '\n' || ch === '\r' || ch === '.' || ch === '\t' || ch === '\u00B7';
  let start = pos;
  while (start > 0 && pos - start < MAX_WALK && !isBoundary(text[start - 1])) start--;
  let end = pos + matchLen;
  while (end < text.length && end - (pos + matchLen) < MAX_WALK && !isBoundary(text[end])) end++;
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function monthNum(name) {
  return MONTHS[name.slice(0, name.length > 4 ? 4 : 3).toLowerCase()] || MONTHS[name.toLowerCase()];
}

// Turns a regex match into an ISO date. inferredYear used when year is absent
// (procedures docs often omit the year on later mentions in the same cycle).
function toISO(monthName, day, year, inferredYear) {
  const mm = monthNum(monthName);
  if (!mm) return null;
  const yyyy = year ? parseInt(year, 10) : inferredYear;
  if (!yyyy) return null;
  const dd = parseInt(day, 10);
  if (dd < 1 || dd > 31) return null;
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  return d.toISOString().slice(0, 10);
}

/**
 * Extract all dates/ranges/TBAs from a block of plain text.
 * @param {string} text
 * @param {number} inferredYear - fallback year for dates that omit one
 * @returns {Array<{raw, date, dateEnd, type, context, isTentative, hint}>}
 *   `hint` is the nearby text the tagger saw when deciding the context —
 *   always populated so any tag (not just unresolved "other" ones) can be
 *   spot-checked against its source, since a confident-but-wrong tag (e.g.
 *   a deadline mislabeled "open" because "Application Opens" bled in from
 *   an adjacent sentence) is just as important to catch as an unresolved one.
 */
function extractDates(text, inferredYear) {
  if (inferredYear === undefined) inferredYear = new Date().getFullYear();
  const results = [];
  const claimedRanges = []; // char ranges already consumed by RANGE_RE / MONTH_RANGE_RE

  // A date with no explicit year (e.g. "the October 16 deadline" appearing
  // later in a doc that said "October 16, 2025" earlier) should inherit that
  // document's actual cycle year, not whatever year the scraper happens to
  // run in. Blindly using the scrape-time year turned "October 16" into
  // "October 16, 2026" — a full year wrong and in the FUTURE relative to the
  // real Nov 2025 cycle — which silently corrupted status classification.
  //
  // Build a position->year map, but ONLY from years that are actually
  // attached to a real "Month Day, Year" date elsewhere in the text — NOT
  // from any bare 4-digit 20xx number. A founding year ("Created in 2007"),
  // a legal citation ("Federal Register ... 1998"), or a class year
  // ("2025-2027 class") have zero connection to an actual date and were
  // getting borrowed as if they were the document's cycle year, producing
  // wildly wrong results (e.g. "May 1st" resolving to "May 1, 2007").
  const yearPositions = [];
  const yearScanRe = new RegExp(`(?:${MONTH_RE})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s*(20\\d{2})`, 'gi');
  let ym;
  while ((ym = yearScanRe.exec(text))) {
    yearPositions.push({ pos: ym.index, year: parseInt(ym[1], 10) });
  }
  function nearestYear(pos) {
    if (!yearPositions.length) return inferredYear;
    // Prefer the SMALLEST year among candidates within a generous radius,
    // not just whichever is textually closest. A bare date silently
    // inheriting a LATER year than intended (e.g. "by August 1" picking up
    // 2026 from a nearby "January 7, 2026" mention, when the correct year
    // was 2025 — the same cycle as an October 2025 deadline mentioned
    // earlier) is a worse failure than staying conservative: it makes an
    // already-closed cycle look falsely still-open.
    const RADIUS = 1000;
    const nearby = yearPositions.filter((yp) => Math.abs(pos - yp.pos) <= RADIUS);
    const pool = nearby.length ? nearby : yearPositions;
    let best = pool[0], bestDist = Math.abs(pos - best.pos);
    for (const yp of pool) {
      if (yp.year < best.year || (yp.year === best.year && Math.abs(pos - yp.pos) < bestDist)) {
        best = yp; bestDist = Math.abs(pos - yp.pos);
      }
    }
    return best.year;
  }

  const withHint = (entry, snippet) => {
    entry.hint = snippet;
    return entry;
  };
  // Discard dates from legal/regulatory citations entirely — correctly
  // formatted but not real award dates (e.g. "63 Federal Register 265
  // (January 5, 1998)" in NSF compliance boilerplate). Returning null here
  // means the match gets dropped rather than mis-tagged.
  const isCitation = (snippet) => CITATION_CONTEXT_RE.test(snippet);

  // 1. TBA
  let m;
  const tbaRe = new RegExp(TBA_RE.source, 'gi');
  while ((m = tbaRe.exec(text))) {
    const snippet = getSentenceAt(text, m.index, m[0].length);
    results.push(withHint({
      raw: m[0], date: null, dateEnd: null, type: 'TBA',
      context: tagContextByProximity(text, m.index),
      isTentative: false,
    }, snippet));
  }

  // 1b. Day-first dates ("29th of September 2026") — must run before the
  // month-first DATE_RE below, and claim its range, or DATE_RE could
  // misread the leading digits of a 4-digit year as a 1-2 digit day (e.g.
  // mistaking "September 20" out of "September 2026").
  const dayFirstRe = new RegExp(DAY_FIRST_DATE_RE.source, 'gi');
  while ((m = dayFirstRe.exec(text))) {
    const full = m[0], day = m[1], mon = m[2], year = m[3];
    const dayNum = parseInt(day, 10);
    if (dayNum < 1 || dayNum > 31) continue;
    const iso = toISO(mon, day, year, nearestYear(m.index));
    if (!iso) continue;
    claimedRanges.push([m.index, m.index + full.length]);
    const snippet = getSentenceAt(text, m.index, full.length);
    results.push(withHint({
      raw: full.trim(), date: iso, dateEnd: null, type: 'date',
      context: tagContextByProximity(text, m.index),
      isTentative: /tentative|estimated/i.test(snippet),
    }, snippet));
  }

  // 2. Explicit day-day / month-day ranges
  const rangeRe = new RegExp(RANGE_RE.source, 'gi');
  while ((m = rangeRe.exec(text))) {
    const full = m[0], mon1 = m[2], day1 = m[3], mon2 = m[5], day2 = m[6], year = m[7];
    const startISO = toISO(mon1, day1, year, nearestYear(m.index));
    const endISO = toISO(mon2 || mon1, day2, year, nearestYear(m.index));
    if (startISO) {
      claimedRanges.push([m.index, m.index + full.length]);
      const snippet = getSentenceAt(text, m.index, full.length);
      results.push(withHint({
        raw: full.trim(), date: startISO, dateEnd: endISO || startISO, type: 'range',
        context: tagContextByProximity(text, m.index, { isRange: true }),
        isTentative: /tentative/i.test(snippet),
      }, snippet));
    }
  }

  // 3. Month-to-month ranges ("May – July 2026")
  const monRangeRe = new RegExp(MONTH_RANGE_RE.source, 'gi');
  while ((m = monRangeRe.exec(text))) {
    const full = m[0], mon1 = m[1], mon2 = m[2], year = m[3];
    const startISO = toISO(mon1, '1', year, nearestYear(m.index));
    if (startISO) {
      claimedRanges.push([m.index, m.index + full.length]);
      const snippet = getSentenceAt(text, m.index, full.length);
      results.push(withHint({
        raw: full.trim(), date: startISO, dateEnd: null, type: 'period',
        context: tagContextByProximity(text, m.index, { isRange: true }),
        isTentative: false,
      }, snippet));
    }
  }

  // 3b. Seasonal periods ("Fall 2026", "Early Spring 2027") — not month
  // names, so DATE_RE/RANGE_RE never see these at all without this branch.
  const seasonRe = new RegExp(SEASON_RE.source, 'gi');
  while ((m = seasonRe.exec(text))) {
    const full = m[0], modifier = (m[1] || '').toLowerCase(), season = m[2].toLowerCase(), year = m[3];
    const anchor = SEASON_ANCHOR[season];
    if (!anchor) continue;
    let [mm, dd] = anchor;
    if (modifier === 'early') dd = Math.max(1, dd - 15);
    else if (modifier === 'late') dd = Math.min(28, dd + 15);
    const d = new Date(Date.UTC(parseInt(year, 10), mm - 1, dd));
    const iso = d.toISOString().slice(0, 10);
    claimedRanges.push([m.index, m.index + full.length]);
    const snippet = getSentenceAt(text, m.index, full.length);
    results.push(withHint({
      raw: full.trim(), date: iso, dateEnd: null, type: 'period',
      context: tagContextByProximity(text, m.index, { isRange: true }), // treated like a range: a season is a span, not a punctual deadline
      isTentative: true, // seasonal estimates are inherently approximate — always flagged so status logic doesn't treat them as firm
    }, snippet));
  }

  // 3c. Bare year-to-year ranges ("the 2025-2027 class")
  const yearRangeRe = new RegExp(YEAR_RANGE_RE.source, 'gi');
  while ((m = yearRangeRe.exec(text))) {
    const full = m[0], y1 = m[1];
    const iso = new Date(Date.UTC(parseInt(y1, 10), 0, 1)).toISOString().slice(0, 10);
    claimedRanges.push([m.index, m.index + full.length]);
    const snippet = getSentenceAt(text, m.index, full.length);
    results.push(withHint({
      raw: full.trim(), date: iso, dateEnd: null, type: 'period',
      context: tagContextByProximity(text, m.index, { isRange: true }),
      isTentative: true,
    }, snippet));
  }

  // 3d. Modifier + bare year, no month/season word ("late 2026")
  const modYearRe = new RegExp(MODIFIER_YEAR_RE.source, 'gi');
  while ((m = modYearRe.exec(text))) {
    const inRange = claimedRanges.some((r) => m.index >= r[0] && m.index < r[1]);
    if (inRange) continue; // avoid double-counting a modifier already consumed by the season pattern
    const full = m[0], modifier = m[1].toLowerCase(), year = m[2];
    const anchor = MODIFIER_YEAR_ANCHOR[modifier];
    if (!anchor) continue;
    const iso = new Date(Date.UTC(parseInt(year, 10), anchor[0] - 1, anchor[1])).toISOString().slice(0, 10);
    claimedRanges.push([m.index, m.index + full.length]);
    const snippet = getSentenceAt(text, m.index, full.length);
    results.push(withHint({
      raw: full.trim(), date: iso, dateEnd: null, type: 'period',
      context: tagContextByProximity(text, m.index, { isRange: true }),
      isTentative: true,
    }, snippet));
  }

  // 3d2. Rhythm dates — "Last Friday in January", "First week in March".
  // Year is resolved the same way as everything else missing one: nearest
  // legitimate year mentioned in the document, falling back to inferredYear.
  const rhythmWeekdayRe = new RegExp(RHYTHM_WEEKDAY_RE.source, 'gi');
  while ((m = rhythmWeekdayRe.exec(text))) {
    const full = m[0], ordinal = m[1].toLowerCase(), weekdayName = m[2].toLowerCase(), monName = m[3];
    const monN = monthNum(monName);
    const weekdayNum = WEEKDAY_NUMS[weekdayName];
    if (!monN || weekdayNum === undefined) continue;
    const year = nearestYear(m.index);
    const day = nthWeekdayOfMonth(year, monN, weekdayNum, ordinal);
    if (!day) continue;
    const iso = new Date(Date.UTC(year, monN - 1, day)).toISOString().slice(0, 10);
    claimedRanges.push([m.index, m.index + full.length]);
    const snippet = getSentenceAt(text, m.index, full.length);
    results.push(withHint({
      raw: `${full.trim()} (= ${iso})`, date: iso, dateEnd: null, type: 'date',
      context: tagContextByProximity(text, m.index),
      isTentative: true, // resolved from a rule, not stated outright — always flagged
    }, snippet));
  }

  const rhythmWeekRe = new RegExp(RHYTHM_WEEK_RE.source, 'gi');
  while ((m = rhythmWeekRe.exec(text))) {
    const inRange = claimedRanges.some((r) => m.index >= r[0] && m.index < r[1]);
    if (inRange) continue;
    const full = m[0], ordinal = m[1].toLowerCase(), monName = m[2];
    const monN = monthNum(monName);
    if (!monN) continue;
    const year = nearestYear(m.index);
    const daysInMonth = new Date(Date.UTC(year, monN, 0)).getUTCDate();
    let startDay, endDay;
    if (ordinal === 'last') { endDay = daysInMonth; startDay = Math.max(1, daysInMonth - 6); }
    else { startDay = ORDINAL_INDEX[ordinal] * 7 + 1; endDay = Math.min(daysInMonth, startDay + 6); }
    const startISO = new Date(Date.UTC(year, monN - 1, startDay)).toISOString().slice(0, 10);
    const endISO = new Date(Date.UTC(year, monN - 1, endDay)).toISOString().slice(0, 10);
    claimedRanges.push([m.index, m.index + full.length]);
    const snippet = getSentenceAt(text, m.index, full.length);
    results.push(withHint({
      raw: `${full.trim()} (= ${startISO} to ${endISO})`, date: startISO, dateEnd: endISO, type: 'range',
      context: tagContextByProximity(text, m.index, { isRange: true }),
      isTentative: true,
    }, snippet));
  }

  // 3e. Month + Year, no day number ("September 2026")
  const monthYearRe = new RegExp(MONTH_YEAR_RE.source, 'gi');
  while ((m = monthYearRe.exec(text))) {
    const inRange = claimedRanges.some((r) => m.index >= r[0] && m.index < r[1]);
    if (inRange) continue;
    const full = m[0], mon = m[1], year = m[2];
    const iso = toISO(mon, '15', year, parseInt(year, 10)); // mid-month anchor, day is unknown
    if (!iso) continue;
    claimedRanges.push([m.index, m.index + full.length]);
    const snippet = getSentenceAt(text, m.index, full.length);
    results.push(withHint({
      raw: full.trim(), date: iso, dateEnd: null, type: 'period',
      context: tagContextByProximity(text, m.index, { isRange: true }),
      isTentative: true,
    }, snippet));
  }

  // 4. Single dates (skip anything already inside a claimed range)
  const dateRe = new RegExp(DATE_RE.source, 'gi');
  while ((m = dateRe.exec(text))) {
    const inRange = claimedRanges.some(function (r) { return m.index >= r[0] && m.index < r[1]; });
    if (inRange) continue;
    const full = m[0], mon = m[1], day = m[2], year = m[3];
    const dayNum = parseInt(day, 10);
    if (dayNum > 31) continue; // guards against stray 4-digit years matching \d{1,2}
    const iso = toISO(mon, day, year, nearestYear(m.index));
    if (!iso) continue;
    const snippet = getSentenceAt(text, m.index, full.length);
    results.push(withHint({
      raw: full.trim(), date: iso, dateEnd: null, type: 'date',
      context: tagContextByProximity(text, m.index),
      isTentative: /tentative|estimated/i.test(snippet),
    }, snippet));
  }

  return results.filter((r) => !isCitation(r.hint || ''));
}

// ==========================================================================
// Status classification — ported from the MS List helper-column formula.
// Needs a MinDate (earliest "open"-type date) and MaxDate (latest
// "deadline"-type date) for the *current/upcoming* cycle.
// ==========================================================================
function classifyStatus(minDate, maxDate, today) {
  if (today === undefined) today = new Date();
  const DAY = 86400000;
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (!maxDate) return 'Input Needed';
  const min = minDate ? Date.parse(minDate) : null;
  const max = Date.parse(maxDate);
  const daysSince = function (ms) { return Math.floor((t - ms) / DAY); };
  const daysUntil = function (ms) { return Math.floor((ms - t) / DAY); };

  if (min !== null && max <= t && min <= t) {
    // both in the past
    if (daysSince(min) >= 360) return 'Urgent: Update Needed Now';
    if (daysSince(min) >= 330) return 'Check for Deadline Immediately';
    if (daysSince(max) >= 180) return 'New Cycle Dates Pending';
    if (daysSince(max) >= 60) return 'Dormant (Cycle Closed)';
    if (daysSince(max) >= 8) return 'Results Pending';
    return 'Application Closed';
  }
  if (min !== null && min <= t && max >= t) return 'Application Open';
  if (min !== null && min === max) {
    if (daysUntil(max) >= 90) return 'Lookout for Open Date';
    if (daysUntil(max) >= 60) return 'App Open Soon if Not Now';
    if (daysUntil(max) >= 30) return 'Application Likely Open';
    if (daysUntil(max) >= 0) return 'Application Likely Closing Soon';
  }
  if (min !== null && max > min && daysUntil(min) >= 20) return 'Dormant (Waiting for App to Open)';
  if (min !== null && daysUntil(min) >= 0 && daysUntil(min) <= 19) return 'App Opening Soon';
  if (daysUntil(max) >= 1 && daysUntil(max) <= 14) return 'Application Closing Soon';
  if (daysUntil(max) > 14) return 'Application Open';
  return 'Application Closed';
}

// "Lookout for Open Date" deliberately excluded — it fires whenever only a
// single far-future date is on file (no explicit "open" date found), which
// is a normal steady-state for many awards, not an actionable problem.
const STALE_STATUSES = new Set([
  'Urgent: Update Needed Now',
  'Check for Deadline Immediately',
]);

module.exports = { extractDates, tagContext, classifyStatus, STALE_STATUSES };
