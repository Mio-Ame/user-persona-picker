import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 这些断言只看 index.js 源码里的 CSS / 关键调用，不需要 Fake DOM，
// 目的是把「手机端面板实底 + 层级压盖」这两类问题钉死在默认测试套件里。
// 真正的浏览器渲染验证在 tests/paint_check.mjs（npm run test:paint）。

const indexSrc = readFileSync(new URL('../index.js', import.meta.url), 'utf8');

function block(selector) {
  // 只匹配行首选择器，避免命中 `.upp-fab-root[data-theme="…"] .upp-fab-pop {` 这类派生规则
  let idx = indexSrc.indexOf(`\n${selector}`);
  if (idx > -1) idx += 1;
  else idx = indexSrc.indexOf(selector);
  assert.ok(idx > -1, `index.js 中找不到样式块：${selector}`);
  const open = indexSrc.indexOf('{', idx);
  const close = indexSrc.indexOf('}', open);
  return indexSrc.slice(open + 1, close);
}

test('Paint invariant: 影子宿主自身必须带高层级，避免 position:fixed 层叠上下文把面板压在宿主界面之下', () => {
  const hostBlock = block(':host {');
  const zMatch = hostBlock.match(/z-index:\s*(\d+)/);
  assert.ok(zMatch, ':host 必须显式声明 z-index');
  const z = Number(zMatch[1]);
  assert.ok(z >= 90000, `:host z-index 过低（${z}），宿主带 z-index 的界面会盖住面板`);
  assert.ok(z < 999999, `:host z-index 过高（${z}），会遮挡酒馆原生 toast（999999）`);
});

test('Paint invariant: 面板/悬浮弹层必须自带不透明底色兜底，不能只靠 background: var(--bg)', () => {
  for (const selector of ['.upp-modal {', '.upp-fab-pop {']) {
    const rule = block(selector);
    assert.ok(
      /background-color:\s*#[0-9a-f]{3,8}\s*;/i.test(rule),
      `${selector} 缺少字面量实底兜底背景色`,
    );
    assert.ok(
      /background-image:\s*linear-gradient\(var\(--bg\)/i.test(rule),
      `${selector} 缺少以主题色覆盖的字面量兜底写法`,
    );
    assert.equal(
      /(^|\n)\s*background:\s*var\(--bg\)\s*;/i.test(rule),
      false,
      `${selector} 不能只用 background: var(--bg)，变量异常时会整体透明`,
    );
  }
});

test('Paint invariant: 手机全屏形态整屏铺实底，仅小窗对照形态保留透明', () => {
  const mobileIdx = indexSrc.indexOf('@media (max-width: 680px)');
  assert.ok(mobileIdx > -1, '缺少 680px 手机断点');
  const mobileBlock = indexSrc.slice(mobileIdx, indexSrc.indexOf('@media (max-width: 680px), (pointer: coarse)', mobileIdx));
  assert.match(mobileBlock, /\.upp-backdrop:not\(\.is-mini\)\s*\{[\s\S]*?background-color:\s*#[0-9a-f]{3,8}/i,
    '手机端遮罩在全屏形态下必须声明实底背景色');
  assert.match(mobileBlock, /background-image:\s*linear-gradient\(var\(--bg\)/i,
    '手机端遮罩实底必须跟随主题色');
  assert.match(mobileBlock, /\.upp-modal:not\(\.is-floating\)\s*\{[\s\S]*?height:\s*100vh;[\s\S]*?height:\s*100dvh;/i,
    '手机全屏面板必须同时给出 100vh 与 100dvh，兼容不支持动态视口单位的内核');
  assert.match(mobileBlock, /\[data-theme="glass-dark"\]\s*\{[\s\S]*?background-color:\s*#[0-9a-f]{3,8}/i,
    '深色主题下手机端遮罩需给深色实底兜底');
});

test('Paint invariant: 桌面端遮罩仍保持透明（不压黑酒馆主界面）', () => {
  const backdropRule = block('.upp-backdrop {');
  assert.match(backdropRule, /background:\s*transparent;/i, '桌面端遮罩必须保持透明');
  assert.match(backdropRule, /pointer-events:\s*none;/i, '桌面端遮罩必须可穿透');
});

test('Paint invariant: 主题应用必须写入逐元素实底并暴露自检入口', () => {
  assert.match(indexSrc, /elModal\.style\.backgroundColor\s*=\s*solidBg/, 'applyThemeAll 必须给主面板写入实底背景色');
  assert.match(indexSrc, /elFabPop\.style\.backgroundColor\s*=\s*solidFab/, 'applyThemeAll 必须给悬浮弹层写入实底背景色');
  assert.match(indexSrc, /elRestorePill\.style\.backgroundColor\s*=\s*applyThemeToElement/, '恢复条同样需要实底背景色');
  assert.match(indexSrc, /window\.__uppPaintDiag\s*=\s*collectPaintDiag/, '缺少面板实底自检入口 __uppPaintDiag');
});

test('Paint invariant: 实底守卫必须存在，且不能把解析不出的底色误判成半透明', () => {
  assert.match(indexSrc, /function guardPanelSurface\(solidBg\)/, '缺少实底守卫 guardPanelSurface');
  assert.match(indexSrc, /setProperty\('background-color',\s*solidBg,\s*'important'\)/, '实底守卫必须用 !important 强制改写');
  assert.match(indexSrc, /guardPanelSurface\(solidBg\);\s*\n\s*if \(state\.open\)/, 'applyThemeAll 必须在应用主题后立刻跑一次实底守卫');
  assert.match(indexSrc, /if \(alpha >= 0\.999\) return false;/, '实底守卫在底色已不透明时必须直接返回，避免无意义改写');
  // 解析不出颜色（如 Fake DOM 返回 undefined）必须视为已知不透明，避免测试与降级环境下误触发
  assert.match(indexSrc, /if \(!m \|\| m\[4\] === undefined\) return 1;/, 'colorAlpha 对无法解析的颜色必须返回 1');
});

test('Paint invariant: 小窗形态标记与视口变化后的主题重算必须存在', () => {
  assert.match(indexSrc, /elBackdrop\?\.classList\.toggle\('is-mini'/, 'syncModalLayoutClasses 必须同步小窗形态标记');
  assert.match(indexSrc, /function scheduleThemeRefresh\(\)/, '缺少视口变化后的主题重算');
  assert.match(indexSrc, /window\.addEventListener\('pageshow',\s*scheduleThemeRefresh/, '从后台返回时必须重算主题底色');
  assert.match(indexSrc, /visualViewport\?\.addEventListener\('resize',\s*handleViewportChange/, '软键盘/视口变化必须触发重排');
});
