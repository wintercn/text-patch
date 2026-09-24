# Algorithm

English · [简体中文](https://github.com/wintercn/text-patch/blob/main/docs/algorithm.zh-CN.md)

`text-patch` creates an exact, serializable transformation from one JavaScript string to another. It compares text rather than Markdown syntax. The same API can therefore handle Markdown source and other strings.

## Difference calculation

The library uses the Myers diff algorithm, proposed by Eugene W. Myers. When allowed to finish, the algorithm finds a shortest edit path consisting of insertions and deletions between two sequences ([original paper PDF](https://neil.fraser.name/writing/diff/myers.pdf), [journal DOI](https://doi.org/10.1007/BF01840446)). A configured comparison limit can instead make a region fall back to a coarser replacement.

There are two comparison levels:

- `createLinePatch` treats each complete line as one element. Lines are separated at `\n`; a line's terminator belongs to that line. A pair of lines is considered equal only after checking length, a precomputed hash, and then every UTF-16 code unit. The final comparison prevents hash collisions from changing correctness.
- `createCharacterPatch` treats each UTF-16 code unit as one element and compares them with `charCodeAt`.

`createPatch` combines the levels. If each input has no newline except a possible final newline, it uses the character level directly. Otherwise, it first finds unchanged lines. For a changed block containing one line on each side, it computes a character-level patch. For a larger changed block, it tries to pair lines from the start; after the first pair fails the similarity threshold, it tries from the end. The first failure at the end stops refinement. Any middle region left over stays a line-level delete-and-insert replacement.

For a candidate pair, similarity is `2 × retained UTF-16 length ÷ (old line length + new line length)`. A pair is refined when this value is at least `0.6`. Adjacent operations of the same kind are merged. This combination is intended to preserve large unchanged regions and refine nearby edits; it does not promise a globally shortest character-level patch.

## Diff capacity and fallback

Both standalone diff functions accept an optional `diffCapacity` argument. `createPatch` accepts independent `characterDiffCapacity` and `lineDiffCapacity` options. Explicit capacities must be positive finite numbers.

For each Myers call, let `N` and `M` be the element counts on the old and new sides at that level. The comparison limit is `floor(diffCapacity × (N + M))`. One character-level comparison tests one pair of UTF-16 code units. One line-level comparison tests one pair of lines and counts as one comparison even when checking that pair scans many code units. Capacity is therefore a limit on element comparisons, not a wall-clock deadline or an exact difference percentage.

When omitted, line-level capacity is `3000`. Character-level calculation is unrestricted when both inputs to that call are at most 500 UTF-16 code units; otherwise its default capacity is `0.1 × (N + M)`. These are per-call defaults, including when the character level is invoked inside `createPatch`.

If the line-level call exceeds its limit, its whole input becomes a delete-and-insert replacement. If a character-level call exceeds its limit, only that call's input becomes a replacement; other regions can still retain finer edits. Fallback preserves the target string but can increase patch size. The algorithm does not read a clock; the time limits in the repository's performance tests are test assertions, not runtime deadlines.

## Patch representation

```ts
enum PatchOpcode {
  Retain = 0,
  Delete = 1,
  Insert = 2,
}

type Patch = {
  ops: PatchOpcode[];
  args: number[];
  insertText: string;
};
```

`ops[i]` is paired with `args[i]`. `Retain` copies the next `args[i]` units from the base string. `Delete` consumes that many units without copying them. `Insert` copies the next `args[i]` units from the single concatenated `insertText` string without advancing through the base string. Lengths always use UTF-16 code units. JSON serialization needs only these three fields; there is no format-version field.

`applyPatch` must receive the same base string used when the patch was generated. It does not verify that the base matches or validate every malformed patch. For a patch produced by this library and applied to its original base, the result equals the requested target exactly.

## Complexity and Unicode boundaries

For a Myers call with `N` old elements, `M` new elements, and shortest insertion/deletion distance `D`, the algorithmic worst-case time bound is `O((N + M)D)` when run to completion. A finite capacity can end the search early and return a replacement instead. The two-level composition and its refinement rule also affect which edit path is returned.

The character level intentionally operates on JavaScript UTF-16 code units, not Unicode code points or grapheme clusters. An operation may end between the two code units of a supplementary character or inside a multi-code-point emoji. Individual patch segments need not be complete display characters; exact reconstruction is checked on the final string. Interfaces that show highlighted edits can adjust their visual boundaries separately.

This package does not provide fuzzy patch application, Markdown syntax-aware editing, or grapheme-aware diff ranges.
