# text-patch 测试

[English](https://github.com/wintercn/text-patch/blob/main/tests/README.md) · 简体中文

运行：在 `text-patch` 目录执行 `npm test`。

算法背景及 Myers 差异算法的含义见[算法指南](../docs/algorithm.zh-CN.md)。测试材料保留在仓库中，不随 npm 包分发。

## 迁入测试材料

| 目录 | 上游来源或用途 | 迁入方式 |
| --- | --- | --- |
| `vscode/` | VS Code `dd35b1a25b6a4096e50ca2af18d9f82b41925b5a` 的 58 个 diff fixtures、`diffComputer.test.ts` 的 49 个输入对及 `defaultLinesDiffComputer.test.ts` 的 3 个输入对 | 将行数组连接为文本；正反向应用之外，对 58 组默认行级结果验证独立的最短插删距离，要求组合 Patch 的编辑代价不高于行级结果、保留总长度不低于上游 diff 范围之外的未修改文本长度；49 个旧版输入对验证默认和无限容量字符级最短距离；3 个示例按行级或字符级验证最短距离。上游 hunk 的精确位置、移动检测和清理策略不是本包的 Myers 输出契约。上游 MIT 许可见 [`vscode/LICENSE.txt`](vscode/LICENSE.txt)。 |
| `google/` | Google diff-match-patch `62f2e689f498f9c92dbc588c58750addec9b1654` 的 `javascript/tests/diff_match_patch_test.js` | 直接提取字符串对；将显式 diff 元组还原为原文和结果文本。全部 170 组用独立插删距离验证无限容量字符级路径；除原本用于超时测试的缩小样本外，还验证默认字符级路径的最短距离；组合 Patch 的代价不高于行级结果。超时样本缩小 64 倍，模糊匹配样本改为精确输入对。上游 Apache-2.0 许可见 [`google/LICENSE.txt`](google/LICENSE.txt)。 |
| `generated/` | 本包的随机用例生成器 | 每条用例保存原文、最终结果、随机操作记录，以及仅允许插入和删除的 Levenshtein 动态规划参考路径与最短代价；测试验证参考路径、组合与独立两层 Patch。生成文本包含 CJK 和 emoji。 |

## 本包自写断言

本包自写用例另覆盖标准场景、空串/首尾/换行及非法容量参数等边界；`applyPatch` 仅测试符合 `Patch` 约定的输入，不断言非法 Patch 的行为。`unicode.test.mjs` 单独覆盖中文多行编辑、单码点非 BMP 汉字、emoji 插入删除、肤色修饰符、ZWJ 序列、旗帜及变体选择符，检查正确还原、JSON 往返和 UTF-16 长度。`patch.test.mjs` 还检查代理对中间的 code unit 差异操作、两层独立容量和单行局部回退。`scenarios.test.mjs` 检查未终止末行、两端细化、相似度阈值和多行缩为一行；`vscode/fixtures.test.mjs` 另以 `subword` 验证原末行被保留，且组合编辑代价达到独立计算的字符级最短距离。上游 hunk 位置不能直接作为本包断言：相同最短距离可以对应不同位置，上游的启发式分段有时也非最短，末尾换行的行模型亦不同；因此保留其未修改文本长度作为质量下界，并以独立最短距离验证行级路径。

## 性能用例

极端性能测试按两级 Myers 分为单行和多行，数据使用固定种子且不含 CJK/emoji；数据生成不计入 `createPatch` 耗时。场景包括 100 万字符、1000 次分散编辑的单行（2 秒），5000 字符独立文本的显式细粒度差异（`characterDiffCapacity = 3000`，2 秒），两侧各 5000 字符的完整替换（2 秒），约 320 万字符、500 次分散编辑的多行（1 秒），以及约 260 万字符、1000 次编辑的重复 Markdown 块（2 秒）。另外，两侧各 20000 字符的无关单行文本使用默认容量，断言整串替换、应用正确且计算不超过 5 秒；两侧各 250 行的无关多行文本同样断言整串替换、应用正确，门槛为 2 秒。分散编辑与显式细粒度差异场景还验证非平凡操作数量。秒数是测试环境的验收门槛，不代表其他设备的性能保证。

## 随机用例生成

```sh
npm run generate:tests -- --original-length=300 --edit-count=10 --edit-length=10 --cases=100 --seed=20260923
```

这五个数字均可调整。`--original-length` 是原文 UTF-16 code unit 的准确长度，`--edit-length` 是单次操作长度的中心值（实际长度约为该值的 50%～150%）。随机文本混合英文、单码点非 BMP 汉字和多码点 emoji；编辑位置与长度按 UTF-16 code unit 选择，可能落在代理对中间。生成器保存的参考路径按 UTF-16 code unit 计算；测试另以整行为元素计算行级最短代价，组合结果则按行级路径、两侧逐行配对及剩余中间整块替换独立计算参考代价，不要求组合结果达到全局字符级最短。配对行的插删距离由 Levenshtein 动态规划计算，与运行时 Myers 实现独立。由于最短路径可能不唯一，测试比较插入、删除总代价，不比较操作数组是否与参考路径逐项相同。相同种子产生相同用例；输出为 `generated/` 下单独的 JSON 文件，已有同名文件不会被覆盖。生成后运行 `npm test` 即会自动读取。
