# Subject-Adaptive Search and Answer Style

**Status: Draft for user review — no app code changed**  
**Target:** Pulse Med 1.0.107 source in `.claude/worktrees/upgrade-v5`

## Why this change

The latest plan-chat test answered the neutral leprosy question correctly and included WHO sources. The earlier failure was not simply “no internet”: the relevant treatment statement had been cut off, the WHO PDF was not read, and book excerpts took web-source slots. Those issues were fixed in 1.0.107.

There is still a wider problem to solve. Search starts with general web results and medical sources, while specialty knowledge is partly a fixed list. A correct answer also needs to be easy to read. The chat currently forces nearly every answer into one format, even when the question only needs a short explanation.

## What you asked for

- Make internet search adapt to all 19 medical subjects, not just leprosy or drug questions.
- Test different cases one at a time, using simple explanations.
- For each question, compare the app answer with an independent answer from me.
- Compare how the answers are presented and improve the style.
- Add the capabilities that the tests show are missing.

## What the current code does

- Plan chat combines the plan topic and question into a query and currently limits it to 220 characters in [`groundedChat.ts`](../src/lib/groundedChat.ts:286).
- The `/api/web/research` route is in [`server.ts`](../../server.ts:2723). In Books + Internet mode, it runs local-book search and web research separately.
- [`web.mjs`](../../server/web.mjs:46) parses up to eight DuckDuckGo results, sorts by a yes/no trusted-site match, and fetches up to three pages. It also queries Europe PMC and conditionally openFDA. HTML and PDF extraction now reads up to 100,000 characters; keep that fix.
- The separate `literatureSources` path has a fixed journal-by-subject map in [`web.mjs`](../../server/web.mjs:178). The plan-chat route calls `research()`, so we must not assume that map is already steering plan-chat web searches.
- The answer prompt in [`groundedChat.ts`](../src/lib/groundedChat.ts:340) requires numbered-source citations and simple words, but also forces a bold answer line, headings, bullets, a table/flowchart pattern, a “pearl,” and a 220-word limit.
- [`GroundedChat.tsx`](../src/components/GroundedChat.tsx:38) has per-answer status badges, clickable citations, an expandable source list, and `RichAnswer` rendering. Its heading also says “Checked against your books and the internet” before a new query has finished; make the trust/status wording match what that query actually did.
- The 19 subjects are defined in [`mockClinicalData.ts`](../src/data/mockClinicalData.ts:17).

## Proposed design

### 1. Keep one generic search flow

Use the subject and topic already available in plan chat, plus the student’s exact question. Pass them separately to the server rather than squeezing everything into a short query string. Preserve the full wording; if a service has a query-length limit, shorten a generated search variant without discarding the original question or its constraints.

The planner should identify the kind of information requested (for example: a current guideline, definition, mechanism, calculation, law, or research finding), whether country/date matters, and which source families fit. Use a general default for unfamiliar topics. Add small data-driven source hints only when tests show they help; do not create a special code path for every specialty.

### 2. Use a shared source-adapter and ranking layer

Keep the existing local books, DuckDuckGo, Europe PMC, and openFDA connections. Represent each result in one common format: title, URL, readable text, source family, publishing organization, date, country/jurisdiction when known, and whether text came from a snippet, page, or PDF.

Rank candidates by how closely they answer the question, whether the source is suitable for that kind of claim, how current it is when currency matters, and whether several independent source families agree. A trusted-site list should be a helpful signal, not a rule that automatically puts every page from a listed host first. Do not let books fill the web-source slots or let one source family crowd out all others.

Fetch full pages only for promising candidates. Keep the 1.0.107 HTML/PDF support, but select relevant passages with nearby context before sending them to the answer model. Preserve table rows and columns when extracting PDFs. If the sources do not directly support the requested detail, say so and ask a clarifying question or give a clearly labelled limited answer rather than guessing.

Do not add a new paid search provider or require a new external account in this first design. If tests show the current search provider blocks or misses a needed source, report that gap and ask before adding a new service.

### 3. Make answer structure fit the question

Keep these rules for every subject:

- Start with the direct answer in plain language.
- Put citations next to the factual statements they support.
- Explain acronyms and difficult terms the first time they appear.
- Be as short as possible while still answering all parts of the question.
- State uncertainty, source disagreement, and missing evidence plainly.

Choose a format only when it helps: a short paragraph for a simple fact, bullets for several points, a table for a useful comparison, and numbered steps for a process. Use a flowchart only when there are real branches. Make “Pearl” and “Trap” optional rather than required. Keep answers readable in the chat card, including on a phone.

### 4. Tell the student what actually happened

Show the status for each answer, not just a general promise in the panel header. Distinguish at least: internet could not be reached; internet responded but no useful source was found; a relevant web source was included; and the answer used books only. A successful HTTP request is not, by itself, proof that a useful or authoritative source supported the answer.

## Test plan

The 31-case first pass is a practical, finite baseline—not a claim that every possible question can be tested. Run the tests one at a time in the visible app preview. For every case, I will write an independent answer using separate, cited reference sources; you do not need to supply the answers. The reference—not my memory, and not either model’s answer—decides whether a claim is correct. If no suitable reference can be found, mark the case “not verifiable,” not “pass.”

### One representative question for each subject

Use the exact subject IDs/labels from `NEET_PG_SUBJECTS`, then verify each suggested query and its reference before running it:

1. **Anatomy:** Which nerve is most at risk in an upper-outer-quadrant gluteal injection, and why?
2. **Physiology:** What is the usual resting heart-rate range for adults?
3. **Biochemistry:** What fasting plasma glucose value meets the diagnostic threshold for diabetes in a non-pregnant adult?
4. **Pathology:** How does the current WHO classification grade meningiomas?
5. **Pharmacology:** What is the maximum daily paracetamol dose for a healthy adult, and what cautions change it?
6. **Microbiology:** What treatment does WHO recommend for uncomplicated *P. falciparum* malaria, and where does the recommendation apply?
7. **Forensic Medicine & Toxicology:** What age does India’s POCSO Act set for a child?
8. **Preventive & Social Medicine (PSM):** What daily salt intake does WHO recommend for adults?
9. **General Medicine:** What does WHO recommend as initial drug treatment for adult hypertension?
10. **General Surgery:** What are the first steps for a grossly contaminated open fracture?
11. **Obstetrics & Gynaecology:** What oxytocin dose does WHO recommend to prevent postpartum haemorrhage after vaginal birth?
12. **Pediatrics:** What zinc regimen does WHO recommend for childhood diarrhoea?
13. **Orthopedics:** What is the initial approach to suspected scaphoid fracture in an adult?
14. **Oto-Rhino-Laryngology (ENT):** What is the first-line antibiotic for acute otitis media in a child under the named guideline?
15. **Ophthalmology:** What is the recommended first-line approach to bacterial conjunctivitis in adults?
16. **Dermatology & Venereology:** What is the first-line treatment for tinea corporis in adults?
17. **Psychiatry:** What does NICE recommend first for adult major depression, and in what circumstances?
18. **Anesthesiology:** What is the maximum recommended lidocaine dose with adrenaline for local anaesthesia in adults?
19. **Radiodiagnosis & Radiotherapy:** What initial imaging is recommended for suspected acute ischaemic stroke?

These are test-question seeds. Before using one, confirm the wording, jurisdiction, population, and reference are precise enough to have a fair expected answer—especially for treatment doses and guideline-dependent questions.

### Twelve cross-checks

- Current and outdated recommendations disagree.
- Two reliable sources disagree or cover different countries/populations.
- Internet is offline; the app must not pretend to have checked it.
- Search reaches the internet but finds no useful result.
- A fictitious drug is asked about; the answer must not invent a dose.
- Ambiguous wording needs clarification (for example, “cold”).
- A relevant fact appears late in a long page or PDF.
- A PDF table’s rows and columns must stay connected.
- A source omits the detail asked for; the answer must say that.
- A drug dose needs the correct route, population, and maximum.
- A non-drug number needs a suitable source too.
- Every displayed citation opens a source that actually supports the cited claim.

### Comparison sheet and scoring

Record one line per case: ID, app version, subject, exact question, app answer and citations, my independent sourced answer, reference title/organization/year/URL and section, missing/extra/contradicted claims, internet status, source match, style comparison, result, and required change.

Score each area 0 = fail, 1 = partial, 2 = good: correctness, completeness, source fit, currency when relevant, citation support, plain language, answer-first presentation, useful structure, suitable length, and phone readability. Any unsafe/wrong dose, fabricated citation, unsupported claim stated as fact, or current-guideline error is a critical failure regardless of score.

### Close the test loop

If an agreed test fails, trace the cause and add the smallest generic capability that fixes the class of problem—not a leprosy-specific answer. Add or update an automated check for that failure. Re-run the failed case and three relevant regression cases. Continue until all verifiable first-pass cases meet the criteria or an external limitation is clearly recorded. If a needed fix requires a paid search provider, new credentials, or a new service, stop and ask first.

## Decisions and open approval

**You asked for:** generic behavior across the 19 subjects; one-at-a-time testing; simple-language explanation; a parallel independent sourced answer; comparison of answer style; and adding features revealed to be missing.

**My design choices:** use a finite 31-case baseline; use independent references as the final check; keep current providers initially; add no leprosy-only branch; and treat unverified cases as inconclusive rather than passing them. The exact first-pass questions above are candidates and will be checked against authoritative sources before testing.

**Still needed before testing:** your approval of this design and a maximum number of billable app/provider calls for the initial run. Recommended cap: 31 app-answer calls (one per case). Any retry or post-fix regression call would need renewed approval. No app code, billable answer tests, or new provider integration is included in this draft.