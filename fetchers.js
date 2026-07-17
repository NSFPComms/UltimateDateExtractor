const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { PDFParse } = require('pdf-parse'); // v2 API — see fetchProceduresPDF below

const TIMEOUT_MS = 20000;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  // Some WAFs (esp. on paths like "secure-documents") check Referer to
  // block direct/scripted access while allowing normal on-site navigation.
  'Referer': 'https://college.emory.edu/national-awards/',
};

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: BROWSER_HEADERS });
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

async function fetchAwardFinderPage(url) {
  if (!url) return { result: null, recipientsText: '' };
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { result: { status: 'broken_link', text: null, httpStatus: res.status }, recipientsText: '' };
    const html = await res.text();
    const $ = cheerio.load(html);

    // Deadlines live in h3 per the sitemap (AwardFinderEntries -> Award_Deadlines: h3)
    const h3Text = $('h3').map((_, el) => $(el).text()).get().join('. ');
    // Also grab the main content body text for endorsement/internal deadlines
    // that appear as bold inline text rather than h3s (e.g. Schwarzman's
    // "begin your application ... by April 23, 2026" sentence).
    const mainText = $('main, #main, .col-md-8, body').first().text().replace(/\s+/g, ' ');
    const combined = `${h3Text}. ${mainText}`;

    // Recipients tab: per the sitemap this is a click-to-reveal ".show li"
    // block. Emory's markup often renders it directly in the DOM even
    // without the JS click (confirmed on the Schwarzman page); fall back to
    // a heading-based search if not.
    let recipientsText = '';
    const recipHeading = $('*:contains("Previous Recipients")').last();
    if (recipHeading.length) {
      recipientsText = recipHeading.parent().text().replace(/\s+/g, ' ');
    }
    if (!recipientsText) recipientsText = mainText; // fallback: year regex will just scan the whole page

    return { result: { status: 'ok', text: combined }, recipientsText };
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
    $('script, style, nav, footer').remove();
    const text = $('body').text().replace(/\s+/g, ' ');
    return { status: 'ok', text };
  } catch (e) {
    return { status: 'fetch_error', text: null, error: e.message };
  }
}

module.exports = { fetchProceduresPDF, fetchAwardFinderPage, fetchExternalPage };
