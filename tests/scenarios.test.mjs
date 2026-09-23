import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPatch, createLinePatch, createPatch, PatchOpcode } from '../src/index.ts';

test('standard: unchanged text is one retain operation', () => {
  assert.deepEqual(createPatch('abc\n', 'abc\n'), {
    ops: [PatchOpcode.Retain],
    args: [4],
    insertText: '',
  });
});

test('standard: multiple inserts consume one concatenated text block', () => {
  const before = 'abcdef';
  const patch = {
    ops: [PatchOpcode.Retain, PatchOpcode.Delete, PatchOpcode.Insert, PatchOpcode.Retain, PatchOpcode.Insert],
    args: [2, 2, 3, 2, 1],
    insertText: 'XYZ!',
  };
  assert.equal(applyPatch(before, patch), 'abXYZef!');
});

test('standard: changed word keeps unchanged surrounding text', () => {
  const before = '# Title\n\nThe quick brown fox.\n';
  const after = '# Title\n\nThe quick black fox.\n';
  const patch = createPatch(before, after);
  assert.equal(applyPatch(before, patch), after);
  assert.equal(patch.insertText, 'lack');
  assert.equal(patch.ops[0], PatchOpcode.Retain);
  assert.equal(patch.ops.at(-1), PatchOpcode.Retain);
});

test('boundary: empty source and result', () => {
  assert.deepEqual(createPatch('', ''), { ops: [], args: [], insertText: '' });
  assert.equal(applyPatch('', createPatch('', 'hello')), 'hello');
  assert.equal(applyPatch('hello', createPatch('hello', '')), '');
});

test('boundary: edits at the first and last positions', () => {
  for (const [before, after] of [
    ['abc', 'Xabc'],
    ['abc', 'abcX'],
    ['Xabc', 'abc'],
    ['abcX', 'abc'],
  ]) {
    assert.equal(applyPatch(before, createPatch(before, after)), after);
  }
});

test('boundary: missing final newline and CRLF stay exact', () => {
  for (const [before, after] of [
    ['a\nb\n', 'a\nb'],
    ['a\nb', 'a\nb\n'],
    ['a\r\nb\r\n', 'a\r\nB\r\n'],
    ['a\r\nb', 'a\r\nb\r\n'],
  ]) {
    assert.equal(applyPatch(before, createPatch(before, after)), after);
  }
});

test('boundary: supplementary Unicode characters use UTF-16 lengths', () => {
  const patch = createPatch('甲😀乙', '甲🐈乙');
  assert.equal(applyPatch('甲😀乙', patch), '甲🐈乙');
  assert.deepEqual(patch.ops, [PatchOpcode.Retain, PatchOpcode.Delete, PatchOpcode.Insert, PatchOpcode.Retain]);
  assert.deepEqual(patch.args, [2, 1, 1, 1]);
  assert.equal(patch.insertText, '🐈'.slice(1));
});

test('boundary: appending a line preserves an unterminated last line', () => {
  const before = 'head\nsame';
  const after = 'head\nsame\nnew';
  const patch = createPatch(before, after);
  assert.deepEqual(patch, {
    ops: [PatchOpcode.Retain, PatchOpcode.Insert],
    args: [before.length, after.length - before.length],
    insertText: '\nnew',
  });
  assert.equal(applyPatch(before, patch), after);
});

test('boundary: refinement scans from the left, then the right, and stops after both fail', () => {
  const before = 'keep\nalpha old\nXXXXXXXX\nomega old\nend\n';
  const after = 'keep\nalpha new\nYYYYYYYY\nadditional\nomega new\nend\n';
  const patch = createPatch(before, after);
  assert.equal(applyPatch(before, patch), after);

  const retained = new Uint8Array(before.length);
  let sourceOffset = 0;
  for (let index = 0; index < patch.ops.length; index++) {
    const length = patch.args[index];
    if (patch.ops[index] === PatchOpcode.Retain) retained.fill(1, sourceOffset, sourceOffset + length);
    if (patch.ops[index] !== PatchOpcode.Insert) sourceOffset += length;
  }
  for (const text of ['alpha ', 'omega ']) {
    const start = before.indexOf(text);
    assert.ok(retained.slice(start, start + text.length).every(value => value === 1), text);
  }
});

test('boundary: low-similarity lines keep the coarse line change', () => {
  const before = 'keep\nAAAAAAAA\nMMMMMMMM\nZZZZZZZZ\nend\n';
  const after = 'keep\nBBBBBBBB\nNNNNNNNN\nYYYYYYYY\nend\n';
  assert.deepEqual(createPatch(before, after), createLinePatch(before, after));
});

test('boundary: similarity exactly 0.6 is accepted', () => {
  const before = 'abcd\nold';
  const after = 'abXY\nnew\nextra';
  const patch = createPatch(before, after);
  assert.equal(applyPatch(before, patch), after);
  assert.deepEqual(patch.ops.slice(0, 2), [PatchOpcode.Retain, PatchOpcode.Delete]);
  assert.equal(patch.args[0], 2);
});

test('boundary: many lines shrinking to one can refine from the right', () => {
  const before = 'XXXXXXXX\nextra\nomega old';
  const after = 'omega new';
  const patch = createPatch(before, after);
  assert.equal(applyPatch(before, patch), after);
  assert.equal(patch.ops.at(-1), PatchOpcode.Insert);
  assert.ok(patch.ops.includes(PatchOpcode.Retain));
  const retainedLength = patch.args.reduce((sum, length, index) =>
    sum + (patch.ops[index] === PatchOpcode.Retain ? length : 0), 0);
  assert.ok(retainedLength >= 'omega '.length);
});
