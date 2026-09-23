import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPatch, createCharacterPatch, createLinePatch, createPatch, PatchOpcode } from '../src/index.ts';

for (const [name, before, after] of [
  ['Chinese paragraphs with edits on multiple lines', '# 标题\n第一段：春风又绿江南岸。\n第二段：明月何时照我还。\n', '# 新标题\n第一段：春风又绿长江岸。\n第三段：山川依旧。\n'],
  ['CJK punctuation and unchanged repeated text', '你好，世界！\n你好，世界！\n结尾。', '你好，世界！\n您好，世界！\n结尾。'],
  ['emoji inserted next to Chinese at the start and end', '开始处理，结束。', '🚀开始处理，结束。🐈'],
  ['emoji removed from the middle', '甲😀乙🐈丙', '甲乙丙'],
  ['consecutive emoji replaced', '😀🐈🧩🚀', '🐉🌙🚀'],
  ['skin tone, ZWJ and variation-selector emoji', '点赞👍🏽，开发👩‍💻，爱❤️', '点赞👍🏻，开发👨‍💻，爱💙'],
  ['single-code-point non-BMP CJK replacements', '甲𠀀乙𠮷丙', '甲𠀁乙𠮶丙'],
  ['single-code-point non-BMP CJK insertions and deletions', '𠀀中文𠮷', '𠮷中文你'],
  ['multi-code-point family emoji', '家庭👨‍👩‍👧‍👦出发', '家庭👨‍👩‍👧‍👧出发'],
  ['multi-code-point emoji with skin tone and profession', '消防员👨🏽‍🚒值班', '消防员👩🏿‍🚒值班'],
  ['flag and regional-indicator emoji', '旗帜🇨🇳和🇯🇵', '旗帜🇯🇵和🇨🇳'],
  ['variation selectors and keycap emoji', '爱❤️，数字1️⃣', '爱❤，数字1⃣'],
  ['mixed Chinese and emoji across lines', '## 今日记录\n- 猫🐈在窗边\n- 天气晴朗☀️\n', '## 明日记录\n- 猫🐈在屋顶🚀\n- 天气多云☁️\n'],
]) {
  test(`Unicode: ${name}`, () => {
    const patch = createPatch(before, after);
    assert.equal(applyPatch(before, patch), after);
    assert.equal(applyPatch(after, createPatch(after, before)), before);
    assert.equal(applyPatch(before, JSON.parse(JSON.stringify(patch))), after);
    assert.equal(applyPatch(before, createCharacterPatch(before, after)), after);
    assert.equal(applyPatch(before, createLinePatch(before, after)), after);
  });
}

test('Unicode: insert length uses UTF-16 code units', () => {
  const after = '中😀🐈文';
  assert.deepEqual(createPatch('', after), {
    ops: [PatchOpcode.Insert],
    args: [after.length],
    insertText: after,
  });
  assert.equal(after.length, 6);
});
