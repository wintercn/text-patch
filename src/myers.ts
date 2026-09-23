// Myers (1986), section 4b: bidirectional frontiers and a middle-snake split.
export function myersChanges(
  beforeLength: number,
  afterLength: number,
  equal: (beforeIndex: number, afterIndex: number) => boolean,
  maxComparisons = Number.POSITIVE_INFINITY,
): { beforeChanged: Uint8Array; afterChanged: Uint8Array } | null {
  const beforeChanged = new Uint8Array(beforeLength);
  const afterChanged = new Uint8Array(afterLength);
  const radius = Math.ceil((beforeLength + afterLength) / 2) + 1;
  const forward = new Int32Array(radius * 2 + 1);
  const reverse = new Int32Array(radius * 2 + 1);
  const unreachable = -0x3fffffff;
  let comparisons = 0;
  let middleBeforeStart = 0;
  let middleAfterStart = 0;
  let middleBeforeEnd = 0;
  let middleAfterEnd = 0;

  function middle(a0: number, a1: number, b0: number, b1: number): boolean {
    const width = a1 - a0;
    const height = b1 - b0;
    const delta = width - height;
    const odd = delta % 2 !== 0;
    for (let depth = 0; depth <= Math.ceil((width + height) / 2); depth++) {
      forward[radius - depth - 1] = unreachable;
      forward[radius + depth + 1] = unreachable;
      for (let k = -depth, slot = radius - depth; k <= depth; k += 2, slot += 2) {
        let x = depth === 0 ? 0 : forward[slot - 1] >= forward[slot + 1]
          ? forward[slot - 1] + 1 : forward[slot + 1];
        let y = x - k;
        while (x < width && y < height) {
          if (comparisons >= maxComparisons) return false;
          comparisons++;
          if (!equal(a0 + x, b0 + y)) break;
          x++;
          y++;
        }
        forward[slot] = x;
        if (odd) {
          const opposite = delta - k;
          if (Math.abs(opposite) <= depth - 1 && x + reverse[radius + opposite] >= width) {
            const start = forward[slot - 1] >= forward[slot + 1]
              ? forward[slot - 1] + 1 : forward[slot + 1];
            middleBeforeStart = a0 + start;
            middleAfterStart = b0 + start - k;
            middleBeforeEnd = a0 + x;
            middleAfterEnd = b0 + y;
            return true;
          }
        }
      }
      reverse[radius - depth - 1] = unreachable;
      reverse[radius + depth + 1] = unreachable;
      for (let k = -depth, slot = radius - depth; k <= depth; k += 2, slot += 2) {
        let x = depth === 0 ? 0 : reverse[slot - 1] >= reverse[slot + 1]
          ? reverse[slot - 1] + 1 : reverse[slot + 1];
        let y = x - k;
        while (x < width && y < height) {
          if (comparisons >= maxComparisons) return false;
          comparisons++;
          if (!equal(a1 - x - 1, b1 - y - 1)) break;
          x++;
          y++;
        }
        reverse[slot] = x;
        if (!odd) {
          const opposite = delta - k;
          if ((delta === 0 || Math.abs(opposite) <= depth)
            && forward[radius + opposite] + x >= width) {
            const start = depth === 0 ? 0 : reverse[slot - 1] >= reverse[slot + 1]
              ? reverse[slot - 1] + 1 : reverse[slot + 1];
            middleBeforeStart = a1 - x;
            middleAfterStart = b1 - y;
            middleBeforeEnd = a1 - start;
            middleAfterEnd = b1 - start + k;
            return true;
          }
        }
      }
    }
    throw new Error('Myers middle snake not found');
  }

  const pending = [0, beforeLength, 0, afterLength];
  while (pending.length !== 0) {
    let b1 = pending.pop()!;
    let b0 = pending.pop()!;
    let a1 = pending.pop()!;
    let a0 = pending.pop()!;
    while (a0 < a1 && b0 < b1) {
      if (comparisons >= maxComparisons) return null;
      comparisons++;
      if (!equal(a0, b0)) break;
      a0++;
      b0++;
    }
    while (a0 < a1 && b0 < b1) {
      if (comparisons >= maxComparisons) return null;
      comparisons++;
      if (!equal(a1 - 1, b1 - 1)) break;
      a1--;
      b1--;
    }
    if (a0 === a1) {
      afterChanged.fill(1, b0, b1);
    } else if (b0 === b1) {
      beforeChanged.fill(1, a0, a1);
    } else {
      if (!middle(a0, a1, b0, b1)) return null;
      pending.push(middleBeforeEnd, a1, middleAfterEnd, b1);
      pending.push(a0, middleBeforeStart, b0, middleAfterStart);
    }
  }
  return { beforeChanged, afterChanged };
}
