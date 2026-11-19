// Offline checks of the plan-chat search helpers. No network, no model.
//   node --import tsx tools/quality/search-planner.test.mjs
import {
  questionTerms,
  planResearchQuery,
  rankWebHits,
  passageWindow,
  passagesCoverQuestion,
} from '../../server/searchPlanner.mjs';

let fails = 0;
const expect = (name, got, want) => {
  const ok = typeof want === 'function' ? want(got) : JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    fails += 1;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${String(want)}`);
  }
};

// 1. A long question keeps the words at its end. The old 220-character cut dropped them.
const longQ =
  'In a 45-year-old man with newly diagnosed multibacillary leprosy and no other comorbidity, what is the complete recommended monthly regimen including the exact dose of clofazimine and its duration under the current WHO guideline?';
const plan = planResearchQuery({ question: longQ, topic: 'Leprosy (Dermatology bank)', subject: 'Dermatology & Venereology' });
expect('full question kept', plan.question, longQ);
expect('end words kept', plan.terms.includes('clofazimine'), () => true);
expect('search variant bounded', String(plan.searchVariant.length <= 200 && plan.searchVariant.length > 20), 'true');
expect('search variant has drug', String(plan.searchVariant.includes('clofazimine')), 'true');
expect('subject kept', plan.subject, 'Dermatology & Venereology');

// 2. Glue words are not terms.
expect('stop words dropped', questionTerms('what is the dose of the drug'), ['dose', 'drug']);

// 3. A relevant page beats a trusted-looking irrelevant one.
const hits = [
  { title: 'Baclofen FDA label', url: 'https://www.fda.gov/label', snippet: 'spasticity' },
  { title: 'WHO leprosy fact sheet: clofazimine regimen', url: 'https://blog.example.org/leprosy', snippet: 'clofazimine monthly dose regimen' },
];
const ranked = rankWebHits(hits, { terms: ['clofazimine', 'regimen', 'leprosy'] }, (u) => /fda\.gov/.test(String(u)));
expect('relevant page first', ranked[0].url, 'https://blog.example.org/leprosy');

// 4. A page whose fact sits late is read there, not cut at the start.
const filler = 'filler text about something else. '.repeat(400);
const late = `${filler} clofazimine 300 mg monthly, supervised, for 12 months.`;
const window = passageWindow(late, ['clofazimine', 'monthly'], 2000);
expect('late fact kept', String(window.includes('clofazimine 300 mg monthly')), 'true');

// 5. A loaded but unrelated page is not evidence.
expect('unrelated page not evidence', String(passagesCoverQuestion(['a page about knee replacement surgery outcomes'], ['clofazimine', 'leprosy'])), 'false');
expect('related page is evidence', String(passagesCoverQuestion(['leprosy regimen: clofazimine 300 mg monthly'], ['clofazimine', 'leprosy'])), 'true');

// 7. Short uppercase medical abbreviations carry search meaning (e.g. MDT in a leprosy regimen topic).
const mdtPlan = planResearchQuery({ question: 'What is the direct fact a student must know?', topic: 'Paucibacillary leprosy MDT' });
expect('uppercase MDT acronym kept as a term', String(mdtPlan.terms.includes('mdt')), 'true');
expect('uppercase MDT acronym kept in the search string', String(mdtPlan.searchVariant.includes('mdt')), 'true');
expect('topic terms lead over generic prompt wording', String(mdtPlan.searchVariant.startsWith('paucibacillary leprosy mdt')), 'true');
expect('short uppercase TB acronym kept', String(questionTerms('TB treatment guideline').includes('tb')), 'true');

// 8. An unknown subject still gets a usable plan.
const generic = planResearchQuery({ question: 'What is the incubation period of rabies?', topic: '', subject: 'Unknown thing' });
expect('generic plan has variant', String(generic.searchVariant.length > 10), 'true');

console.log(fails ? `${fails} FAILED` : 'all search planner checks passed');
process.exit(fails ? 1 : 0);
