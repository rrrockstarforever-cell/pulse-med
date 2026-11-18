// Builds app-ready ClinicalQuestion objects (same mapping as generateChapterMcqs step 4) from offline writer replies.
//   node --import tsx tools/quality/chapter-build-json.mjs <pages.json> <plan-reply.json> <write-dir> <out.json> [book] [chapter]
import fs from 'node:fs';
import path from 'node:path';
import { asDraft, checkDraft, placeCorrect, quoteInText, dedupeFacts, selectFacts } from '../../src/lib/chapterMcq.ts';

const [pagesFile, planFile, writeDir, outFile, book = 'Book', chapter = 'Chapter'] = process.argv.slice(2);
const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8')).filter((p) => p.text.trim());
const reply = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const all = Array.isArray(reply) ? reply.flatMap((r) => r.facts ?? []) : reply.facts ?? [];
const whole = pages.map((p) => p.text).join(' ');
const valid = [];
for (const f of all) {
  const quote = String(f.quote ?? '');
  if (!quoteInText(quote, whole)) continue;
  const home = pages.find((p) => quoteInText(quote, p.text));
  valid.push({ fact: String(f.fact), quote: quote.slice(0, 300), page: home ? home.page : Number(f.page), importance: Math.max(1, Math.min(5, Math.round(Number(f.importance)) || 3)) });
}
const chosen = selectFacts(dedupeFacts(valid), pages.length, 100).sort((a, b) => a.page - b.page);
const LETTERS = ['A', 'B', 'C', 'D'];
const stamp = Date.now().toString(36);
const built = [];
let turn = 0;
for (let b = 0; b < Math.ceil(chosen.length / 4); b++) {
  const file = path.join(writeDir, `write-reply-${b + 1}.json`);
  if (!fs.existsSync(file)) continue;
  for (const raw of JSON.parse(fs.readFileSync(file, 'utf8')).questions ?? []) {
    const d = asDraft(raw);
    if (!d || checkDraft(d)) continue;
    const fact = chosen[d.factIndex];
    const fixed = LETTERS.some((l) => /\b(both|all of the|none of the|above)\b|\b[A-D]\s*(and|&|,)\s*[A-D]\b/i.test(d.options[l]));
    const p = fixed ? d : placeCorrect(d, LETTERS[turn++ % 4]);
    built.push({
      id: `CH-${stamp}-${built.length + 1}`, moduleCode: `${book} · ${chapter}`, examType: 'NEET-PG', subject: 'Pharmacology', subtopic: chapter,
      cognitiveTier: p.cognitiveTier, difficultyTier: 'MEDIUM', stem: p.stem, questionText: p.questionText,
      options: LETTERS.map((l) => ({ id: l, text: p.options[l] })), correctOption: p.correctOption,
      boardPearl: p.boardPearl || p.keyFact, keyFact: p.keyFact || fact?.fact, optionReasons: p.optionReasons,
      citations: [`${book}, p. ${fact?.page}`], targetAccuracy: 60, explanation: p.explanation, ...(fixed ? { fixedOptionOrder: true } : {}),
    });
  }
}
for (let i = built.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [built[i], built[j]] = [built[j], built[i]]; }
fs.writeFileSync(outFile, JSON.stringify(built), 'utf8');
console.log(`${built.length} questions written`);
