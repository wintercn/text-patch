import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyPatch, createCharacterPatch, createLinePatch, createPatch, PatchOpcode } from '../../src/index.ts';

const corpus = JSON.parse(readFileSync(new URL('./vscode-fixtures.json', import.meta.url), 'utf8'));
const unitCorpus = JSON.parse(readFileSync(new URL('./vscode-unit-fixtures.json', import.meta.url), 'utf8'));
assert.equal(corpus.cases.length, 58);
assert.equal(unitCorpus.cases.length, 49);

function lineStarts(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function splitLines(text) {
  const starts = lineStarts(text);
  const lines = [];
  for (let index = 0; index < starts.length; index++) {
    const line = text.slice(starts[index], starts[index + 1] ?? text.length);
    if (line.length !== 0) lines.push(line);
  }
  return lines;
}

function insertDeleteDistance(before, after) {
  let previous = Uint32Array.from({ length: after.length + 1 }, (_, index) => index);
  let current = new Uint32Array(after.length + 1);
  for (let beforeIndex = 1; beforeIndex <= before.length; beforeIndex++) {
    current[0] = beforeIndex;
    for (let afterIndex = 1; afterIndex <= after.length; afterIndex++) {
      current[afterIndex] = before[beforeIndex - 1] === after[afterIndex - 1]
        ? previous[afterIndex - 1]
        : Math.min(previous[afterIndex], current[afterIndex - 1]) + 1;
    }
    [previous, current] = [current, previous];
  }
  return previous[after.length];
}

function lineEditCost(before, patch) {
  let sourceOffset = 0;
  let insertOffset = 0;
  let cost = 0;
  for (let index = 0; index < patch.ops.length; index++) {
    const length = patch.args[index];
    if (patch.ops[index] === PatchOpcode.Retain) {
      sourceOffset += length;
    } else if (patch.ops[index] === PatchOpcode.Delete) {
      cost += splitLines(before.slice(sourceOffset, sourceOffset + length)).length;
      sourceOffset += length;
    } else {
      cost += splitLines(patch.insertText.slice(insertOffset, insertOffset + length)).length;
      insertOffset += length;
    }
  }
  return cost;
}

function lineRangeOffsets(range, starts, textLength) {
  const match = /^\[(\d+),(\d+)\)$/.exec(range);
  assert.ok(match, `invalid upstream line range: ${range}`);
  return [starts[Number(match[1]) - 1] ?? textLength, starts[Number(match[2]) - 1] ?? textLength];
}

function assertUpstreamRetentionBound(fixture, patch) {
  const originalStarts = lineStarts(fixture.original);
  const modifiedStarts = lineStarts(fixture.modified);
  let originalEnd = 0;
  let modifiedEnd = 0;
  let upstreamRetainedLength = 0;
  function checkGap(nextOriginal, nextModified) {
    const originalGap = fixture.original.slice(originalEnd, nextOriginal);
    const modifiedGap = fixture.modified.slice(modifiedEnd, nextModified);
    const addedFinalNewline = nextOriginal === fixture.original.length && modifiedGap === `${originalGap}\n`;
    const removedFinalNewline = nextModified === fixture.modified.length && originalGap === `${modifiedGap}\n`;
    assert.ok(originalGap === modifiedGap || addedFinalNewline || removedFinalNewline,
      `${fixture.name}: upstream unchanged lines differ`);
    upstreamRetainedLength += originalGap.length;
  }

  for (const diff of fixture.upstreamDiffs) {
    const [originalStart, nextOriginalEnd] = lineRangeOffsets(diff.originalRange, originalStarts, fixture.original.length);
    const [modifiedStart, nextModifiedEnd] = lineRangeOffsets(diff.modifiedRange, modifiedStarts, fixture.modified.length);
    checkGap(originalStart, modifiedStart);
    originalEnd = nextOriginalEnd;
    modifiedEnd = nextModifiedEnd;
  }
  checkGap(fixture.original.length, fixture.modified.length);
  const patchRetainedLength = patch.args.reduce((total, length, index) =>
    total + (patch.ops[index] === PatchOpcode.Retain ? length : 0), 0);
  assert.ok(patchRetainedLength >= upstreamRetainedLength,
    `${fixture.name}: retained ${patchRetainedLength} of ${upstreamRetainedLength} upstream unchanged code units`);
}

for (const fixture of corpus.cases) {
  test(`VS Code diff fixture: ${fixture.name}`, () => {
    const patch = createPatch(fixture.original, fixture.modified);
    assert.equal(patch.ops.length, patch.args.length);
    assert.equal(applyPatch(fixture.original, patch), fixture.modified);
    assert.equal(applyPatch(fixture.modified, createPatch(fixture.modified, fixture.original)), fixture.original);
    assert.equal(
      patch.args.reduce((total, length, index) => total + (patch.ops[index] === PatchOpcode.Insert ? length : 0), 0),
      patch.insertText.length,
    );
    assert.ok(patch.args.every(length => Number.isSafeInteger(length) && length > 0));
    assert.ok(patch.ops.every((opcode, index) =>
      (opcode === PatchOpcode.Retain || opcode === PatchOpcode.Delete || opcode === PatchOpcode.Insert)
      && (index === 0 || opcode !== patch.ops[index - 1])));
    assert.equal(patch.args.reduce((total, length, index) =>
      total + (patch.ops[index] === PatchOpcode.Insert ? 0 : length), 0), fixture.original.length);
    const linePatch = createLinePatch(fixture.original, fixture.modified);
    assert.equal(applyPatch(fixture.original, linePatch), fixture.modified);
    assert.equal(
      lineEditCost(fixture.original, linePatch),
      insertDeleteDistance(splitLines(fixture.original), splitLines(fixture.modified)),
      `${fixture.name}: line edit path is not shortest`,
    );
    assert.ok(
      patch.args.reduce((total, length, index) =>
        total + (patch.ops[index] === PatchOpcode.Retain ? 0 : length), 0)
      <= linePatch.args.reduce((total, length, index) =>
        total + (linePatch.ops[index] === PatchOpcode.Retain ? 0 : length), 0),
      `${fixture.name}: character refinement is worse than the line path`,
    );
    assertUpstreamRetentionBound(fixture, patch);
  });
}

for (const name of ['difficult-move', 'noise-1', 'noisy-move1', 'ts-confusing-2']) {
  test(`VS Code fixture retains unchanged text by default: ${name}`, () => {
    const fixture = corpus.cases.find(entry => entry.name === name);
    const patch = createPatch(fixture.original, fixture.modified);
    assert.ok(patch.ops.includes(PatchOpcode.Retain));
    assert.ok(patch.insertText.length < fixture.modified.length);
    assert.equal(applyPatch(fixture.original, patch), fixture.modified);
  });
}

test('VS Code subword preserves the original final line', () => {
  const fixture = corpus.cases.find(entry => entry.name === 'subword');
  const patch = createPatch(fixture.original, fixture.modified);
  assert.equal(applyPatch(fixture.original, patch), fixture.modified);
  assert.equal(
    patch.args.reduce((total, length, index) =>
      total + (patch.ops[index] === PatchOpcode.Retain ? 0 : length), 0),
    insertDeleteDistance(fixture.original.split(''), fixture.modified.split('')),
  );
  assert.equal(
    patch.args.reduce((total, length, index) =>
      total + (patch.ops[index] === PatchOpcode.Delete ? length : 0), 0),
    0,
  );
});

for (const fixture of unitCorpus.cases) {
  test(`VS Code legacy DiffComputer: ${fixture.name}`, () => {
    const patch = createPatch(fixture.original, fixture.modified);
    assert.equal(applyPatch(fixture.original, patch), fixture.modified);
    assert.equal(applyPatch(fixture.modified, createPatch(fixture.modified, fixture.original)), fixture.original);
    const shortestCost = insertDeleteDistance(fixture.original.split(''), fixture.modified.split(''));
    const characterPatch = createCharacterPatch(fixture.original, fixture.modified, Number.MAX_SAFE_INTEGER);
    assert.equal(applyPatch(fixture.original, characterPatch), fixture.modified);
    assert.equal(
      characterPatch.args.reduce((total, length, index) =>
        total + (characterPatch.ops[index] === PatchOpcode.Retain ? 0 : length), 0),
      shortestCost,
      `${fixture.name}: character edit path is not shortest`,
    );
    const defaultCharacterPatch = createCharacterPatch(fixture.original, fixture.modified);
    assert.equal(applyPatch(fixture.original, defaultCharacterPatch), fixture.modified);
    assert.equal(
      defaultCharacterPatch.args.reduce((total, length, index) =>
        total + (defaultCharacterPatch.ops[index] === PatchOpcode.Retain ? 0 : length), 0),
      shortestCost,
      `${fixture.name}: default character edit path is not shortest`,
    );
  });
}

// From defaultLinesDiffComputer.test.ts: the direct Myers smoke input and
// line-range mapping examples, converted to full source/result strings.
for (const [name, original, modified] of [
  ['Myers smoke', 'hello world', 'hallo welt'],
  ['line range mapping simple', 'const abc = "helloworld".split("");\n\n', 'const asciiLower = "helloworld".split("");\n'],
  ['line range mapping empty lines', '\n', '\n\n\n'],
]) {
  test(`VS Code defaultLinesDiffComputer: ${name}`, () => {
    assert.equal(applyPatch(original, createPatch(original, modified)), modified);
    if (!original.includes('\n') && !modified.includes('\n')) {
      const patch = createCharacterPatch(original, modified);
      assert.equal(
        patch.args.reduce((total, length, index) =>
          total + (patch.ops[index] === PatchOpcode.Retain ? 0 : length), 0),
        insertDeleteDistance(original.split(''), modified.split('')),
      );
    } else {
      const patch = createLinePatch(original, modified);
      assert.equal(lineEditCost(original, patch), insertDeleteDistance(splitLines(original), splitLines(modified)));
    }
  });
}
