import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPatch, createCharacterPatch, createLinePatch, createPatch, PatchOpcode } from '../src/index.ts';

test('character diff compares UTF-16 code units', () => {
  const before = '𠀀';
  const after = '𠀁';
  const patch = createPatch(before, after);
  assert.deepEqual(patch, {
    ops: [PatchOpcode.Retain, PatchOpcode.Delete, PatchOpcode.Insert],
    args: [1, 1, 1],
    insertText: after.slice(1),
  });
  assert.equal(applyPatch(before, patch), after);
  assert.equal(applyPatch(before, JSON.parse(JSON.stringify(patch))), after);
  assert.deepEqual(createCharacterPatch(before, after), patch);
});

test('CRLF is preserved exactly', () => {
  const before = 'a\r\nb\r\n';
  const after = 'a\r\nB\r\n';
  assert.equal(applyPatch(before, createPatch(before, after)), after);
});

test('JSON round-trip uses exactly ops, args, and insertText', () => {
  const before = 'a\nb\nc\n';
  const after = 'a\nB\nc\n新\n';
  const patch = createPatch(before, after);
  assert.deepEqual(Object.keys(patch), ['ops', 'args', 'insertText']);
  assert.equal(applyPatch(before, JSON.parse(JSON.stringify(patch))), after);
});

test('invalid diff capacities throw for both layers', () => {
  for (const diffCapacity of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => createCharacterPatch('a', 'b', diffCapacity), RangeError);
    assert.throws(() => createLinePatch('a', 'b', diffCapacity), RangeError);
    assert.throws(() => createPatch('a', 'b', { characterDiffCapacity: diffCapacity }), RangeError);
    assert.throws(() => createPatch('a', 'b', { lineDiffCapacity: diffCapacity }), RangeError);
  }
  assert.throws(() => createPatch('a', 'b', 1), TypeError);
  assert.throws(() => createPatch('a', 'b', { diffCapacity: 1 }), TypeError);
});

test('character capacity fallback replaces only its single-line input', () => {
  const before = 'unchanged\nold line\n';
  const after = 'unchanged\nnew line\n';
  const patch = createPatch(before, after, { characterDiffCapacity: 0.1 });
  assert.deepEqual(patch, {
    ops: [PatchOpcode.Retain, PatchOpcode.Delete, PatchOpcode.Insert],
    args: [10, 9, 9],
    insertText: 'new line\n',
  });
  assert.equal(applyPatch(before, JSON.parse(JSON.stringify(patch))), after);
});

test('line capacity is independent from character capacity', () => {
  const before = 'unchanged\nold line\n';
  const after = 'unchanged\nnew line\n';
  const linePatch = createLinePatch(before, after);
  assert.deepEqual(linePatch, {
    ops: [PatchOpcode.Retain, PatchOpcode.Delete, PatchOpcode.Insert],
    args: [10, 9, 9],
    insertText: 'new line\n',
  });
  assert.deepEqual(createPatch(before, after, { lineDiffCapacity: 0.1 }), {
    ops: [PatchOpcode.Delete, PatchOpcode.Insert],
    args: [before.length, after.length],
    insertText: after,
  });
  assert.deepEqual(createPatch(before, after, { lineDiffCapacity: 100, characterDiffCapacity: 100 }), {
    ops: [PatchOpcode.Retain, PatchOpcode.Delete, PatchOpcode.Insert, PatchOpcode.Retain],
    args: [10, 3, 3, 6],
    insertText: 'new',
  });
});

test('character and line APIs are independently usable', () => {
  const before = 'old line\n';
  const after = 'new line\n';
  assert.deepEqual(createCharacterPatch(before, after, 100), {
    ops: [PatchOpcode.Delete, PatchOpcode.Insert, PatchOpcode.Retain],
    args: [3, 3, 6],
    insertText: 'new',
  });
  assert.deepEqual(createLinePatch(before, after), {
    ops: [PatchOpcode.Delete, PatchOpcode.Insert],
    args: [before.length, after.length],
    insertText: after,
  });
  assert.deepEqual(
    createPatch(before, after, { characterDiffCapacity: 100, lineDiffCapacity: 0.1 }),
    createCharacterPatch(before, after, 100),
  );
});

test('multi-line changed region stays at line granularity', () => {
  const before = 'keep\nold1\nold2\nend\n';
  const after = 'keep\nnew1\nnew2\nend\n';
  assert.deepEqual(
    createPatch(before, after, { characterDiffCapacity: 1_000 }),
    createLinePatch(before, after),
  );
});
