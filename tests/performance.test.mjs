import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { applyPatch, createPatch, PatchOpcode } from '../src/index.ts';

function seededRandom(seed) {
  let state = seed;
  return bound => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 0x100000000) * bound);
  };
}

function randomAscii(random, length) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz ';
  let result = '';
  for (let index = 0; index < length; index++) {
    result += alphabet[random(alphabet.length)];
  }
  return result;
}

test('extreme single line: one million characters with 1000 scattered edits within 2 seconds', () => {
  const random = seededRandom(123456789);
  const before = randomAscii(random, 1_000_000);
  const characters = [...before];
  for (let index = 0; index < 1_000; index++) {
    const at = random(characters.length);
    if (index % 2 === 0) {
      characters.splice(at, 0, ...randomAscii(random, 10));
    } else {
      characters.splice(at, 10);
    }
  }
  const after = characters.join('');
  assert.equal(before.includes('\n'), false);
  assert.equal(after.includes('\n'), false);

  const start = performance.now();
  const patch = createPatch(before, after);
  const elapsed = performance.now() - start;

  assert.equal(applyPatch(before, patch), after);
  assert.ok(patch.ops.length > 1_000, `only ${patch.ops.length} operations were generated`);
  assert.ok(elapsed <= 2_000, `createPatch took ${elapsed.toFixed(1)} ms, limit 2000 ms`);
});

test('extreme single line: 5000 independent characters with explicit fine-diff capacity within 2 seconds', () => {
  const random = seededRandom(314159265);
  const before = randomAscii(random, 5_000);
  const after = randomAscii(random, 5_000);

  const start = performance.now();
  const patch = createPatch(before, after, { characterDiffCapacity: 3_000 });
  const elapsed = performance.now() - start;

  assert.equal(applyPatch(before, patch), after);
  assert.ok(patch.ops.includes(PatchOpcode.Retain));
  assert.ok(patch.ops.length > 1_000, `only ${patch.ops.length} operations were generated`);
  assert.ok(elapsed <= 2_000, `createPatch took ${elapsed.toFixed(1)} ms, limit 2000 ms`);
});

test('extreme single line: 5000 unrelated characters fully replace within 2 seconds', () => {
  const before = randomAscii(seededRandom(123456789), 5_000);
  const after = randomAscii(seededRandom(987654321), 5_000);

  const start = performance.now();
  const patch = createPatch(before, after);
  const elapsed = performance.now() - start;

  assert.deepEqual(patch, {
    ops: [PatchOpcode.Delete, PatchOpcode.Insert],
    args: [before.length, after.length],
    insertText: after,
  });
  assert.equal(applyPatch(before, patch), after);
  assert.ok(elapsed <= 2_000, `createPatch took ${elapsed.toFixed(1)} ms, limit 2000 ms`);
});

test('extreme single line: 20000 unrelated characters fall back within 5 seconds', () => {
  const before = randomAscii(seededRandom(123456789), 20_000);
  const after = randomAscii(seededRandom(987654321), 20_000);

  const start = performance.now();
  const patch = createPatch(before, after);
  const elapsed = performance.now() - start;

  assert.deepEqual(patch, {
    ops: [PatchOpcode.Delete, PatchOpcode.Insert],
    args: [before.length, after.length],
    insertText: after,
  });
  assert.equal(applyPatch(before, patch), after);
  assert.ok(elapsed <= 5_000, `createPatch took ${elapsed.toFixed(1)} ms, limit 5000 ms`);
});

test('extreme multi-line: 250 unrelated lines produce whole replacement within 2 seconds', () => {
  const beforeRandom = seededRandom(123456789);
  const afterRandom = seededRandom(987654321);
  const before = Array.from({ length: 250 }, () => `${randomAscii(beforeRandom, 79)}\n`).join('');
  const after = Array.from({ length: 250 }, () => `${randomAscii(afterRandom, 79)}\n`).join('');

  const start = performance.now();
  const patch = createPatch(before, after);
  const elapsed = performance.now() - start;

  assert.deepEqual(patch, {
    ops: [PatchOpcode.Delete, PatchOpcode.Insert],
    args: [before.length, after.length],
    insertText: after,
  });
  assert.equal(applyPatch(before, patch), after);
  assert.ok(elapsed <= 2_000, `createPatch took ${elapsed.toFixed(1)} ms, limit 2000 ms`);
});

test('extreme multi-line: 3.2 million varied characters and 500 scattered edits within 1 second', () => {
  const random = seededRandom(20260923);
  const lines = Array.from({ length: 40_000 }, () => `${randomAscii(random, 80)}\n`);
  const modified = lines.slice();
  for (let index = 0; index < 500; index++) {
    const at = random(modified.length);
    if (index % 3 === 0) {
      modified.splice(at, 0, `${randomAscii(random, 80)}\n`);
    } else if (index % 3 === 1) {
      modified.splice(at, 1);
    } else {
      modified[at] = modified[at].slice(0, 30) + randomAscii(random, 10) + modified[at].slice(40);
    }
  }
  const before = lines.join('');
  const after = modified.join('');
  assert.ok(before.length > 3_000_000);

  const start = performance.now();
  const patch = createPatch(before, after);
  const elapsed = performance.now() - start;

  assert.equal(applyPatch(before, patch), after);
  assert.ok(patch.ops.length > 1_000, `only ${patch.ops.length} operations were generated`);
  assert.ok(elapsed <= 1_000, `createPatch took ${elapsed.toFixed(1)} ms, limit 1000 ms`);
});

test('extreme multi-line: repeated Markdown blocks and 1000 scattered edits within 2 seconds', () => {
  const random = seededRandom(271828182);
  const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'omicron', 'pi'];
  const blocks = words.map((word, index) => `## ${word}\n- ${words[(index + 3) % words.length]} ${words[(index + 7) % words.length]} ${words[(index + 11) % words.length]}\n`);
  const sourceBlocks = Array.from({ length: 100_000 }, () => blocks[random(blocks.length)]);
  const modifiedBlocks = sourceBlocks.slice();
  for (let index = 0; index < 1_000; index++) {
    const at = random(modifiedBlocks.length);
    if (index % 3 === 0) {
      modifiedBlocks.splice(at, 1);
    } else if (index % 3 === 1) {
      modifiedBlocks.splice(at, 0, blocks[random(blocks.length)]);
    } else {
      modifiedBlocks[at] = blocks[random(blocks.length)];
    }
  }
  const before = sourceBlocks.join('');
  const after = modifiedBlocks.join('');
  assert.ok(before.length > 2_000_000);

  const start = performance.now();
  const patch = createPatch(before, after);
  const elapsed = performance.now() - start;

  assert.equal(applyPatch(before, patch), after);
  assert.ok(patch.ops.length > 1_000, `only ${patch.ops.length} operations were generated`);
  assert.ok(elapsed <= 2_000, `createPatch took ${elapsed.toFixed(1)} ms, limit 2000 ms`);
});
