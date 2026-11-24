;(function () {
  'use strict';

  const APP_VERSION = '3.1.0';
  const APP_ID = 'user-persona-picker-host';
  const MENU_ENTRY_ID = 'user-persona-picker-menu-entry';
  const DISPOSE_EVENT = 'user-persona-picker-dispose';
  const BUTTON_NAME = 'User人设';
  const VAR_KEY = 'user_picker';
  const CONFIG_STORAGE_KEY = 'userPersonaPicker.config.v3';
  const KEY_SEP = '\u0000';

  const DEFAULT_OPENING_BOOK = 'User·总控入口';

  const OPENING_BODY_EJS = [
    '<%_',
    'const _getPick = function () {',
    '  let raw = null;',
    "  try { if (typeof getLocalVar === 'function') raw = getLocalVar('user_picker'); } catch (e) {}",
    '  if (raw == null) {',
    "    try { if (typeof getvar === 'function') raw = getvar('user_picker', { scope: 'local' }); } catch (e) {}",
    '  }',
    "  if (typeof raw === 'string') {",
    '    try { raw = JSON.parse(raw); } catch (e) { raw = {}; }',
    '  }',
    "  return (raw && typeof raw === 'object') ? raw : {};",
    '};',
    'const _pk = _getPick();',
    'const _list = Array.isArray(_pk.wi) ? _pk.wi : [];',
    'const _body = [], _rules = [];',
    'for (let _i = 0; _i < _list.length; _i++) {',
    '  const _it = _list[_i] || {};',
    '  if (!_it.book || !_it.title) continue;',
    "  if (_it.slot === 'depth1' || _it.title === '红线') continue;",
    '  const _c = await getwi(_it.book, _it.title);',
    '  if (!_c) continue;',
    "  if (_c.indexOf('[未找到') >= 0 || _c.indexOf('〔未找到') >= 0) continue;",
    "  if (_it.slot === 'rule' || /^(写作约束|演绎准则)/.test(_it.title)) _rules.push(_c); else _body.push(_c);",
    '}',
    '_%><% if (_body.length) { %><USER人设>',
    '以下是 {{user}} 的基础设定，只属于 {{user}}，禁止混淆 {{user}} 与 {{char}}。',
    "<%- _body.join('\n\n') %>",
    '</USER人设>',
    '<% } %><% if (_rules.length) { %><USER写作规则>',
    "<%- _rules.join('\n\n') %>",
    '</USER写作规则>',
    '<% } %>',
  ].join('\n');

  const OPENING_REDLINE_EJS = [
    '<%_',
    'const _pk2 = (function () {',
    '  let raw = null;',
    "  try { if (typeof getLocalVar === 'function') raw = getLocalVar('user_picker'); } catch (e) {}",
    '  if (raw == null) {',
    "    try { if (typeof getvar === 'function') raw = getvar('user_picker', { scope: 'local' }); } catch (e) {}",
    '  }',
    "  if (typeof raw === 'string') {",
    '    try { raw = JSON.parse(raw); } catch (e) { raw = {}; }',
    '  }',
    "  return (raw && typeof raw === 'object') ? raw : {};",
    '})();',
    'const _l2 = Array.isArray(_pk2.wi) ? _pk2.wi : [];',
    'const _d1 = [];',
    'for (let _j = 0; _j < _l2.length; _j++) {',
    '  const _it = _l2[_j] || {};',
    '  if (!_it.book || !_it.title) continue;',
    "  if (_it.slot !== 'depth1' && _it.title !== '红线') continue;",
    '  const _c = await getwi(_it.book, _it.title);',
    "  if (_c && _c.indexOf('[未找到') < 0 && _c.indexOf('〔未找到') < 0) _d1.push(_c);",
    '}',
    "_%><%- _d1.join('\n\n') %>",
  ].join('\n');

  // =========================
  // Pure State & Domain Core
  // =========================

  function itemKey(book, title) {
    return String(book || '') + KEY_SEP + String(title || '');
  }

  function parseKey(key) {
    const str = String(key || '');
    const idx = str.indexOf(KEY_SEP);
    if (idx < 0) return { book: '', title: str };
    return { book: str.slice(0, idx), title: str.slice(idx + 1) };
  }

  function normalizeName(name) {
    return String(name ?? '').normalize('NFKC').trim();
  }

  function sanitizeCharName(name) {
    const clean = normalizeName(name);
    if (!clean) return '';
    if (/^SillyTavern\s+System$/i.test(clean) || /^System$/i.test(clean)) return '';
    return clean;
  }

  function stripTrailingDigits(name) {
    return normalizeName(name).replace(/\d+$/, '').trim();
  }

  function parseBracketTitle(title) {
    const m = String(title || '').match(/^(?:【([^】]+)】|\[([^\]]+)\])(.*)$/);
    if (!m) return null;
    return { tag: (m[1] || m[2] || '').trim(), shortTitle: (m[3] || '').trim(), fullTitle: String(title) };
  }

  function matchesCharacterTag(tag, currentChar) {
    const t = normalizeName(tag);
    const c = sanitizeCharName(currentChar);
    if (!t || !c || t === '通用' || t === '模板') return false;
    if (t === c) return true;
    const tb = stripTrailingDigits(t);
    const cb = stripTrailingDigits(c);
    if (!tb || !cb) return false;
    if (tb === cb) return true;
    if (tb.length >= 2 && cb.length >= 2 && (cb.startsWith(tb) || tb.startsWith(cb))) return true;
    return false;
  }

  // Tolerant matching: works for 【角色】路线, [角色]路线, 角色-路线, 角色·路线, or any title containing character name
  function classifyIfTitle(title, currentChar) {
    const raw = String(title || '');
    const bracket = parseBracketTitle(raw);
    if (bracket) {
      if (bracket.tag === '模板') return 'template';
      if (bracket.tag === '通用') return 'common';
      if (matchesCharacterTag(bracket.tag, currentChar)) return 'current';
      return 'other_char';
    }
    const cleanChar = sanitizeCharName(currentChar);
    if (cleanChar) {
      const normTitle = normalizeName(raw);
      const charBase = stripTrailingDigits(cleanChar);
      if (normTitle.includes(cleanChar) || (charBase.length >= 2 && normTitle.includes(charBase))) {
        return 'current';
      }
    }
    if (/^通用[·\-\s_:：/]/.test(raw)) return 'common';
    return 'other';
  }

  // Detect whether a book naturally uses "前缀·名称" convention (>= 3 items sharing a · prefix)
  function detectRecommendedBookMode(entryNames) {
    const names = Array.isArray(entryNames) ? entryNames : [];
    const prefixCounts = new Map();
    let bracketCount = 0;
    for (const n of names) {
      if (parseBracketTitle(n)) bracketCount++;
      const m = String(n || '').match(/^([^·]{1,12})·(.+)$/);
      if (m) {
        const p = m[1].trim();
        prefixCounts.set(p, (prefixCounts.get(p) || 0) + 1);
      }
    }
    if (names.length >= 3 && bracketCount / names.length >= 0.5) return { mode: 'if', layout: 'chips' };
    let groupedHits = 0;
    for (const c of prefixCounts.values()) {
      if (c >= 2) groupedHits += c;
    }
    if (groupedHits >= 4) return { mode: 'prefix', layout: 'chips' };
    // Default for normal users: flat (no forced grouping!), card list for coarse books (<= 16 entries)
    return { mode: 'flat', layout: names.length > 16 ? 'chips' : 'list' };
  }

  function inferGroupFromTitle(title, bookCfg, catOverrides) {
    const bookName = bookCfg.name;
    const mapped = catOverrides?.[bookName]?.[title];
    if (mapped) return mapped;

    if (bookCfg.mode !== 'prefix') return '';

    const m = String(title || '').match(/^([^·]{1,12})·(.+)$/);
    if (m) {
      const prefix = m[1].trim();
      const catOrder = Array.isArray(bookCfg.catOrder) ? bookCfg.catOrder : [];
      if (prefix === '阶段' && catOrder.includes('关系阶段')) return '关系阶段';
      if (prefix === '发型' && catOrder.includes('外貌')) return '外貌';
      if ((prefix === '住所' || prefix === '出行' || prefix === '身世') && catOrder.includes('世界观')) return '世界观';
      return prefix;
    }
    return '常规';
  }

  function chipLabel(bookCfg, cat, title, ifSection) {
    if (bookCfg && bookCfg.mode === 'if') {
      if (ifSection === 'current' || ifSection === 'common') {
        const parsed = parseBracketTitle(title);
        if (parsed && parsed.shortTitle) return parsed.shortTitle;
      }
      return title;
    }
    if (!cat || bookCfg?.mode !== 'prefix') return title;
    if (cat === '关系阶段' && title.startsWith('阶段·')) return title.slice(3);
    if (title.startsWith(cat + '·')) {
      const stripped = title.slice(cat.length + 1).trim();
      if (stripped) return stripped;
    }
    return title;
  }

  function summarizeContent(content, maxLen) {
    const limit = maxLen || 68;
    const flat = String(content || '')
      .replace(/\r?\n+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!flat) return '';
    return flat.length > limit ? flat.slice(0, limit) + '…' : flat;
  }

  function parseRgb(colorStr) {
    const s = String(colorStr || '').trim();
    let m = s.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      const hex = m[1];
      if (hex.length === 3) {
        return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16)];
      }
      return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    }
    return null;
  }

  function inferThemeFromTextColor(colorStr, hasLightGlassTokens) {
    if (hasLightGlassTokens) return 'light';
    const rgb = parseRgb(colorStr);
    if (!rgb) return 'light';
    const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    return lum < 0.55 ? 'light' : 'dark';
  }

  function createEmptyConfig() {
    return {
      v: 3,
      openingBook: DEFAULT_OPENING_BOOK,
      defaultPresetId: '',
      books: [],
      exclusive: [],
      softSingle: [],
      catOverrides: {},
      slotOverrides: {},
      folded: {},
      presets: [],
    };
  }

  function normalizeConfig(raw) {
    const base = createEmptyConfig();
    if (!raw || typeof raw !== 'object') return base;
    if (typeof raw.openingBook === 'string' && raw.openingBook.trim()) {
      base.openingBook = raw.openingBook.trim();
    }
    if (typeof raw.defaultPresetId === 'string') base.defaultPresetId = raw.defaultPresetId;

    if (Array.isArray(raw.books)) {
      const seenBooks = new Set();
      for (const b of raw.books) {
        const name = typeof b === 'string' ? b.trim() : (typeof b?.name === 'string' ? b.name.trim() : '');
        if (!name || seenBooks.has(name)) continue;
        seenBooks.add(name);
        // Compat: legacy v3.0 'grouped' maps to 'prefix'
        const rawMode = b?.mode;
        const mode = rawMode === 'if' ? 'if' : (rawMode === 'prefix' || rawMode === 'grouped' ? 'prefix' : 'flat');
        const layout = b?.layout === 'list' ? 'list' : 'chips';
        base.books.push({
          name,
          label: typeof b?.label === 'string' && b.label.trim() ? b.label.trim() : name,
          mode,
          layout,
          preserveCatsOnReplace: Array.isArray(b?.preserveCatsOnReplace) ? b.preserveCatsOnReplace.filter(x => typeof x === 'string') : [],
          catOrder: Array.isArray(b?.catOrder) ? b.catOrder.filter(x => typeof x === 'string') : [],
        });
      }
    }

    if (Array.isArray(raw.exclusive)) {
      base.exclusive = raw.exclusive
        .filter(g => g && Array.isArray(g.items) && g.items.length >= 2)
        .map((g, i) => ({
          id: typeof g.id === 'string' && g.id ? g.id : 'ex_' + (i + 1),
          label: typeof g.label === 'string' && g.label ? g.label : '互斥组 ' + (i + 1),
          items: g.items.filter(t => typeof t === 'string' && t.trim()),
        }));
    }

    if (Array.isArray(raw.softSingle)) {
      base.softSingle = raw.softSingle
        .filter(g => g && Array.isArray(g.items) && g.items.length >= 2)
        .map((g, i) => ({
          id: typeof g.id === 'string' && g.id ? g.id : 'ss_' + (i + 1),
          label: typeof g.label === 'string' && g.label ? g.label : '提示组 ' + (i + 1),
          items: g.items.filter(t => typeof t === 'string' && t.trim()),
        }));
    }

    if (raw.catOverrides && typeof raw.catOverrides === 'object') {
      for (const [bookName, map] of Object.entries(raw.catOverrides)) {
        if (!map || typeof map !== 'object') continue;
        base.catOverrides[bookName] = {};
        for (const [title, cat] of Object.entries(map)) {
          if (typeof title === 'string' && typeof cat === 'string' && cat.trim()) {
            base.catOverrides[bookName][title] = cat.trim();
          }
        }
      }
    }

    if (raw.slotOverrides && typeof raw.slotOverrides === 'object') {
      for (const [bookName, map] of Object.entries(raw.slotOverrides)) {
        if (!map || typeof map !== 'object') continue;
        base.slotOverrides[bookName] = {};
        for (const [title, slot] of Object.entries(map)) {
          if (typeof title === 'string' && (slot === 'rule' || slot === 'depth1')) {
            base.slotOverrides[bookName][title] = slot;
          }
        }
      }
    }

    if (raw.folded && typeof raw.folded === 'object') {
      for (const [bookName, arr] of Object.entries(raw.folded)) {
        if (Array.isArray(arr)) {
          base.folded[bookName] = [...new Set(arr.filter(t => typeof t === 'string' && t))];
        }
      }
    }

    if (Array.isArray(raw.presets)) {
      const seenIds = new Set();
      for (let i = 0; i < raw.presets.length; i++) {
        const p = raw.presets[i];
        if (!p || typeof p !== 'object' || !Array.isArray(p.items)) continue;
        let id = typeof p.id === 'string' && p.id.trim() ? p.id.trim() : 'p_' + Date.now() + '_' + i;
        while (seenIds.has(id)) id += '_1';
        seenIds.add(id);
        const mode = p.mode === 'additive'
          ? 'additive'
          : (p.mode === 'replace_book' || p.mode === 'replace_daily' ? 'replace_book' : 'replace_all');
        const items = [];
        const seenIt = new Set();
        for (const it of p.items) {
          if (!it || typeof it.book !== 'string' || typeof it.title !== 'string') continue;
          const k = itemKey(it.book, it.title);
          if (seenIt.has(k)) continue;
          seenIt.add(k);
          items.push({ book: it.book, title: it.title });
        }
        base.presets.push({
          id,
          label: typeof p.label === 'string' && p.label.trim() ? p.label.trim() : '方案 ' + (i + 1),
          mode,
          targetBook: typeof p.targetBook === 'string' ? p.targetBook : '',
          items,
        });
      }
    }

    return base;
  }

  function parseSavedPicker(raw) {
    let obj = raw;
    if (typeof obj === 'string') {
      try { obj = JSON.parse(obj); } catch (_) { obj = null; }
    }
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.wi)) {
      return { hasSaved: false, wi: [], char: '' };
    }
    const seen = new Set();
    const wi = [];
    for (const item of obj.wi) {
      if (!item || typeof item !== 'object') continue;
      const book = typeof item.book === 'string' ? item.book.trim() : '';
      const title = typeof item.title === 'string' ? item.title : '';
      if (!book || !title) continue;
      const k = itemKey(book, title);
      if (seen.has(k)) continue;
      seen.add(k);
      wi.push({ book, title });
    }
    return {
      hasSaved: true,
      wi,
      char: typeof obj.char === 'string' ? obj.char : '',
    };
  }

  function buildRuntimeModel(config, liveEntriesByBook) {
    const liveSets = Object.create(null);
    const entryContentMap = Object.create(null);
    const groupsByBook = Object.create(null);
    const ifTitlesByBook = Object.create(null);
    const missingBooks = [];

    for (const bookCfg of config.books) {
      const bookName = bookCfg.name;
      const entries = liveEntriesByBook && Object.prototype.hasOwnProperty.call(liveEntriesByBook, bookName)
        ? liveEntriesByBook[bookName]
        : null;

      if (!Array.isArray(entries)) {
        liveSets[bookName] = null;
        missingBooks.push(bookName);
        groupsByBook[bookName] = [];
        ifTitlesByBook[bookName] = [];
        continue;
      }

      const names = [];
      const seen = new Set();
      entryContentMap[bookName] = Object.create(null);
      for (const e of entries) {
        const name = typeof e === 'string' ? e : (typeof e?.name === 'string' ? e.name : '');
        if (!name || seen.has(name)) continue;
        seen.add(name);
        names.push(name);
        entryContentMap[bookName][name] = typeof e?.content === 'string' ? e.content : '';
      }
      liveSets[bookName] = seen;

      if (bookCfg.mode === 'if') {
        ifTitlesByBook[bookName] = names;
        groupsByBook[bookName] = [];
      } else {
        const foldedSet = new Set(config.folded?.[bookName] || []);
        const buckets = new Map();
        for (const name of names) {
          const cat = inferGroupFromTitle(name, bookCfg, config.catOverrides);
          if (!buckets.has(cat)) buckets.set(cat, []);
          buckets.get(cat).push({
            title: name,
            tier: foldedSet.has(name) ? 'more' : 'main',
          });
        }

        // In flat mode with zero custom groups, keep one clean unheaded group ('')
        if (bookCfg.mode === 'flat' && buckets.size === 1 && buckets.has('')) {
          groupsByBook[bookName] = [{ book: bookName, cat: '', items: buckets.get('') }];
        } else {
          const orderedCats = [];
          const usedCats = new Set();
          for (const c of bookCfg.catOrder || []) {
            if (buckets.has(c) && !usedCats.has(c)) { orderedCats.push(c); usedCats.add(c); }
          }
          for (const c of buckets.keys()) {
            if (!usedCats.has(c) && c !== '' && c !== '常规' && c !== '其他') {
              orderedCats.push(c);
              usedCats.add(c);
            }
          }
          for (const tail of ['', '常规', '其他']) {
            if (buckets.has(tail) && !usedCats.has(tail)) {
              orderedCats.push(tail);
              usedCats.add(tail);
            }
          }
          groupsByBook[bookName] = orderedCats.map(cat => ({
            book: bookName,
            cat: cat || '未分组',
            items: buckets.get(cat),
          }));
        }
      }
    }

    return { liveSets, entryContentMap, groupsByBook, ifTitlesByBook, missingBooks };
  }

  function filterItemsByQuery(items, query, bookName, contentMap) {
    const q = normalizeName(query).toLocaleLowerCase();
    if (!q) return items;
    return items.filter(it => {
      if (normalizeName(it.title).toLocaleLowerCase().includes(q)) return true;
      const body = contentMap?.[bookName]?.[it.title] || '';
      return body && normalizeName(body).toLocaleLowerCase().includes(q);
    });
  }

  function buildExclusiveMap(config) {
    const map = new Map();
    for (const g of config.exclusive || []) {
      for (const t of g.items || []) map.set(t, g.items);
    }
    return map;
  }

  function addWithExclusive(targetSet, book, title, exclusiveMap) {
    const siblings = exclusiveMap.get(title);
    if (siblings) {
      for (const sib of siblings) {
        if (sib !== title) targetSet.delete(itemKey(book, sib));
      }
    }
    targetSet.add(itemKey(book, title));
  }

  function initSelection(savedState, config, liveSets) {
    const selected = new Set();
    const stale = [];
    const exMap = buildExclusiveMap(config);

    if (!savedState || !savedState.hasSaved) {
      const defPreset = (config.presets || []).find(p => p.id === config.defaultPresetId);
      if (defPreset) {
        for (const it of defPreset.items || []) {
          const liveSet = liveSets?.[it.book];
          if (!liveSet || liveSet.has(it.title)) {
            addWithExclusive(selected, it.book, it.title, exMap);
          }
        }
      }
      return { selected, stale };
    }

    for (const it of savedState.wi) {
      const liveSet = liveSets?.[it.book];
      if (liveSet && !liveSet.has(it.title)) {
        stale.push({ book: it.book, title: it.title });
      } else {
        selected.add(itemKey(it.book, it.title));
      }
    }
    return { selected, stale };
  }

  function toggleItem(selectedSet, book, title, config) {
    const exMap = buildExclusiveMap(config);
    const next = new Set(selectedSet);
    const k = itemKey(book, title);
    if (next.has(k)) {
      next.delete(k);
      return next;
    }
    addWithExclusive(next, book, title, exMap);
    return next;
  }

  function applyPreset(selectedSet, preset, config, liveSets) {
    const exMap = buildExclusiveMap(config);
    const next = new Set();

    if (preset.mode === 'additive') {
      for (const k of selectedSet) next.add(k);
    } else if (preset.mode === 'replace_book') {
      const targetBook = preset.targetBook || preset.items?.[0]?.book || '';
      const bookCfg = (config.books || []).find(b => b.name === targetBook);
      const preserveCats = new Set(bookCfg?.preserveCatsOnReplace || []);
      for (const k of selectedSet) {
        const { book, title } = parseKey(k);
        if (book !== targetBook) {
          next.add(k);
        } else if (bookCfg && preserveCats.size > 0) {
          const cat = inferGroupFromTitle(title, bookCfg, config.catOverrides);
          if (preserveCats.has(cat)) next.add(k);
        }
      }
    }

    for (const it of preset.items || []) {
      const liveSet = liveSets?.[it.book];
      if (liveSet && !liveSet.has(it.title)) continue;
      addWithExclusive(next, it.book, it.title, exMap);
    }
    return next;
  }

  function getSoftWarnKeys(selectedSet, config) {
    const warn = new Set();
    const byBook = new Map();
    for (const k of selectedSet) {
      const { book, title } = parseKey(k);
      if (!byBook.has(book)) byBook.set(book, new Set());
      byBook.get(book).add(title);
    }
    for (const [book, titleSet] of byBook.entries()) {
      for (const g of config.softSingle || []) {
        const hits = [];
        for (const t of g.items || []) {
          if (titleSet.has(t)) hits.push(itemKey(book, t));
        }
        if (hits.length >= 2) {
          for (const k of hits) warn.add(k);
        }
      }
    }
    return warn;
  }

  function resolveEntrySlot(book, title, config) {
    const custom = config?.slotOverrides?.[book]?.[title];
    if (custom === 'depth1' || custom === 'rule') return custom;
    return '';
  }

  function serializeSelection(selectedSet, charName, config, model) {
    const ordered = [];
    const emitted = new Set();

    function emitIfSelected(book, title) {
      const k = itemKey(book, title);
      if (!selectedSet.has(k) || emitted.has(k)) return;
      emitted.add(k);
      const slot = resolveEntrySlot(book, title, config);
      ordered.push(slot ? { book, title, slot } : { book, title });
    }

    for (const bookCfg of config.books || []) {
      if (bookCfg.mode === 'if') {
        for (const title of model?.ifTitlesByBook?.[bookCfg.name] || []) {
          emitIfSelected(bookCfg.name, title);
        }
      } else {
        for (const g of model?.groupsByBook?.[bookCfg.name] || []) {
          for (const it of g.items || []) emitIfSelected(bookCfg.name, it.title);
        }
      }
    }

    for (const k of selectedSet) {
      if (emitted.has(k)) continue;
      const { book, title } = parseKey(k);
      if (book && title) {
        emitted.add(k);
        const slot = resolveEntrySlot(book, title, config);
        ordered.push(slot ? { book, title, slot } : { book, title });
      }
    }

    return {
      v: 1,
      char: sanitizeCharName(charName),
      wi: ordered,
    };
  }

  function buildPreviewText(selectedSet, charName, config, model) {
    const payload = serializeSelection(selectedSet, charName, config, model);
    const body = [];
    const rules = [];
    const depth1 = [];
    for (const it of payload.wi) {
      const text = model?.entryContentMap?.[it.book]?.[it.title] || '';
      if (!text.trim()) continue;
      if (it.slot === 'depth1' || it.title === '红线') {
        depth1.push(text);
      } else if (it.slot === 'rule' || /^(写作约束|演绎准则)/.test(it.title)) {
        rules.push(text);
      } else {
        body.push(text);
      }
    }
    const sections = [];
    if (body.length) sections.push('<USER人设>\n' + body.join('\n\n') + '\n</USER人设>');
    if (rules.length) sections.push('<USER写作规则>\n' + rules.join('\n\n') + '\n</USER写作规则>');
    if (depth1.length) sections.push('【深度 1 · 强提醒】\n' + depth1.join('\n\n'));
    const combined = sections.join('\n\n');
    return { text: combined, chars: combined.length, count: payload.wi.length };
  }

  function buildWorldbookEntry(name, content) {
    return {
      name,
      enabled: true,
      content,
      strategy: {
        type: 'selective',
        keys: [],
        keys_secondary: { logic: 'and_any', keys: [] },
        scan_depth: 'same_as_global',
      },
      position: {
        type: 'after_character_definition',
        role: 'system',
        depth: 4,
        order: 100,
      },
      probability: 100,
      recursion: {
        prevent_incoming: true,
        prevent_outgoing: true,
        delay_until: null,
      },
      effect: {
        sticky: null,
        cooldown: null,
        delay: null,
      },
    };
  }

  function formatNewIfEntry(charName, shortName, relationText, secretText, existingNames) {
    const rawShort = String(shortName ?? '').trim();
    const rawRel = String(relationText ?? '').trim();
    const rawSec = String(secretText ?? '').trim();

    if (!rawShort) return { ok: false, error: '请填写路线名称' };
    if (!rawRel) return { ok: false, error: '请填写身份与关系/前提' };

    const prefixTag = sanitizeCharName(charName) || '通用';
    const cleanShort = rawShort.replace(/^(?:【[^】]+】|\[[^\]]+\])\s*/, '').trim();
    if (!cleanShort) return { ok: false, error: '请填写路线名称' };

    const fullTitle = '【' + prefixTag + '】' + cleanShort;
    if (existingNames && existingNames.has(fullTitle)) {
      return { ok: false, error: '同名路线已存在' };
    }

    const toLines = txt => txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const relLines = toLines(rawRel);
    const secLines = toLines(rawSec);

    const lines = [fullTitle + ':'];
    if (relLines.length === 1) lines.push('  身份与关系: ' + relLines[0]);
    else {
      lines.push('  身份与关系:');
      for (const line of relLines) lines.push('    ' + line);
    }
    if (secLines.length === 1) lines.push('  秘密与补充: ' + secLines[0]);
    else if (secLines.length > 1) {
      lines.push('  秘密与补充:');
      for (const line of secLines) lines.push('    ' + line);
    }

    return { ok: true, fullTitle, entry: buildWorldbookEntry(fullTitle, lines.join('\n')) };
  }

  function formatNewGenericEntry(titleText, contentText, existingNames) {
    const title = String(titleText ?? '').trim();
    const content = String(contentText ?? '').trim();
    if (!title) return { ok: false, error: '请填写条目标题' };
    if (!content) return { ok: false, error: '请填写条目正文' };
    if (existingNames && existingNames.has(title)) return { ok: false, error: '同名条目已存在' };
    return { ok: true, fullTitle: title, entry: buildWorldbookEntry(title, content) };
  }

  function partitionIfTitles(ifTitles, currentChar, selectedSet, ifBookName, showAllChars) {
    const current = [];
    const common = [];
    const selectedOther = [];
    const otherChars = [];
    const unprefixed = [];

    for (const title of ifTitles || []) {
      const kind = classifyIfTitle(title, currentChar);
      const isSelected = selectedSet.has(itemKey(ifBookName, title));
      if (kind === 'template') {
        if (isSelected) selectedOther.push(title);
        continue;
      }
      if (kind === 'current') current.push(title);
      else if (kind === 'common') common.push(title);
      else if (kind === 'other') unprefixed.push(title);
      else {
        if (isSelected) selectedOther.push(title);
        if (showAllChars) otherChars.push(title);
      }
    }
    return { current, common, selectedOther, otherChars, unprefixed };
  }

  function buildOpeningWorldbookEntries() {
    return [
      {
        uid: 0,
        name: '【常开】User人设总控',
        enabled: true,
        content: OPENING_BODY_EJS,
        strategy: {
          type: 'constant',
          keys: [],
          keys_secondary: { logic: 'and_any', keys: [] },
          scan_depth: 'same_as_global',
        },
        position: {
          type: 'after_character_definition',
          role: 'system',
          depth: 4,
          order: 0,
        },
        probability: 100,
        recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
        effect: { sticky: null, cooldown: null, delay: null },
      },
      {
        uid: 1,
        name: '【常开】User红线',
        enabled: true,
        content: OPENING_REDLINE_EJS,
        strategy: {
          type: 'constant',
          keys: [],
          keys_secondary: { logic: 'and_any', keys: [] },
          scan_depth: 'same_as_global',
        },
        position: {
          type: 'at_depth',
          role: 'system',
          depth: 1,
          order: 1,
        },
        probability: 100,
        recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
        effect: { sticky: null, cooldown: null, delay: null },
      },
    ];
  }

  function renameReferenceInConfig(config, bookName, oldTitle, newTitle) {
    if (!oldTitle || !newTitle || oldTitle === newTitle) return;
    if (config.catOverrides?.[bookName]?.[oldTitle]) {
      config.catOverrides[bookName][newTitle] = config.catOverrides[bookName][oldTitle];
      delete config.catOverrides[bookName][oldTitle];
    }
    if (config.slotOverrides?.[bookName]?.[oldTitle]) {
      config.slotOverrides[bookName][newTitle] = config.slotOverrides[bookName][oldTitle];
      delete config.slotOverrides[bookName][oldTitle];
    }
    if (Array.isArray(config.folded?.[bookName])) {
      config.folded[bookName] = config.folded[bookName].map(t => (t === oldTitle ? newTitle : t));
    }
    for (const p of config.presets || []) {
      for (const it of p.items || []) {
        if (it.book === bookName && it.title === oldTitle) it.title = newTitle;
      }
    }
    for (const g of [...(config.exclusive || []), ...(config.softSingle || [])]) {
      g.items = (g.items || []).map(t => (t === oldTitle ? newTitle : t));
    }
  }

  const Core = {
    APP_VERSION,
    itemKey,
    parseKey,
    normalizeName,
    sanitizeCharName,
    stripTrailingDigits,
    parseBracketTitle,
    matchesCharacterTag,
    classifyIfTitle,
    detectRecommendedBookMode,
    inferGroupFromTitle,
    chipLabel,
    summarizeContent,
    parseRgb,
    inferThemeFromTextColor,
    createEmptyConfig,
    normalizeConfig,
    parseSavedPicker,
    buildRuntimeModel,
    filterItemsByQuery,
    initSelection,
    toggleItem,
    applyPreset,
    getSoftWarnKeys,
    resolveEntrySlot,
    serializeSelection,
    buildPreviewText,
    buildWorldbookEntry,
    formatNewIfEntry,
    formatNewGenericEntry,
    partitionIfTitles,
    buildOpeningWorldbookEntries,
    renameReferenceInConfig,
  };

  if (typeof globalThis.__UPP_EXPORT__ === 'function') {
    globalThis.__UPP_EXPORT__(Core);
    return;
  }

  // =========================
  // Host Runtime Wiring
  // =========================

  const Env = (function () {
    let pwin = window;
    let pdoc = document;
    try {
      if (window.parent && window.parent.document) {
        pwin = window.parent;
        pdoc = pwin.document;
      }
    } catch (_) {}
    return { win: window, pwin, pdoc };
  })();

  function getApi(name) {
    const owners = [
      window,
      globalThis,
      Env.pwin,
      window.TavernHelper,
      Env.pwin.TavernHelper,
      window.SillyTavern,
      Env.pwin.SillyTavern,
    ];
    for (const owner of owners) {
      try {
        if (owner && owner[name] != null) return { value: owner[name], owner };
      } catch (_) {}
    }
    return null;
  }

  function getFn(name) {
    const api = getApi(name);
    if (api && typeof api.value === 'function') return api.value.bind(api.owner);
    return null;
  }

  function getStContext() {
    try {
      return getApi('SillyTavern')?.value?.getContext?.() || null;
    } catch (_) {
      return null;
    }
  }

  function notify(msg, type) {
    const t = Env.pwin.toastr || window.toastr;
    const level = type || 'info';
    if (t && typeof t[level] === 'function') {
      try { t[level](msg); return; } catch (_) {}
    }
    console.log('[User人设点选]', msg);
  }

  function loadStoredConfig() {
    try {
      const raw = Env.pwin.localStorage?.getItem(CONFIG_STORAGE_KEY);
      if (raw) return normalizeConfig(JSON.parse(raw));
    } catch (_) {}
    return createEmptyConfig();
  }

  function saveStoredConfig(cfg) {
    try {
      Env.pwin.localStorage?.setItem(CONFIG_STORAGE_KEY, JSON.stringify(cfg));
    } catch (_) {}
  }

  function detectHostTheme() {
    try {
      const rootStyle = Env.pwin.getComputedStyle(Env.pdoc.documentElement);
      const hasIgLight = Boolean(rootStyle.getPropertyValue('--ig-panel-bg').trim());
      const bodyColor = Env.pwin.getComputedStyle(Env.pdoc.body || Env.pdoc.documentElement).color;
      const smartColor = rootStyle.getPropertyValue('--SmartThemeBodyColor').trim();
      return inferThemeFromTextColor(bodyColor || smartColor, hasIgLight);
    } catch (_) {
      return 'light';
    }
  }

  function readCurrentCharName() {
    const ctx = getStContext();
    if (ctx && (ctx.characterId === undefined || ctx.characterId === null) && !ctx.groupId) {
      return '';
    }
    const fn = getFn('getCurrentCharacterName');
    if (fn) {
      try {
        const name = sanitizeCharName(fn());
        if (name) return name;
      } catch (_) {}
    }
    if (ctx && ctx.characterId !== undefined && ctx.characterId !== null && typeof ctx.name2 === 'string') {
      return sanitizeCharName(ctx.name2);
    }
    return '';
  }

  function readCurrentPersona() {
    const fn = getFn('getPersona');
    if (fn) {
      try {
        const p = fn('current');
        if (p && typeof p.description === 'string') return p;
      } catch (_) {}
    }
    return null;
  }

  function hasActiveChat() {
    const ctx = getStContext();
    if (!ctx) return true;
    return Boolean(ctx.chatId || ctx.groupId || (ctx.characterId !== undefined && ctx.characterId !== null));
  }

  function readChatPickerVar() {
    const fn = getFn('getVariables');
    if (fn) {
      try {
        const vars = fn({ type: 'chat' });
        if (vars && typeof vars === 'object') return vars[VAR_KEY];
      } catch (_) {}
    }
    const ctx = getStContext();
    return ctx?.chatMetadata?.variables?.[VAR_KEY];
  }

  async function writeChatPickerVar(payload) {
    const insertFn = getFn('insertOrAssignVariables');
    if (insertFn) {
      await Promise.resolve(insertFn({ [VAR_KEY]: payload }, { type: 'chat' }));
      return;
    }
    const updateFn = getFn('updateVariablesWith');
    if (updateFn) {
      await Promise.resolve(updateFn(vars => {
        const next = (vars && typeof vars === 'object') ? { ...vars } : {};
        next[VAR_KEY] = payload;
        return next;
      }, { type: 'chat' }));
      return;
    }
    throw new Error('未找到聊天变量写入接口');
  }

  async function listHostWorldbooks() {
    const namesFn = getFn('getWorldbookNames');
    if (!namesFn) return [];
    try {
      const names = await Promise.resolve(namesFn());
      return Array.isArray(names) ? names.filter(n => typeof n === 'string' && n) : [];
    } catch (_) {
      return [];
    }
  }

  async function listGlobalWorldbooks() {
    const fn = getFn('getGlobalWorldbookNames');
    if (!fn) return [];
    try {
      const names = await Promise.resolve(fn());
      return Array.isArray(names) ? names.filter(n => typeof n === 'string' && n) : [];
    } catch (_) {
      return [];
    }
  }

  async function loadSingleWorldbook(bookName) {
    const getWbFn = getFn('getWorldbook');
    if (!getWbFn) return null;
    try {
      const entries = await Promise.resolve(getWbFn(bookName));
      return Array.isArray(entries) ? entries : null;
    } catch (_) {
      return null;
    }
  }

  async function loadBoundWorldbooks(config, allHostNames) {
    const result = Object.create(null);
    const hostSet = allHostNames.length > 0 ? new Set(allHostNames) : null;
    await Promise.all(config.books.map(async b => {
      if (hostSet && !hostSet.has(b.name)) {
        result[b.name] = null;
        return;
      }
      result[b.name] = await loadSingleWorldbook(b.name);
    }));
    return result;
  }

  async function createEntryInBook(bookName, entry) {
    const fn = getFn('createWorldbookEntries');
    if (!fn) throw new Error('未找到世界书写入接口');
    return await Promise.resolve(fn(bookName, [entry], { render: 'debounced' }));
  }

  async function updateEntryInBook(bookName, oldTitle, newTitle, newContent) {
    const fn = getFn('updateWorldbookWith');
    if (!fn) throw new Error('未找到世界书更新接口');
    return await Promise.resolve(fn(bookName, entries => {
      return entries.map(e => (e && e.name === oldTitle ? { ...e, name: newTitle, content: newContent } : e));
    }, { render: 'debounced' }));
  }

  async function ensureOpeningWorldbook(bookName) {
    const createWbFn = getFn('createWorldbook');
    const rebindFn = getFn('rebindGlobalWorldbooks');
    if (!createWbFn || !rebindFn) throw new Error('当前酒馆助手版本缺少世界书管理接口');

    const allNames = await listHostWorldbooks();
    if (!allNames.includes(bookName)) {
      await Promise.resolve(createWbFn(bookName, buildOpeningWorldbookEntries()));
    }
    const globals = await listGlobalWorldbooks();
    if (!globals.includes(bookName)) {
      await Promise.resolve(rebindFn([...globals, bookName]));
    }
  }

  async function createStarterWorldbook(importPersona) {
    const createWbFn = getFn('createWorldbook');
    if (!createWbFn) throw new Error('缺少创建世界书接口');
    const allNames = await listHostWorldbooks();
    let bookName = '我的人设库';
    let idx = 2;
    while (allNames.includes(bookName)) {
      bookName = '我的人设库' + idx;
      idx++;
    }
    const entries = [];
    if (importPersona) {
      const p = readCurrentPersona();
      const desc = String(p?.description || '').trim();
      const title = String(p?.name || '').trim() || '基础人设';
      entries.push({ ...buildWorldbookEntry(title, desc || '在这里填写你的基础设定。'), uid: 0 });
    } else {
      entries.push({ ...buildWorldbookEntry('基础人设', '在这里填写你的姓名、外貌、性格等基础设定。'), uid: 0 });
    }
    await Promise.resolve(createWbFn(bookName, entries));
    return bookName;
  }

  // =========================
  // Cleanup Previous Instance
  // =========================

  const prevHost = Env.pdoc.getElementById(APP_ID);
  if (prevHost) {
    try { prevHost.dispatchEvent(new Env.pwin.Event(DISPOSE_EVENT)); } catch (_) {}
    if (prevHost.isConnected) prevHost.remove();
  }
  Env.pdoc.querySelectorAll('#' + MENU_ENTRY_ID).forEach(el => el.remove());

  let dead = false;
  const cleanup = [];
  const timers = new Set();

  function later(fn, ms) {
    const id = Env.pwin.setTimeout(() => {
      timers.delete(id);
      if (!dead) fn();
    }, ms);
    timers.add(id);
    return id;
  }

  function listen(target, eventName, handler, options) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(eventName, handler, options);
    cleanup.push(() => {
      try { target.removeEventListener(eventName, handler, options); } catch (_) {}
    });
  }

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));

  // =========================
  // UI Host & Adaptive Glass Styles
  // =========================

  const host = Env.pdoc.createElement('div');
  host.id = APP_ID;
  host.dataset.version = APP_VERSION;
  const shadow = host.attachShadow({ mode: 'open' });

  const STYLE = `
    :host {
      all: initial;
      font-family: "PingFang SC", "PingFang TC", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Microsoft YaHei", system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
      --upp-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

    .upp-backdrop[data-theme="light"] {
      --upp-veil: rgba(18, 24, 38, 0.26);
      --upp-shell-bg: linear-gradient(165deg, rgba(255, 255, 255, 0.90) 0%, rgba(243, 246, 252, 0.86) 100%);
      --upp-shell-border: rgba(255, 255, 255, 0.86);
      --upp-shell-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.96),
        inset 0 0 0 0.5px rgba(255, 255, 255, 0.55),
        0 24px 64px rgba(15, 23, 42, 0.18),
        0 4px 16px rgba(15, 23, 42, 0.06);
      --upp-divider: rgba(27, 30, 40, 0.07);
      --upp-card-bg: rgba(255, 255, 255, 0.64);
      --upp-card-border: rgba(255, 255, 255, 0.84);
      --upp-card-shadow: 0 2px 10px rgba(15, 23, 42, 0.03), inset 0 1px 0 rgba(255, 255, 255, 0.88);
      --upp-tx: #1b1e28;
      --upp-tx2: rgba(27, 30, 40, 0.60);
      --upp-tx3: rgba(27, 30, 40, 0.44);
      --upp-track-bg: rgba(27, 30, 40, 0.055);
      --upp-seg-active-bg: #ffffff;
      --upp-seg-active-shadow: 0 2px 8px rgba(15, 23, 42, 0.09), 0 0.5px 1px rgba(15, 23, 42, 0.05);
      --upp-chip-bg: rgba(255, 255, 255, 0.84);
      --upp-chip-hover: #ffffff;
      --upp-chip-border: rgba(27, 30, 40, 0.09);
      --upp-chip-tx: #262b38;
      --upp-accent: #3a7bd5;
      --upp-accent-bg: rgba(58, 123, 213, 0.13);
      --upp-accent-border: rgba(58, 123, 213, 0.44);
      --upp-accent-tx: #1b52a4;
      --upp-badge-bg: rgba(58, 123, 213, 0.12);
      --upp-badge-tx: #245db3;
      --upp-btn-bg: rgba(27, 30, 40, 0.055);
      --upp-btn-hover: rgba(27, 30, 40, 0.10);
      --upp-btn-border: rgba(27, 30, 40, 0.07);
      --upp-btn-tx: #2c3140;
      --upp-primary-bg: linear-gradient(180deg, #4b8ae2 0%, #3472cb 100%);
      --upp-primary-hover: linear-gradient(180deg, #5793e8 0%, #3d7bd4 100%);
      --upp-primary-shadow: 0 4px 14px rgba(58, 123, 213, 0.30), inset 0 1px 0 rgba(255, 255, 255, 0.30);
      --upp-foot-bg: rgba(255, 255, 255, 0.58);
      --upp-input-bg: rgba(255, 255, 255, 0.88);
      --upp-input-border: rgba(27, 30, 40, 0.13);
      --upp-warn-bg: rgba(217, 130, 43, 0.11);
      --upp-warn-border: rgba(217, 130, 43, 0.55);
      --upp-warn-tx: #94510c;
      --upp-warn-dot: #d9822b;
      --upp-danger-bg: rgba(220, 68, 68, 0.09);
      --upp-danger-border: rgba(220, 68, 68, 0.34);
      --upp-danger-tx: #b52b2b;
      --upp-ok-bg: rgba(46, 158, 99, 0.11);
      --upp-ok-border: rgba(46, 158, 99, 0.34);
      --upp-ok-tx: #1f7a49;
      --upp-scroll: rgba(27, 30, 40, 0.16);
      --upp-scroll-hover: rgba(27, 30, 40, 0.28);
      --upp-handle: rgba(27, 30, 40, 0.16);
    }

    .upp-backdrop[data-theme="dark"] {
      --upp-veil: rgba(6, 8, 14, 0.62);
      --upp-shell-bg: linear-gradient(165deg, rgba(28, 31, 41, 0.91) 0%, rgba(20, 22, 30, 0.93) 100%);
      --upp-shell-border: rgba(255, 255, 255, 0.13);
      --upp-shell-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.12),
        0 24px 64px rgba(0, 0, 0, 0.52);
      --upp-divider: rgba(255, 255, 255, 0.08);
      --upp-card-bg: rgba(255, 255, 255, 0.045);
      --upp-card-border: rgba(255, 255, 255, 0.08);
      --upp-card-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
      --upp-tx: #eff2f8;
      --upp-tx2: rgba(239, 242, 248, 0.62);
      --upp-tx3: rgba(239, 242, 248, 0.44);
      --upp-track-bg: rgba(255, 255, 255, 0.06);
      --upp-seg-active-bg: rgba(255, 255, 255, 0.13);
      --upp-seg-active-shadow: 0 2px 8px rgba(0, 0, 0, 0.26), inset 0 1px 0 rgba(255, 255, 255, 0.14);
      --upp-chip-bg: rgba(255, 255, 255, 0.055);
      --upp-chip-hover: rgba(255, 255, 255, 0.10);
      --upp-chip-border: rgba(255, 255, 255, 0.10);
      --upp-chip-tx: #e3e7f0;
      --upp-accent: #6ea2f8;
      --upp-accent-bg: rgba(110, 162, 248, 0.18);
      --upp-accent-border: rgba(124, 174, 255, 0.56);
      --upp-accent-tx: #eaf2ff;
      --upp-badge-bg: rgba(110, 162, 248, 0.18);
      --upp-badge-tx: #b8d3ff;
      --upp-btn-bg: rgba(255, 255, 255, 0.07);
      --upp-btn-hover: rgba(255, 255, 255, 0.13);
      --upp-btn-border: rgba(255, 255, 255, 0.10);
      --upp-btn-tx: #e5e9f2;
      --upp-primary-bg: linear-gradient(180deg, #5691eb 0%, #3d79d6 100%);
      --upp-primary-hover: linear-gradient(180deg, #649cf0 0%, #4984df 100%);
      --upp-primary-shadow: 0 4px 16px rgba(61, 121, 214, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.22);
      --upp-foot-bg: rgba(255, 255, 255, 0.03);
      --upp-input-bg: rgba(0, 0, 0, 0.28);
      --upp-input-border: rgba(255, 255, 255, 0.12);
      --upp-warn-bg: rgba(234, 169, 79, 0.15);
      --upp-warn-border: rgba(234, 169, 79, 0.65);
      --upp-warn-tx: #f6d19a;
      --upp-warn-dot: #eaa94f;
      --upp-danger-bg: rgba(238, 102, 102, 0.14);
      --upp-danger-border: rgba(238, 102, 102, 0.45);
      --upp-danger-tx: #fbb8b8;
      --upp-ok-bg: rgba(84, 198, 134, 0.14);
      --upp-ok-border: rgba(84, 198, 134, 0.40);
      --upp-ok-tx: #9be7bc;
      --upp-scroll: rgba(255, 255, 255, 0.16);
      --upp-scroll-hover: rgba(255, 255, 255, 0.28);
      --upp-handle: rgba(255, 255, 255, 0.22);
    }

    @keyframes upp-fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes upp-pop-in { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
    @keyframes upp-sheet-up { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: translateY(0); } }

    .upp-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483000;
      background: var(--upp-veil);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
      color: var(--upp-tx);
      animation: upp-fade-in 0.18s var(--upp-ease);
    }
    .upp-backdrop[hidden] { display: none; }

    .upp-modal {
      width: 100%;
      max-width: 580px;
      max-height: 85dvh;
      background: var(--upp-shell-bg);
      backdrop-filter: blur(28px) saturate(185%);
      -webkit-backdrop-filter: blur(28px) saturate(185%);
      color: var(--upp-tx);
      border: 1px solid var(--upp-shell-border);
      border-radius: 22px;
      box-shadow: var(--upp-shell-shadow);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: upp-pop-in 0.22s var(--upp-ease);
    }

    .upp-grab {
      display: none;
      width: 36px;
      height: 4px;
      border-radius: 999px;
      background: var(--upp-handle);
      margin: 8px auto 0;
      flex-shrink: 0;
    }

    .upp-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 14px 16px 10px;
      flex-shrink: 0;
    }
    .upp-head-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .upp-head-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .upp-title { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; color: var(--upp-tx); white-space: nowrap; }
    .upp-char-tag {
      font-size: 12px; font-weight: 500; line-height: 1; padding: 5px 10px; border-radius: 999px;
      background: var(--upp-badge-bg); color: var(--upp-badge-tx);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px;
    }
    .upp-char-tag[hidden] { display: none; }

    .upp-icon-btn {
      width: 30px; height: 30px; border-radius: 999px;
      border: 1px solid var(--upp-btn-border); background: var(--upp-btn-bg); color: var(--upp-tx2);
      font-size: 15px; line-height: 1; display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; flex-shrink: 0;
      transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease, transform 0.12s ease;
    }
    .upp-icon-btn:hover { background: var(--upp-btn-hover); color: var(--upp-tx); }
    .upp-icon-btn:active { transform: scale(0.92); }
    .upp-icon-btn.is-active { background: var(--upp-accent-bg); border-color: var(--upp-accent-border); color: var(--upp-accent-tx); }

    .upp-tabs-wrap { padding: 2px 16px 10px; flex-shrink: 0; }
    .upp-tabs-wrap[hidden] { display: none; }
    .upp-tabs {
      display: flex; gap: 3px; padding: 3px; border-radius: 13px; background: var(--upp-track-bg);
      overflow-x: auto; scrollbar-width: none;
    }
    .upp-tabs::-webkit-scrollbar { display: none; }
    .upp-tab {
      flex: 1 0 auto; height: 32px; border-radius: 10px; border: none; background: transparent;
      color: var(--upp-tx2); font-size: 13px; font-weight: 500;
      display: inline-flex; align-items: center; justify-content: center; gap: 5px;
      cursor: pointer; padding: 0 10px; white-space: nowrap;
      transition: background 0.16s var(--upp-ease), color 0.16s ease, box-shadow 0.16s var(--upp-ease);
    }
    .upp-tab:hover { color: var(--upp-tx); }
    .upp-tab.is-active { background: var(--upp-seg-active-bg); color: var(--upp-tx); font-weight: 600; box-shadow: var(--upp-seg-active-shadow); }
    .upp-tab-count {
      font-size: 11px; font-weight: 600; line-height: 1; padding: 2px 6px; border-radius: 999px;
      background: var(--upp-badge-bg); color: var(--upp-badge-tx);
    }

    .upp-presets {
      display: flex; align-items: center; gap: 7px; padding: 0 16px 11px;
      overflow-x: auto; scrollbar-width: none; flex-shrink: 0; border-bottom: 1px solid var(--upp-divider);
    }
    .upp-presets[hidden] { display: none; }
    .upp-presets::-webkit-scrollbar { display: none; }
    .upp-preset-btn {
      height: 30px; padding: 0 12px; border-radius: 999px;
      border: 1px solid var(--upp-chip-border); background: var(--upp-chip-bg); color: var(--upp-chip-tx);
      font-size: 12px; font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center; gap: 5px;
      transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease, transform 0.12s ease;
    }
    .upp-preset-btn:hover { background: var(--upp-chip-hover); border-color: var(--upp-accent-border); color: var(--upp-accent-tx); }
    .upp-preset-btn:active { transform: scale(0.96); }
    .upp-preset-btn.is-action { background: var(--upp-btn-bg); border-color: var(--upp-btn-border); color: var(--upp-tx2); }
    .upp-preset-dot { width: 5px; height: 5px; border-radius: 999px; background: var(--upp-accent); opacity: 0.78; }
    .upp-preset-btn[data-mode="additive"] .upp-preset-dot { background: #d46a8c; }
    .upp-preset-btn[data-mode="replace_all"] .upp-preset-dot { background: #4ca37b; }

    .upp-alerts { padding: 10px 16px 0; display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
    .upp-alerts:empty { display: none; }
    .upp-stale-box, .upp-miss-box, .upp-ok-box { border-radius: 12px; padding: 8px 11px; font-size: 12px; line-height: 1.45; }
    .upp-stale-box { border: 1px solid var(--upp-danger-border); background: var(--upp-danger-bg); display: flex; flex-direction: column; gap: 7px; }
    .upp-stale-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-weight: 500; color: var(--upp-danger-tx); }
    .upp-stale-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .upp-stale-chip {
      height: 26px; padding: 0 9px; border-radius: 999px; border: 1px solid var(--upp-danger-border);
      background: var(--upp-chip-bg); color: var(--upp-danger-tx); font-size: 12px;
      display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
    }
    .upp-miss-box {
      border: 1px solid var(--upp-warn-border); background: var(--upp-warn-bg); color: var(--upp-warn-tx);
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    .upp-ok-box { border: 1px solid var(--upp-ok-border); background: var(--upp-ok-bg); color: var(--upp-ok-tx); }

    .upp-body {
      flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
      padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 10px;
      scrollbar-width: thin; scrollbar-color: var(--upp-scroll) transparent;
    }
    .upp-body::-webkit-scrollbar { width: 5px; height: 5px; }
    .upp-body::-webkit-scrollbar-track { background: transparent; }
    .upp-body::-webkit-scrollbar-thumb { background: var(--upp-scroll); border-radius: 999px; }
    .upp-body::-webkit-scrollbar-thumb:hover { background: var(--upp-scroll-hover); }

    .upp-search-wrap { position: relative; }
    .upp-search-input {
      width: 100%; height: 34px; border-radius: 11px;
      border: 1px solid var(--upp-input-border); background: var(--upp-input-bg); color: var(--upp-tx);
      padding: 0 32px 0 12px; font: inherit; font-size: 13px; outline: none;
    }
    .upp-search-input::placeholder { color: var(--upp-tx3); }
    .upp-search-input:focus { border-color: var(--upp-accent-border); box-shadow: 0 0 0 3px var(--upp-accent-bg); }
    .upp-search-clear {
      position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
      width: 22px; height: 22px; border-radius: 999px; border: none;
      background: var(--upp-btn-bg); color: var(--upp-tx2); font-size: 13px;
      cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
    }

    .upp-group {
      background: var(--upp-card-bg); border: 1px solid var(--upp-card-border);
      box-shadow: var(--upp-card-shadow); border-radius: 15px; padding: 11px 12px;
      display: flex; flex-direction: column; gap: 9px;
    }
    .upp-group-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; }
    .upp-group-title { font-size: 13px; font-weight: 600; color: var(--upp-tx); display: inline-flex; align-items: center; gap: 6px; }
    .upp-group-badge {
      font-size: 11px; font-weight: 600; color: var(--upp-badge-tx); background: var(--upp-badge-bg);
      border-radius: 999px; padding: 1px 7px; line-height: 1.4;
    }
    .upp-mini-btn {
      height: 26px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--upp-btn-border);
      background: var(--upp-btn-bg); color: var(--upp-tx2); font-size: 12px; font-weight: 500; line-height: 1;
      display: inline-flex; align-items: center; justify-content: center; cursor: pointer; white-space: nowrap;
      transition: background 0.14s ease, color 0.14s ease;
    }
    .upp-mini-btn:hover { background: var(--upp-btn-hover); color: var(--upp-tx); }
    .upp-mini-btn.is-active { background: var(--upp-accent-bg); border-color: var(--upp-accent-border); color: var(--upp-accent-tx); }
    .upp-mini-btn.is-danger { color: var(--upp-danger-tx); }

    .upp-chips { display: flex; flex-wrap: wrap; gap: 7px; }
    .upp-chip {
      min-height: 34px; padding: 6px 12px; border-radius: 10px;
      border: 1px solid var(--upp-chip-border); background: var(--upp-chip-bg); color: var(--upp-chip-tx);
      font-size: 13px; font-weight: 450; line-height: 1.25; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px; text-align: left; word-break: break-word;
      transition: background 0.14s var(--upp-ease), border-color 0.14s ease, color 0.14s ease, transform 0.10s ease;
    }
    .upp-chip:hover { background: var(--upp-chip-hover); }
    .upp-chip:active { transform: scale(0.97); }
    .upp-chip.is-selected { background: var(--upp-accent-bg); border-color: var(--upp-accent-border); color: var(--upp-accent-tx); font-weight: 500; }
    .upp-chip.is-selected::before { content: ""; width: 6px; height: 6px; border-radius: 999px; background: var(--upp-accent); flex-shrink: 0; }
    .upp-chip.is-selected.is-soft-warn { background: var(--upp-warn-bg); border-color: var(--upp-warn-border); color: var(--upp-warn-tx); }
    .upp-chip.is-selected.is-soft-warn::before { background: var(--upp-warn-dot); }
    .upp-chip.is-edit-mode { border-style: dashed; }

    /* Summary Card List Layout (ideal for normal users with coarse persona entries) */
    .upp-card-list { display: flex; flex-direction: column; gap: 7px; }
    .upp-entry-card {
      display: flex; align-items: center; gap: 8px;
      border: 1px solid var(--upp-chip-border); background: var(--upp-chip-bg);
      border-radius: 12px; padding: 9px 10px;
      transition: background 0.14s ease, border-color 0.14s ease;
    }
    .upp-entry-card.is-selected { background: var(--upp-accent-bg); border-color: var(--upp-accent-border); }
    .upp-entry-card.is-selected.is-soft-warn { background: var(--upp-warn-bg); border-color: var(--upp-warn-border); }
    .upp-entry-main {
      flex: 1 1 auto; min-width: 0; background: none; border: none; padding: 0; text-align: left;
      cursor: pointer; display: flex; align-items: flex-start; gap: 9px; color: inherit; font: inherit;
    }
    .upp-entry-dot {
      width: 16px; height: 16px; border-radius: 999px; margin-top: 2px; flex-shrink: 0;
      border: 1.5px solid var(--upp-chip-border); background: transparent;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .upp-entry-card.is-selected .upp-entry-dot {
      border-color: var(--upp-accent); background: var(--upp-accent);
    }
    .upp-entry-card.is-selected .upp-entry-dot::after {
      content: ""; width: 6px; height: 6px; border-radius: 999px; background: #ffffff;
    }
    .upp-entry-text { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 2px; }
    .upp-entry-name { font-size: 13px; font-weight: 500; color: var(--upp-tx); line-height: 1.3; word-break: break-word; }
    .upp-entry-card.is-selected .upp-entry-name { color: var(--upp-accent-tx); font-weight: 600; }
    .upp-entry-snippet {
      font-size: 12px; color: var(--upp-tx3); line-height: 1.35;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .upp-entry-edit {
      width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--upp-btn-border);
      background: var(--upp-btn-bg); color: var(--upp-tx2); flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
    }
    .upp-entry-edit:hover { background: var(--upp-btn-hover); color: var(--upp-tx); }

    .upp-subbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 2px 2px; }
    .upp-subbar-text { font-size: 12px; font-weight: 500; color: var(--upp-tx2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .upp-subbar-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .upp-bar-btn {
      height: 30px; padding: 0 11px; border-radius: 999px; border: 1px solid var(--upp-btn-border);
      background: var(--upp-chip-bg); color: var(--upp-tx); font-size: 12px; font-weight: 500;
      display: inline-flex; align-items: center; justify-content: center; cursor: pointer; white-space: nowrap;
      transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
    }
    .upp-bar-btn:hover { background: var(--upp-chip-hover); }
    .upp-bar-btn.is-active { background: var(--upp-accent-bg); border-color: var(--upp-accent-border); color: var(--upp-accent-tx); }

    .upp-form {
      background: var(--upp-card-bg); border: 1px solid var(--upp-card-border);
      box-shadow: var(--upp-card-shadow); border-radius: 15px; padding: 13px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .upp-field { display: flex; flex-direction: column; gap: 5px; }
    .upp-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .upp-label { font-size: 12px; font-weight: 500; color: var(--upp-tx2); display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .upp-prefix-preview { font-size: 12px; font-weight: 600; color: var(--upp-accent-tx); }
    .upp-input, .upp-textarea, .upp-select {
      width: 100%; border: 1px solid var(--upp-input-border); background: var(--upp-input-bg); color: var(--upp-tx);
      border-radius: 10px; padding: 8px 11px; font: inherit; font-size: 13px; outline: none;
      transition: border-color 0.14s ease, box-shadow 0.14s ease;
    }
    .upp-input::placeholder, .upp-textarea::placeholder { color: var(--upp-tx3); }
    .upp-input:focus, .upp-textarea:focus, .upp-select:focus { border-color: var(--upp-accent-border); box-shadow: 0 0 0 3px var(--upp-accent-bg); }
    .upp-textarea { resize: vertical; min-height: 76px; line-height: 1.5; }
    .upp-textarea.is-tall { min-height: 165px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
    .upp-form-error { font-size: 12px; color: var(--upp-danger-tx); }
    .upp-form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px; }

    .upp-row-list { display: flex; flex-direction: column; gap: 7px; }
    .upp-row-item {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 8px 10px; border-radius: 11px; border: 1px solid var(--upp-chip-border); background: var(--upp-chip-bg);
    }
    .upp-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
    .upp-row-title { font-size: 13px; font-weight: 500; color: var(--upp-tx); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .upp-row-sub { font-size: 11px; color: var(--upp-tx3); }
    .upp-row-btns { display: flex; align-items: center; gap: 5px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }

    .upp-preview-pre {
      margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.55;
      color: var(--upp-tx); background: var(--upp-input-bg); border: 1px solid var(--upp-input-border);
      border-radius: 12px; padding: 12px; max-height: 52dvh; overflow-y: auto;
    }

    .upp-empty { font-size: 12px; color: var(--upp-tx3); padding: 2px 0; }

    .upp-foot {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      padding: 11px 16px; border-top: 1px solid var(--upp-divider); background: var(--upp-foot-bg); flex-shrink: 0;
    }
    .upp-foot-right { display: flex; align-items: center; gap: 12px; }
    .upp-total { font-size: 12px; font-weight: 500; color: var(--upp-tx2); white-space: nowrap; }
    .upp-btn {
      height: 36px; min-width: 74px; padding: 0 15px; border-radius: 999px;
      border: 1px solid var(--upp-btn-border); background: var(--upp-btn-bg); color: var(--upp-btn-tx);
      font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; white-space: nowrap;
      transition: background 0.14s ease, transform 0.10s ease, box-shadow 0.14s ease;
    }
    .upp-btn:hover { background: var(--upp-btn-hover); }
    .upp-btn:active { transform: scale(0.97); }
    .upp-btn:disabled { opacity: 0.52; cursor: not-allowed; }
    .upp-btn-primary {
      background: var(--upp-primary-bg); border-color: transparent; color: #ffffff; font-weight: 600;
      box-shadow: var(--upp-primary-shadow);
    }
    .upp-btn-primary:hover { background: var(--upp-primary-hover); }

    @media (max-width: 640px) {
      .upp-backdrop { padding: 0; align-items: flex-end; }
      .upp-modal {
        max-width: 100%; max-height: 88dvh; border-radius: 24px 24px 0 0;
        border-left: none; border-right: none; border-bottom: none;
        animation: upp-sheet-up 0.24s var(--upp-ease);
      }
      .upp-grab { display: block; }
      .upp-head { padding: 10px 16px 8px; }
      .upp-foot { padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px)); }
      .upp-chip { min-height: 36px; padding: 7px 13px; }
      .upp-field-row { grid-template-columns: 1fr; }
    }

    @media (prefers-reduced-motion: reduce) {
      .upp-backdrop, .upp-modal { animation: none; }
      .upp-chip, .upp-btn, .upp-preset-btn, .upp-tab, .upp-icon-btn { transition: none; }
    }
  `;

  const ICON_EDIT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const ICON_EYE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const ICON_GEAR = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>';

  shadow.innerHTML = `
    <style>${STYLE}</style>
    <div class="upp-backdrop" data-theme="light" hidden>
      <div class="upp-modal" role="dialog" aria-modal="true" aria-label="User 人设点选">
        <div class="upp-grab" aria-hidden="true"></div>
        <div class="upp-head">
          <div class="upp-head-left">
            <span class="upp-title">User 人设</span>
            <span class="upp-char-tag" hidden></span>
          </div>
          <div class="upp-head-actions">
            <button type="button" class="upp-icon-btn" data-act="toggle-edit-mode" title="编辑条目" aria-label="编辑条目">${ICON_EDIT}</button>
            <button type="button" class="upp-icon-btn" data-act="toggle-preview" title="预览正文" aria-label="预览正文">${ICON_EYE}</button>
            <button type="button" class="upp-icon-btn" data-act="toggle-settings" title="设置" aria-label="设置">${ICON_GEAR}</button>
            <button type="button" class="upp-icon-btn" data-act="close" title="关闭" aria-label="关闭">×</button>
          </div>
        </div>
        <div class="upp-tabs-wrap">
          <div class="upp-tabs" role="tablist"></div>
        </div>
        <div class="upp-presets"></div>
        <div class="upp-alerts"></div>
        <div class="upp-body"></div>
        <div class="upp-foot">
          <button type="button" class="upp-btn" data-act="clear">清空</button>
          <div class="upp-foot-right">
            <span class="upp-total">已选 0</span>
            <button type="button" class="upp-btn upp-btn-primary" data-act="save">保存</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const $ = sel => shadow.querySelector(sel);
  const elBackdrop = $('.upp-backdrop');
  const elCharTag = $('.upp-char-tag');
  const elEditBtn = $('[data-act="toggle-edit-mode"]');
  const elPreviewBtn = $('[data-act="toggle-preview"]');
  const elSettingsBtn = $('[data-act="toggle-settings"]');
  const elTabsWrap = $('.upp-tabs-wrap');
  const elTabs = $('.upp-tabs');
  const elPresets = $('.upp-presets');
  const elAlerts = $('.upp-alerts');
  const elBody = $('.upp-body');
  const elTotal = $('.upp-total');
  const elSaveBtn = $('[data-act="save"]');
  const elFoot = $('.upp-foot');

  // =========================
  // UI State
  // =========================

  const state = {
    open: false,
    loading: false,
    saving: false,
    view: 'picker', // 'picker' | 'preview' | 'settings' | 'presets' | 'edit_entry'
    editMode: false,
    activeBook: '',
    searchQuery: '',
    charName: '',
    config: loadStoredConfig(),
    allHostBooks: [],
    globalBooks: [],
    model: null,
    selected: new Set(),
    stale: [],
    expandedGroups: new Set(),
    showAllChars: false,
    showNewForm: false,
    newDraft: { shortName: '', relation: '', secret: '', title: '', content: '', group: '', slot: '', error: '', busy: false },
    editEntryDraft: { book: '', oldTitle: '', title: '', group: '', slot: '', content: '', error: '', busy: false },
    presetForm: { open: false, label: '', mode: 'replace_all', targetBook: '', error: '' },
    importDraft: { open: false, text: '', error: '' },
    exDraft: { label: '', itemsText: '', error: '' },
  };

  function currentBookCfg() {
    if (!state.config.books.length) return null;
    return state.config.books.find(b => b.name === state.activeBook) || state.config.books[0];
  }

  function countSelectedInBook(bookName) {
    let n = 0;
    for (const k of state.selected) {
      if (parseKey(k).book === bookName) n++;
    }
    return n;
  }

  function countEntriesInBook(bookCfg) {
    if (!bookCfg || !state.model) return 0;
    if (bookCfg.mode === 'if') return (state.model.ifTitlesByBook?.[bookCfg.name] || []).length;
    return (state.model.groupsByBook?.[bookCfg.name] || []).reduce((sum, g) => sum + g.items.length, 0);
  }

  function renderHeader() {
    if (state.charName) {
      elCharTag.textContent = state.charName;
      elCharTag.hidden = false;
    } else {
      elCharTag.hidden = true;
    }
    elEditBtn.classList.toggle('is-active', state.editMode && state.view === 'picker');
    elPreviewBtn.classList.toggle('is-active', state.view === 'preview');
    elSettingsBtn.classList.toggle('is-active', state.view === 'settings');
  }

  function renderTabs() {
    const showPickerChrome = state.view === 'picker' && state.config.books.length > 0;
    elTabsWrap.hidden = !showPickerChrome;
    elPresets.hidden = !showPickerChrome;
    if (!showPickerChrome) return;

    const active = currentBookCfg()?.name || '';
    elTabs.innerHTML = state.config.books.map(b => {
      const count = countSelectedInBook(b.name);
      return '<button type="button" class="upp-tab' + (active === b.name ? ' is-active' : '') +
        '" data-book-tab="' + esc(b.name) + '" role="tab">' +
        esc(b.label) + (count > 0 ? '<span class="upp-tab-count">' + count + '</span>' : '') +
      '</button>';
    }).join('');
  }

  function renderPresetsBar() {
    if (elPresets.hidden) return;
    const pills = (state.config.presets || []).map(p => {
      const isDef = p.id === state.config.defaultPresetId;
      return '<button type="button" class="upp-preset-btn" data-preset="' + esc(p.id) + '" data-mode="' + esc(p.mode) + '">' +
        '<span class="upp-preset-dot" aria-hidden="true"></span>' +
        '<span>' + (isDef ? '★ ' : '') + esc(p.label) + '</span>' +
      '</button>';
    });
    pills.push('<button type="button" class="upp-preset-btn is-action" data-act="open-save-preset">+ 存方案</button>');
    if ((state.config.presets || []).length > 0) {
      pills.push('<button type="button" class="upp-preset-btn is-action" data-act="open-presets">管理</button>');
    }
    elPresets.innerHTML = pills.join('');
  }

  function renderAlerts() {
    if (state.view !== 'picker') {
      elAlerts.innerHTML = '';
      return;
    }
    const parts = [];
    const openingName = state.config.openingBook || DEFAULT_OPENING_BOOK;
    const hasOpening = state.allHostBooks.includes(openingName);
    const openingActive = state.globalBooks.includes(openingName);

    if (!state.loading && state.config.books.length > 0 && (!hasOpening || !openingActive)) {
      parts.push(
        '<div class="upp-miss-box">' +
          '<span>' + (!hasOpening ? '未检测到总控世界书 ' + esc(openingName) : '总控世界书 ' + esc(openingName) + ' 未全局开启') + '</span>' +
          '<button type="button" class="upp-mini-btn" data-act="ensure-opening">' + (!hasOpening ? '一键生成' : '一键开启') + '</button>' +
        '</div>'
      );
    }

    if (state.model?.missingBooks?.length > 0 && !state.loading) {
      parts.push(
        '<div class="upp-miss-box"><span>未找到世界书：' + esc(state.model.missingBooks.join('、')) + '</span></div>'
      );
    }

    if (state.stale.length > 0) {
      const chips = state.stale.map((it, idx) =>
        '<button type="button" class="upp-stale-chip" data-stale-idx="' + idx + '" title="' + esc(it.book + ' / ' + it.title) + '">' +
        '<span>' + esc(it.title) + '</span><span>×</span></button>'
      ).join('');
      parts.push(
        '<div class="upp-stale-box">' +
          '<div class="upp-stale-head">' +
            '<span>已失效 ' + state.stale.length + ' 项</span>' +
            '<button type="button" class="upp-mini-btn" data-act="clear-stale">移除全部</button>' +
          '</div>' +
          '<div class="upp-stale-list">' + chips + '</div>' +
        '</div>'
      );
    }

    if (state.editMode) {
      parts.push('<div class="upp-ok-box">编辑模式：点任意条目即可原地改标题、分组或正文</div>');
    }

    elAlerts.innerHTML = parts.join('');
  }

  function renderEntriesItems(bookCfg, cat, visibleItems, softWarnSet, ifSection) {
    const bookName = bookCfg.name;
    if (bookCfg.layout === 'list') {
      return '<div class="upp-card-list">' + visibleItems.map(it => {
        const k = itemKey(bookName, it.title);
        const isSel = state.selected.has(k);
        const isWarn = isSel && softWarnSet.has(k);
        const label = chipLabel(bookCfg, cat, it.title, ifSection);
        const snippet = summarizeContent(state.model?.entryContentMap?.[bookName]?.[it.title] || '', 72);
        return '<div class="upp-entry-card' + (isSel ? ' is-selected' : '') + (isWarn ? ' is-soft-warn' : '') + '">' +
          '<button type="button" class="upp-entry-main" data-book="' + esc(bookName) + '" data-title="' + esc(it.title) + '">' +
            '<span class="upp-entry-dot" aria-hidden="true"></span>' +
            '<span class="upp-entry-text">' +
              '<span class="upp-entry-name">' + esc(label) + '</span>' +
              (snippet ? '<span class="upp-entry-snippet">' + esc(snippet) + '</span>' : '') +
            '</span>' +
          '</button>' +
          '<button type="button" class="upp-entry-edit" data-edit-book="' + esc(bookName) + '" data-edit-title="' + esc(it.title) + '" title="编辑" aria-label="编辑">' + ICON_EDIT + '</button>' +
        '</div>';
      }).join('') + '</div>';
    }

    return '<div class="upp-chips">' + visibleItems.map(it => {
      const k = itemKey(bookName, it.title);
      const isSel = state.selected.has(k);
      const isWarn = isSel && softWarnSet.has(k);
      const label = chipLabel(bookCfg, cat, it.title, ifSection);
      return '<button type="button" class="upp-chip' +
        (isSel ? ' is-selected' : '') +
        (isWarn ? ' is-soft-warn' : '') +
        (state.editMode ? ' is-edit-mode' : '') +
        '" data-book="' + esc(bookName) +
        '" data-title="' + esc(it.title) +
        '" title="' + esc(it.title) + '">' + esc(label) + '</button>';
    }).join('') + '</div>';
  }

  function renderGroupBlock(bookCfg, cat, items, softWarnSet, ifSection, isSearching) {
    const bookName = bookCfg.name;
    const filtered = isSearching
      ? filterItemsByQuery(items, state.searchQuery, bookName, state.model?.entryContentMap)
      : items;
    if (!filtered.length) return '';

    const groupId = bookName + '::' + cat;
    const expanded = isSearching || state.expandedGroups.has(groupId);
    const mainItems = [];
    const moreSelected = [];
    const moreHidden = [];

    for (const it of filtered) {
      const k = itemKey(bookName, it.title);
      const isSel = state.selected.has(k);
      if (it.tier === 'more') {
        if (isSel) moreSelected.push(it);
        else moreHidden.push(it);
      } else {
        mainItems.push(it);
      }
    }

    const visibleItems = expanded ? filtered : [...moreSelected, ...mainItems];

    let selectedCount = 0;
    for (const it of filtered) {
      if (state.selected.has(itemKey(bookName, it.title))) selectedCount++;
    }

    const toggleBtn = !isSearching && moreHidden.length > 0
      ? '<button type="button" class="upp-mini-btn" data-expand="' + esc(groupId) + '">' + (expanded ? '收起' : '更多') + '</button>'
      : '';

    const bodyHtml = renderEntriesItems(bookCfg, cat, visibleItems, softWarnSet, ifSection);
    if (!cat && !toggleBtn) {
      return '<section class="upp-group">' + bodyHtml + '</section>';
    }

    return '<section class="upp-group">' +
      '<div class="upp-group-head">' +
        '<span class="upp-group-title">' + esc(cat) +
          (selectedCount > 0 ? '<span class="upp-group-badge">' + selectedCount + '</span>' : '') +
        '</span>' +
        toggleBtn +
      '</div>' +
      bodyHtml +
    '</section>';
  }

  function renderSavePresetForm() {
    const pf = state.presetForm;
    const bookOpts = state.config.books.map(b =>
      '<option value="' + esc(b.name) + '"' + (pf.targetBook === b.name ? ' selected' : '') + '>' + esc(b.label) + '</option>'
    ).join('');
    return '<div class="upp-form">' +
      '<div class="upp-group-head"><span class="upp-group-title">保存当前勾选为方案</span></div>' +
      '<div class="upp-field">' +
        '<label class="upp-label"><span>方案名称</span><span class="upp-prefix-preview">共 ' + state.selected.size + ' 项</span></label>' +
        '<input type="text" class="upp-input" data-pf-field="label" value="' + esc(pf.label) + '" placeholder="例如：日常底包" />' +
      '</div>' +
      '<div class="upp-field">' +
        '<label class="upp-label"><span>应用方式</span></label>' +
        '<select class="upp-select" data-pf-field="mode">' +
          '<option value="replace_all"' + (pf.mode === 'replace_all' ? ' selected' : '') + '>整套切换</option>' +
          '<option value="replace_book"' + (pf.mode === 'replace_book' ? ' selected' : '') + '>仅替换单本书</option>' +
          '<option value="additive"' + (pf.mode === 'additive' ? ' selected' : '') + '>叠加勾选</option>' +
        '</select>' +
      '</div>' +
      (pf.mode === 'replace_book'
        ? '<div class="upp-field"><label class="upp-label"><span>替换目标书</span></label><select class="upp-select" data-pf-field="targetBook">' + bookOpts + '</select></div>'
        : '') +
      (pf.error ? '<div class="upp-form-error">' + esc(pf.error) + '</div>' : '') +
      '<div class="upp-form-actions">' +
        '<button type="button" class="upp-btn" data-act="cancel-save-preset">取消</button>' +
        '<button type="button" class="upp-btn upp-btn-primary" data-act="confirm-save-preset">保存方案</button>' +
      '</div>' +
    '</div>';
  }

  function renderNewEntryForm(bookCfg) {
    const d = state.newDraft;
    if (bookCfg.mode === 'if') {
      const prefix = '【' + (sanitizeCharName(state.charName) || '通用') + '】';
      return '<div class="upp-form">' +
        '<div class="upp-field">' +
          '<label class="upp-label"><span>路线名称</span><span class="upp-prefix-preview">' + esc(prefix) + '</span></label>' +
          '<input type="text" class="upp-input" data-new-field="shortName" value="' + esc(d.shortName) + '" placeholder="例如：重逢线" />' +
        '</div>' +
        '<div class="upp-field">' +
          '<label class="upp-label"><span>身份与关系/前提</span></label>' +
          '<textarea class="upp-textarea" data-new-field="relation" placeholder="本线身份、与角色的关系或起点前提">' + esc(d.relation) + '</textarea>' +
        '</div>' +
        '<div class="upp-field">' +
          '<label class="upp-label"><span>秘密或特殊补充</span></label>' +
          '<textarea class="upp-textarea" data-new-field="secret" placeholder="选填">' + esc(d.secret) + '</textarea>' +
        '</div>' +
        (d.error ? '<div class="upp-form-error">' + esc(d.error) + '</div>' : '') +
        '<div class="upp-form-actions">' +
          '<button type="button" class="upp-btn" data-act="cancel-new">取消</button>' +
          '<button type="button" class="upp-btn upp-btn-primary" data-act="submit-new"' + (d.busy ? ' disabled' : '') + '>创建</button>' +
        '</div>' +
      '</div>';
    }

    return '<div class="upp-form">' +
      '<div class="upp-field">' +
        '<label class="upp-label"><span>条目标题</span></label>' +
        '<input type="text" class="upp-input" data-new-field="title" value="' + esc(d.title) + '" placeholder="随意命名即可" />' +
      '</div>' +
      '<div class="upp-field-row">' +
        '<div class="upp-field">' +
          '<label class="upp-label"><span>插件内分组</span></label>' +
          '<input type="text" class="upp-input" data-new-field="group" value="' + esc(d.group) + '" placeholder="选填，不改原名" />' +
        '</div>' +
        '<div class="upp-field">' +
          '<label class="upp-label"><span>注入位置</span></label>' +
          '<select class="upp-select" data-new-field="slot">' +
            '<option value=""' + (!d.slot ? ' selected' : '') + '>默认正文</option>' +
            '<option value="rule"' + (d.slot === 'rule' ? ' selected' : '') + '>写作规则</option>' +
            '<option value="depth1"' + (d.slot === 'depth1' ? ' selected' : '') + '>深度1强提醒</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div class="upp-field">' +
        '<label class="upp-label"><span>条目正文</span></label>' +
        '<textarea class="upp-textarea" data-new-field="content" placeholder="写入该条目的设定内容">' + esc(d.content) + '</textarea>' +
      '</div>' +
      (d.error ? '<div class="upp-form-error">' + esc(d.error) + '</div>' : '') +
      '<div class="upp-form-actions">' +
        '<button type="button" class="upp-btn" data-act="cancel-new">取消</button>' +
        '<button type="button" class="upp-btn upp-btn-primary" data-act="submit-new"' + (d.busy ? ' disabled' : '') + '>创建</button>' +
      '</div>' +
    '</div>';
  }

  function renderOnboarding() {
    const openingName = state.config.openingBook || DEFAULT_OPENING_BOOK;
    const hasOpening = state.allHostBooks.includes(openingName);
    const openingActive = state.globalBooks.includes(openingName);
    const bookRows = state.allHostBooks
      .filter(name => name !== openingName)
      .map(name =>
        '<div class="upp-row-item">' +
          '<div class="upp-row-main"><span class="upp-row-title">' + esc(name) + '</span></div>' +
          '<div class="upp-row-btns">' +
            '<button type="button" class="upp-mini-btn" data-quick-add="' + esc(name) + '">+ 绑定</button>' +
          '</div>' +
        '</div>'
      ).join('');

    return '<section class="upp-group">' +
      '<div class="upp-group-head"><span class="upp-group-title">第一步：绑定你的 User 世界书</span></div>' +
      '<div class="upp-empty">直接选择你现有的世界书，无需改条目名；没有现成世界书也可以一键新建或导入当前原生人设。</div>' +
      '<div class="upp-chips">' +
        '<button type="button" class="upp-bar-btn" data-act="create-starter-persona">从当前 Persona 导入新建</button>' +
        '<button type="button" class="upp-bar-btn" data-act="create-starter-blank">+ 新建空白人设书</button>' +
      '</div>' +
      '<div class="upp-row-list">' + (bookRows || '<div class="upp-empty">暂无其他世界书</div>') + '</div>' +
    '</section>' +
    '<section class="upp-group">' +
      '<div class="upp-group-head">' +
        '<span class="upp-group-title">第二步：总控世界书</span>' +
        '<button type="button" class="upp-mini-btn" data-act="ensure-opening">' + (hasOpening && openingActive ? '已启用' : '一键生成并启用') + '</button>' +
      '</div>' +
      '<div class="upp-empty">仅 ' + esc(openingName) + ' 保持全局常开，数据源书保持关闭即可。</div>' +
    '</section>' +
    '<section class="upp-group">' +
      '<div class="upp-group-head">' +
        '<span class="upp-group-title">已有配置文件？</span>' +
        '<button type="button" class="upp-mini-btn" data-act="toggle-settings">前往导入</button>' +
      '</div>' +
    '</section>';
  }

  function renderPickerBody() {
    if (!state.config.books.length) return renderOnboarding();
    const bookCfg = currentBookCfg();
    if (!bookCfg) return '<div class="upp-empty">请先在设置中绑定世界书</div>';

    const softWarnSet = getSoftWarnKeys(state.selected, state.config);
    const totalCount = countEntriesInBook(bookCfg);
    const isSearching = Boolean(state.searchQuery.trim());
    const parts = [];

    if (state.presetForm.open) parts.push(renderSavePresetForm());

    if (totalCount > 10 || isSearching) {
      parts.push(
        '<div class="upp-search-wrap">' +
          '<input type="text" class="upp-search-input" data-search-input="1" value="' + esc(state.searchQuery) + '" placeholder="搜索标题或正文" />' +
          (isSearching ? '<button type="button" class="upp-search-clear" data-act="clear-search" aria-label="清除">×</button>' : '') +
        '</div>'
      );
    }

    const layoutBtn = '<button type="button" class="upp-bar-btn" data-act="toggle-layout">' + (bookCfg.layout === 'list' ? '标签视图' : '摘要视图') + '</button>';

    if (bookCfg.mode === 'if') {
      parts.push(
        '<div class="upp-subbar">' +
          '<span class="upp-subbar-text">' + esc(state.charName ? '当前角色：' + state.charName : '未打开角色卡') + '</span>' +
          '<div class="upp-subbar-actions">' +
            layoutBtn +
            '<button type="button" class="upp-bar-btn' + (state.showAllChars ? ' is-active' : '') + '" data-act="toggle-all-chars">全部角色</button>' +
            '<button type="button" class="upp-bar-btn' + (state.showNewForm ? ' is-active' : '') + '" data-act="toggle-new">+ 新建</button>' +
          '</div>' +
        '</div>'
      );
      if (state.showNewForm) parts.push(renderNewEntryForm(bookCfg));

      const titles = state.model?.ifTitlesByBook?.[bookCfg.name] || [];
      const p = partitionIfTitles(titles, state.charName, state.selected, bookCfg.name, state.showAllChars);
      const toItems = arr => arr.map(title => ({ title, tier: 'main' }));

      if (p.current.length > 0) {
        const block = renderGroupBlock(bookCfg, state.charName || '本角色', toItems(p.current), softWarnSet, 'current', isSearching);
        if (block) parts.push(block);
      } else if (!isSearching) {
        parts.push(
          '<section class="upp-group">' +
            '<div class="upp-group-head"><span class="upp-group-title">' + esc(state.charName || '本角色') + '</span></div>' +
            '<div class="upp-empty">' + (state.charName ? '暂无匹配本角色的路线' : '打开角色卡后自动匹配本角色路线') + '</div>' +
          '</section>'
        );
      }
      for (const [label, arr, sec] of [
        ['通用', p.common, 'common'],
        ['已选其他角色', state.showAllChars ? [] : p.selectedOther, 'other'],
        ['其他', p.unprefixed, 'other'],
        ['其他角色', state.showAllChars ? p.otherChars : [], 'other'],
      ]) {
        if (arr.length > 0) {
          const block = renderGroupBlock(bookCfg, label, toItems(arr), softWarnSet, sec, isSearching);
          if (block) parts.push(block);
        }
      }
      return parts.join('');
    }

    parts.push(
      '<div class="upp-subbar">' +
        '<span class="upp-subbar-text">' + esc(bookCfg.name) + '</span>' +
        '<div class="upp-subbar-actions">' +
          layoutBtn +
          '<button type="button" class="upp-bar-btn' + (state.showNewForm ? ' is-active' : '') + '" data-act="toggle-new">+ 新建</button>' +
        '</div>' +
      '</div>'
    );
    if (state.showNewForm) parts.push(renderNewEntryForm(bookCfg));

    const groups = state.model?.groupsByBook?.[bookCfg.name] || [];
    let rendered = 0;
    for (const g of groups) {
      const block = renderGroupBlock(bookCfg, g.cat, g.items, softWarnSet, '', isSearching);
      if (block) { parts.push(block); rendered++; }
    }
    if (rendered === 0) {
      parts.push('<div class="upp-empty">' + (isSearching ? '没有匹配的条目' : '该世界书暂无条目') + '</div>');
    }
    return parts.join('');
  }

  function renderEditEntryView() {
    const d = state.editEntryDraft;
    return '<div class="upp-form">' +
      '<div class="upp-group-head">' +
        '<span class="upp-group-title">编辑条目</span>' +
        '<span class="upp-row-sub">' + esc(d.book) + '</span>' +
      '</div>' +
      '<div class="upp-field">' +
        '<label class="upp-label"><span>条目标题</span></label>' +
        '<input type="text" class="upp-input" data-edit-field="title" value="' + esc(d.title) + '" />' +
      '</div>' +
      '<div class="upp-field-row">' +
        '<div class="upp-field">' +
          '<label class="upp-label"><span>插件内分组</span></label>' +
          '<input type="text" class="upp-input" data-edit-field="group" value="' + esc(d.group) + '" placeholder="留空按默认规则" />' +
        '</div>' +
        '<div class="upp-field">' +
          '<label class="upp-label"><span>注入位置</span></label>' +
          '<select class="upp-select" data-edit-field="slot">' +
            '<option value=""' + (!d.slot ? ' selected' : '') + '>默认正文</option>' +
            '<option value="rule"' + (d.slot === 'rule' ? ' selected' : '') + '>写作规则</option>' +
            '<option value="depth1"' + (d.slot === 'depth1' ? ' selected' : '') + '>深度1强提醒</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div class="upp-field">' +
        '<label class="upp-label"><span>正文</span></label>' +
        '<textarea class="upp-textarea is-tall" data-edit-field="content">' + esc(d.content) + '</textarea>' +
      '</div>' +
      (d.error ? '<div class="upp-form-error">' + esc(d.error) + '</div>' : '') +
      '<div class="upp-form-actions">' +
        '<button type="button" class="upp-btn" data-act="back-picker">返回</button>' +
        '<button type="button" class="upp-btn upp-btn-primary" data-act="save-edit-entry"' + (d.busy ? ' disabled' : '') + '>保存修改</button>' +
      '</div>' +
    '</div>';
  }

  function renderPreviewView() {
    const pv = buildPreviewText(state.selected, state.charName, state.config, state.model);
    return '<section class="upp-group">' +
      '<div class="upp-group-head">' +
        '<span class="upp-group-title">输出预览<span class="upp-group-badge">' + pv.count + ' 项 · ' + pv.chars + ' 字</span></span>' +
        '<button type="button" class="upp-mini-btn" data-act="back-picker">返回</button>' +
      '</div>' +
      (pv.text
        ? '<pre class="upp-preview-pre">' + esc(pv.text) + '</pre>'
        : '<div class="upp-empty">当前未勾选任何条目</div>') +
    '</section>';
  }

  function renderPresetsManageView() {
    const modeLabel = m => (m === 'additive' ? '叠加' : (m === 'replace_book' ? '单书替换' : '整套切换'));
    const rows = (state.config.presets || []).map(p => {
      const isDef = p.id === state.config.defaultPresetId;
      return '<div class="upp-row-item">' +
        '<div class="upp-row-main">' +
          '<span class="upp-row-title">' + (isDef ? '★ ' : '') + esc(p.label) + '</span>' +
          '<span class="upp-row-sub">' + modeLabel(p.mode) + ' · ' + p.items.length + ' 项</span>' +
        '</div>' +
        '<div class="upp-row-btns">' +
          '<button type="button" class="upp-mini-btn' + (isDef ? ' is-active' : '') + '" data-preset-def="' + esc(p.id) + '">' + (isDef ? '取消默认' : '设默认') + '</button>' +
          '<button type="button" class="upp-mini-btn" data-preset-overwrite="' + esc(p.id) + '">用当前覆盖</button>' +
          '<button type="button" class="upp-mini-btn is-danger" data-preset-del="' + esc(p.id) + '">删</button>' +
        '</div>' +
      '</div>';
    }).join('');

    return '<section class="upp-group">' +
      '<div class="upp-group-head">' +
        '<span class="upp-group-title">方案管理</span>' +
        '<button type="button" class="upp-mini-btn" data-act="back-picker">返回</button>' +
      '</div>' +
      '<div class="upp-row-list">' + (rows || '<div class="upp-empty">暂无方案</div>') + '</div>' +
    '</section>';
  }

  function renderSettingsView() {
    const openingName = state.config.openingBook || DEFAULT_OPENING_BOOK;
    const hasOpening = state.allHostBooks.includes(openingName);
    const openingActive = state.globalBooks.includes(openingName);
    const boundNames = new Set(state.config.books.map(b => b.name));
    const modeLabel = m => (m === 'if' ? '角色匹配' : (m === 'prefix' ? '前缀归组' : '平铺'));

    const boundRows = state.config.books.map((b, idx) =>
      '<div class="upp-row-item">' +
        '<div class="upp-row-main">' +
          '<span class="upp-row-title">' + esc(b.label) + '</span>' +
          '<span class="upp-row-sub">' + esc(b.name) + ' · ' + modeLabel(b.mode) + ' · ' + (b.layout === 'list' ? '摘要' : '标签') + '</span>' +
        '</div>' +
        '<div class="upp-row-btns">' +
          '<button type="button" class="upp-mini-btn" data-book-cycle-mode="' + idx + '">切模式</button>' +
          '<button type="button" class="upp-mini-btn is-danger" data-book-remove="' + idx + '">移除</button>' +
        '</div>' +
      '</div>'
    ).join('');

    const availableRows = state.allHostBooks
      .filter(n => !boundNames.has(n) && n !== openingName)
      .map(n =>
        '<button type="button" class="upp-chip" data-quick-add="' + esc(n) + '">+ ' + esc(n) + '</button>'
      ).join('');

    const exRows = (state.config.exclusive || []).map((g, idx) =>
      '<div class="upp-row-item">' +
        '<div class="upp-row-main">' +
          '<span class="upp-row-title">' + esc(g.label) + '</span>' +
          '<span class="upp-row-sub">' + esc(g.items.join(' / ')) + '</span>' +
        '</div>' +
        '<div class="upp-row-btns">' +
          '<button type="button" class="upp-mini-btn is-danger" data-ex-del="' + idx + '">删</button>' +
        '</div>' +
      '</div>'
    ).join('');

    return '<section class="upp-group">' +
      '<div class="upp-group-head">' +
        '<span class="upp-group-title">已绑定世界书</span>' +
        '<button type="button" class="upp-mini-btn" data-act="back-picker">返回</button>' +
      '</div>' +
      '<div class="upp-row-list">' + (boundRows || '<div class="upp-empty">尚未绑定世界书</div>') + '</div>' +
      (availableRows ? '<div class="upp-label"><span>点击添加世界书</span></div><div class="upp-chips">' + availableRows + '</div>' : '') +
    '</section>' +
    '<section class="upp-group">' +
      '<div class="upp-group-head">' +
        '<span class="upp-group-title">总控世界书</span>' +
        '<button type="button" class="upp-mini-btn" data-act="ensure-opening">' + (hasOpening && openingActive ? '已全局启用' : '一键生成并启用') + '</button>' +
      '</div>' +
      '<div class="upp-empty">当前入口：' + esc(openingName) + '</div>' +
    '</section>' +
    '<section class="upp-group">' +
      '<div class="upp-group-head"><span class="upp-group-title">硬互斥组</span></div>' +
      '<div class="upp-row-list">' + (exRows || '<div class="upp-empty">暂无互斥规则</div>') + '</div>' +
      '<div class="upp-field">' +
        '<input type="text" class="upp-input" data-ex-field="label" value="' + esc(state.exDraft.label) + '" placeholder="组名，如：主定位" />' +
        '<input type="text" class="upp-input" data-ex-field="itemsText" value="' + esc(state.exDraft.itemsText) + '" placeholder="互斥条目标题，用逗号分隔" />' +
      '</div>' +
      (state.exDraft.error ? '<div class="upp-form-error">' + esc(state.exDraft.error) + '</div>' : '') +
      '<div class="upp-form-actions"><button type="button" class="upp-mini-btn" data-act="add-ex">+ 添加互斥组</button></div>' +
    '</section>' +
    '<section class="upp-group">' +
      '<div class="upp-group-head">' +
        '<span class="upp-group-title">配置同步</span>' +
        '<div class="upp-row-btns">' +
          '<button type="button" class="upp-mini-btn" data-act="export-config">导出 JSON</button>' +
          '<button type="button" class="upp-mini-btn" data-act="toggle-import">导入 JSON</button>' +
        '</div>' +
      '</div>' +
      (state.importDraft.open
        ? '<div class="upp-field">' +
            '<textarea class="upp-textarea" data-import-field="text" placeholder="粘贴配置 JSON 内容">' + esc(state.importDraft.text) + '</textarea>' +
            (state.importDraft.error ? '<div class="upp-form-error">' + esc(state.importDraft.error) + '</div>' : '') +
            '<div class="upp-form-actions">' +
              '<button type="button" class="upp-mini-btn" data-act="pick-import-file">选文件</button>' +
              '<button type="button" class="upp-mini-btn is-active" data-act="confirm-import">确认导入</button>' +
            '</div>' +
          '</div>'
        : '<div class="upp-empty">导出后可在手机与电脑间一键同步世界书绑定、自定义分组与方案快照。</div>') +
    '</section>';
  }

  function renderBody(preserveFocusSearch) {
    if (state.loading) {
      elBody.innerHTML = '<div class="upp-empty">加载中…</div>';
      return;
    }
    const prevScroll = elBody.scrollTop;
    let searchSelStart = null;
    if (preserveFocusSearch) {
      const activeEl = shadow.activeElement;
      if (activeEl && activeEl.dataset?.searchInput) searchSelStart = activeEl.selectionStart;
    }

    if (state.view === 'edit_entry') elBody.innerHTML = renderEditEntryView();
    else if (state.view === 'preview') elBody.innerHTML = renderPreviewView();
    else if (state.view === 'presets') elBody.innerHTML = renderPresetsManageView();
    else if (state.view === 'settings') elBody.innerHTML = renderSettingsView();
    else elBody.innerHTML = renderPickerBody();

    elBody.scrollTop = prevScroll;
    if (preserveFocusSearch && searchSelStart !== null) {
      const input = shadow.querySelector('[data-search-input]');
      if (input) {
        input.focus();
        try { input.setSelectionRange(searchSelStart, searchSelStart); } catch (_) {}
      }
    }
  }

  function renderFooter() {
    const showFoot = state.view === 'picker' && state.config.books.length > 0;
    elFoot.style.display = showFoot ? '' : 'none';
    elTotal.textContent = '已选 ' + state.selected.size;
    elSaveBtn.disabled = state.loading || state.saving;
  }

  function renderAll() {
    renderHeader();
    renderTabs();
    renderPresetsBar();
    renderAlerts();
    renderBody(false);
    renderFooter();
  }

  async function refreshState() {
    elBackdrop.dataset.theme = detectHostTheme();
    state.loading = true;
    state.charName = readCurrentCharName();
    state.config = loadStoredConfig();
    renderAll();

    const [allBooks, globals] = await Promise.all([listHostWorldbooks(), listGlobalWorldbooks()]);
    if (dead) return;
    state.allHostBooks = allBooks;
    state.globalBooks = globals;

    if (!state.activeBook || !state.config.books.some(b => b.name === state.activeBook)) {
      state.activeBook = state.config.books[0]?.name || '';
    }

    const liveEntriesMap = await loadBoundWorldbooks(state.config, allBooks);
    if (dead) return;

    state.model = buildRuntimeModel(state.config, liveEntriesMap);
    const saved = parseSavedPicker(readChatPickerVar());
    const init = initSelection(saved, state.config, state.model.liveSets);
    state.selected = init.selected;
    state.stale = init.stale;
    state.loading = false;
    renderAll();
  }

  function openModal() {
    if (dead) return;
    elBackdrop.dataset.theme = detectHostTheme();
    state.open = true;
    state.view = 'picker';
    state.editMode = false;
    state.searchQuery = '';
    state.showNewForm = false;
    state.presetForm.open = false;
    state.newDraft = { shortName: '', relation: '', secret: '', title: '', content: '', group: '', slot: '', error: '', busy: false };
    elBackdrop.hidden = false;
    syncMenuExpanded();
    void refreshState();
  }

  function closeModal() {
    state.open = false;
    state.editMode = false;
    state.showNewForm = false;
    state.presetForm.open = false;
    elBackdrop.hidden = true;
    syncMenuExpanded();
  }

  function openEditEntry(book, title) {
    state.editEntryDraft = {
      book,
      oldTitle: title,
      title,
      group: state.config.catOverrides?.[book]?.[title] || '',
      slot: state.config.slotOverrides?.[book]?.[title] || '',
      content: state.model?.entryContentMap?.[book]?.[title] || '',
      error: '',
      busy: false,
    };
    state.view = 'edit_entry';
    renderAll();
  }

  async function handleQuickAddBook(name) {
    if (state.config.books.some(b => b.name === name)) return;
    const entries = await loadSingleWorldbook(name);
    const names = Array.isArray(entries) ? entries.map(e => e?.name).filter(Boolean) : [];
    const rec = detectRecommendedBookMode(names);
    state.config.books.push({
      name,
      label: name.replace(/^User[·:：_-]?/i, '') || name,
      mode: rec.mode,
      layout: rec.layout,
      preserveCatsOnReplace: [],
      catOrder: [],
    });
    saveStoredConfig(state.config);
    state.activeBook = name;
    await refreshState();
  }

  async function handleSave() {
    if (state.saving || state.loading) return;
    if (!hasActiveChat()) {
      notify('请先打开一个聊天再保存', 'warning');
      return;
    }
    state.saving = true;
    renderFooter();
    try {
      const payload = serializeSelection(state.selected, state.charName, state.config, state.model);
      await writeChatPickerVar(payload);
      state.stale = [];
      closeModal();
      notify(payload.wi.length > 0 ? '已保存 ' + payload.wi.length + ' 项' : '已清空保存', 'success');
    } catch (err) {
      notify('保存失败：' + (err?.message || String(err)), 'error');
    } finally {
      state.saving = false;
      renderFooter();
    }
  }

  async function handleSubmitNewEntry() {
    const bookCfg = currentBookCfg();
    if (!bookCfg) return;
    const d = state.newDraft;
    if (d.busy) return;

    const existingSet = state.model?.liveSets?.[bookCfg.name];
    if (existingSet === null) {
      d.error = '未找到世界书：' + bookCfg.name;
      renderBody(false);
      return;
    }

    const built = bookCfg.mode === 'if'
      ? formatNewIfEntry(state.charName, d.shortName, d.relation, d.secret, existingSet)
      : formatNewGenericEntry(d.title, d.content, existingSet);

    if (!built.ok) {
      d.error = built.error;
      renderBody(false);
      return;
    }

    d.busy = true;
    d.error = '';
    renderBody(false);
    try {
      await createEntryInBook(bookCfg.name, built.entry);
      const customGroup = String(d.group || '').trim();
      if (customGroup) {
        state.config.catOverrides[bookCfg.name] = state.config.catOverrides[bookCfg.name] || {};
        state.config.catOverrides[bookCfg.name][built.fullTitle] = customGroup;
      }
      if (d.slot === 'rule' || d.slot === 'depth1') {
        state.config.slotOverrides[bookCfg.name] = state.config.slotOverrides[bookCfg.name] || {};
        state.config.slotOverrides[bookCfg.name][built.fullTitle] = d.slot;
      }
      if (customGroup || d.slot) saveStoredConfig(state.config);

      state.selected.add(itemKey(bookCfg.name, built.fullTitle));
      state.showNewForm = false;
      state.newDraft = { shortName: '', relation: '', secret: '', title: '', content: '', group: '', slot: '', error: '', busy: false };
      notify('已创建并勾选：' + built.fullTitle, 'success');
      const liveEntriesMap = await loadBoundWorldbooks(state.config, state.allHostBooks);
      state.model = buildRuntimeModel(state.config, liveEntriesMap);
      renderAll();
    } catch (err) {
      d.busy = false;
      d.error = '写入失败：' + (err?.message || String(err));
      renderBody(false);
    }
  }

  async function handleSaveEditEntry() {
    const d = state.editEntryDraft;
    if (d.busy) return;
    const newTitle = String(d.title || '').trim();
    const newContent = String(d.content || '');
    if (!newTitle) { d.error = '标题不能为空'; renderBody(false); return; }
    const existingSet = state.model?.liveSets?.[d.book];
    if (newTitle !== d.oldTitle && existingSet && existingSet.has(newTitle)) {
      d.error = '同名条目已存在';
      renderBody(false);
      return;
    }
    d.busy = true;
    d.error = '';
    renderBody(false);
    try {
      await updateEntryInBook(d.book, d.oldTitle, newTitle, newContent);
      if (newTitle !== d.oldTitle) {
        const oldK = itemKey(d.book, d.oldTitle);
        if (state.selected.has(oldK)) {
          state.selected.delete(oldK);
          state.selected.add(itemKey(d.book, newTitle));
        }
        renameReferenceInConfig(state.config, d.book, d.oldTitle, newTitle);
      }

      const customGroup = String(d.group || '').trim();
      state.config.catOverrides[d.book] = state.config.catOverrides[d.book] || {};
      if (customGroup) state.config.catOverrides[d.book][newTitle] = customGroup;
      else delete state.config.catOverrides[d.book][newTitle];

      state.config.slotOverrides[d.book] = state.config.slotOverrides[d.book] || {};
      if (d.slot === 'rule' || d.slot === 'depth1') state.config.slotOverrides[d.book][newTitle] = d.slot;
      else delete state.config.slotOverrides[d.book][newTitle];

      saveStoredConfig(state.config);
      const liveEntriesMap = await loadBoundWorldbooks(state.config, state.allHostBooks);
      state.model = buildRuntimeModel(state.config, liveEntriesMap);
      state.view = 'picker';
      notify('已保存条目修改', 'success');
      renderAll();
    } catch (err) {
      d.busy = false;
      d.error = '保存失败：' + (err?.message || String(err));
      renderBody(false);
    }
  }

  function handleExportConfig() {
    const text = JSON.stringify(state.config, null, 2);
    const copyFn = getApi('builtin')?.value?.copyText;
    if (typeof copyFn === 'function') {
      try { copyFn(text); notify('配置 JSON 已复制到剪贴板', 'success'); return; } catch (_) {}
    }
    if (Env.pwin.navigator?.clipboard?.writeText) {
      Env.pwin.navigator.clipboard.writeText(text).then(
        () => notify('配置 JSON 已复制到剪贴板', 'success'),
        () => downloadConfigFile(text)
      );
      return;
    }
    downloadConfigFile(text);
  }

  function downloadConfigFile(text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Env.pdoc.createElement('a');
    a.href = url;
    a.download = 'user-persona-picker-config.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('已导出配置文件', 'success');
  }

  function applyImportedConfigText(text) {
    try {
      const parsed = JSON.parse(String(text || ''));
      state.config = normalizeConfig(parsed);
      saveStoredConfig(state.config);
      state.importDraft = { open: false, text: '', error: '' };
      state.view = 'picker';
      notify('配置导入成功', 'success');
      void refreshState();
    } catch (err) {
      state.importDraft.error = 'JSON 格式无效：' + (err?.message || String(err));
      renderBody(false);
    }
  }

  function pickImportFile() {
    const input = Env.pdoc.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => applyImportedConfigText(String(reader.result || ''));
      reader.readAsText(file, 'utf8');
    };
    input.click();
  }

  // =========================
  // Shadow DOM Event Handling
  // =========================

  listen(elBackdrop, 'click', ev => {
    if (ev.target === elBackdrop) closeModal();
  });

  listen(shadow, 'input', ev => {
    const el = ev.target;
    if (el?.dataset?.searchInput) {
      state.searchQuery = el.value;
      renderBody(true);
    } else if (el?.dataset?.newField) {
      state.newDraft[el.dataset.newField] = el.value;
      if (state.newDraft.error) { state.newDraft.error = ''; shadow.querySelector('.upp-form-error')?.remove(); }
    } else if (el?.dataset?.editField) {
      state.editEntryDraft[el.dataset.editField] = el.value;
      if (state.editEntryDraft.error) { state.editEntryDraft.error = ''; shadow.querySelector('.upp-form-error')?.remove(); }
    } else if (el?.dataset?.pfField) {
      state.presetForm[el.dataset.pfField] = el.value;
      if (el.dataset.pfField === 'mode') renderBody(false);
    } else if (el?.dataset?.importField) {
      state.importDraft[el.dataset.importField] = el.value;
    } else if (el?.dataset?.exField) {
      state.exDraft[el.dataset.exField] = el.value;
    }
  });

  listen(shadow, 'change', ev => {
    const el = ev.target;
    if (el?.dataset?.pfField) {
      state.presetForm[el.dataset.pfField] = el.value;
      if (el.dataset.pfField === 'mode') renderBody(false);
    } else if (el?.dataset?.newField) {
      state.newDraft[el.dataset.newField] = el.value;
    } else if (el?.dataset?.editField) {
      state.editEntryDraft[el.dataset.editField] = el.value;
    }
  });

  listen(shadow, 'click', ev => {
    const target = ev.target.closest('button');
    if (!target) return;

    const act = target.dataset.act;
    if (act === 'close') { closeModal(); return; }
    if (act === 'save') { void handleSave(); return; }
    if (act === 'clear') { state.selected = new Set(); renderAll(); return; }
    if (act === 'clear-stale') { state.stale = []; renderAlerts(); return; }
    if (act === 'clear-search') { state.searchQuery = ''; renderBody(true); return; }
    if (act === 'back-picker') { state.view = 'picker'; renderAll(); return; }

    if (act === 'toggle-edit-mode') { state.view = 'picker'; state.editMode = !state.editMode; renderAll(); return; }
    if (act === 'toggle-preview') { state.view = state.view === 'preview' ? 'picker' : 'preview'; renderAll(); return; }
    if (act === 'toggle-settings') { state.view = state.view === 'settings' ? 'picker' : 'settings'; renderAll(); return; }
    if (act === 'open-presets') { state.view = 'presets'; renderAll(); return; }
    if (act === 'toggle-layout') {
      const b = currentBookCfg();
      if (b) {
        b.layout = b.layout === 'list' ? 'chips' : 'list';
        saveStoredConfig(state.config);
        renderBody(false);
      }
      return;
    }

    if (act === 'create-starter-persona' || act === 'create-starter-blank') {
      void createStarterWorldbook(act === 'create-starter-persona').then(bookName => {
        notify('已创建世界书：' + bookName, 'success');
        return handleQuickAddBook(bookName);
      }).catch(err => notify('创建失败：' + (err?.message || String(err)), 'error'));
      return;
    }

    if (act === 'open-save-preset') {
      state.presetForm = {
        open: !state.presetForm.open,
        label: '',
        mode: 'replace_all',
        targetBook: currentBookCfg()?.name || '',
        error: '',
      };
      renderBody(false);
      return;
    }
    if (act === 'cancel-save-preset') { state.presetForm.open = false; renderBody(false); return; }
    if (act === 'confirm-save-preset') {
      const label = String(state.presetForm.label || '').trim();
      if (!label) { state.presetForm.error = '请填写方案名称'; renderBody(false); return; }
      const payload = serializeSelection(state.selected, state.charName, state.config, state.model);
      const items = state.presetForm.mode === 'replace_book' && state.presetForm.targetBook
        ? payload.wi.filter(it => it.book === state.presetForm.targetBook)
        : payload.wi;
      state.config.presets.push({
        id: 'p_' + Date.now().toString(36),
        label,
        mode: state.presetForm.mode,
        targetBook: state.presetForm.mode === 'replace_book' ? state.presetForm.targetBook : '',
        items: items.map(({ book, title }) => ({ book, title })),
      });
      saveStoredConfig(state.config);
      state.presetForm.open = false;
      notify('已保存方案：' + label, 'success');
      renderAll();
      return;
    }

    if (act === 'toggle-all-chars') { state.showAllChars = !state.showAllChars; renderBody(false); return; }
    if (act === 'toggle-new') { state.showNewForm = !state.showNewForm; state.newDraft.error = ''; renderBody(false); return; }
    if (act === 'cancel-new') { state.showNewForm = false; state.newDraft.error = ''; renderBody(false); return; }
    if (act === 'submit-new') { void handleSubmitNewEntry(); return; }
    if (act === 'save-edit-entry') { void handleSaveEditEntry(); return; }

    if (act === 'ensure-opening') {
      const name = state.config.openingBook || DEFAULT_OPENING_BOOK;
      void ensureOpeningWorldbook(name).then(() => {
        notify('已启用总控世界书：' + name, 'success');
        void refreshState();
      }).catch(err => notify('操作失败：' + (err?.message || String(err)), 'error'));
      return;
    }

    if (act === 'export-config') { handleExportConfig(); return; }
    if (act === 'toggle-import') { state.importDraft.open = !state.importDraft.open; state.importDraft.error = ''; renderBody(false); return; }
    if (act === 'pick-import-file') { pickImportFile(); return; }
    if (act === 'confirm-import') { applyImportedConfigText(state.importDraft.text); return; }

    if (act === 'add-ex') {
      const label = String(state.exDraft.label || '').trim();
      const items = String(state.exDraft.itemsText || '').split(/[,，/\n]+/).map(s => s.trim()).filter(Boolean);
      if (!label || items.length < 2) { state.exDraft.error = '请填写组名与至少 2 个条目标题'; renderBody(false); return; }
      state.config.exclusive.push({ id: 'ex_' + Date.now().toString(36), label, items });
      saveStoredConfig(state.config);
      state.exDraft = { label: '', itemsText: '', error: '' };
      renderBody(false);
      return;
    }

    if (target.dataset.quickAdd) {
      void handleQuickAddBook(target.dataset.quickAdd);
      return;
    }

    if (target.dataset.bookCycleMode !== undefined) {
      const idx = Number(target.dataset.bookCycleMode);
      const b = state.config.books[idx];
      if (b) {
        const order = ['flat', 'prefix', 'if'];
        b.mode = order[(order.indexOf(b.mode) + 1) % order.length];
        saveStoredConfig(state.config);
        void refreshState();
      }
      return;
    }

    if (target.dataset.bookRemove !== undefined) {
      const idx = Number(target.dataset.bookRemove);
      if (Number.isInteger(idx) && idx >= 0) {
        state.config.books.splice(idx, 1);
        saveStoredConfig(state.config);
        void refreshState();
      }
      return;
    }

    if (target.dataset.exDel !== undefined) {
      const idx = Number(target.dataset.exDel);
      if (Number.isInteger(idx) && idx >= 0) {
        state.config.exclusive.splice(idx, 1);
        saveStoredConfig(state.config);
        renderBody(false);
      }
      return;
    }

    if (target.dataset.presetDef) {
      const id = target.dataset.presetDef;
      state.config.defaultPresetId = state.config.defaultPresetId === id ? '' : id;
      saveStoredConfig(state.config);
      renderAll();
      return;
    }
    if (target.dataset.presetOverwrite) {
      const p = state.config.presets.find(x => x.id === target.dataset.presetOverwrite);
      if (p) {
        const payload = serializeSelection(state.selected, state.charName, state.config, state.model);
        const items = p.mode === 'replace_book' && p.targetBook
          ? payload.wi.filter(it => it.book === p.targetBook)
          : payload.wi;
        p.items = items.map(({ book, title }) => ({ book, title }));
        saveStoredConfig(state.config);
        notify('已更新方案：' + p.label, 'success');
        renderAll();
      }
      return;
    }
    if (target.dataset.presetDel) {
      const id = target.dataset.presetDel;
      state.config.presets = state.config.presets.filter(x => x.id !== id);
      if (state.config.defaultPresetId === id) state.config.defaultPresetId = '';
      saveStoredConfig(state.config);
      renderAll();
      return;
    }

    if (target.dataset.bookTab) {
      state.activeBook = target.dataset.bookTab;
      state.searchQuery = '';
      state.showNewForm = false;
      elBody.scrollTop = 0;
      renderTabs();
      renderBody(false);
      return;
    }

    if (target.dataset.preset) {
      const preset = (state.config.presets || []).find(p => p.id === target.dataset.preset);
      if (preset) {
        state.selected = applyPreset(state.selected, preset, state.config, state.model?.liveSets);
        renderAll();
      }
      return;
    }

    if (target.dataset.staleIdx !== undefined) {
      const idx = Number(target.dataset.staleIdx);
      if (Number.isInteger(idx) && idx >= 0 && idx < state.stale.length) {
        state.stale.splice(idx, 1);
        renderAlerts();
      }
      return;
    }

    if (target.dataset.expand) {
      const gid = target.dataset.expand;
      if (state.expandedGroups.has(gid)) state.expandedGroups.delete(gid);
      else state.expandedGroups.add(gid);
      renderBody(false);
      return;
    }

    if (target.dataset.editBook && target.dataset.editTitle) {
      openEditEntry(target.dataset.editBook, target.dataset.editTitle);
      return;
    }

    if (target.dataset.book && target.dataset.title) {
      const book = target.dataset.book;
      const title = target.dataset.title;
      if (state.editMode) {
        openEditEntry(book, title);
        return;
      }
      state.selected = toggleItem(state.selected, book, title, state.config);
      renderTabs();
      renderBody(false);
      renderFooter();
    }
  });

  listen(Env.pdoc, 'keydown', ev => {
    if (!state.open || ev.key !== 'Escape') return;
    ev.stopPropagation();
    if (state.view !== 'picker') { state.view = 'picker'; renderAll(); }
    else if (state.showNewForm || state.presetForm.open) { state.showNewForm = false; state.presetForm.open = false; renderBody(false); }
    else closeModal();
  });

  // =========================
  // Native Menu & Button Entry
  // =========================

  const menuEntry = Env.pdoc.createElement('div');
  menuEntry.id = MENU_ENTRY_ID;
  menuEntry.className = 'list-group-item flex-container flexGap5 interactable';
  menuEntry.setAttribute('role', 'button');
  menuEntry.tabIndex = 0;
  menuEntry.setAttribute('aria-label', '打开 User 人设点选');
  menuEntry.setAttribute('aria-controls', APP_ID);
  menuEntry.setAttribute('aria-expanded', 'false');
  menuEntry.title = 'User 人设点选';
  menuEntry.innerHTML =
    '<span class="extensionsMenuExtensionButton" aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>' +
        '<circle cx="12" cy="7" r="4"/>' +
      '</svg>' +
    '</span>' +
    '<span>User 人设点选</span>';

  function syncMenuExpanded() { menuEntry.setAttribute('aria-expanded', String(state.open)); }

  listen(menuEntry, 'click', ev => { ev.preventDefault(); if (state.open) closeModal(); else openModal(); });
  listen(menuEntry, 'keydown', ev => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (state.open) closeModal(); else openModal(); }
  });

  function mountExtensionMenu() {
    if (dead) return false;
    const menu = Env.pdoc.getElementById('extensionsMenu');
    if (!menu) return false;
    Env.pdoc.querySelectorAll('#' + MENU_ENTRY_ID).forEach(el => { if (el !== menuEntry) el.remove(); });
    if (menuEntry.parentElement !== menu) menu.append(menuEntry);
    return menuEntry.isConnected;
  }

  let menuSyncTimer = null;
  if (typeof Env.pwin.MutationObserver === 'function') {
    const observer = new Env.pwin.MutationObserver(() => {
      if (dead || menuSyncTimer) return;
      if (menuEntry.isConnected && menuEntry.parentElement?.id === 'extensionsMenu') return;
      menuSyncTimer = later(() => { menuSyncTimer = null; mountExtensionMenu(); }, 120);
    });
    observer.observe(Env.pdoc.documentElement, { childList: true, subtree: true });
    cleanup.push(() => observer.disconnect());
  }

  const eventOnFn = getFn('eventOn');
  const getBtnEvtFn = getFn('getButtonEvent');
  const tavernEvents = getApi('tavern_events')?.value;

  if (eventOnFn && getBtnEvtFn) {
    try {
      const btnSub = eventOnFn(getBtnEvtFn(BUTTON_NAME), () => { if (state.open) closeModal(); else openModal(); });
      if (btnSub && typeof btnSub.stop === 'function') cleanup.push(() => btnSub.stop());
    } catch (_) {}
  }

  if (eventOnFn && tavernEvents?.CHAT_CHANGED) {
    try {
      const chatSub = eventOnFn(tavernEvents.CHAT_CHANGED, () => { if (state.open) void refreshState(); });
      if (chatSub && typeof chatSub.stop === 'function') cleanup.push(() => chatSub.stop());
    } catch (_) {}
  }

  function dispose() {
    if (dead) return;
    dead = true;
    timers.forEach(id => Env.pwin.clearTimeout(id));
    timers.clear();
    cleanup.splice(0).forEach(fn => { try { fn(); } catch (_) {} });
    if (menuEntry.isConnected) menuEntry.remove();
    if (host.isConnected) host.remove();
  }

  listen(host, DISPOSE_EVENT, dispose);
  listen(window, 'pagehide', ev => { if (!ev.persisted) dispose(); });
  listen(window, 'unload', dispose);

  (Env.pdoc.body || Env.pdoc.documentElement).append(host);
  mountExtensionMenu();
})();
