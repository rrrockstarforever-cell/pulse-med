// Writes the planning prompt for a chapter (pages from a JSON file made by the PDF text export) so it can be sent to a
// model outside the app, and later checks the model's reply the way the app does (quote check, dedupe, selection).
//   node --import tsx tools/quality/chapter-plan-prompt.mjs prompt <pages.json> <out-dir> [book] [chapter]
//   node --import tsx tools/quality/chapter-plan-prompt.mjs select <pages.json> <reply.json> [maxQuestions]
import fs from 'node:fs';
import path from 'node:path';
import { PLAN_SYSTEM, buildGapMessage, WRITE_SYSTEM, buildWriteMessage, asDraft, checkDraft, placeCorrect, chunkPages, quoteInText, dedupeFacts, selectFacts } from '../../src/lib/chapterMcq.ts';

const [mode, pagesFile, third, fourth, fifth] = process.argv.slice(2);
const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8')).filter((p) => p.text.trim());
const chunks = chunkPages(pages);

if (mode === 'prompt') {
  const outDir = third;
  const book = fourth ?? 'Book';
  const chapter = fifth ?? 'Chapter';
  fs.mkdirSync(outDir, { recursive: true });
  chunks.forEach((chunk, i) => {
    const text = chunk.map((p) => `[page ${p.page}]\n${p.text}`).join('\n\n');
    const prompt = `${PLAN_SYSTEM}\n\n---\n\nBook: ${book}\nChapter: ${chapter}\n\nPassage:\n${text}\n\nList the testable facts as JSON.`;
    fs.writeFileSync(path.join(outDir, `plan-prompt-${i + 1}.txt`), prompt, 'utf8');
  });
  console.log(`${chunks.length} prompt file(s) written, ${pages.length} pages`);
} else if (mode === 'gap') {
  // gap <pages.json> <dir-with-plan-reply-N.json> [book] [chapter]: writes gap-prompt-N.txt, the second planning pass of each chunk.
  const dir = third;
  chunks.forEach((chunk, i) => {
    const file = path.join(dir, `plan-reply-${i + 1}.json`);
    const first = JSON.parse(fs.readFileSync(file, 'utf8')).facts ?? [];
    const text = chunk.map((p) => `[page ${p.page}]\n${p.text}`).join('\n\n');
    fs.writeFileSync(path.join(dir, `gap-prompt-${i + 1}.txt`), `${PLAN_SYSTEM}\n\n---\n\n${buildGapMessage(fourth ?? 'Book', fifth ?? 'Chapter', text, first)}`, 'utf8');
  });
  console.log(`${chunks.length} gap prompt file(s) written`);
} else if (mode === 'write-prompts' || mode === 'build') {
  // write-prompts <pages.json> <plan-reply.json> <out-dir> [book] [chapter]: the writer prompts of the selected facts, 4 per call.
  // build <pages.json> <plan-reply.json> <out-dir>: reads write-reply-N.json from out-dir, applies the app's draft checks and letter
  // placement, and prints the questions.
  const reply = JSON.parse(fs.readFileSync(third, 'utf8'));
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
  const outDir = fourth;
  const BATCH = 4;
  const batches = [];
  chosen.forEach((fact, index) => { (batches[Math.floor(index / BATCH)] ??= []).push({ fact, index }); });
  if (mode === 'write-prompts') {
    const book = fifth ?? 'Book';
    const chapter = process.argv[7] ?? 'Chapter';
    fs.mkdirSync(outDir, { recursive: true });
    batches.forEach((items, b) => fs.writeFileSync(path.join(outDir, `write-prompt-${b + 1}.txt`), `${WRITE_SYSTEM}\n\n---\n\n${buildWriteMessage(book, chapter, items, pages)}`, 'utf8'));
    fs.writeFileSync(path.join(outDir, 'facts.json'), JSON.stringify(chosen, null, 1), 'utf8');
    console.log(`${chosen.length} facts, ${batches.length} writer prompt file(s)`);
  } else {
    const drafts = [];
    for (let b = 0; b < batches.length; b++) {
      const file = path.join(outDir, `write-reply-${b + 1}.json`);
      if (!fs.existsSync(file)) { console.log(`missing ${file}`); continue; }
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const raw of parsed.questions ?? []) { const d = asDraft(raw); if (d) drafts.push(d); }
    }
    let turn = 0;
    const out = [];
    drafts.forEach((d) => {
      const fact = chosen[d.factIndex];
      const bad = checkDraft(d);
      if (bad) { console.log(`REJECTED fact ${d.factIndex} (${bad})`); return; }
      const fixed = ['A', 'B', 'C', 'D'].some((l) => /\b(both|all of the|none of the|above)\b|\b[A-D]\s*(and|&|,)\s*[A-D]\b/i.test(d.options[l]));
      const placed = fixed ? d : placeCorrect(d, ['A', 'B', 'C', 'D'][turn++ % 4]);
      out.push({ n: out.length + 1, fact: d.factIndex, page: fact?.page, stem: placed.stem, ask: placed.questionText, options: placed.options, key: placed.correctOption, keyFact: placed.keyFact, explanation: placed.explanation, tier: placed.cognitiveTier });
    });
    fs.writeFileSync(path.join(outDir, 'questions.json'), JSON.stringify(out, null, 1), 'utf8');
    console.log(`${drafts.length} drafts, ${out.length} pass the code checks (facts planned ${chosen.length})`);
  }
} else if (mode === 'select') {
  const reply = JSON.parse(fs.readFileSync(third, 'utf8'));
  const all = Array.isArray(reply) ? reply.flatMap((r) => r.facts ?? []) : reply.facts ?? [];
  const pageText = (n) => pages.find((p) => p.page === n)?.text ?? '';
  const whole = pages.map((p) => p.text).join(' ');
  const valid = [];
  const bad = [];
  for (const f of all) {
    const quote = String(f.quote ?? '');
    if (!quoteInText(quote, whole)) { bad.push(f); continue; }
    const home = pages.find((p) => quoteInText(quote, p.text));
    valid.push({ fact: String(f.fact), quote, page: home ? home.page : Number(f.page), importance: Math.max(1, Math.min(5, Math.round(Number(f.importance)) || 3)) });
  }
  const unique = dedupeFacts(valid);
  const chosen = selectFacts(unique, pages.length, Number(fourth) || 100).sort((a, b) => a.page - b.page);
  const byImportance = (list) => [1, 2, 3, 4, 5].map((n) => `${n}:${list.filter((f) => f.importance === n).length}`).join(' ');
  console.log(`pages ${pages.length} | AI listed ${all.length} | quote not in pages ${bad.length} | after dedupe ${unique.length} (${byImportance(unique)}) | questions ${chosen.length}`);
  for (const f of chosen) console.log(`p${f.page} [${f.importance}] ${f.fact}`);
  void pageText;
}
