# 算法说明

[English](https://github.com/wintercn/text-patch/blob/main/docs/algorithm.md) · 简体中文

`text-patch` 为两个 JavaScript 字符串生成可序列化、可精确还原目标字符串的 Patch。它比较的是文本，不解析 Markdown 语法，因此也可处理 Markdown 源码以外的字符串。

## 差异计算

本包使用 Eugene W. Myers 提出的 Myers 差异算法。允许算法完整运行时，它会在两个序列之间寻找只由插入和删除构成的最短编辑路径（[原论文 PDF](https://neil.fraser.name/writing/diff/myers.pdf)，[期刊 DOI](https://doi.org/10.1007/BF01840446)）。设置比较上限后，超限区域会回退为更粗的替换操作。

算法分为两级：

- `createLinePatch` 将每一整行视为一个元素。以 `\n` 分行，行末的换行符属于该行。判断两行相等时先比较长度和预计算哈希，再逐个核对 UTF-16 code unit，因此哈希碰撞不会影响结果正确性。
- `createCharacterPatch` 将每个 UTF-16 code unit 视为一个元素，使用 `charCodeAt` 比较。

`createPatch` 组合两级。若两侧文本都没有换行，或只在末尾有一个换行，则直接执行字符级比较；否则先找出未变化的整行。变化区域两侧各一行时，继续做字符级比较。对于更大的变化区域，先从左侧逐行尝试配对；第一次不满足相似度阈值后，转到右侧向内配对；右侧第一次失败后停止细化。剩余的中间区域保持行级删除、插入操作。

候选行对的相似度为 `2 × 保留的 UTF-16 长度 ÷（原行长度 + 新行长度）`，达到 `0.6` 才细化。相邻同类操作会合并。这种组合旨在保留大块不变文本、细化附近修改；它不承诺得到全局最短的字符级 Patch。

## 差异容量与回退

两个独立差异函数都接受可选的 `diffCapacity` 参数。`createPatch` 则分别接受 `characterDiffCapacity` 和 `lineDiffCapacity`。显式容量必须是正的有限数。

对每次 Myers 调用，设该层原序列和新序列的元素数分别为 `N`、`M`，比较上限为 `floor(diffCapacity × (N + M))`。字符级的一次比较核对一对 UTF-16 code unit；行级的一次比较核对一对行，即使核对整行内容需要扫描多个 code unit，也只计一次。因此容量限制的是元素比较次数，不是运行时间，也不等于精确差异百分比。

未指定时，行级容量为 `3000`。每次字符级调用的两侧输入都不超过 500 个 UTF-16 code unit 时不限制比较次数；否则默认容量为 `0.1 × (N + M)`。组合 API 内部发起的每次字符级调用也独立使用这套默认值。

行级调用超限时，其整个输入回退为删除、插入；字符级调用超限时，只替换该次调用的输入，其他区域仍可保留细粒度结果。回退不影响最终字符串的正确性，但可能增大 Patch。算法不读取时间；仓库性能测试中的耗时门槛只是测试断言，并非运行时截止时间。

## Patch 表示

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

`ops[i]` 与 `args[i]` 一一对应。`Retain` 从基础字符串复制接下来的 `args[i]` 个单位；`Delete` 消耗相应长度但不写入结果；`Insert` 从集中保存的 `insertText` 中依次复制相应长度，不移动基础字符串游标。所有长度都以 UTF-16 code unit 计。JSON 序列化只需这三个字段，没有格式版本字段。

应用 Patch 时，`applyPatch` 必须接收生成 Patch 时所用的基础字符串。它不核对基础字符串是否匹配，也不全面校验非法 Patch。本包生成的 Patch 应用于原基础字符串时，结果与目标字符串严格相等。

## 复杂度与 Unicode 边界

对一次 Myers 调用，若原序列有 `N` 个元素、新序列有 `M` 个元素，最短插删距离为 `D`，完整运行时的最坏时间复杂度上界为 `O((N + M)D)`。有限容量可提前结束搜索并回退为替换。双层组合及行配对规则也会影响最终编辑路径。

字符级刻意使用 JavaScript 的 UTF-16 code unit，而非 Unicode 码点或字素簇。操作边界可以落在补充平面字符的代理对中间，也可以落在多码点 emoji 内部。单个 Patch 片段不必是完整的显示字符；正确性以最终还原的完整字符串为准。展示差异的界面可单独调整可视边界。

本包不提供模糊 Patch 应用、理解 Markdown 语法的编辑或按字素簇对齐的差异范围。
