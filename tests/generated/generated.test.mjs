import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { applyPatch, createCharacterPatch, createLinePatch, createPatch, PatchOpcode } from '../../src/index.ts';

const generatedDirectory = new URL('./', import.meta.url);
const batches = readdirSync(generatedDirectory).filter(name => name.endsWith('.json')).sort();
assert.ok(batches.length > 0);
const fullDiffCapacity = Number.MAX_SAFE_INTEGER;
const allCases = [];
const indexedCases = [];

function editCost(patch) {
  return patch.args.reduce((total, length, index) =>
    total + (patch.ops[index] === PatchOpcode.Retain ? 0 : length), 0);
}

function splitLines(text) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) {
      lines.push(text.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < text.length) {
    lines.push(text.slice(start));
  }
  return lines;
}

function insertDeleteDistance(beforeUnits, afterUnits) {
  let previous = Uint32Array.from({ length: afterUnits.length + 1 }, (_, index) => index);
  let current = new Uint32Array(afterUnits.length + 1);
  for (let beforeIndex = 1; beforeIndex <= beforeUnits.length; beforeIndex++) {
    current[0] = beforeIndex;
    for (let afterIndex = 1; afterIndex <= afterUnits.length; afterIndex++) {
      current[afterIndex] = beforeUnits[beforeIndex - 1] === afterUnits[afterIndex - 1]
        ? previous[afterIndex - 1]
        : Math.min(previous[afterIndex], current[afterIndex - 1]) + 1;
    }
    [previous, current] = [current, previous];
  }
  return previous[afterUnits.length];
}

function lineEditCost(before, patch) {
  let beforeOffset = 0;
  let insertOffset = 0;
  let cost = 0;
  for (let index = 0; index < patch.ops.length; index++) {
    const length = patch.args[index];
    if (patch.ops[index] === PatchOpcode.Retain) {
      beforeOffset += length;
    } else if (patch.ops[index] === PatchOpcode.Delete) {
      cost += splitLines(before.slice(beforeOffset, beforeOffset + length)).length;
      beforeOffset += length;
    } else {
      cost += splitLines(patch.insertText.slice(insertOffset, insertOffset + length)).length;
      insertOffset += length;
    }
  }
  return cost;
}

function isSingleLine(text) {
  const newline = text.indexOf('\n');
  return newline === -1 || newline === text.length - 1;
}

function composedReferenceCost(before, after, linePatch, characterDistance) {
  if (isSingleLine(before) && isSingleLine(after)) {
    return characterDistance;
  }
  let cost = 0;
  let beforeOffset = 0;
  let insertOffset = 0;
  for (let index = 0; index < linePatch.ops.length; index++) {
    const opcode = linePatch.ops[index];
    const length = linePatch.args[index];
    if (opcode === PatchOpcode.Retain) {
      beforeOffset += length;
    } else if (opcode === PatchOpcode.Delete) {
      const beforeText = before.slice(beforeOffset, beforeOffset + length);
      beforeOffset += length;
      if (linePatch.ops[index + 1] === PatchOpcode.Insert) {
        const insertLength = linePatch.args[++index];
        const afterText = linePatch.insertText.slice(insertOffset, insertOffset + insertLength);
        insertOffset += insertLength;
        if (isSingleLine(beforeText) && isSingleLine(afterText)) {
          cost += insertDeleteDistance(beforeText.split(''), afterText.split(''));
        } else {
          const beforeLines = splitLines(beforeText);
          const afterLines = splitLines(afterText);
          let beforeLeft = 0;
          let afterLeft = 0;
          let beforeRight = beforeLines.length;
          let afterRight = afterLines.length;
          let scanLeft = true;
          while (beforeLeft < beforeRight && afterLeft < afterRight) {
            const beforeLine = scanLeft ? beforeLines[beforeLeft] : beforeLines[beforeRight - 1];
            const afterLine = scanLeft ? afterLines[afterLeft] : afterLines[afterRight - 1];
            const distance = insertDeleteDistance(beforeLine.split(''), afterLine.split(''));
            if (5 * distance > 2 * (beforeLine.length + afterLine.length)) {
              if (scanLeft) {
                scanLeft = false;
                continue;
              }
              break;
            }
            cost += distance;
            if (scanLeft) {
              beforeLeft++;
              afterLeft++;
            } else {
              beforeRight--;
              afterRight--;
            }
          }
          for (let line = beforeLeft; line < beforeRight; line++) cost += beforeLines[line].length;
          for (let line = afterLeft; line < afterRight; line++) cost += afterLines[line].length;
        }
      } else {
        cost += length;
      }
    } else {
      cost += length;
      insertOffset += length;
    }
  }
  return cost;
}

for (const filename of batches) {
  const batch = JSON.parse(readFileSync(new URL(filename, generatedDirectory), 'utf8'));
  assert.equal(batch.cases.length > 0, true);
  allCases.push(...batch.cases);

  for (const [index, fixture] of batch.cases.entries()) {
    indexedCases.push({ filename, index, fixture });
    test(`generated ${filename} #${index + 1}`, () => {
      assert.equal(fixture.original.length, batch.originalLength);
      assert.equal(fixture.edits.length, batch.editCount);
      let replay = fixture.original;
      for (const edit of fixture.edits) {
        if (edit.type === 'insert') {
          replay = replay.slice(0, edit.at) + edit.text + replay.slice(edit.at);
        } else if (edit.type === 'delete') {
          replay = replay.slice(0, edit.at) + replay.slice(edit.at + edit.length);
        } else {
          throw new RangeError(`unknown generated edit type: ${edit.type}`);
        }
      }
      assert.equal(replay, fixture.result);

      assert.equal(applyPatch(fixture.original, fixture.referencePatch), fixture.result);
      assert.equal(editCost(fixture.referencePatch), fixture.referenceDistance);

      const patch = createPatch(fixture.original, fixture.result);
      assert.equal(applyPatch(fixture.original, patch), fixture.result);
      assert.equal(applyPatch(fixture.original, JSON.parse(JSON.stringify(patch))), fixture.result);
      const characterPatch = createCharacterPatch(fixture.original, fixture.result, fullDiffCapacity);
      assert.equal(applyPatch(fixture.original, characterPatch), fixture.result);
      assert.equal(editCost(characterPatch), fixture.referenceDistance);
      assert.equal(applyPatch(fixture.original, createLinePatch(fixture.original, fixture.result)), fixture.result);
    });
  }
}

test('generated line paths match line-level insert/delete distance', () => {
  for (const { filename, index, fixture } of indexedCases) {
    const expected = insertDeleteDistance(splitLines(fixture.original), splitLines(fixture.result));
    const actual = lineEditCost(fixture.original, createLinePatch(fixture.original, fixture.result, fullDiffCapacity));
    assert.equal(actual, expected, `${filename} #${index + 1}`);
  }
});

test('generated combined paths match the two-layer reference cost', () => {
  for (const { filename, index, fixture } of indexedCases) {
    const linePatch = createLinePatch(fixture.original, fixture.result, fullDiffCapacity);
    const expected = composedReferenceCost(
      fixture.original, fixture.result, linePatch, fixture.referenceDistance,
    );
    const actual = editCost(createPatch(fixture.original, fixture.result, {
      characterDiffCapacity: fullDiffCapacity,
      lineDiffCapacity: fullDiffCapacity,
    }));
    assert.equal(actual, expected, `${filename} #${index + 1}`);
  }
});

test('generated cases include CJK and emoji', () => {
  assert.ok(allCases.some(fixture => /\p{Script=Han}/u.test(fixture.original)));
  assert.ok(allCases.some(fixture => /\p{Extended_Pictographic}/u.test(fixture.original)));
  assert.ok(allCases.some(fixture => fixture.original.includes('𠀀') || fixture.original.includes('𠮷')));
  assert.ok(allCases.some(fixture => fixture.original.includes('👩‍💻') || fixture.original.includes('👨🏽‍🚒')));
  assert.ok(allCases.some(fixture => [...fixture.result].some(character =>
    character.length === 1 && /[\ud800-\udfff]/u.test(character)
  )));
});
