import { readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const [sourceFile, sourceCommit, outputFile] = process.argv.slice(2);
const source = readFileSync(sourceFile, 'utf8');
const quoted = String.raw`('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")`;
const calls = new RegExp(String.raw`dmp\.(diff_commonPrefix|diff_commonSuffix|diff_commonOverlap_|diff_halfMatch_|diff_linesToChars_|diff_main|patch_make)\(\s*${quoted}\s*,\s*${quoted}`, 'g');
const cases = [];

for (const match of source.matchAll(calls)) {
  const preceding = source.slice(0, match.index);
  const functionName = [...preceding.matchAll(/function (test\w+)\(/g)].at(-1)?.[1];
  const line = preceding.split('\n').length;
  cases.push({
    name: `${functionName}:${line}`,
    before: runInNewContext(match[2]),
    after: runInNewContext(match[3]),
  });
}

// Diff cleanup, delta, indexing, and rendering cases contain explicit
// equal/delete/insert tuples, either as input or expected output. Rebuild
// both texts and use them as Patch inputs.
for (const match of source.matchAll(/\[\[\s*DIFF_(?:EQUAL|DELETE|INSERT)\s*,/g)) {
  const start = match.index;
  let depth = 0;
  let quote = '';
  let escaped = false;
  let end = start;
  for (; end < source.length; end++) {
    const character = source[end];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = '';
      }
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === '[') {
      depth++;
    } else if (character === ']' && --depth === 0) {
      break;
    }
  }
  const literal = source.slice(start, end + 1);
  let tuples;
  if (literal === '[[DIFF_DELETE, chars]]' || literal === '[[DIFF_DELETE, lines]]') {
    tuples = [[-1, Array.from({ length: 300 }, (_, index) => `${index + 1}\n`).join('')]];
  } else if (literal === '[[DIFF_INSERT, results.chars1]]') {
    tuples = [[1, Array.from({ length: 66_000 }, (_, index) => `${index}\n`).join('')]];
  } else if (literal === '[[DIFF_INSERT, a]]') {
    tuples = [[1, 'abcdefghij'.repeat(2 ** 14)]];
  } else {
    tuples = runInNewContext(literal, {
      DIFF_EQUAL: 0, DIFF_DELETE: -1, DIFF_INSERT: 1,
    });
  }
  const preceding = source.slice(0, match.index);
  const functionName = [...preceding.matchAll(/function (test\w+)\(/g)].at(-1)?.[1];
  const line = preceding.split('\n').length;
  let before = '';
  let after = '';
  for (const [opcode, value] of tuples) {
    if (opcode !== 1) before += value;
    if (opcode !== -1) after += value;
  }
  cases.push({ name: `${functionName}:${line}:diff-tuples`, before, after });
}

cases.push(
  { name: 'testDiffBisect:normal', before: 'cat', after: 'map' },
  {
    name: 'testDiffMain:line-mode-disjoint',
    before: '1234567890\n'.repeat(13),
    after: 'abcdefghij\n'.repeat(13),
  },
  {
    name: 'testDiffMain:line-mode-single-line',
    before: '1234567890'.repeat(13),
    after: 'abcdefghij'.repeat(13),
  },
  {
    name: 'testDiffMain:line-mode-overlap',
    before: '1234567890\n'.repeat(13),
    after: 'abcdefghij\n1234567890\n1234567890\n1234567890\n'.repeat(3) + 'abcdefghij\n',
  },
  {
    name: 'testDiffMain:timeout-input-scaled-down-64x',
    before: '`Twas brillig, and the slithy toves\nDid gyre and gimble in the wabe:\nAll mimsy were the borogoves,\nAnd the mome raths outgrabe.\n'.repeat(16),
    after: "I am the very model of a modern major general,\nI've information vegetable, animal, and mineral,\nI know the kings of England, and I quote the fights historical,\nFrom Marathon to Waterloo, in order categorical.\n".repeat(16),
  },
  {
    name: 'testPatchMake:repeated-string',
    before: 'abcdef'.repeat(100),
    after: 'abcdef'.repeat(100) + '123',
  },
  {
    name: 'testPatchApply:partial-match-adapted-to-direct-input',
    before: 'The quick red rabbit jumps over the tired tiger.',
    after: 'That quick red rabbit jumped over a tired tiger.',
  },
  {
    name: 'testPatchApply:large-delete-small-change-adapted-to-direct-input',
    before: 'x123456789012345678901234567890-----++++++++++-----123456789012345678901234567890y',
    after: 'xabcy',
  },
  {
    name: 'testPatchApply:large-delete-large-change-adapted-to-direct-input',
    before: 'x12345678901234567890---------------++++++++++---------------12345678901234567890y',
    after: 'xabcy',
  },
  { name: 'testPatchApply:edge-partial-match-adapted-to-direct-input', before: 'x', after: 'x123' },
);

writeFileSync(outputFile, `${JSON.stringify({ sourceCommit, cases }, null, 2)}\n`);
