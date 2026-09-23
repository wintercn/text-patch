import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyPatch, createCharacterPatch, createLinePatch, createPatch, PatchOpcode } from '../../src/index.ts';

const corpus = JSON.parse(readFileSync(new URL('./google-fixtures.json', import.meta.url), 'utf8'));
assert.equal(corpus.cases.length, 170);

function insertDeleteDistance(before, after) {
  let previous = Uint32Array.from({ length: after.length + 1 }, (_, index) => index);
  let current = new Uint32Array(after.length + 1);
  for (let beforeIndex = 1; beforeIndex <= before.length; beforeIndex++) {
    current[0] = beforeIndex;
    for (let afterIndex = 1; afterIndex <= after.length; afterIndex++) {
      current[afterIndex] = before.charCodeAt(beforeIndex - 1) === after.charCodeAt(afterIndex - 1)
        ? previous[afterIndex - 1]
        : Math.min(previous[afterIndex], current[afterIndex - 1]) + 1;
    }
    [previous, current] = [current, previous];
  }
  return previous[after.length];
}

for (const fixture of corpus.cases) {
  test(`Google diff-match-patch: ${fixture.name}`, () => {
    const patch = createPatch(fixture.before, fixture.after);
    assert.equal(applyPatch(fixture.before, patch), fixture.after);
    assert.equal(applyPatch(fixture.after, createPatch(fixture.after, fixture.before)), fixture.before);
    assert.equal(
      patch.args.reduce((total, length, index) => total + (patch.ops[index] === PatchOpcode.Insert ? length : 0), 0),
      patch.insertText.length,
    );
    assert.ok(patch.args.every(length => Number.isSafeInteger(length) && length > 0));
    assert.ok(patch.ops.every((opcode, index) =>
      (opcode === PatchOpcode.Retain || opcode === PatchOpcode.Delete || opcode === PatchOpcode.Insert)
      && (index === 0 || opcode !== patch.ops[index - 1])));
    assert.equal(patch.args.reduce((total, length, index) =>
      total + (patch.ops[index] === PatchOpcode.Insert ? 0 : length), 0), fixture.before.length);
    const characterPatch = createCharacterPatch(fixture.before, fixture.after, Number.MAX_SAFE_INTEGER);
    assert.equal(applyPatch(fixture.before, characterPatch), fixture.after);
    const shortestCost = insertDeleteDistance(fixture.before, fixture.after);
    assert.equal(
      characterPatch.args.reduce((total, length, index) =>
        total + (characterPatch.ops[index] === PatchOpcode.Retain ? 0 : length), 0),
      shortestCost,
      `${fixture.name}: character edit path is not shortest`,
    );
    const defaultCharacterPatch = createCharacterPatch(fixture.before, fixture.after);
    assert.equal(applyPatch(fixture.before, defaultCharacterPatch), fixture.after);
    if (!fixture.before.includes('\n') && !fixture.after.includes('\n')) {
      assert.deepEqual(patch, defaultCharacterPatch);
    } else {
      const linePatch = createLinePatch(fixture.before, fixture.after);
      assert.ok(
        patch.args.reduce((total, length, index) =>
          total + (patch.ops[index] === PatchOpcode.Retain ? 0 : length), 0)
        <= linePatch.args.reduce((total, length, index) =>
          total + (linePatch.ops[index] === PatchOpcode.Retain ? 0 : length), 0),
        `${fixture.name}: character refinement is worse than the line path`,
      );
    }
    if (fixture.name !== 'testDiffMain:timeout-input-scaled-down-64x') {
      assert.equal(
        defaultCharacterPatch.args.reduce((total, length, index) =>
          total + (defaultCharacterPatch.ops[index] === PatchOpcode.Retain ? 0 : length), 0),
        shortestCost,
        `${fixture.name}: default character edit path is not shortest`,
      );
    }
  });
}
