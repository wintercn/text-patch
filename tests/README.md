# text-patch tests

English · [简体中文](https://github.com/wintercn/text-patch/blob/main/tests/README.zh-CN.md)

Run `npm test` from the repository root. The suite covers reconstruction, edit-path quality, Unicode boundaries, generated cases, and timed performance cases. Test assets are kept in the repository but excluded from the npm package.

For the Myers diff algorithm mentioned below, see the [algorithm guide](../docs/algorithm.md).

## Imported test material

| Directory | Source | Adaptation and assertions |
| --- | --- | --- |
| `vscode/` | VS Code commit `dd35b1a25b6a4096e50ca2af18d9f82b41925b5a`: 58 diff fixtures, 49 input pairs from `diffComputer.test.ts`, and 3 from `defaultLinesDiffComputer.test.ts` | Line arrays were joined into text. Besides applying patches in both directions, the 58 fixtures check an independently computed shortest insertion/deletion distance for the line result. The combined patch's edit cost must not exceed that line result, and its retained length must be at least the unchanged text outside the upstream diff ranges. The 49 legacy cases check shortest character-level distance with default and unlimited capacity; the 3 remaining examples check shortest line- or character-level distance as appropriate. Exact upstream hunk positions, move detection, and cleanup rules are not this package's output contract. The upstream MIT notice is in [`vscode/LICENSE.txt`](vscode/LICENSE.txt). |
| `google/` | Google diff-match-patch commit `62f2e689f498f9c92dbc588c58750addec9b1654`, `javascript/tests/diff_match_patch_test.js` | String pairs were extracted directly; explicit diff tuples were reconstructed into source and target strings. All 170 pairs check unlimited-capacity character-level paths against an independent shortest insertion/deletion distance. Default character-level paths are checked as well, except for a scaled-down original timeout case. Combined patch cost must not exceed the line-level result. The timeout sample was scaled down 64-fold, and a fuzzy-match sample became an exact input pair. The upstream Apache-2.0 notice is in [`google/LICENSE.txt`](google/LICENSE.txt). |
| `generated/` | The package's seeded random-case generator | Each case stores source and target strings, random edit records, and an insertion/deletion-only Levenshtein dynamic-programming reference path and minimum cost. Tests check the reference path, the combined patch, and both standalone layers. Generated text includes CJK and emoji. |

## Local assertions

The package's own tests cover ordinary edits, empty strings, beginning/end edits, newline variants, and invalid capacity arguments. `applyPatch` is tested with valid `Patch` values; malformed patches have no asserted behavior. `unicode.test.mjs` covers Chinese multiline edits, single-code-point non-BMP Han characters, emoji insertion/deletion, skin-tone modifiers, ZWJ sequences, flags, variation selectors, JSON round trips, and UTF-16 lengths. `patch.test.mjs` covers edits between surrogate code units, independent capacities, and local character-level fallback. `scenarios.test.mjs` covers unterminated final lines, refinement from both ends, the similarity threshold, and many lines shrinking to one. The VS Code `subword` fixture checks preservation of the original final line and the independently computed shortest character-level cost.

Upstream hunk positions are not used as exact assertions: equally short edit paths can choose different positions, upstream heuristic segmentation is sometimes non-minimal, and final-newline line models differ. The adapted tests instead preserve upstream unchanged-text length as a quality lower bound and use independent shortest distances for the applicable layer.

## Performance cases

Timed tests exercise both levels and assert correctness as well as elapsed time. Input generation is excluded from the measured duration. The fixed-seed performance data uses no CJK or emoji.

- One million characters in one line with 1,000 scattered edits: 2 seconds.
- 5,000 mostly independent characters with explicit `characterDiffCapacity = 3000`: 2 seconds.
- Two unrelated 5,000-character single-line strings with default capacity: whole replacement within 2 seconds.
- About 3.2 million characters across many lines with 500 scattered edits: 1 second.
- About 2.6 million characters of repeated Markdown blocks with 1,000 edits: 2 seconds.
- Two unrelated 20,000-character single-line strings with default capacity: whole replacement within 5 seconds.
- Two unrelated 250-line strings with default capacity: whole replacement within 2 seconds.

The scattered-edit and explicit fine-diff cases also assert nontrivial edit structure. These limits are acceptance thresholds for the test environment, not performance guarantees for other machines.

## Generate random cases

```sh
npm run generate:tests -- --original-length=300 --edit-count=10 --edit-length=10 --cases=100 --seed=20260923
```

All five numbers are configurable. `--original-length` is the exact source length in UTF-16 code units. `--edit-length` is the center of the edit-length range; actual lengths are approximately 50%–150% of it. Generated strings mix English, single-code-point non-BMP Han characters, and multi-code-point emoji. Edit positions and lengths are chosen in UTF-16 units and may split a surrogate pair.

The saved reference path uses UTF-16 code units. Tests also compute a shortest line-level cost with whole lines as elements. For the combined algorithm, an independent reference follows the line path, refinement from both ends, and coarse replacement of the remaining middle; it does not require a globally shortest character-level result. Paired-line insertion/deletion distances come from Levenshtein dynamic programming, independently of the runtime Myers implementation. Since minimum paths need not be unique, tests compare total insertion and deletion cost, not operation arrays element by element.

The same seed produces the same cases. Each run writes a separate JSON file in `generated/`; an existing file with the same name is not overwritten. `npm test` automatically reads generated cases.
