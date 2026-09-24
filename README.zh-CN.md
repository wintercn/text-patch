# text-patch

[English](https://github.com/wintercn/text-patch/blob/main/README.md) · 简体中文

`text-patch` 将一个 JavaScript 字符串相对于另一字符串的修改表示为可序列化的 Patch。它适合保存或传输 Markdown 等文本的修改，但直接处理的是字符串，不解析 Markdown 语法。运行时不依赖第三方包。

生成差异时，包可以先比较文本行，再对变化区域细化到字符。两层都使用 Myers 差异算法（Eugene W. Myers，[原论文 PDF](https://neil.fraser.name/writing/diff/myers.pdf)，[期刊 DOI](https://doi.org/10.1007/BF01840446)）：它将文本视为序列，寻找通过插入、删除从原文变成目标文本的编辑路径。为限制计算量，超过容量时会回退为整段替换，因此结果不承诺总是全局最短。所有操作长度均以 JavaScript 字符串的 UTF-16 code unit，即 `string.length` 计数的单位为准。

## 安装与使用

```sh
npm install text-patch
```

包提供 ESM JavaScript 入口和 TypeScript 类型声明。

```ts
import { applyPatch, createPatch } from 'text-patch';

const before = '# 标题\n旧内容\n';
const after = '# 标题\n新内容\n';

const patch = createPatch(before, after);
const serialized = JSON.stringify(patch);
const restored = applyPatch(before, JSON.parse(serialized));

console.assert(restored === after);
```

应用 Patch 时应传入生成它所用的同一个基础字符串；`applyPatch` 不验证基础字符串是否匹配，也不保证非法 Patch 的行为。

## 公开 API

```ts
createPatch(before: string, after: string, options?: PatchOptions): Patch
createCharacterPatch(before: string, after: string, diffCapacity?: number): Patch
createLinePatch(before: string, after: string, diffCapacity?: number): Patch
applyPatch(before: string, patch: Patch): string
```

- `createPatch`：先按行查找未变化区域，再在合适的变化区域内做字符级细化。通常用于多行文本。
- `createCharacterPatch`：直接以 UTF-16 code unit 为元素计算差异，适用于单行或需要独立控制字符级计算的场景。
- `createLinePatch`：以完整行为元素计算差异，不做字符级细化。
- `applyPatch`：在基础字符串上按顺序执行 Patch，并返回结果字符串。

`PatchOptions` 可分别设置 `characterDiffCapacity` 和 `lineDiffCapacity`。独立 API 的第三个参数只控制该层的差异计算。容量必须是正的有限数；值越大，算法允许的元素比较越多。它是性能容量，不是精确编辑距离或差异百分比。超出容量时，相关计算区域会退化为删除加插入，因此仍能正确还原目标文本，但 Patch 可能不再是最短编辑路径。默认容量和计算方式见[算法文档](https://github.com/wintercn/text-patch/blob/main/docs/algorithm.zh-CN.md)。

## Patch 格式

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

`ops[i]` 与 `args[i]` 对应。`Retain` 和 `Delete` 的参数是基础字符串中的长度；`Insert` 的参数是从 `insertText` 当前游标依次取出的长度。所有待插入内容按操作顺序拼接在一个字符串中。Patch 可直接用 JSON 序列化，不含格式版本字段。

差异边界可能位于代理对或多码点 emoji 内部；算法不把 Unicode 码点或字素簇作为编辑单位。只要在同一个基础字符串上应用由本包生成的 Patch，最终字符串会与目标字符串一致。展示高亮等界面逻辑可单独调整可视边界。

## 开发与测试

```sh
npm install
npm run build
npm test
```

构建结果位于 `dist/`；npm 包包含构建产物、源码和文档，不包含测试材料。测试说明及迁入来源见[测试文档](https://github.com/wintercn/text-patch/blob/main/tests/README.zh-CN.md)。

代表性实测数据及对应测试门槛见[性能报告](docs/performance.zh-CN.md)。

## 许可

本包自有代码采用 [MIT 许可证](https://github.com/wintercn/text-patch/blob/main/LICENSE)。仓库中的 Google 和 VS Code 测试材料保留各自的[许可证声明](https://github.com/wintercn/text-patch/blob/main/tests/README.zh-CN.md)，不随 npm 包分发。
