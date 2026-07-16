const { buildAwardReport } = require('./reportBuilder');
const { buildEmailHTML } = require('./emailBuilder');
const fs = require('fs');

const proceduresText = `To receive feedback on your Schwarzman China application, you must begin the advising process before April 27, 2026. To receive feedback on your Schwarzman US/Global Application, you must begin the advising process before August 14, 2026. 7 Submit application to the Schwarzman Foundation May 20, 2026. 8 Submit application to Schwarzman Foundation September 9, 2026`;
const awardFinderText = `US/Global Competition estimated Deadline: 3:00 PM (ET), September 10, 2026. begin your application and indicate your intent to apply by April 23, 2026 for the China application, and August 6, 2026 for the US application.`;
const externalText = `Application Deadline: Sept 9, 2026 at 3 p.m. EDT. The U.S. and Global application for the class of 2027-2028 is now open from April 8, 2026 to September 9, 2026 at 3 p.m. EDT.`;
const recipientsText = `2020/21: Roda Kesete. 2018/19: Veronica Chua. 2016/17: Caiwei Huang.`;

const schwarzman = buildAwardReport('Schwarzman', {
  procedures: { status: 'ok', text: proceduresText },
  awardFinder: { status: 'ok', text: awardFinderText },
  external: { status: 'ok', text: externalText },
}, recipientsText, 2026, {
  procedures: 'http://college.emory.edu/national-awards/documents/secure-documents/schwarzman-procedures.pdf',
  awardFinder: 'https://college.emory.edu/national-awards/awards/award-schwarzman.html',
  external: 'https://www.schwarzmanscholars.org/admissions/',
});

// Mock: broken external link
const goldwater = buildAwardReport('Goldwater', {
  procedures: { status: 'ok', text: 'Internal deadline November 3, 2026 for the Goldwater Scholarship.' },
  awardFinder: { status: 'ok', text: 'Internal deadline: November 3, 2026.' },
  external: { status: 'broken_link', text: null },
}, `2024/25: Jane Doe.`, 2026, {
  procedures: 'http://college.emory.edu/national-awards/documents/secure-documents/goldwater-procedures.pdf',
  awardFinder: 'https://college.emory.edu/national-awards/awards/award-goldwater.html',
  external: 'https://goldwaterscholarship.gov/important-dates/',
});

// Mock: award-finder page loads but has no dates (wrong URL / page redesigned)
const truman = buildAwardReport('Truman', {
  procedures: { status: 'ok', text: 'Internal deadline January 15, 2027.' },
  awardFinder: { status: 'ok', text: 'The Truman Scholarship recognizes public service leadership. No specific dates on this page anymore.' },
  external: { status: 'ok', text: 'Application deadline: January 15, 2027.' },
}, `2024/25: John Smith.`, 2026, {
  procedures: 'http://college.emory.edu/national-awards/documents/secure-documents/truman-procedures.pdf',
  awardFinder: 'https://college.emory.edu/national-awards/awards/award-truman.html',
  external: 'https://www.truman.gov/apply/applying/important-dates',
});

// Mock: everything clean, recent recipients, no issues
const marshall = buildAwardReport('Marshall', {
  procedures: { status: 'ok', text: 'Internal deadline: September 1, 2026.' },
  awardFinder: { status: 'ok', text: 'Internal deadline: September 1, 2026.' },
  external: { status: 'ok', text: 'Application deadline: September 1, 2026.' },
}, `2025/26: Alex Kim.`, 2026, {
  procedures: 'http://college.emory.edu/national-awards/documents/secure-documents/marshall-procedures.pdf',
  awardFinder: 'https://college.emory.edu/national-awards/awards/award-marshall.html',
  external: 'https://www.marshallscholarship.org/apply',
});

const reports = [schwarzman, goldwater, truman, marshall];
const html = buildEmailHTML(reports);
fs.writeFileSync('/home/claude/award-scraper/sample-email.html', html);
console.log('Written sample-email.html');
console.log('\nAction items found:');
reports.forEach((r) => console.log(r.awardName, '->', JSON.stringify(r.actionItems)));
