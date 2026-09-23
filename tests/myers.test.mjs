import assert from 'node:assert/strict';
import test from 'node:test';
import { myersChanges } from '../src/myers.ts';

function editDistance(before, after) {
  const previous = Array.from({ length: after.length + 1 }, (_, index) => index);
  const current = new Array(after.length + 1);
  for (let beforeIndex = 1; beforeIndex <= before.length; beforeIndex++) {
    current[0] = beforeIndex;
    for (let afterIndex = 1; afterIndex <= after.length; afterIndex++) {
      current[afterIndex] = before[beforeIndex - 1] === after[afterIndex - 1]
        ? previous[afterIndex - 1]
        : Math.min(previous[afterIndex] + 1, current[afterIndex - 1] + 1);
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[after.length];
}

function sequences(maximumLength) {
  const result = [''];
  for (let length = 1; length <= maximumLength; length++) {
    const previous = result.filter(sequence => sequence.length === length - 1);
    for (const sequence of previous) {
      result.push(`${sequence}a`, `${sequence}b`);
    }
  }
  return result;
}

test('Myers produces a minimal insertion/deletion path for every short binary sequence pair', () => {
  const values = sequences(5);
  for (const before of values) {
    for (const after of values) {
      const { beforeChanged, afterChanged } = myersChanges(
        before.length,
        after.length,
        (beforeIndex, afterIndex) => before[beforeIndex] === after[afterIndex],
      );
      const retainedBefore = Array.from(before).filter((_, index) => beforeChanged[index] === 0).join('');
      const retainedAfter = Array.from(after).filter((_, index) => afterChanged[index] === 0).join('');
      assert.equal(retainedBefore, retainedAfter, `${before} -> ${after}`);
      assert.equal(
        beforeChanged.reduce((sum, value) => sum + value, 0) + afterChanged.reduce((sum, value) => sum + value, 0),
        editDistance(before, after),
        `${before} -> ${after}`,
      );
    }
  }
});

test('Myers stops when the comparison budget is exhausted', () => {
  assert.equal(myersChanges(3, 3, (beforeIndex, afterIndex) => 'abc'[beforeIndex] === 'xyz'[afterIndex], 1), null);
});
