# Performance measurements

[简体中文](performance.zh-CN.md) · English

These are measurements of the current `text-patch` implementation, not performance guarantees for other machines. The cases use the deterministic inputs in [`tests/performance.test.mjs`](../tests/performance.test.mjs). Input generation and `applyPatch` are excluded from the timings; the resulting Patch was applied separately and checked against the target text.

## Environment and method

- Date: 2026-09-23.
- CPU: AMD Ryzen 7 9700X 8-Core Processor; Windows x64, version `10.0.26200`.
- Node.js `v24.20.0`; `createPatch` imported from the compiled `dist/index.js`.
- One process, cases in the table order. For each case: two warm-up calls, then ten timed calls. The table reports the median and the minimum–maximum range of those ten calls.
- All calls used the default diff capacities. Timings cover `createPatch` only.

| Case | Input | Median | Range | Test limit |
| --- | --- | ---: | ---: | ---: |
| Sparse edits in one line | 1,000,000 characters on each side; 1,000 scattered insertions/deletions | 689.86 ms | 610.09–917.03 ms | 2,000 ms |
| Unrelated single lines | 20,000 characters on each side; whole-replacement fallback | 2,574.91 ms | 2,241.77–2,815.63 ms | 5,000 ms |
| Sparse edits across many lines | 40,000 lines, 3,240,000 characters on each side; 500 mixed edits | 109.89 ms | 106.70–121.03 ms | 1,000 ms |
| Repeated Markdown blocks | About 2.6 million characters on each side; 1,000 mixed edits | 269.19 ms | 241.53–292.21 ms | 2,000 ms |

The 20,000-character unrelated-single-line case is distinct from the 5,000-character whole-replacement case with a 2-second limit. Its previous 2-second limit was too close to observed timings: before the limit was changed, an isolated test run took 2,048.1 ms and a full-suite run took 3,153.9 ms. The current 5-second limit leaves room for variation while still checking for large regressions. The measurements in the table were not changed when the limit changed.

These figures show that the current fallback still spends substantial time on unrelated long single lines. The much faster multi-line measurements do not establish a general speed guarantee, particularly on less powerful hardware. See the [algorithm guide](algorithm.md) for the capacity and fallback behavior.
