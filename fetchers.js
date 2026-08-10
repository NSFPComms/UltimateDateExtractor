const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { PDFParse } = require('pdf-parse'); // v2 API — see fetchProceduresPDF below

const TIMEOUT_MS = 20000;

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
};

// The Emory referer helps bypass Emory's own WAF on paths like
// "secure-documents" (which checks for on-site navigation), but sending it
// to unrelated THIRD-PARTY sites is actually counterproductive — a real
// visitor navigating directly to an external site wouldn't carry an Emory
// referer at all, and that mismatch is exactly the kind of signal bot
// detection looks for. Only attach it for Emory's own domain.
const EMORY_HEADERS = Object.assign({}, COMMON_HEADERS, {
  'Referer': 'https://college.emory.edu/national-awards/',
});

async function fetchWithTimeout(url, opts) {
  const isEmory = /(^|\.)emory\.edu$/i.test(new URL(url).hostname);
  const headers = (opts && opts.forceEmoryHeaders) || isEmory ? EMORY_HEADERS : COMMON_HEADERS;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow', headers });
    clearTimeout(t);
    return res;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

// "Only hard failures count as broken" — network errors, timeouts, and
// non-2xx HTTP status. We do NOT try to detect soft 404s / redirected error
// pages dressed up as 200s; that's a later refinement if it turns out to
// matter in practice.
async function fetchProceduresPDF(url) {
  if (!url) return null;
  let parser;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { status: 'broken_link', text: null, httpStatus: res.status };
    const buf = await res.buffer();
    // pdf-parse v2: no longer a plain callable function (that was v1) — it's
    // now a class. new PDFParse({ data }) + .getText(), then must .destroy()
    // to free the underlying worker.
    parser = new PDFParse({ data: buf });
    const result = await parser.getText();
    return { status: 'ok', text: result.text };
  } catch (e) {
    return { status: 'fetch_error', text: null, error: e.message };
  } finally {
    if (parser) await parser.destroy().catch(() => {});
  }
}

// Strips common chrome/boilerplate that isn't part of the actual page
// content — semantic tags AND common non-semantic menu/nav patterns (many
// sites, like goldwaterscholarship.gov, build navigation out of plain
// <ul>/<div> without a <nav> tag, which a semantic-only strip would miss).
function stripChrome($) {
  $('script, style, noscript, nav, header, footer, aside, form, iframe').remove();
  $('[class*="menu" i], [id*="menu" i], [class*="nav" i], [id*="nav" i], [class*="sidebar" i], [class*="widget" i], [class*="social" i], [class*="breadcrumb" i], [role="navigation"]').remove();
  return $;
}

// Extracts text while preserving line breaks between block-level elements.
// Cheerio's plain .text() concatenates everything with no separators unless
// the source HTML happens to have whitespace text nodes between tags — on
// tightly-packed table/list layouts (no whitespace in the markup) this glues
// unrelated rows together into one giant run with no sentence boundary. That
// was the root cause of a page-top header ("APPLICATION DEADLINE:") bleeding
// into every row below it on a row-per-line layout: by the time the text
// reached date extraction, ALL of its line structure had already been
// collapsed away. Inserting explicit newlines at block boundaries first
// fixes that at the source.
function textPreservingLines($, root) {
  const $root = $(root).clone();
  $root.find('br').replaceWith('\n');
  $root.find('p, div, li, tr, td, th, h1, h2, h3, h4, h5, h6, section, article').each((_, el) => {
    $(el).append('\n');
  });
  return $root.text().replace(/[ \t]+/g, ' ').replace(/\n[ \t]*\n+/g, '\n').trim();
}

async function fetchAwardFinderPage(url) {
  if (!url) return { result: null, recipientsText: '' };
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { result: { status: 'broken_link', text: null, httpStatus: res.status }, recipientsText: '' };
    const html = await res.text();
    const $ = cheerio.load(html);

    // Recipients tab text must be captured BEFORE chrome-stripping in case
    // it lives near a nav-like class name; capture first, strip after.
    let recipientsText = '';
    const recipHeading = $('*:contains("Previous Recipients")').last();
    if (recipHeading.length) {
      recipientsText = textPreservingLines($, recipHeading.parent());
    }

    stripChrome($);
    // Deadlines live in h3 per the sitemap (AwardFinderEntries -> Award_Deadlines: h3),
    // but h3 elements are already part of the body text below — do NOT
    // concatenate them separately, or every h3 date gets counted twice.
    const root = $('main, #main, .col-md-8, body').first();
    const mainText = textPreservingLines($, root);
    if (!recipientsText) recipientsText = mainText; // fallback: year regex will just scan the whole page

    return { result: { status: 'ok', text: mainText }, recipientsText };
  } catch (e) {
    return { result: { status: 'fetch_error', text: null, error: e.message }, recipientsText: '' };
  }
}

async function fetchExternalPage(url) {
  if (!url) return null;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { status: 'broken_link', text: null, httpStatus: res.status };
    const html = await res.text();
    const $ = cheerio.load(html);
    stripChrome($);
    const text = textPreservingLines($, 'body');
    return { status: 'ok', text };
  } catch (e) {
    return { status: 'fetch_error', text: null, error: e.message };
  }
}

// ==========================================================================
// Annual Deadlines page — one page covering many awards in two HTML tables,
// with EXPLICIT named columns (Internal Deadline, External Deadline, etc.)
// Since the column tells us the category with certainty, we bypass
// tagContext's guesswork entirely and force the category per-column.
// ==========================================================================

// Column header text (lowercased, partial match) -> forced context tag.
const ANNUAL_DEADLINES_COLUMN_MAP = [
  { match: /pre-?application|early decision/i, tag: 'deadline' },
  { match: /internal deadline/i, tag: 'internal_deadline' },
  { match: /interview/i, tag: 'interview' },
  { match: /revision/i, tag: 'internal_deadline' },
  { match: /external deadline/i, tag: 'deadline' },
];

// Award-name aliases: the annual-deadlines page uses slightly different
// naming than our award-finder page slugs. Built by hand from the page's
// actual rows rather than fuzzy-matched, since there are only ~20 and a
// couple (US-Ireland Alliance -> Mitchell) aren't guessable from text alone.
const ANNUAL_DEADLINES_ALIASES = {
  'beinecke scholarship program': 'Beinecke',
  'carnegie junior fellows program': 'Carnegie',
  'churchill foundation': 'Churchill',
  'david-weill scholarship': 'David Weill',
  'fulbright fellowship program (eta)': 'Fulbright Eta',
  'fulbright fellowship program (r/s)': 'Fulbright Rs',
  'goldwater scholarships': 'Goldwater',
  'knight-hennessy scholars program': 'Knight Hennessy',
  'marshall scholarships': 'Marshall',
  'us-ireland alliance scholarships': 'Mitchell',
  'rhodes scholarships': 'Rhodes',
  'rhodes (international)': 'Rhodes',
  'schwarzman scholarships (china)': 'Schwarzman',
  'schwarzman scholarships (us)': 'Schwarzman',
  'truman scholarship': 'Truman',
  'bobby jones scholarship': 'B Jones Scholar',
  'bredow memorial fund': 'Bredow',
  'shepard scholarship': 'Shepard',
  'sonny carter scholarship': 'Sonny Carter',
};

/**
 * Fetches the annual-deadlines page ONCE and returns a Map of
 * awardName -> array of {tag, text} cell entries.
 */
async function fetchAnnualDeadlinesPage(url) {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { status: 'broken_link', httpStatus: res.status, byAward: new Map() };
    const html = await res.text();
    const $ = cheerio.load(html);
    const byAward = new Map(); // awardName -> array of {tag, text}

    $('table').each((_, table) => {
      const headers = $(table).find('th').map((_, th) => $(th).text().trim()).get();
      if (!headers.length) return;
      const colTags = headers.map((h) => {
        const found = ANNUAL_DEADLINES_COLUMN_MAP.find((c) => c.match.test(h));
        return found ? found.tag : null;
      });

      $(table).find('tbody tr, tr').each((_, tr) => {
        const cells = $(tr).find('td');
        if (!cells.length) return; // header row
        const rawName = $(cells[0]).text().trim();
        if (!rawName) return;
        const normalized = rawName.toLowerCase().replace(/\s+/g, ' ').trim();
        const awardName = ANNUAL_DEADLINES_ALIASES[normalized];
        if (!awardName) return; // not one of ours (e.g. Dean's Achievement, Mellon-Mays)

        if (!byAward.has(awardName)) byAward.set(awardName, []);
        cells.each((i, cell) => {
          if (i === 0) return; // name column
          const tag = colTags[i];
          if (!tag) return;
          const text = $(cell).text().trim();
          if (!text || /^(n\/a|tba|paused|non-endorsed|varies)/i.test(text)) return;
          byAward.get(awardName).push({ tag, text });
        });
      });
    });

    return { status: 'ok', byAward };
  } catch (e) {
    return { status: 'fetch_error', error: e.message, byAward: new Map() };
  }
}

module.exports = { fetchProceduresPDF, fetchAwardFinderPage, fetchExternalPage, fetchAnnualDeadlinesPage };
