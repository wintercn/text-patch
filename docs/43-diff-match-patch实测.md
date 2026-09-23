# diff-match-patch 实测

日期：2026-09-22。

## 测试目的

本次测试用于确认 `diff-match-patch` 在中文 Markdown 场景中的实际问题。测试只形成实测结论，不据此确定 Text Patch 的最终技术方案。

测试对象：

- `@sanity/diff-match-patch@3.2.0`；
- `diff-match-patch@1.0.5`，即原始 Google JavaScript 实现发布到 npm 的版本；
- Node.js `v24.20.0`。

每次测试都检查以下三项，不以库返回的应用状态作为唯一成功标准：

1. Patch 应用过程中是否抛错；
2. 库返回的每个应用状态是否为 `true`；
3. 应用后的完整字符串是否与目标字符串严格相等。

“直接”表示将内存中的 Patch 对象直接交给应用函数；“序列化”表示先将 Patch 转为字符串，再从字符串解析并应用。这两条路径都是包公开文档支持的调用方式。

## 测试内容

固定样本包括：

- 5,290 字节 ASCII 文本；
- 47,280 字节中文 Markdown；
- 27,780 字节、正文中重复包含 emoji 的 Markdown；
- 19,390 字节、包含组合附加符号的文本。

批量测试包括：

- 在 96 个互不相同的中文字符中选择 72 个位置逐一修改；
- 在 80 个 emoji 与 ASCII 字符交错的字符串中选择 64 个 emoji 位置逐一修改；
- 在 47 KB 中文 Markdown 的 100 个不同位置分别修改一次；
- 在 28 KB emoji Markdown 的 100 个不同位置分别修改一次；
- 对 44 KB、同时包含中文、emoji 和组合字符的 Markdown 进行 500 次差异计算，并分别从差异结果重建源字符串和目标字符串。

## Sanity 版本结果

### Patch 对象直接应用

| 场景 | 成功 | 抛错 | 返回成功但结果错误 |
| --- | ---: | ---: | ---: |
| 72 个中文修改位置 | 24 | 48 | 0 |
| 中文 Markdown 的 100 次修改 | 0 | 61 | 39 |
| 64 个 emoji 修改位置 | 26 | 38 | 0 |
| emoji Markdown 的 100 次修改 | 3 | 43 | 54 |

中文位置抛出的错误为 `Failed to determine byte offset`。

更严重的情况是，部分测试没有抛错，返回的应用状态也是 `true`，但修改被应用到了错误位置。例如目标是修改第 380 行，实际结果修改了第 156 行；另一个样本将第 380 行的修改应用到了第 300 行。

启用 `allowExceedingIndices: true` 只消除了大部分异常，没有解决坐标错误：

- 中文 Markdown 的 100 次修改中，1 次正确、99 次结果错误；
- emoji Markdown 的 100 次修改中，2 次正确、98 次结果错误。

### Patch 字符串序列化后应用

| 场景 | 成功 | 抛错 | 返回成功但结果错误 |
| --- | ---: | ---: | ---: |
| 72 个中文修改位置 | 72 | 0 | 0 |
| 中文 Markdown 的 100 次修改 | 100 | 0 | 0 |
| 64 个 emoji 修改位置 | 38 | 26 | 0 |
| emoji Markdown 的 100 次修改 | 2 | 25 | 73 |

序列化路径修正了仅含 BMP 中文字符时的直接应用问题，但没有正确处理 emoji。emoji Markdown 中再次出现了应用状态为 `true`、结果却与目标字符串不同的情况。

## Sanity 版本根因

Sanity fork 同时保存两套坐标：

- `start1`、`start2` 是 JavaScript 字符串的 UTF-16 索引；
- `utf8Start1`、`utf8Start2` 是 UTF-8 字节偏移。

直接应用 Patch 对象时，`adjustIndiciesToUcs2` 将 `patch.start1` 和 `patch.start2` 当作 UTF-8 字节偏移再次转换。中文字符通常占三个 UTF-8 字节，因此某些数值无法对应字符边界而抛错；恰好能够对应时也会得到错误位置。随后进行的模糊匹配可能在相似段落中找到另一个位置，并将错误结果报告为应用成功。

emoji 的序列化路径还有另一个问题。`countUtf8Bytes` 使用 `codePointAt(i)` 读取码点，但循环每次只将 `i` 增加一。一个代理对会先按完整码点计算 4 字节，下一轮又把低代理项计算为 3 字节，因此一个 emoji 被累计为 7 字节。错误的字节偏移写入 Patch 字符串后，解析和应用无法稳定恢复原位置。

相关源码：

- [`patch/make.ts`](https://github.com/sanity-io/diff-match-patch/blob/main/src/patch/make.ts)
- [`patch/apply.ts`](https://github.com/sanity-io/diff-match-patch/blob/main/src/patch/apply.ts)
- [`utils/utf8Indices.ts`](https://github.com/sanity-io/diff-match-patch/blob/main/src/utils/utf8Indices.ts)

## 原始版本结果

原始 `diff-match-patch@1.0.5` 没有引入上述 UTF-8 坐标转换：

- 72 个中文位置直接应用和序列化应用均为 72/72 正确；
- 中文 Markdown 的两条路径均为 100/100 正确；
- emoji Markdown 的两条路径均为 100/100 正确；
- 64 个独立 emoji 位置直接应用为 64/64 正确。

但是，64 个独立 emoji 位置中，序列化路径只有 48 次成功，另外 16 次在 `patch_toText` 中抛出 `URI malformed`。原因是 Patch 上下文可能截断 UTF-16 代理对，之后 `encodeURI` 无法序列化孤立的代理项。

因此原始版本虽然没有 Sanity fork 的 UTF-8 坐标错误，但其 Patch 字符串格式仍不能可靠覆盖任意 emoji 编辑位置。

## Diff 计算结果

对 44 KB 混合文本执行 500 次修改：

| 实现 | 正确重建源字符串 | 正确重建目标字符串 | 失败 |
| --- | ---: | ---: | ---: |
| `@sanity/diff-match-patch` 的 `makeDiff` | 500 | 500 | 0 |
| 原始版本的 `diff_main` | 500 | 500 | 0 |

本轮没有发现 Myers 差异计算本身产生错误。已复现的问题集中在 Patch 坐标、Patch 字符串序列化和 Patch 应用阶段。

## 结论

- `@sanity/diff-match-patch@3.2.0` 的 Patch API 不能直接用于本项目；`allowExceedingIndices` 不能解决问题，并可能把异常变成静默的错误结果。
- 原始 `diff-match-patch@1.0.5` 对中文的表现正常，但 Patch 字符串序列化存在位置相关的 emoji 失败，仍不能直接作为完整方案。
- 两种实现的 diff 计算在本轮样本中均正确；这不等于它们的 Patch 系统可靠。
- 应用结果必须与预期目标或目标摘要进行独立校验，不能只检查 Patch API 返回的布尔状态。

## 后续决定

本项目自行实现 Text Patch，不使用 `@sanity/diff-match-patch` 或原始 `diff-match-patch` 的 Patch API。自研算法和格式见[Text Patch 算法](42-Markdown%20Patch算法.md)。
