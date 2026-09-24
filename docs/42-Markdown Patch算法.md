# Text Patch 算法

日期：2026-09-22。

## 技术选型结论

Text Patch 由项目自行实现，包括行级、字符级两级 Myers 差异计算，Patch 指令生成、序列化和应用。Myers 是 Eugene W. Myers 提出的序列差异算法；完整计算时，它寻找只用插入和删除操作的最短编辑路径。运行时代码不使用 `@sanity/diff-match-patch` 或原始 `diff-match-patch` 的 Patch API。

Myers 核心依据 Eugene W. Myers 的[原论文](https://doi.org/10.1007/BF01840446)独立实现。公开接口保持不变；`src/myers.ts` 从原实现的 154 行降至 116 行。现有六项性能测试全部通过；其中无关单行测试使用两侧各 2 万字符，耗时门槛为 2 秒。

该实现作为独立包 `text-patch` 维护，仓库位于 [wintercn/text-patch](https://github.com/wintercn/text-patch)。公开入口包括独立的 `createCharacterPatch`、`createLinePatch`，组合两级的 `createPatch`，以及 `applyPatch`；三种生成函数均返回相同的 `Patch` 结构。npm 包入口是编译后的 ESM JavaScript，并提供 TypeScript 类型声明；源码仍公开在仓库和 npm 包中。

排除这两个现成实现的实测依据见[diff-match-patch 实测](43-diff-match-patch实测.md)。

## 适用范围

本算法用于以 Markdown 源码字符串保存的大型属性。Markdown 源码是 Patch 的直接处理对象；生成和应用 Patch 时不将内容转换为 Markdown AST、Tiptap JSON 或 HTML。

Patch 由前端生成并执行。服务端不生成、解析或执行 Patch，只保存序列化后的 Patch 字符串，并检查 `baseVersion` 与最新全量记录之间的关系。Patch 必须相对 `baseVersion` 指向的全量记录生成，不形成 Patch 链。

## 差异计算

差异计算使用两级 Myers diff：

1. 以完整 Markdown 中的每一行为元素，对基础内容和修改后内容执行行级 Myers diff。
2. 连续未变化的行直接转换为保留操作。
3. 对行级结果中的每一段连续变化区域，分别汇总基础内容一侧被删除的文本和修改后内容一侧新增的文本。
4. 变化区域两侧各恰好一行时，继续执行字符级 Myers diff。其余变化区域先从左侧逐行尝试配对：比较两侧当前首行，字符级差异路径的相似度达到 0.6 就接受细化并将两个左边界各前进一行；左侧首次不达标后，改从右侧以相同规则逐行向内配对；右侧首次不达标就停止。相似度为 `2 × 字符级 Retain 长度 ÷ 两行 UTF-16 长度之和`。剩余中间区域保持行级删除、插入操作。整个输入两侧各只有一行时，直接执行字符级 Myers diff。
5. 将结果转换为 `retain`、`delete`、`insert` 操作，并合并相邻的同类操作。

行级比较用于跳过完整文档中未变化的大段内容；字符级比较用于避免只修改少量字符时保存整行内容。两级处理是针对长文档、小范围修改的工程组合，不改变 Myers diff 的最坏情况复杂度。

行级比较中的 `N`、`M` 分别表示基础内容和修改后内容的行数；字符级比较中的 `N`、`M` 分别表示当前变化区域两侧的 UTF-16 code unit 数量。`D` 表示将该级基础序列转换为修改后序列所需的最少插入和删除次数。Myers diff 的最坏情况时间复杂度写作 `O((N + M)D)`；将两个序列的总长度记为 `N` 时，也写作 `O(ND)`。

两层均提供独立 API：`createCharacterPatch(before, after, diffCapacity?)` 与 `createLinePatch(before, after, diffCapacity?)`。组合 API 为 `createPatch(before, after, options?)`，其中 `options` 可分别指定 `characterDiffCapacity`、`lineDiffCapacity`，互不共用。`diffCapacity` 是差异计算的容量参数，不等于精确编辑距离或差异百分比；字符级默认系数 `0.1` 被选作约 10% 差异的容量基线。值越大，允许更多元素相等性比较，越晚回退。显式容量必须为正的有限数。

未传入容量时，行级使用 `diffCapacity = 3000`；字符级对每次调用分别选默认值：两侧文本各不超过 500 个 UTF-16 code unit 时完整计算，否则取 `diffCapacity = 0.1 × (N + M)`。每次 Myers 调用分别统计实际元素相等性比较次数 `W`：行级比较一对行计一次，字符级比较一对 UTF-16 code unit 计一次。行级判等先比较行长与预计算哈希，相同时仍逐个 code unit 核对；一次行判等即使扫描整行，在 `W` 中也只计一次。比较上限为 `floor(diffCapacity × (N + M))`。字符级超限时只把本次字符级输入替换成删除、插入操作；行级超限时替换本次行级输入。算法不读取时间；测试中的秒数仅用于验收性能。

## Patch 操作

Patch 只包含以下三种操作：

- `retain`：从基础字符串的当前位置保留指定长度的内容，并向后移动相同长度。
- `delete`：从基础字符串的当前位置删除指定长度的内容，并向后移动相同长度。
- `insert`：在当前位置写入指定字符串，不移动基础字符串中的当前位置。

操作码使用 `PatchOpcode` 枚举，包含 `Retain`、`Delete`、`Insert` 三个成员。`Patch` 不使用 `PatchOperation` 元组，而是以下结构：

```ts
type Patch = {
  ops: PatchOpcode[]
  args: number[]
  insertText: string
}
```

`ops[i]` 与 `args[i]` 一一对应。三种操作的参数都在 `args` 中：`Retain`、`Delete` 的参数是基础字符串中的长度，`Insert` 的参数是从 `insertText` 中依次取用的长度。

采用两个数组和一整块插入文本也考虑 JavaScript 的分配成本：若每条操作都创建一个短数组，大量操作会产生大量短生命周期对象，增加垃圾回收压力。

字符级差异计算和三种操作的长度都使用 JavaScript 字符串的 UTF-16 code unit。字符级 Myers 通过 `charCodeAt` 比较每个 code unit，不调用 `codePointAt` 或按码点拆分文本；行级 Myers 仍以整行为元素。操作长度取对应文本的 `value.length`，应用 Patch 时通过 `slice` 按相同单位取值。差异操作可以位于代理对中间，`insertText` 可以包含孤立代理项；应用后的完整字符串必须与目标字符串一致。

`Patch` 序列化为 JSON，仅保存 `ops`、`args` 和 `insertText` 三个字段，不加格式版本号。操作码序列化为枚举值，不使用操作名称字符串。

## Patch 应用

应用 Patch 时维护基础字符串游标、插入文本游标和结果片段数组，并按 `ops` 数组的顺序读取同位置的 `args` 执行：

1. `retain` 将基础字符串中游标开始的指定长度内容加入结果，并移动游标。
2. `delete` 只移动游标。
3. `insert` 从集中保存的插入文本中取出指定长度的内容加入结果，移动插入文本游标，不移动基础字符串游标。
4. 全部操作执行后，将结果片段连接为完整 Markdown。由本包生成的 Patch 会恰好消费基础字符串和插入文本。

`applyPatch` 只接受符合 `Patch` 类型及其操作约定的输入，不在函数内校验输入。非法 Patch 的结果不作保证，可能自然抛错，也可能产生错误结果。

读取最新 Patch 记录时，以同时返回的 `baseRecord.value` 为基础执行 Patch。最新记录本身已经是 Patch 时，编辑表单先还原出当前完整内容；再次保存 Patch 时，仍从同一个最新全量 `baseRecord.value` 计算到本次编辑后的最终内容，不从上一条 Patch 继续计算。

## 全量记录

以下情况保存本次修改后的完整 Markdown，并令 `isPatch = false`、`baseVersion = null`：

- 序列化后的 Patch 不小于完整 Markdown。

行级计算超出容量时，`createPatch` 返回整串替换 Patch；字符级计算超出容量时，仅对对应的单行变化区域使用删除、插入操作。记录层仍按序列化大小决定是否保存完整 Markdown。新的全量记录成为后续 Patch 的基础。Patch 大小与完整 Markdown 大小的比较口径，在记录层实现前另行确定。

## 参考资料与测试

运行时代码以 Myers 原论文为算法依据；VS Code 和 Google 的材料用于测试输入及断言迁入。Git 来源的测试材料已从本包移除。

测试用例是这项工作的重点：对保留的来源，所有与差异算法有关的现有用例及输入样本都要收集并迁入，不只挑选代表性样本。迁入前列出来源文件和用例清单，迁入后核对清单，避免遗漏。

VS Code 的 diff fixtures 也覆盖 Myers 之外的行为。只要用例涉及差异算法，即使同时覆盖其他功能，也要纳入并处理，不能因其包含其他功能就忽略。只有完全不涉及差异算法的用例不纳入。

部分相关用例可能需要修改后才能适用于本包，例如提取算法输入，或调整与上游测试入口、结果格式绑定的断言。这些修改必须实际完成，使相关用例能够在本包运行；不能只收集或登记后跳过。迁入时记录原用例与修改后用例的对应关系及修改内容。具体修改方式逐项核对。

本包测试按来源放入 `tests/vscode/` 和 `tests/google/`，并将随机生成的用例单独放入 `tests/generated/`。来源文件、版本和断言改写方式见[测试文档](../tests/README.md)。Google diff-match-patch 虽已归档，其算法相关输入仍用于测试，不采用其运行时 Patch 实现。

自写测试覆盖标准、边界、Unicode 和极端性能场景。随机生成器默认生成 UTF-16 长度 300 的原文，执行 10 次插入或删除，单次长度以 10 为中心；原文长度、操作次数、操作长度、用例数和种子均可参数化。随机组混合英文、单码点非 BMP 汉字和多码点 emoji，编辑边界按 UTF-16 code unit 选择。Unicode 用例另覆盖代理对中间的差异操作。

极端性能组不使用 CJK 或 emoji，分别覆盖单行字符级与多行行级/字符级 Myers：100 万字符的单行分散编辑、5000 字符单行低相似度、约 320 万字符的多行分散编辑，以及约 260 万字符的重复 Markdown 块；5000 字符用例显式设置 `characterDiffCapacity = 3000` 以检验细粒度差异，另以默认容量测试 20000 字符的无关单行回退和 250 行无关多行文本的整串替换。前四组的耗时门槛分别为 2、2、1、2 秒，新增两组均为 2 秒；六组均断言结果正确，生成测试数据不计入耗时。耗时门槛是当前测试环境的验收标准，不构成对其他设备的性能保证。

## 参考资料

- Eugene W. Myers, *An O(ND) Difference Algorithm and Its Variations*（[原论文 PDF](https://neil.fraser.name/writing/diff/myers.pdf)，[期刊 DOI](https://doi.org/10.1007/BF01840446)）。
- [jsdiff](https://github.com/kpdecker/jsdiff)：基于 Myers 算法的 JavaScript 文本差异实现。
- [VS Code Myers 实现](https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/diff/defaultLinesDiffComputer/algorithms/myersDiffAlgorithm.ts)、[VS Code diff fixtures](https://github.com/microsoft/vscode/tree/main/src/vs/editor/test/node/diffing/fixtures)。
- [Google diff-match-patch 测试](https://github.com/google/diff-match-patch/blob/master/javascript/tests/diff_match_patch_test.js)。
