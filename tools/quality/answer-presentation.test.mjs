// Offline checks for honest status labels and helper behavior. No provider calls.
//   node --import tsx tools/quality/answer-presentation.test.mjs
import { decideGroundedOutcome, describeSearch } from '../../src/lib/groundedChat.ts';
import * as groundedChat from '../../src/lib/groundedChat.ts';

let fails = 0;
const expect = (name, got, want) => {
  if (got !== want) {
    fails += 1;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
};

expect('relevant web source', decideGroundedOutcome('both', 'ok', 0, 2, true), 'found');
expect('internet pages unrelated', decideGroundedOutcome('both', 'ok', 2, 2, false), 'no-direct-source');
expect('internet offline with books', decideGroundedOutcome('both', 'no-connection', 2, 0, false), 'books-only');
expect('internet offline without books', decideGroundedOutcome('web', 'no-connection', 0, 0, false), 'unavailable');
expect('books-only mode', decideGroundedOutcome('books', 'local', 2, 0, false), 'books-only');
expect('no web results', decideGroundedOutcome('both', 'no-results', 0, 0, false), 'empty');
expect(
  'no-direct-source message is explicit',
  describeSearch('both', 'ok', 2, 2, false).includes('none of the passages read states the detail asked for'),
  true,
);
expect(
  'source-supported message is distinct',
  describeSearch('both', 'ok', 0, 2, true).includes('usable web sources'),
  true,
);

const reconcile = groundedChat.reconcileSearchOutcome;
expect('answer-status reconciliation helper is exported', typeof reconcile, 'function');
if (typeof reconcile === 'function') {
  expect(
    'answer admitting no direct source downgrades status',
    reconcile('found', '**Answer: The search did not return a direct source for this.** From general knowledge (not verified): fact.'),
    'no-direct-source',
  );
  expect(
    'answer with only an unverified memory claim downgrades status',
    reconcile('found', 'From general knowledge (not verified): fact.'),
    'no-direct-source',
  );
  expect('answer supported by a numbered source stays found', reconcile('found', 'Fact [1].'), 'found');
  expect('books-only status is preserved', reconcile('books-only', 'From general knowledge (not verified): fact.'), 'books-only');
  expect('unavailable status is preserved', reconcile('unavailable', 'The search did not return a direct source.'), 'unavailable');
}

console.log(fails ? `${fails} FAILED` : 'all answer presentation checks passed');
process.exit(fails ? 1 : 0);
