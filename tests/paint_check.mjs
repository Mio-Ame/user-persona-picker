#!/usr/bin/env node
/**
 * 真机渲染实底检查（可选脚本，不进入 npm test 默认套件）
 *
 * 为什么需要它：
 *   tests/e2e_ui.test.mjs 用的是自己写的 Fake DOM，只能断言「内联字符串写没写」，
 *   证明不了浏览器真正画出来的底色，也证明不了面板有没有被宿主界面压盖。
 *   本脚本把 index.js 里真实的 STYLE_CSS 抽出来，在真实 Chromium 里用 CDP
 *   模拟 390×844 手机视口（mobile + touch）渲染面板，再读取
 *   getComputedStyle / elementsFromPoint 做断言。
 *
 * 用法：
 *   node tests/paint_check.mjs                    # 只断言
 *   node tests/paint_check.mjs --shots ./_shots   # 断言 + 输出手机/桌面截图
 *   CHROME_PATH=/path/to/chrome node tests/paint_check.mjs
 */

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INDEX_JS = path.join(ROOT, 'index.js');

const PALETTES = { paper: '#f1f1ec', ink: '#ebf0f3', warm: '#f1ece2', sakura: '#f6edf0', 'glass-dark': '#17181c' };

let failed = 0;
function fail(msg) {
  failed += 1;
  console.error(`✗ ${msg}`);
}
function pass(msg) {
  console.log(`✓ ${msg}`);
}

function readStyleCss() {
  const src = readFileSync(INDEX_JS, 'utf8');
  const startToken = 'const STYLE_CSS = `';
  const start = src.indexOf(startToken);
  if (start < 0) throw new Error('index.js 中找不到 STYLE_CSS');
  let end = src.indexOf('`;\r\n', start);
  if (end < 0) end = src.indexOf('`;\n', start);
  if (end < 0) end = src.indexOf('`;', start);
  const raw = src.slice(start + startToken.length, end);
  return raw.replace(/\$\{PANEL_BACKGROUNDS\.(?:'([a-z-]+)'|([a-z-]+))\}/g, (_m, quoted, bare) => {
    const key = quoted || bare;
    if (!PALETTES[key]) throw new Error(`未知配色键 ${key}`);
    return PALETTES[key];
  });
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find(p => existsSync(p)) || '';
}

const MARKUP = `
<div class="upp-fab-root" id="upp-fab-root">
  <button type="button" class="upp-fab" id="upp-fab-btn">CAM</button>
  <div class="upp-fab-pop" id="upp-fab-pop" hidden>
    <div class="upp-fab-pop-head"><span>快照</span><label><input type="checkbox" checked />切聊天时自动应用绑定快照</label></div>
    <div class="upp-fab-search-wrap">
      <div class="upp-input-wrap"><input type="text" id="upp-fab-search" placeholder="搜索快照" spellcheck="false" /></div>
      <select class="upp-select" id="upp-fab-group" aria-label="快照分组" title="全部分组">
        <option value="">全部分组</option>
        <option>雨天酒馆</option>
        <option>很长很长的一个分组名称示例</option>
      </select>
    </div>
    <div class="upp-fab-pop-list" id="upp-fab-pop-list">
      <div class="upp-fab-snap-row is-bound">
        <div class="upp-fab-snap-main">
          <div class="upp-fab-snap-top"><span class="upp-fab-snap-name">雨天 · 主聊天</span><span class="upp-badge ok">本聊天</span></div>
          <div class="upp-fab-snap-meta"><span>User 人设：沈倦</span><span>预设：叙事加速</span><span>世界书：雨夜酒馆</span></div>
          <div class="upp-fab-snap-note">临时笔记：雨天、旧信</div>
        </div>
        <button type="button" class="upp-fab-apply-btn">应用</button>
      </div>
      <div class="upp-fab-snap-row">
        <div class="upp-fab-snap-main">
          <div class="upp-fab-snap-top"><span class="upp-fab-snap-name">港口旧事 · 存档 2</span><span class="upp-badge">港口旧事</span></div>
        </div>
        <button type="button" class="upp-fab-apply-btn">应用</button>
      </div>
    </div>
    <div class="upp-fab-pop-foot"><button type="button" class="upp-btn primary">保存快照</button></div>
  </div>
</div>
<button type="button" class="upp-restore-pill" id="upp-restore-pill">快照管家 · 点击恢复</button>
<div class="upp-backdrop" hidden>
  <div class="upp-modal" role="dialog" aria-modal="true">
    <div class="upp-header">
      <div class="upp-title-wrap"><span class="upp-title">快照管家</span><span class="upp-ctx-chip">当前聊天</span></div>
      <div class="upp-head-actions"><select class="upp-select" id="upp-theme-select"><option>素纸</option></select>
      <button type="button" class="upp-btn">悬浮球</button></div>
    </div>
    <div class="upp-tabs"><button class="upp-tab active">快照</button><button class="upp-tab">User</button><button class="upp-tab">世界书</button><button class="upp-tab">预设</button><button class="upp-tab">正则</button></div>
    <div class="upp-toolbar"><div class="upp-tb-search upp-input-wrap"><input placeholder="搜索快照" spellcheck="false"></div>
      <button type="button" class="upp-btn primary">保存当前状态</button>
      <div class="upp-pill-strip"><button class="upp-pill active">全部 (3)</button><button class="upp-pill">主聊天</button></div></div>
    <div class="upp-body">
      <div class="upp-card"><div class="upp-entry-title-row"><strong>雨天 · 主聊天</strong><span class="upp-badge ok">当前</span></div>
        <div class="upp-muted">User 人设：沈倦 / 预设：叙事加速 / 世界书：雨夜酒馆</div>
        <div class="upp-snap-actions"><button class="upp-btn">应用</button><button class="upp-btn">查看</button><button class="upp-btn">改名</button></div></div>
    </div>
    <div class="upp-footer"><div class="upp-foot-status"><span>共 3 份快照</span></div>
      <div class="upp-foot-actions"><button class="upp-btn">备份</button><button class="upp-btn primary">应用</button></div></div>
    <div class="upp-drawer-mask" id="upp-drawer-mask" hidden><div class="upp-drawer"><div class="upp-drawer-head">编辑</div></div></div>
  </div>
</div>`;

const HARNESS_SCRIPT = `
  const shadow = document.getElementById('upp-host').shadowRoot;
  const elBackdrop = shadow.querySelector('.upp-backdrop');
  const elModal = shadow.querySelector('.upp-modal');
  const elFabPop = shadow.getElementById('upp-fab-pop');
  const elFabRoot = shadow.getElementById('upp-fab-root');
  const elRestorePill = shadow.getElementById('upp-restore-pill');

  // 与 index.js 中 applyThemeToElement 的 host 模式同逻辑
  const rs = getComputedStyle(document.documentElement);
  const blurBg = rs.getPropertyValue('--SmartThemeBlurTintColor').trim();
  const bodyColor = rs.getPropertyValue('--SmartThemeBodyColor').trim();
  function parseColor(str) {
    const s = String(str || '').trim();
    const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (hex) {
      let h = hex[1];
      if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
    const m = s.match(/^rgba?\\(\\s*([\\d.]+)\\s*[,\\s]\\s*([\\d.]+)\\s*[,\\s]\\s*([\\d.]+)(?:\\s*[,/]\\s*([\\d.]+%?))?\\s*\\)$/i);
    if (!m) return null;
    let a = 1;
    if (m[4] !== undefined) a = m[4].endsWith('%') ? +m[4].slice(0, -1) / 100 : +m[4];
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  const fg = parseColor(bodyColor);
  // 与 index.js inferThemeFromTextColor 一致：正文颜色偏暗 → 浅色主题
  const isLight = fg ? (0.299 * fg.r + 0.587 * fg.g + 0.114 * fg.b) < 140 : false;
  const dataTheme = isLight ? 'paper' : 'glass-dark';
  const baseHex = isLight ? '#f1f1ec' : '#17181c';
  const tint = parseColor(blurBg);
  const solid = (!tint || tint.a <= 0)
    ? 'rgb(23, 24, 28)'
    : (tint.a >= 0.999
      ? 'rgb(' + Math.round(tint.r) + ', ' + Math.round(tint.g) + ', ' + Math.round(tint.b) + ')'
      : (() => {
        const b = parseColor(baseHex);
        return 'rgb(' + Math.round(tint.r * tint.a + b.r * (1 - tint.a)) + ', '
          + Math.round(tint.g * tint.a + b.g * (1 - tint.a)) + ', '
          + Math.round(tint.b * tint.a + b.b * (1 - tint.a)) + ')';
      })());

  elBackdrop.dataset.theme = dataTheme;
  elFabRoot.dataset.theme = dataTheme;
  elRestorePill.dataset.theme = dataTheme;
  elBackdrop.style.setProperty('--bg', solid);
  elFabRoot.style.setProperty('--bg', solid);
  elModal.style.backgroundColor = solid;
  elFabPop.style.backgroundColor = solid;
  elRestorePill.style.backgroundColor = solid;
  elBackdrop.hidden = false;

  function alphaOf(color) {
    const p = parseColor(color);
    return p ? p.a : null;
  }
  function read(el) {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { background: cs.backgroundColor, image: cs.backgroundImage, zIndex: cs.zIndex };
  }
  const cx = Math.round(innerWidth / 2);
  const rect = elModal.getBoundingClientRect();
  const report = {
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio, coarse: matchMedia('(pointer: coarse)').matches },
    hostTint: blurBg,
    dataTheme,
    solid,
    hostZ: getComputedStyle(document.getElementById('upp-host')).zIndex,
    modal: read(elModal),
    modalAlpha: alphaOf(getComputedStyle(elModal).backgroundColor),
    backdrop: read(elBackdrop),
    backdropAlpha: alphaOf(getComputedStyle(elBackdrop).backgroundColor),
    fabPop: read(elFabPop),
    fabPopAlpha: alphaOf(getComputedStyle(elFabPop).backgroundColor),
    drawer: read(shadow.querySelector('.upp-drawer')),
    modalRect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
    topHit: document.elementsFromPoint(cx, 8).map(e => e.id || e.className || e.tagName).slice(0, 3),
    headerHit: document.elementsFromPoint(cx, 70).map(e => e.id || e.className || e.tagName).slice(0, 3),
    bodyHit: document.elementsFromPoint(cx, Math.round(innerHeight * 0.6)).map(e => e.id || e.className || e.tagName).slice(0, 3),
  };
  window.__uppPaintReport = report;
`;

function buildHarness(css) {
  const hostCss = `
  html, body { margin: 0; height: 100%; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #f3f3f3;
    background: linear-gradient(160deg, #5a3d2b 0%, #2b3a55 45%, #1d2a1f 100%); }
  :root {
    --SmartThemeBlurTintColor: rgba(12, 20, 30, 0.25);
    --SmartThemeBodyColor: rgb(238, 238, 238);
    --SmartThemeBorderColor: rgba(255, 255, 255, 0.24);
    --SmartThemeEmColor: rgb(214, 168, 122);
  }
  .chat { padding: 56px 16px 16px; font-size: 15px; line-height: 1.6; }
  .chat b { color: #ffd9a6; }
  .chat p { margin: 0 0 14px; }
  .host-bar { position: fixed; top: 0; left: 0; right: 0; height: 44px; z-index: 5;
    background: rgba(20, 20, 24, 0.5); border-bottom: 1px solid rgba(255,255,255,.18);
    display: flex; align-items: center; padding: 0 14px; font-size: 14px; }
  `;
  const chat = `<div class="host-bar" id="host-bar">酒馆顶栏（宿主 z-index: 5，用于检测层级压盖）</div>
  <div class="chat" id="chat">
    <p><b>角色</b>：窗外雨声渐密，她把杯子推到桌角，抬头看你。</p>
    <p><b>角色</b>：桌面上摊着一份没写完的信，墨迹在潮湿的空气里微微晕开。</p>
    <p><b>你</b>：顺着她的目光看向那封信，伸手把窗关小了一些。</p>
    <p><b>角色</b>：「别关。」她轻轻按住你的手背，「雨声挺好听的。」</p>
    <p><b>角色</b>：远处酒馆的门被推开，一阵风声挟着湿冷涌进来。</p>
  </div>`;

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>快照管家 实底渲染检查</title>
<style>${hostCss}</style></head>
<body>
<script>window.__uppErr = []; window.addEventListener('error', e => window.__uppErr.push(String(e.message || e.error)));</script>
${chat}
<script>
(function () {
  const host = document.createElement('div');
  host.id = 'upp-host';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<style>' + ${JSON.stringify(css)} + '</style>' + ${JSON.stringify(MARKUP)};
  document.body.appendChild(host);
})();
</script>
<script>${HARNESS_SCRIPT}</script>
</body></html>`;
}

// ============ 极简 CDP 客户端 ============

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', e => reject(new Error(`WebSocket 连接失败：${e?.message || 'unknown'}`)));
    });
    this.ws.addEventListener('message', ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message || 'CDP 错误'} (${msg.error.code})`));
        else resolve(msg.result);
        return;
      }
      if (msg.method) {
        const arr = this.listeners.get(msg.method) || [];
        arr.forEach(fn => { try { fn(msg.params, msg.sessionId); } catch (_) {} });
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 超时：${method}`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  once(method, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const arr = this.listeners.get(method) || [];
      const timer = setTimeout(() => reject(new Error(`等待事件超时：${method}`)), timeoutMs);
      const fn = params => {
        clearTimeout(timer);
        this.listeners.set(method, (this.listeners.get(method) || []).filter(x => x !== fn));
        resolve(params);
      };
      arr.push(fn);
      this.listeners.set(method, arr);
    });
  }

  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

function waitForDevtools(proc) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('Chrome 未在 15s 内就绪')), 15000);
    const onData = chunk => {
      buf += String(chunk);
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    };
    proc.stderr.on('data', onData);
    proc.stdout.on('data', onData);
    proc.on('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Chrome 提前退出（code=${code}）`));
    });
  });
}

async function shoot(cdp, sessionId, file) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`  截图：${file}`);
}

async function evaluate(cdp, sessionId, expression) {
  const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (res.exceptionDetails) throw new Error(`页面执行异常：${res.exceptionDetails.text || 'unknown'}`);
  return res.result?.value;
}

// 悬浮球弹层：层级、字号一致性、分组下拉宽度、胶囊/徽章高度、全插件字号阶梯
async function collectFabMetrics(cdp, sessionId) {
  const raw = await evaluate(cdp, sessionId, `(() => {
    const s = document.getElementById('upp-host').shadowRoot;
    const pop = s.getElementById('upp-fab-pop');
    pop.hidden = false;
    pop.style.left = '12px';
    pop.style.top = '12px';
    pop.style.width = '304px';
    pop.style.maxHeight = '352px';
    const cs = el => getComputedStyle(el);
    const px = el => Math.round(parseFloat(cs(el).fontSize) * 10) / 10;
    const search = s.getElementById('upp-fab-search');
    const group = s.getElementById('upp-fab-group');
    const pills = [...s.querySelectorAll('.upp-pill-strip .upp-pill')].map(el => Math.round(el.getBoundingClientRect().height));
    const badges = [...s.querySelectorAll('.upp-fab-snap-row .upp-badge')].map(el => Math.round(el.getBoundingClientRect().height));
    const sizes = new Set();
    const sizeSamples = {};
    s.querySelectorAll('*').forEach(el => {
      const v = px(el);
      if (!(v > 0)) return;
      sizes.add(v);
      if (!sizeSamples[v]) {
        sizeSamples[v] = (el.tagName || '').toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '');
      }
    });
    return JSON.stringify({
      fabZ: Number(cs(s.getElementById('upp-fab-btn')).zIndex),
      backdropZ: Number(cs(s.querySelector('.upp-backdrop')).zIndex),
      searchFont: px(search),
      selectFont: px(group),
      selectWidth: Math.round(group.getBoundingClientRect().width),
      themeSelectWidth: Math.round(s.getElementById('upp-theme-select').getBoundingClientRect().width),
      headerOverflow: (() => {
        const h = s.querySelector('.upp-header');
        return Math.round(h.scrollWidth - h.clientWidth);
      })(),
      pills,
      badges,
      fontSizes: [...sizes].sort((a, b) => a - b),
      sizeSamples,
    });
  })()`);
  return JSON.parse(raw || '{}');
}

function checkFabAndType(m) {
  if (!m || !m.fabZ) {
    fail('未能读取悬浮球弹层度量');
    return;
  }
  if (m.fabZ > m.backdropZ) pass(`悬浮球层级 ${m.fabZ} 高于遮罩 ${m.backdropZ}，面板展开时仍可拖动`);
  else fail(`悬浮球层级 ${m.fabZ} 不高于遮罩 ${m.backdropZ}，面板展开时会被遮住`);

  if (m.searchFont === m.selectFont) pass(`搜索框与分组下拉同字号 ${m.searchFont}px`);
  else fail(`搜索框 ${m.searchFont}px 与分组下拉 ${m.selectFont}px 字号不一致`);

  if (m.selectWidth >= 92) pass(`分组下拉宽 ${m.selectWidth}px，可完整显示「全部分组」`);
  else fail(`分组下拉仅 ${m.selectWidth}px，长分组名会被截断`);

  if (m.themeSelectWidth >= 70) pass(`顶栏主题下拉宽 ${m.themeSelectWidth}px，文字与箭头不再互撞`);
  else fail(`顶栏主题下拉仅 ${m.themeSelectWidth}px，文字会撞到右侧箭头`);

  if (m.headerOverflow <= 0) pass('顶栏无横向溢出');
  else fail(`顶栏横向溢出 ${m.headerOverflow}px`);

  const uniform = arr => Array.isArray(arr) && arr.length > 0 && new Set(arr).size === 1;
  if (uniform(m.pills)) pass(`分组胶囊高度一致 ${m.pills[0]}px`);
  else fail(`分组胶囊高度不一致：${JSON.stringify(m.pills)}`);
  if (uniform(m.badges)) pass(`行内徽章高度一致 ${m.badges[0]}px`);
  else fail(`行内徽章高度不一致：${JSON.stringify(m.badges)}`);

  const allowed = new Set([11, 12, 13, 15, 16]);
  const bad = (m.fontSizes || []).filter(v => !allowed.has(v));
  if (!bad.length) pass(`字号收敛为 ${(m.fontSizes || []).join(' / ')}px（11/12/13/15 + 手机输入框 16）`);
  else fail(`出现阶梯外字号：${bad.map(v => `${v}px(${m.sizeSamples?.[v] || '?'})`).join(', ')}`);
}

async function loadAndReport(cdp, sessionId, url) {
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url }, sessionId);
  await loaded;
  await evaluate(cdp, sessionId, '1'); // 等首帧脚本执行完
  return evaluate(cdp, sessionId, 'window.__uppPaintReport || null');
}

function checkMobile(report) {
  const { modal, backdrop, fabPop, modalAlpha, backdropAlpha, fabPopAlpha, hostZ, headerHit, modalRect, viewport } = report;
  const opaque = (name, entry, alpha) => {
    if (alpha === null) return fail(`${name}：无法解析真实计算出的底色 ${entry?.background}`);
    if (alpha >= 0.999) pass(`${name} 计算底色为实底 ${entry.background}`);
    else fail(`${name} 仍半透明：${entry.background}`);
  };
  if (report.dataTheme !== 'glass-dark' && report.dataTheme !== 'paper') fail(`宿主主题判定异常：${report.dataTheme}`);
  opaque('主面板 .upp-modal', modal, modalAlpha);
  opaque('悬浮弹层 .upp-fab-pop', fabPop, fabPopAlpha);
  opaque('手机端遮罩 .upp-backdrop', backdrop, backdropAlpha);

  const z = Number(hostZ);
  if (Number.isFinite(z) && z >= 90000 && z < 999999) pass(`面板宿主层叠 z-index=${hostZ}`);
  else fail(`面板宿主 z-index 过低（${hostZ}），宿主带 z-index 的界面会盖住面板`);

  const topmost = (headerHit || [])[0] || '';
  if (topmost === 'upp-host') pass('面板顶栏命中自身，未被宿主元素压盖');
  else fail(`面板顶栏被宿主元素压盖：${JSON.stringify(headerHit)}`);

  const coversWidth = modalRect.width >= viewport.w - 1;
  const coversHeight = modalRect.height >= viewport.h - 1;
  if (coversWidth && coversHeight) pass(`手机全屏覆盖 ${modalRect.width}×${modalRect.height}`);
  else fail(`手机端面板未覆盖整屏：${modalRect.width}×${modalRect.height} @ ${viewport.w}×${viewport.h}`);
}

function checkDesktop(report) {
  const { modal, modalAlpha, modalRect, headerHit } = report;
  if (modalAlpha === null || modalAlpha >= 0.999) pass(`桌面面板实底 ${modal.background}（${modalRect.width}×${modalRect.height}）`);
  else fail(`桌面主面板半透明：${modal.background}`);
  const topmost = (headerHit || [])[0] || '';
  if (topmost === 'upp-host') pass('桌面面板同样压住宿主顶栏');
  else fail(`桌面面板被宿主元素压盖：${JSON.stringify(headerHit)}`);
}

async function main() {
  const shotsFlag = process.argv.indexOf('--shots');
  const shotsDir = shotsFlag > -1 ? path.resolve(process.argv[shotsFlag + 1] || './_shots') : '';

  const chrome = findChrome();
  if (!chrome) {
    console.log('… 未找到 Chrome/Edge，跳过真渲染检查（可用 CHROME_PATH 指定）');
    return;
  }

  const css = readStyleCss();
  const workDir = mkdtempSync(path.join(tmpdir(), 'upp-paint-'));
  const harness = path.join(workDir, 'harness.html');
  writeFileSync(harness, buildHarness(css), 'utf8');
  const url = new URL(`file:///${harness.replace(/\\/g, '/')}`).href;

  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--remote-debugging-port=0',
    `--user-data-dir=${path.join(workDir, 'profile')}`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let cdp;
  try {
    const browserWs = await waitForDevtools(proc);
    cdp = new Cdp(browserWs);
    await cdp.ready;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
      screenWidth: 390, screenHeight: 844, screenOrientation: { angle: 0, type: 'portraitPrimary' },
    }, sessionId);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
    const mobileReport = await loadAndReport(cdp, sessionId, url);
    if (!mobileReport) {
      const dbg = await evaluate(cdp, sessionId, 'JSON.stringify({ err: window.__uppErr, host: !!document.getElementById("upp-host") })');
      fail(`手机视口未产出渲染报告：${dbg}`);
    } else {
      checkMobile(mobileReport);
      if (shotsDir) {
        mkdirSync(shotsDir, { recursive: true });
        await shoot(cdp, sessionId, path.join(shotsDir, 'paint-mobile390.png'));
      }

      // 小窗对照形态：面板本体仍是实底，遮罩恢复透明以便看后方聊天
      const miniRaw = await evaluate(cdp, sessionId, `(() => {
        const s = document.getElementById('upp-host').shadowRoot;
        const b = s.querySelector('.upp-backdrop');
        const m = s.querySelector('.upp-modal');
        b.classList.add('is-mini');
        m.classList.add('is-floating');
        const alpha = el => {
          const c = getComputedStyle(el).backgroundColor;
          const i = c.indexOf('(');
          const j = c.indexOf(')');
          if (i < 0 || j < 0) return 1;
          const parts = c.slice(i + 1, j).split(/[\\s,/]+/).filter(Boolean);
          return parts.length >= 4 ? Number(parts[3]) : 1;
        };
        return JSON.stringify({ backdrop: alpha(b), modal: alpha(m) });
      })()`);
      const mini = JSON.parse(miniRaw || '{}');
      if (mini.modal >= 0.999) pass('小窗形态下面板本体仍为实底');
      else fail(`小窗形态下面板半透明：${mini.modal}`);
      if (mini.backdrop <= 0.001) pass('小窗形态下遮罩恢复透明，可对照后方聊天');
      else fail(`小窗形态下遮罩未恢复透明：${mini.backdrop}`);

      // 复原成全屏形态，避免影响后续探针
      await evaluate(cdp, sessionId, `(() => {
        const s = document.getElementById('upp-host').shadowRoot;
        s.querySelector('.upp-backdrop').classList.remove('is-mini');
        s.querySelector('.upp-modal').classList.remove('is-floating');
        return 1;
      })()`);

      // 实底守卫机制验证：样式表用 !important 把面板改成半透明时，内联 !important 能否夺回
      const guardRaw = await evaluate(cdp, sessionId, `(() => {
        const s = document.getElementById('upp-host').shadowRoot;
        const m = s.querySelector('.upp-modal');
        const st = document.createElement('style');
        st.textContent = '.upp-modal { background-color: rgba(10, 10, 10, 0.2) !important; background-image: none !important; }';
        s.appendChild(st);
        const soft = getComputedStyle(m).backgroundColor;
        m.style.setProperty('background-color', 'rgb(20, 23, 29)', 'important');
        m.style.setProperty('background-image', 'none', 'important');
        const forced = getComputedStyle(m).backgroundColor;
        st.remove();
        m.style.removeProperty('background-color');
        m.style.removeProperty('background-image');
        return JSON.stringify({ soft, forced });
      })()`);
      const guard = JSON.parse(guardRaw || '{}');
      const alphaOfStr = c => {
        const i = String(c).indexOf('(');
        const j = String(c).indexOf(')');
        if (i < 0 || j < 0) return 1;
        const parts = String(c).slice(i + 1, j).split(/[\s,/]+/).filter(Boolean);
        return parts.length >= 4 ? Number(parts[3]) : 1;
      };
      if (alphaOfStr(guard.soft) < 0.999) pass('样式表 !important 半透明注入成功（复现被覆盖场景）');
      else fail(`无法复现被覆盖场景：${guard.soft}`);
      if (alphaOfStr(guard.forced) >= 0.999) pass('内联 !important 可夺回实底（实底守卫机制有效）');
      else fail(`实底守卫无法夺回底色：${guard.forced}`);

      // 悬浮球弹层与全插件字号
      const fabReport = await collectFabMetrics(cdp, sessionId);
      checkFabAndType(fabReport);
      if (shotsDir) await shoot(cdp, sessionId, path.join(shotsDir, 'paint-fabpop390.png'));

      // 悬浮球拖到面板左上角时，标题应被让位推开
      const clearRaw = await evaluate(cdp, sessionId, `(() => {
        const s = document.getElementById('upp-host').shadowRoot;
        const modal = s.querySelector('.upp-modal');
        const ball = s.getElementById('upp-fab-btn');
        const title = s.querySelector('.upp-title');
        const hit = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
        ball.style.left = '6px';
        ball.style.top = '6px';
        const before = hit(ball.getBoundingClientRect(), title.getBoundingClientRect());
        const br = ball.getBoundingClientRect();
        const tr = title.getBoundingClientRect();
        modal.classList.add('is-fab-clear-head-l');
        const after = hit(ball.getBoundingClientRect(), title.getBoundingClientRect());
        modal.classList.remove('is-fab-clear-head-l');
        return JSON.stringify({
          before, after,
          ball: [Math.round(br.left), Math.round(br.top), Math.round(br.width), Math.round(br.height)],
          title: [Math.round(tr.left), Math.round(tr.top), Math.round(tr.width), Math.round(tr.height)],
        });
      })()`);
      const clear = JSON.parse(clearRaw || '{}');
      if (clear.before !== true) fail(`让位探针未复现重叠（球未压在标题上）ball=${JSON.stringify(clear.ball)} title=${JSON.stringify(clear.title)}`);
      else pass('悬浮球压在标题上时确实遮挡（复现问题场景）');
      if (clear.after === false) pass('顶栏让位生效：标题被推开，不被悬浮球遮挡');
      else fail('顶栏让位无效：标题仍被悬浮球遮挡');
      if (shotsDir) {
        await evaluate(cdp, sessionId, `(() => {
          const s = document.getElementById('upp-host').shadowRoot;
          s.querySelector('.upp-modal').classList.add('is-fab-clear-head-l');
          s.getElementById('upp-fab-pop').hidden = true;
          const ball = s.getElementById('upp-fab-btn');
          ball.style.left = '6px';
          ball.style.top = '6px';
          return 1;
        })()`);
        await shoot(cdp, sessionId, path.join(shotsDir, 'paint-fabclear390.png'));
        await evaluate(cdp, sessionId, `(() => {
          const s = document.getElementById('upp-host').shadowRoot;
          s.querySelector('.upp-modal').classList.remove('is-fab-clear-head-l');
          return 1;
        })()`);
      }
    }

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
      screenWidth: 1280, screenHeight: 800,
    }, sessionId);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }, sessionId);
    const desktopReport = await loadAndReport(cdp, sessionId, url);
    if (desktopReport) {
      checkDesktop(desktopReport);
      if (shotsDir) await shoot(cdp, sessionId, path.join(shotsDir, 'paint-desktop1280.png'));
    }
  } catch (err) {
    fail(`真渲染检查失败：${err?.message || err}`);
  } finally {
    try { cdp?.close(); } catch (_) {}
    try { proc.kill(); } catch (_) {}
  }

  if (failed) {
    console.error(`\n共 ${failed} 项未通过`);
    process.exit(1);
  }
  console.log('\n真渲染检查全部通过');
}

main();
