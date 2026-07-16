const { analyzeAward } = require('./discrepancyChecker');

const proceduresText = `
Applicants who hold Chinese passports must apply through the China competition. Applicants who are US
citizens or hold passports from countries other than China apply through the US/Global competition. To
receive feedback on your Schwarzman China application, you must begin the advising process before April
27, 2026. To receive feedback on your Schwarzman US/Global Application, you must begin the advising
process before August 14, 2026.
Recommended Application Timeline: China Competition Applicants
1 Schedule a Consultation with an NS&FP advisor Spring 2026
5 Revise personal statement and essays April 26 – May 16, 2026
6 Follow up with recommenders Mid-May 2026
7 Submit application to the Schwarzman Foundation May 20, 2026
Recommended Application Timeline: US/Global Competition Applicants
8 Submit application to Schwarzman Foundation September 9, 2026
`;

const awardFinderText = `
US/Global Competition Estimated Open Date: April 2026
US/Global Competition estimated Deadline: 3:00 PM (ET), September 10, 2026
Chinese Passport Holder Application Period: January 2026 - May 2026
you will need to begin your application and indicate your intent to apply by April 23, 2026 for the
China application, and August 6, 2026 for the US application.
`;

const externalText = `
Current Selection Cycle: Countdown to September 9, 2026 Application Deadline
U.S. and Global Applicants
Application Now Open
Application Deadline: Sept 9, 2026 at 3 p.m. EDT
Selection Cycle: Oct – Nov 2026
APPLICANTS WITH CHINESE CITIZENSHIP
Application Period: Jan 2026 – May 2026
The U.S. and Global application for the class of 2027-2028 is now open from April 8, 2026 to September 9, 2026 at 3 p.m. EDT.
`;

const result = analyzeAward('Schwarzman', {
  procedures: proceduresText,
  awardFinder: awardFinderText,
  external: externalText,
}, 2026);

console.log('=== Extracted deadline-tagged dates by source ===');
console.log(JSON.stringify(result.deadlinesBySource, null, 2));

console.log('\n=== Status per source ===');
console.log(JSON.stringify(result.statuses, null, 2));

console.log('\n=== Discrepancies flagged ===');
console.log(JSON.stringify(result.discrepancies, null, 2));
