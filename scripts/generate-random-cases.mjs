import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const allowedOptions = new Set(['--original-length', '--edit-count', '--edit-length', '--cases', '--seed']);
const options = new Map();
for (const argument of process.argv.slice(2)) {
  const separator = argument.indexOf('=');
  const name = argument.slice(0, separator);
  const value = argument.slice(separator + 1);
  if (separator === -1 || !allowedOptions.has(name) || value === '' || options.has(name)) {
    throw new RangeError(`Invalid or duplicate generator option: ${argument}`);
  }
  options.set(name, value);
}

const originalLength = Number(options.get('--original-length') ?? 300);
const editCount = Number(options.get('--edit-count') ?? 10);
const editLength = Number(options.get('--edit-length') ?? 10);
const caseCount = Number(options.get('--cases') ?? 100);
const seed = Number(options.get('--seed') ?? (Date.now() >>> 0));

for (const [name, value, minimum] of [
  ['original-length', originalLength, 0],
  ['edit-count', editCount, 0],
  ['edit-length', editLength, 1],
  ['cases', caseCount, 1],
  ['seed', seed, 0],
]) {
  if (!Number.isSafeInteger(value) || value < minimum || (name === 'seed' && value > 0xffffffff)) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${name === 'seed' ? 0xffffffff : Number.MAX_SAFE_INTEGER}`);
  }
}

let state = seed >>> 0;
function randomInteger(bound) {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return Math.floor((state / 0x100000000) * bound);
}

const alphabet = [...'abcdefghijklmnopqrstuvwxyz \n中文汉字测试段落标题', '𠀀', '𠮷', '😀', '🐈', '🧩', '🚀', '👩‍💻', '👨🏽‍🚒', '🏳️‍🌈', '🇨🇳'];
const oneUnitAlphabet = alphabet.filter(character => character.length === 1);
function randomText(length) {
  let result = '';
  for (let remaining = length; remaining > 0;) {
    const candidate = alphabet[randomInteger(alphabet.length)];
    const character = candidate.length <= remaining
      ? candidate
      : oneUnitAlphabet[randomInteger(oneUnitAlphabet.length)];
    result += character;
    remaining -= character.length;
  }
  return result;
}

function randomEditLength() {
  const radius = Math.floor(editLength / 2);
  return Math.max(1, editLength - radius + randomInteger(radius * 2 + 1));
}

function levenshteinInsertDeleteReference(before, after) {
  const width = after.length + 1;
  const distances = new Uint32Array((before.length + 1) * width);
  for (let beforeIndex = 0; beforeIndex <= before.length; beforeIndex++) {
    distances[beforeIndex * width] = beforeIndex;
  }
  for (let afterIndex = 0; afterIndex <= after.length; afterIndex++) {
    distances[afterIndex] = afterIndex;
  }
  for (let beforeIndex = 1; beforeIndex <= before.length; beforeIndex++) {
    for (let afterIndex = 1; afterIndex <= after.length; afterIndex++) {
      const position = beforeIndex * width + afterIndex;
      distances[position] = before.charCodeAt(beforeIndex - 1) === after.charCodeAt(afterIndex - 1)
        ? distances[position - width - 1]
        : Math.min(distances[position - width], distances[position - 1]) + 1;
    }
  }

  const referenceDistance = distances[before.length * width + after.length];
  const reversedOps = [];
  let beforeIndex = before.length;
  let afterIndex = after.length;
  while (beforeIndex !== 0 || afterIndex !== 0) {
    const position = beforeIndex * width + afterIndex;
    if (beforeIndex !== 0 && afterIndex !== 0
      && before.charCodeAt(beforeIndex - 1) === after.charCodeAt(afterIndex - 1)
      && distances[position] === distances[position - width - 1]) {
      reversedOps.push(0);
      beforeIndex--;
      afterIndex--;
    } else if (beforeIndex !== 0 && (afterIndex === 0
      || distances[position - width] <= distances[position - 1])) {
      reversedOps.push(1);
      beforeIndex--;
    } else {
      reversedOps.push(2);
      afterIndex--;
    }
  }

  const ops = [];
  const args = [];
  const insertPieces = [];
  let afterOffset = 0;
  for (let operation = reversedOps.length - 1; operation >= 0;) {
    const opcode = reversedOps[operation];
    let length = 0;
    while (operation >= 0 && reversedOps[operation] === opcode) {
      length++;
      operation--;
    }
    ops.push(opcode);
    args.push(length);
    if (opcode === 0) {
      afterOffset += length;
    } else if (opcode === 2) {
      insertPieces.push(after.slice(afterOffset, afterOffset + length));
      afterOffset += length;
    }
  }
  return { referenceDistance, referencePatch: { ops, args, insertText: insertPieces.join('') } };
}

const cases = [];
for (let caseIndex = 0; caseIndex < caseCount; caseIndex++) {
  const original = randomText(originalLength);
  let result = original;
  const edits = [];
  for (let editIndex = 0; editIndex < editCount; editIndex++) {
    const length = randomEditLength();
    const insert = result.length === 0 || randomInteger(2) === 0;
    if (insert) {
      const at = randomInteger(result.length + 1);
      const text = randomText(length);
      result = result.slice(0, at) + text + result.slice(at);
      edits.push({ type: 'insert', at, text });
    } else {
      const at = randomInteger(result.length);
      const actualLength = Math.min(length, result.length - at);
      result = result.slice(0, at) + result.slice(at + actualLength);
      edits.push({ type: 'delete', at, length: actualLength });
    }
  }
  cases.push({ original, result, edits, ...levenshteinInsertDeleteReference(original, result) });
}

const outputDirectory = fileURLToPath(new URL('../tests/generated/', import.meta.url));
mkdirSync(outputDirectory, { recursive: true });
const outputFile = fileURLToPath(new URL(`../tests/generated/random-${seed}-${caseCount}-${originalLength}-${editCount}-${editLength}.json`, import.meta.url));
writeFileSync(outputFile, `${JSON.stringify({ seed, originalLength, editCount, editLength, cases }, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(`${outputFile}\n`);
