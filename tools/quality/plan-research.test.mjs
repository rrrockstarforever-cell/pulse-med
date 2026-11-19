import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  '../../src/lib/planResearch.ts',
  '../../src/lib/plan-research.ts',
  '../../src/lib/plan-research.mjs',
  '../../src/lib/plan-research.js',
  '../../src/lib/plan-research/index.ts',
  '../../src/lib/research/plan-research.ts',
  '../../src/lib/research/plan-research.mjs',
  '../../src/features/plans/plan-research.ts',
  '../../lib/plan-research.ts',
  '../../lib/plan-research.mjs',
  '../../lib/plan-research.js',
  '../../lib/plan-research/index.ts',
  '../../lib/research/plan-research.ts',
  '../../lib/research/plan-research.mjs',
  '../../app/lib/plan-research.ts',
  '../../app/lib/plan-research.mjs',
  '../../app/lib/plan-research.js',
  '../../app/lib/plan-research/index.ts',
  '../../src/app/lib/plan-research.ts',
  '../../src/app/lib/plan-research.mjs',
  '../../src/app/lib/plan-research.js',
  '../../src/app/lib/plan-research/index.ts',
  '../../src/plan-research.ts',
  '../../src/plan-research.mjs',
  '../../src/plan-research.js',
  '../../src/plan-research/index.ts',
  '../../plan-research.ts',
  '../../plan-research.mjs',
  '../../plan-research.js',
  '../../plan-research/index.ts',
  '../plan-research.ts',
  '../plan-research.mjs',
  '../plan-research.js',
  '../plan-research/index.ts',
];

let loadedModule = null;
let loadedPath = null;
for (const relativePath of candidates) {
  const absolutePath = resolve(here, relativePath);
  if (!existsSync(absolutePath)) continue;
  loadedModule = await import(pathToFileURL(absolutePath).href);
  loadedPath = absolutePath;
  break;
}

assert.ok(
  loadedModule,
  `Unable to locate plan-research module. Tried:\n${candidates
    .map((relativePath) => resolve(here, relativePath))
    .join('\n')}`,
);

const researchForPlan =
  loadedModule.researchForPlan ?? loadedModule.default?.researchForPlan;
const selectMerged =
  loadedModule.selectMerged ?? loadedModule.default?.selectMerged;

assert.equal(
  typeof researchForPlan,
  'function',
  `researchForPlan export missing from ${loadedPath}`,
);
assert.equal(
  typeof selectMerged,
  'function',
  `selectMerged export missing from ${loadedPath}`,
);

const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input === 'object' && typeof input.url === 'string') {
    return input.url;
  }
  return String(input);
}

function parsedBody(init) {
  const body = init?.body;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  if (body instanceof URLSearchParams) {
    return Object.fromEntries(body.entries());
  }
  return body;
}

function findBooks(value, seen = new Set()) {
  if (value == null) return undefined;
  if (typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Object.prototype.hasOwnProperty.call(value, 'books')) {
    return value.books;
  }

  for (const child of Object.values(value)) {
    const found = findBooks(child, seen);
    if (found !== undefined) return found;
  }

  return undefined;
}

function booksFlagForCall(call) {
  let url = null;
  try {
    url = new URL(call.url, 'http://fixture.local');
  } catch {
    url = null;
  }

  if (url) {
    const raw = url.searchParams.get('books');
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  }

  const bodyValue = findBooks(parsedBody(call.init));
  if (bodyValue === true || bodyValue === 'true') return true;
  if (bodyValue === false || bodyValue === 'false') return false;

  return undefined;
}

function requestTextForCall(call) {
  const body = call.init?.body;
  let bodyText = '';

  if (typeof body === 'string') {
    bodyText = body;
  } else if (body instanceof URLSearchParams) {
    bodyText = body.toString();
  } else if (body != null) {
    try {
      bodyText = JSON.stringify(body);
    } catch {
      bodyText = String(body);
    }
  }

  return `${call.url}\n${bodyText}`;
}

function installFetch(handler) {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (input, init = {}) => {
    const call = {
      input,
      init,
      url: requestUrl(input),
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  };

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

function brokenJsonResponse() {
  return {
    ok: true,
    status: 200,
    async json() {
      throw new SyntaxError('sanitized invalid json');
    },
    async text() {
      throw new SyntaxError('sanitized invalid json');
    },
  };
}

function makeBook(title, n = 1) {
  return {
    title,
    url: `book://local/${encodeURIComponent(title)}`,
    kind: 'book',
    text: `Sanitized book fixture: ${title}`,
    snippet: `Sanitized book fixture: ${title}`,
    n,
  };
}

function makeWeb(title, n = 1) {
  return {
    title,
    url: `https://example.test/${encodeURIComponent(title)}`,
    kind: 'web',
    text: `Sanitized web fixture: ${title}`,
    snippet: `Sanitized web fixture: ${title}`,
    n,
  };
}

function researchBody(sources, search = 'ok') {
  return {
    success: true,
    sources,
    search,
    coversQuestion: sources.length > 0,
    retrievedAt: '2024-01-01T00:00:00.000Z',
  };
}

function resultSources(result) {
  assert.ok(result && typeof result === 'object', 'callback must return an object');
  assert.ok(Array.isArray(result.sources), 'callback must return a sources array');
  return result.sources;
}

function mergedSources(value) {
  assert.ok(Array.isArray(value), 'selectMerged must return an array of sources');
  return value;
}

function searchText(search) {
  try {
    return JSON.stringify(search ?? '').toLowerCase();
  } catch {
    return String(search ?? '').toLowerCase();
  }
}

function assertSearchReportsFailure(search, label = 'search') {
  assert.notEqual(search, undefined, `${label} must be reported`);
  const text = searchText(search);
  assert.match(
    text,
    /(fail|failure|error|unavailable|unreachable|timeout|partial|not\s+available)/,
    `${label} should report a truthful failure: ${text}`,
  );
}

function assertSearchReportsKindFailure(search, kind, label = 'search') {
  assert.notEqual(search, undefined, `${label} must be reported`);
  const text = searchText(search);
  assert.ok(text.includes(kind), `${label} should mention ${kind}: ${text}`);
  assert.match(
    text,
    /(fail|failure|error|unavailable|unreachable|timeout|partial|not\s+available)/,
    `${label} should report ${kind} failure: ${text}`,
  );
}

function assertRenumbered(sources, label = 'sources') {
  sources.forEach((source, index) => {
    assert.equal(
      source.n,
      index + 1,
      `${label}[${index}] should be renumbered to ${index + 1}`,
    );
  });
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('books mode makes only books:true requests and does not let q.books override', async () => {
  const question = 'What does the sanitized fixture say about books-only research?';
  const expected = makeBook('Books-only fixture', 91);

  const mock = installFetch((call) => {
    const flag = booksFlagForCall(call);
    return jsonResponse(researchBody(flag === true ? [expected] : []));
  });

  try {
    const run = await researchForPlan('books');
    assert.equal(typeof run, 'function');

    const result = await run({
      question,
      topic: 'fixture-topic',
      subject: 'fixture-subject',
      books: false,
    });

    assert.equal(mock.calls.length, 1);
    assert.equal(booksFlagForCall(mock.calls[0]), true);
    assert.ok(
      requestTextForCall(mock.calls[0]).includes(question),
      'request should include the actual missed question',
    );

    const sources = resultSources(result);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].title, expected.title);
    assert.equal(sources[0].kind, 'book');
    assertRenumbered(sources);
  } finally {
    mock.restore();
  }
});

test('books mode filters web entries before applying the cap', async () => {
  const leadingWeb = [
    makeWeb('Books-mode Web 1', 301),
    makeWeb('Books-mode Web 2', 302),
    makeWeb('Books-mode Web 3', 303),
    makeWeb('Books-mode Web 4', 304),
    makeWeb('Books-mode Web 5', 305),
  ];
  const trailingBooks = [
    makeBook('Books-mode Book 1', 311),
    makeBook('Books-mode Book 2', 312),
  ];

  const mock = installFetch((call) => {
    const flag = booksFlagForCall(call);
    return jsonResponse(
      researchBody(flag === true ? [...leadingWeb, ...trailingBooks] : []),
    );
  });

  try {
    const run = await researchForPlan('books');
    const result = await run({
      question: 'Filter leading web entries before capping books.',
      topic: 'fixture-topic',
      subject: 'fixture-subject',
      books: false,
    });

    assert.equal(mock.calls.length, 1);
    assert.equal(booksFlagForCall(mock.calls[0]), true);

    const sources = resultSources(result);
    assert.equal(sources.length, 2);
    assert.deepEqual(
      sources.map((source) => source.title),
      ['Books-mode Book 1', 'Books-mode Book 2'],
    );
    assert.ok(sources.every((source) => source.kind === 'book'));
    assertRenumbered(sources);
  } finally {
    mock.restore();
  }
});

test('web mode makes only books:false requests and rejects non-genuine web URLs', async () => {
  const question = 'Find only genuine sanitized web evidence.';
  const real = makeWeb('Genuine web fixture', 55);
  const invalidBookUri = {
    title: 'Book URI marked web',
    url: 'book://local/not-web',
    kind: 'web',
    text: 'Sanitized invalid fixture',
    snippet: 'Sanitized invalid fixture',
    n: 1,
  };
  const invalidJavascript = {
    title: 'JavaScript URI marked web',
    url: 'javascript:alert(1)',
    kind: 'web',
    text: 'Sanitized invalid fixture',
    snippet: 'Sanitized invalid fixture',
    n: 2,
  };
  const invalidMissing = {
    title: 'Missing URL marked web',
    kind: 'web',
    text: 'Sanitized invalid fixture',
    snippet: 'Sanitized invalid fixture',
    n: 3,
  };
  const invalidData = {
    title: 'Data URI marked web',
    url: 'data:text/html,<script>alert(1)</script>',
    kind: 'web',
    text: 'Sanitized invalid fixture',
    snippet: 'Sanitized invalid fixture',
    n: 4,
  };
  const invalidRelative = {
    title: 'Protocol-relative URI marked web',
    url: '//example.test/not-absolute',
    kind: 'web',
    text: 'Sanitized invalid fixture',
    snippet: 'Sanitized invalid fixture',
    n: 5,
  };

  const mock = installFetch((call) => {
    const flag = booksFlagForCall(call);
    return jsonResponse(
      researchBody(
        flag === false
          ? [invalidBookUri, invalidJavascript, invalidMissing, invalidData, invalidRelative, real]
          : [],
      ),
    );
  });

  try {
    const run = await researchForPlan('web');
    assert.equal(typeof run, 'function');

    const result = await run({
      question,
      topic: 'fixture-topic',
      subject: 'fixture-subject',
      books: true,
    });

    assert.equal(mock.calls.length, 1);
    assert.equal(booksFlagForCall(mock.calls[0]), false);
    assert.ok(
      requestTextForCall(mock.calls[0]).includes(question),
      'request should include the actual missed question',
    );

    const sources = resultSources(result);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].title, real.title);
    assert.equal(sources[0].url, real.url);
    assert.equal(sources[0].kind, 'web');
    assertRenumbered(sources);
  } finally {
    mock.restore();
  }
});

test('both mode makes two requests, keeps book and genuine web evidence, caps at 4, and renumbers', async () => {
  const question = 'Compare sanitized book and web fixtures for the plan.';
  const books = [
    makeBook('Both Book 1', 101),
    makeBook('Both Book 2', 102),
    makeBook('Both Book 3', 103),
  ];
  const webs = [
    makeWeb('Both Web 1', 201),
    makeWeb('Both Web 2', 202),
    makeWeb('Both Web 3', 203),
  ];

  const mock = installFetch((call) => {
    const flag = booksFlagForCall(call);
    if (flag === true) return jsonResponse(researchBody(books));
    if (flag === false) return jsonResponse(researchBody(webs));
    return jsonResponse(
      { error: 'missing books flag' },
      { ok: false, status: 400 },
    );
  });

  try {
    const run = await researchForPlan('both');
    assert.equal(typeof run, 'function');

    const result = await run({
      question,
      topic: 'fixture-topic',
      subject: 'fixture-subject',
      books: false,
    });

    assert.equal(mock.calls.length, 2);
    const flags = mock.calls.map((call) => booksFlagForCall(call)).sort();
    assert.deepEqual(flags, [false, true]);
    assert.ok(
      mock.calls.some((call) => requestTextForCall(call).includes(question)),
      'both-mode requests should include the actual missed question',
    );

    const sources = resultSources(result);
    assert.equal(sources.length, 4);
    assert.ok(
      sources.some((source) => source.kind === 'book'),
      'merged sources must retain a book result',
    );
    assert.ok(
      sources.some((source) => source.kind === 'web'),
      'merged sources must retain a genuine web result',
    );
    assert.ok(
      sources.some((source) => source.title.startsWith('Both Book')),
      'book batch should contribute at least one source',
    );
    assert.ok(
      sources.some((source) => source.title.startsWith('Both Web')),
      'web batch should contribute at least one source',
    );
    assertRenumbered(sources);
  } finally {
    mock.restore();
  }
});

test('both mode reserves a web source when books exceed the cap', async () => {
  const books = [
    makeBook('Many Book 1', 401),
    makeBook('Many Book 2', 402),
    makeBook('Many Book 3', 403),
    makeBook('Many Book 4', 404),
    makeBook('Many Book 5', 405),
  ];
  const webs = [makeWeb('Many Web 1', 501)];

  const mock = installFetch((call) => {
    const flag = booksFlagForCall(call);
    if (flag === true) return jsonResponse(researchBody(books));
    if (flag === false) return jsonResponse(researchBody(webs));
    return jsonResponse(
      { error: 'missing books flag' },
      { ok: false, status: 400 },
    );
  });

  try {
    const run = await researchForPlan('both');
    const result = await run({
      question: 'Reserve web evidence when many books match.',
      topic: 'fixture-topic',
      subject: 'fixture-subject',
    });

    const sources = resultSources(result);
    assert.equal(sources.length, 4);
    assert.equal(sources.filter((source) => source.kind === 'book').length, 3);
    assert.equal(sources.filter((source) => source.kind === 'web').length, 1);
    assert.equal(sources.find((source) => source.kind === 'web')?.title, webs[0].title);
    assertRenumbered(sources);
  } finally {
    mock.restore();
  }
});

test('selectMerged is pure, caps results, preserves kind, and renumbers', () => {
  const books = [makeBook('Pure Book 1', 7), makeBook('Pure Book 2', 8)];
  const webs = [makeWeb('Pure Web 1', 9), makeWeb('Pure Web 2', 10)];
  const booksBefore = deepClone(books);
  const websBefore = deepClone(webs);

  const merged = mergedSources(selectMerged(books, webs, 3));

  assert.equal(merged.length, 3);
  assert.deepEqual(books, booksBefore, 'selectMerged must not mutate books input');
  assert.deepEqual(webs, websBefore, 'selectMerged must not mutate web input');
  assert.ok(merged.some((source) => source.kind === 'book'));
  assert.ok(merged.some((source) => source.kind === 'web'));
  assertRenumbered(merged);
});

test('selectMerged reserves web evidence when four books exist', () => {
  const books = [
    makeBook('Cap Book 1', 701),
    makeBook('Cap Book 2', 702),
    makeBook('Cap Book 3', 703),
    makeBook('Cap Book 4', 704),
  ];
  const webs = [makeWeb('Cap Web 1', 801)];

  const merged = mergedSources(selectMerged(books, webs, 4));

  assert.equal(merged.length, 4);
  assert.equal(merged.filter((source) => source.kind === 'book').length, 3);
  assert.equal(merged.filter((source) => source.kind === 'web').length, 1);
  assertRenumbered(merged);
});

test('selectMerged max 1 can choose a book and renumbers', () => {
  const merged = mergedSources(
    selectMerged([makeBook('Single Book', 901)], [makeWeb('Single Web', 902)], 1),
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].kind, 'book');
  assert.equal(merged[0].title, 'Single Book');
  assertRenumbered(merged);
});

test('HTTP error returns empty sources and a truthful failure status', async () => {
  const mock = installFetch(() =>
    jsonResponse(
      {
        error: 'upstream unavailable',
        sources: [makeBook('Fabricated source', 1)],
      },
      { ok: false, status: 503 },
    ),
  );

  try {
    const run = await researchForPlan('books');
    const result = await run({
      question: 'HTTP error fixture',
      topic: 'fixture-topic',
      subject: 'fixture-subject',
    });

    const sources = resultSources(result);
    assert.equal(sources.length, 0, 'HTTP errors must not fabricate sources');
    assertSearchReportsFailure(result.search, 'HTTP error search');
  } finally {
    mock.restore();
  }
});

test('thrown fetch returns empty sources and a truthful failure status', async () => {
  const mock = installFetch(() => {
    throw new Error('sanitized network failure');
  });

  try {
    const run = await researchForPlan('web');
    const result = await run({
      question: 'Thrown fetch fixture',
      topic: 'fixture-topic',
      subject: 'fixture-subject',
    });

    const sources = resultSources(result);
    assert.equal(sources.length, 0, 'thrown fetch must not fabricate sources');
    assertSearchReportsFailure(result.search, 'thrown fetch search');
  } finally {
    mock.restore();
  }
});

test('JSON parse failure returns empty sources and a truthful failure status', async () => {
  const mock = installFetch(() => brokenJsonResponse());

  try {
    const run = await researchForPlan('books');
    const result = await run({
      question: 'Bad JSON fixture',
      topic: 'fixture-topic',
      subject: 'fixture-subject',
    });

    const sources = resultSources(result);
    assert.equal(sources.length, 0, 'parse failure must not fabricate sources');
    assertSearchReportsFailure(result.search, 'JSON parse failure search');
  } finally {
    mock.restore();
  }
});

test('both mode preserves successful book sources while reporting failed web research', async () => {
  const preserved = makeBook('Preserved book despite web failure', 77);

  const mock = installFetch((call) => {
    const flag = booksFlagForCall(call);
    if (flag === true) return jsonResponse(researchBody([preserved]));
    if (flag === false) {
      return jsonResponse(
        {
          error: 'web unavailable',
          sources: [makeWeb('Fabricated web source', 88)],
        },
        { ok: false, status: 502 },
      );
    }
    return jsonResponse(
      { error: 'missing books flag' },
      { ok: false, status: 400 },
    );
  });

  try {
    const run = await researchForPlan('both');
    const result = await run({
      question: 'Partial failure fixture',
      topic: 'fixture-topic',
      subject: 'fixture-subject',
    });

    const sources = resultSources(result);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].title, preserved.title);
    assert.equal(sources[0].kind, 'book');
    assertSearchReportsKindFailure(result.search, 'web', 'partial failure search');
    assertRenumbered(sources);
  } finally {
    mock.restore();
  }
});

test('both mode preserves book sources when web throws a network error', async () => {
  const preserved = makeBook('Preserved book on thrown web', 1001);

  const mock = installFetch((call) => {
    const flag = booksFlagForCall(call);
    if (flag === true) return jsonResponse(researchBody([preserved]));
    if (flag === false) throw new Error('sanitized web network failure');
    return jsonResponse(
      { error: 'missing books flag' },
      { ok: false, status: 400 },
    );
  });

  try {
    const run = await researchForPlan('both');
    const result = await run({
      question: 'Preserve books when web network fails.',
      topic: 'fixture-topic',
      subject: 'fixture-subject',
    });

    const sources = resultSources(result);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].title, preserved.title);
    assert.equal(sources[0].kind, 'book');
    assertSearchReportsKindFailure(result.search, 'web', 'network failure search');
    assertRenumbered(sources);
  } finally {
    mock.restore();
  }
});

test('restores globalThis.fetch after mocked research calls', async () => {
  const originalFetch = globalThis.fetch;
  const mock = installFetch(() => jsonResponse(researchBody([])));

  try {
    const run = await researchForPlan('books');
    await run({
      question: 'Restore fetch fixture',
      topic: 'fixture-topic',
      subject: 'fixture-subject',
    });
  } finally {
    mock.restore();
  }

  assert.equal(globalThis.fetch, originalFetch, 'fetch must be restored');
});

let failures = 0;
for (const { name, fn } of cases) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${name}`);
    console.error(error?.stack ?? error);
  }
}

if (failures > 0) {
  console.error(`\n${failures} of ${cases.length} test(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`\n${cases.length} test(s) passed`);
}
