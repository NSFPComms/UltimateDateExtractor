const fs = require('fs');

function slugToName(url) {
  const m = url.match(/award-(.+)\.html/);
  if (!m) return url;
  return m[1].split('-').map((w) => w.toUpperCase() === w ? w : w[0].toUpperCase() + w.slice(1)).join(' ');
}

function na(v) { return v === 'n/a' ? null : v; }

const lines = fs.readFileSync(__dirname + '/raw-spreadsheet.tsv', 'utf8').trim().split('\n');
const awards = lines.map((line) => {
  const [external, awardFinder, canvas, procedures] = line.split('\t');
  return {
    name: slugToName(na(awardFinder) || external),
    external: na(external),
    awardFinder: na(awardFinder),
    canvas: na(canvas),
    procedures: na(procedures),
  };
}).filter((a) => a.awardFinder); // only track awards that at least have our own page

fs.writeFileSync(__dirname + '/awardList.json', JSON.stringify(awards, null, 2));
console.log(`Parsed ${awards.length} awards`);
console.log(awards.slice(0, 3));
