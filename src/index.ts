import { myersChanges } from './myers.ts';

export enum PatchOpcode {
  Retain = 0,
  Delete = 1,
  Insert = 2,
}

export type Patch = {
  ops: PatchOpcode[];
  args: number[];
  insertText: string;
};

export type PatchOptions = {
  characterDiffCapacity?: number;
  lineDiffCapacity?: number;
};

const DEFAULT_LINE_DIFF_CAPACITY = 3_000;
const DEFAULT_CHARACTER_DIFF_RATIO = 0.1;
const DEFAULT_FULL_DIFF_MAX_LENGTH = 500;

function validateDiffCapacity(diffCapacity: number | undefined): void {
  if (diffCapacity !== undefined && (!Number.isFinite(diffCapacity) || diffCapacity <= 0)) {
    throw new RangeError('diffCapacity must be a positive finite number');
  }
}

function unchangedPatch(before: string): Patch {
  return before.length === 0
    ? { ops: [], args: [], insertText: '' }
    : { ops: [PatchOpcode.Retain], args: [before.length], insertText: '' };
}

function replacementPatch(before: string, after: string): Patch {
  const ops: PatchOpcode[] = [];
  const args: number[] = [];
  if (before.length !== 0) {
    ops.push(PatchOpcode.Delete);
    args.push(before.length);
  }
  if (after.length !== 0) {
    ops.push(PatchOpcode.Insert);
    args.push(after.length);
  }
  return { ops, args, insertText: after };
}

function emit(ops: PatchOpcode[], args: number[], opcode: PatchOpcode, length: number): void {
  if (length === 0) {
    return;
  }
  if (ops[ops.length - 1] === opcode) {
    args[args.length - 1] += length;
  } else {
    ops.push(opcode);
    args.push(length);
  }
}

function isSingleLine(text: string): boolean {
  const newline = text.indexOf('\n');
  return newline === -1 || newline === text.length - 1;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineHashes(text: string, starts: number[]): Uint32Array {
  const hashes = new Uint32Array(starts.length);
  for (let line = 0; line < starts.length; line++) {
    const end = starts[line + 1] ?? text.length;
    let hash = 2166136261;
    for (let index = starts[line]; index < end; index++) {
      hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    }
    hashes[line] = hash >>> 0;
  }
  return hashes;
}

export function createCharacterPatch(before: string, after: string, diffCapacity?: number): Patch {
  validateDiffCapacity(diffCapacity);
  if (before === after) {
    return unchangedPatch(before);
  }

  const combinedLength = before.length + after.length;
  const defaultCapacity = before.length <= DEFAULT_FULL_DIFF_MAX_LENGTH
    && after.length <= DEFAULT_FULL_DIFF_MAX_LENGTH
    ? Number.POSITIVE_INFINITY
    : DEFAULT_CHARACTER_DIFF_RATIO * combinedLength;
  const changes = myersChanges(
    before.length,
    after.length,
    (beforeIndex, afterIndex) => before.charCodeAt(beforeIndex) === after.charCodeAt(afterIndex),
    Math.floor((diffCapacity ?? defaultCapacity) * combinedLength),
  );
  if (changes === null) {
    return replacementPatch(before, after);
  }

  const ops: PatchOpcode[] = [];
  const args: number[] = [];
  const insertPieces: string[] = [];
  const { beforeChanged, afterChanged } = changes;
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeChanged.length || afterIndex < afterChanged.length) {
    const removedStart = beforeIndex;
    while (beforeIndex < beforeChanged.length && beforeChanged[beforeIndex] !== 0) {
      beforeIndex++;
    }
    emit(ops, args, PatchOpcode.Delete, beforeIndex - removedStart);

    const insertedStart = afterIndex;
    while (afterIndex < afterChanged.length && afterChanged[afterIndex] !== 0) {
      afterIndex++;
    }
    const insertedText = after.slice(insertedStart, afterIndex);
    emit(ops, args, PatchOpcode.Insert, insertedText.length);
    if (insertedText.length !== 0) {
      insertPieces.push(insertedText);
    }

    const retainedStart = beforeIndex;
    while (beforeIndex < beforeChanged.length && afterIndex < afterChanged.length
      && beforeChanged[beforeIndex] === 0 && afterChanged[afterIndex] === 0) {
      beforeIndex++;
      afterIndex++;
    }
    emit(ops, args, PatchOpcode.Retain, beforeIndex - retainedStart);
  }

  return { ops, args, insertText: insertPieces.join('') };
}

function createLinePatchOrNull(before: string, after: string, diffCapacity?: number): Patch | null {
  validateDiffCapacity(diffCapacity);
  if (before === after) {
    return unchangedPatch(before);
  }

  const beforeLines = lineStarts(before);
  const afterLines = lineStarts(after);
  const beforeHashes = lineHashes(before, beforeLines);
  const afterHashes = lineHashes(after, afterLines);
  const lineChanges = myersChanges(
    beforeLines.length,
    afterLines.length,
    (beforeLine, afterLine) => {
      const beforeStart = beforeLines[beforeLine];
      const afterStart = afterLines[afterLine];
      const beforeEnd = beforeLines[beforeLine + 1] ?? before.length;
      const afterEnd = afterLines[afterLine + 1] ?? after.length;
      if (beforeEnd - beforeStart !== afterEnd - afterStart || beforeHashes[beforeLine] !== afterHashes[afterLine]) {
        return false;
      }
      for (let offset = 0; offset < beforeEnd - beforeStart; offset++) {
        if (before.charCodeAt(beforeStart + offset) !== after.charCodeAt(afterStart + offset)) {
          return false;
        }
      }
      return true;
    },
    Math.floor((diffCapacity ?? DEFAULT_LINE_DIFF_CAPACITY) * (beforeLines.length + afterLines.length)),
  );
  if (lineChanges === null) {
    return null;
  }

  const ops: PatchOpcode[] = [];
  const args: number[] = [];
  const insertPieces: string[] = [];
  const { beforeChanged, afterChanged } = lineChanges;

  let beforeLine = 0;
  let afterLine = 0;
  while (beforeLine < beforeLines.length || afterLine < afterLines.length) {
    const beforeStartLine = beforeLine;
    const afterStartLine = afterLine;
    while (beforeLine < beforeLines.length && beforeChanged[beforeLine] !== 0) {
      beforeLine++;
    }
    while (afterLine < afterLines.length && afterChanged[afterLine] !== 0) {
      afterLine++;
    }
    if (beforeLine !== beforeStartLine || afterLine !== afterStartLine) {
      const beforeStart = beforeLines[beforeStartLine] ?? before.length;
      const beforeEnd = beforeLines[beforeLine] ?? before.length;
      const afterStart = afterLines[afterStartLine] ?? after.length;
      const afterEnd = afterLines[afterLine] ?? after.length;
      emit(ops, args, PatchOpcode.Delete, beforeEnd - beforeStart);
      const insertedText = after.slice(afterStart, afterEnd);
      emit(ops, args, PatchOpcode.Insert, insertedText.length);
      if (insertedText.length !== 0) {
        insertPieces.push(insertedText);
      }
    }

    const retainedStart = beforeLine;
    while (beforeLine < beforeLines.length && afterLine < afterLines.length
      && beforeChanged[beforeLine] === 0 && afterChanged[afterLine] === 0) {
      beforeLine++;
      afterLine++;
    }
    const retainedEnd = beforeLines[beforeLine] ?? before.length;
    emit(ops, args, PatchOpcode.Retain, retainedEnd - (beforeLines[retainedStart] ?? before.length));
  }

  return { ops, args, insertText: insertPieces.join('') };
}

export function createLinePatch(before: string, after: string, diffCapacity?: number): Patch {
  return createLinePatchOrNull(before, after, diffCapacity) ?? replacementPatch(before, after);
}

export function createPatch(before: string, after: string, options?: PatchOptions): Patch {
  if (options !== undefined && (options === null || typeof options !== 'object' || Array.isArray(options))) {
    throw new TypeError('Patch options must be an object');
  }
  if (options !== undefined) {
    for (const name of Object.keys(options)) {
      if (name !== 'characterDiffCapacity' && name !== 'lineDiffCapacity') {
        throw new TypeError(`Unknown Patch option: ${name}`);
      }
    }
  }
  validateDiffCapacity(options?.characterDiffCapacity);
  validateDiffCapacity(options?.lineDiffCapacity);

  if (before === after) {
    return unchangedPatch(before);
  }
  if (isSingleLine(before) && isSingleLine(after)) {
    return createCharacterPatch(before, after, options?.characterDiffCapacity);
  }

  const linePatch = createLinePatchOrNull(before, after, options?.lineDiffCapacity);
  if (linePatch === null) {
    return replacementPatch(before, after);
  }
  const ops: PatchOpcode[] = [];
  const args: number[] = [];
  const insertPieces: string[] = [];
  let beforeOffset = 0;
  let lineInsertOffset = 0;

  for (let index = 0; index < linePatch.ops.length; index++) {
    const opcode = linePatch.ops[index];
    const length = linePatch.args[index];
    if (opcode === PatchOpcode.Retain) {
      emit(ops, args, opcode, length);
      beforeOffset += length;
    } else if (opcode === PatchOpcode.Delete) {
      const beforeText = before.slice(beforeOffset, beforeOffset + length);
      beforeOffset += length;
      if (linePatch.ops[index + 1] === PatchOpcode.Insert) {
        const insertedLength = linePatch.args[++index];
        const afterText = linePatch.insertText.slice(lineInsertOffset, lineInsertOffset + insertedLength);
        lineInsertOffset += insertedLength;
        if (isSingleLine(beforeText) && isSingleLine(afterText)) {
          const characterPatch = createCharacterPatch(beforeText, afterText, options?.characterDiffCapacity);
          for (let operation = 0; operation < characterPatch.ops.length; operation++) {
            emit(ops, args, characterPatch.ops[operation], characterPatch.args[operation]);
          }
          if (characterPatch.insertText.length !== 0) {
            insertPieces.push(characterPatch.insertText);
          }
        } else {
          let beforeLeft = 0;
          let afterLeft = 0;
          let beforeRight = beforeText.length;
          let afterRight = afterText.length;
          let scanLeft = true;
          const rightPatches: Patch[] = [];

          while (beforeLeft < beforeRight && afterLeft < afterRight) {
            if (scanLeft) {
              const beforeNewline = beforeText.indexOf('\n', beforeLeft);
              const afterNewline = afterText.indexOf('\n', afterLeft);
              const beforeEnd = beforeNewline < 0 || beforeNewline >= beforeRight ? beforeRight : beforeNewline + 1;
              const afterEnd = afterNewline < 0 || afterNewline >= afterRight ? afterRight : afterNewline + 1;
              const characterPatch = createCharacterPatch(
                beforeText.slice(beforeLeft, beforeEnd),
                afterText.slice(afterLeft, afterEnd),
                options?.characterDiffCapacity,
              );
              const retainedLength = characterPatch.args.reduce((total, argument, operation) =>
                total + (characterPatch.ops[operation] === PatchOpcode.Retain ? argument : 0), 0);
              if (10 * retainedLength < 3 * (beforeEnd - beforeLeft + afterEnd - afterLeft)) {
                scanLeft = false;
                continue;
              }
              for (let operation = 0; operation < characterPatch.ops.length; operation++) {
                emit(ops, args, characterPatch.ops[operation], characterPatch.args[operation]);
              }
              if (characterPatch.insertText.length !== 0) {
                insertPieces.push(characterPatch.insertText);
              }
              beforeLeft = beforeEnd;
              afterLeft = afterEnd;
            } else {
              const beforeStart = Math.max(beforeLeft, beforeText.lastIndexOf('\n', beforeRight - 2) + 1);
              const afterStart = Math.max(afterLeft, afterText.lastIndexOf('\n', afterRight - 2) + 1);
              const characterPatch = createCharacterPatch(
                beforeText.slice(beforeStart, beforeRight),
                afterText.slice(afterStart, afterRight),
                options?.characterDiffCapacity,
              );
              const retainedLength = characterPatch.args.reduce((total, argument, operation) =>
                total + (characterPatch.ops[operation] === PatchOpcode.Retain ? argument : 0), 0);
              if (10 * retainedLength < 3 * (beforeRight - beforeStart + afterRight - afterStart)) {
                break;
              }
              rightPatches.push(characterPatch);
              beforeRight = beforeStart;
              afterRight = afterStart;
            }
          }

          emit(ops, args, PatchOpcode.Delete, beforeRight - beforeLeft);
          emit(ops, args, PatchOpcode.Insert, afterRight - afterLeft);
          if (afterRight !== afterLeft) {
            insertPieces.push(afterText.slice(afterLeft, afterRight));
          }
          for (let rightIndex = rightPatches.length - 1; rightIndex >= 0; rightIndex--) {
            const characterPatch = rightPatches[rightIndex];
            for (let operation = 0; operation < characterPatch.ops.length; operation++) {
              emit(ops, args, characterPatch.ops[operation], characterPatch.args[operation]);
            }
            if (characterPatch.insertText.length !== 0) {
              insertPieces.push(characterPatch.insertText);
            }
          }
        }
      } else {
        emit(ops, args, opcode, length);
      }
    } else {
      const insertedText = linePatch.insertText.slice(lineInsertOffset, lineInsertOffset + length);
      lineInsertOffset += length;
      emit(ops, args, opcode, length);
      insertPieces.push(insertedText);
    }
  }

  return { ops, args, insertText: insertPieces.join('') };
}

export function applyPatch(before: string, patch: Patch): string {
  let beforeOffset = 0;
  let insertOffset = 0;
  const pieces: string[] = [];

  for (let index = 0; index < patch.ops.length; index++) {
    const opcode = patch.ops[index];
    const length = patch.args[index];

    switch (opcode) {
      case PatchOpcode.Retain:
        pieces.push(before.slice(beforeOffset, beforeOffset + length));
        beforeOffset += length;
        break;
      case PatchOpcode.Delete:
        if (beforeOffset + length > before.length) {
          throw new RangeError('Delete exceeds source length');
        }
        beforeOffset += length;
        break;
      case PatchOpcode.Insert:
        pieces.push(patch.insertText.slice(insertOffset, insertOffset + length));
        insertOffset += length;
        break;
    }
  }

  return pieces.join('');
}
