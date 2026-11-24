;(function () {
  'use strict';

  const APP_VERSION = '4.0.0';
  const APP_ID = 'user-persona-picker-host';
  const MENU_ENTRY_ID = 'user-persona-picker-menu-entry';
  const DISPOSE_EVENT = 'user-persona-picker-dispose';
  const BUTTON_NAME = 'User人设';
  const VAR_KEY = 'user_picker';
  const LIB_BOOK = '__lib__';
  const OPENING_BOOK = 'User·总控入口';
  const STORE_KEY = 'userPersonaPicker.v4';
  const KEY_SEP = '\u0000';

  const BUILTIN_LIBRARY = [{"id":"look_cool","cat":"外貌气质","title":"清冷美人","content":"外貌气质偏清冷出尘，眉眼线条干净利落，神情自带几分疏离感，静下来时很有氛围感。"},{"id":"look_vivid","cat":"外貌气质","title":"浓颜明艳","content":"五官立体深邃、轮廓明艳夺目，眉眼有神，站在人群里第一眼就很抓人。"},{"id":"look_sweet","cat":"外貌气质","title":"邻家甜妹","content":"长相柔和讨喜，眉眼弯弯带笑意，整体气质亲近自然，让人很有保护欲。"},{"id":"look_fresh","cat":"外貌气质","title":"元气少女","content":"神态鲜活明快，笑容有感染力，举手投足带着轻盈的朝气。"},{"id":"look_boyish","cat":"外貌气质","title":"清俊少年感","content":"轮廓清爽利落，身材修长匀称，自带干净坦荡的少年气质。"},{"id":"look_long_straight","cat":"外貌气质","title":"黑长直","content":"留着一头顺滑乌黑的长直发，垂落肩背，衬得肤色更白皙。"},{"id":"look_long_wave","cat":"外貌气质","title":"长卷发","content":"留着蓬松柔顺的长卷发，发尾自然微卷，举动间带着柔和的慵懒感。"},{"id":"look_short","cat":"外貌气质","title":"利落短发","content":"留着干净利落的短发，修饰出清晰的下颌线与颈部线条，显得精气神十足。"},{"id":"char_gentle","cat":"性格特点","title":"温柔体贴","content":"性格温和细腻，懂得体谅他人情绪，说话轻声细语但心里有主见，不是一味迁就。"},{"id":"char_spoiled","cat":"性格特点","title":"娇气爱撒娇","content":"有点小娇气，面对亲近的人容易软声撒娇、求抱求哄，受了委屈会眼眶发红但很好哄。"},{"id":"char_tsundere","cat":"性格特点","title":"傲娇嘴硬","content":"嘴上总爱逞强拌嘴，其实心软护短，被夸或被直球撩到时容易耳根发红、别开视线。"},{"id":"char_calm","cat":"性格特点","title":"独立清醒","content":"情绪稳定、边界清晰，遇事冷静有判断力，不内耗也不轻易被言语牵着鼻子走。"},{"id":"char_cute_air","cat":"性格特点","title":"呆萌迷糊","content":"平时偶尔反应慢半拍、带点天然的迷糊感，但对自己在乎的事格外认真执着。"},{"id":"char_shy","cat":"性格特点","title":"社恐慢热","content":"面对陌生人拘谨话少、容易紧张，混熟之后才会卸下防备露出柔软或话痨的一面。"},{"id":"char_direct","cat":"性格特点","title":"活泼直球","content":"性格外向坦率，喜欢就直接表达，不藏着掖着，聊天节奏轻快自然。"},{"id":"char_scheming","cat":"性格特点","title":"腹黑绿茶","content":"表面无辜软糯、很会示弱拿捏分寸，心里却精明通透，擅长不动声色地引导局势。"},{"id":"char_aloof","cat":"性格特点","title":"高冷少言","content":"平时话不多、表情克制，不爱多余寒暄，只在真正在意的人面前展露细微偏爱。"},{"id":"char_chill","cat":"性格特点","title":"咸鱼摆烂","content":"随性松弛、能躺着绝不站着，对琐事佛系不卷，日常最在乎吃好睡好和舒服自在。"},{"id":"rel_stranger","cat":"关系阶段","title":"初见陌生","content":"与{{char}}刚认识不久，彼此保持礼貌与试探，尚未建立亲密信任。"},{"id":"rel_crush","cat":"关系阶段","title":"熟人暗恋","content":"与{{char}}原本相熟，关系里藏着未挑明的暗恋与在意，互动带着微妙的克制。"},{"id":"rel_ambiguous","cat":"关系阶段","title":"暧昧拉扯","content":"与{{char}}处于心照不宣的暧昧期，言语和肢体都在试探边界，尚未正式确认关系。"},{"id":"rel_dating","cat":"关系阶段","title":"热恋交往","content":"已与{{char}}正式确定恋爱关系，相处自然亲密，习惯彼此的陪伴与偏爱。"},{"id":"rel_bicker","cat":"关系阶段","title":"欢喜冤家","content":"与{{char}}平时爱互相斗嘴拆台，表面互不相让，关键时刻却最护着对方。"},{"id":"rel_reunion","cat":"关系阶段","title":"破镜重圆","content":"与{{char}}曾有过一段刻骨的过去，分开一段时间后再度重逢，旧情与心结交织。"},{"id":"rel_contract","cat":"关系阶段","title":"契约关系","content":"与{{char}}因某种约定或利益结成契约关系，台面上各取所需，私下界限却逐渐松动。"},{"id":"rel_married","cat":"关系阶段","title":"已婚同居","content":"已与{{char}}领证结婚并同居生活，熟悉彼此日常起居，兼具烟火气与亲密感。"},{"id":"bg_student","cat":"背景身份","title":"现代学生","content":"当前身份为在校大学生，日常围绕学业、校园生活与课余社交展开。"},{"id":"bg_office","cat":"背景身份","title":"现代职场","content":"当前已步入社会工作，经济独立，生活节奏带着都市职场的现实感。"},{"id":"bg_rich","cat":"背景身份","title":"豪门世家","content":"出身优渥的豪门家庭，教养良好、眼界开阔，行事低调但不缺底气。"},{"id":"bg_ancient","cat":"背景身份","title":"古风世家","content":"身处古代背景，出身书香或勋贵世家，言行举止合乎礼数而不失灵气。"},{"id":"bg_fantasy","cat":"背景身份","title":"西幻冒险者","content":"身处剑与魔法的奇幻世界，具备一定自保能力，游历于城镇与秘境之间。"},{"id":"bg_xianxia","cat":"背景身份","title":"修仙宗门","content":"身处修真世界，为宗门弟子，日常修行历练，重道心与机缘。"},{"id":"rule_no_godmod","cat":"互动规则","title":"禁止代写User言行","isRule":true,"content":"严格禁止替{{user}}描写对话、动作、心理活动或擅自替{{user}}做决定，所有反应留给{{user}}本人。"},{"id":"rule_agency","cat":"互动规则","title":"尊重User自主权","isRule":true,"content":"{{char}}不得无视{{user}}的拒绝或强行主导全部节奏，情节推进须给{{user}}留出回应空间。"},{"id":"rule_call","cat":"互动规则","title":"称呼自然少喊全名","isRule":true,"content":"关系亲近后称呼自然贴合语境，非严肃、生疏或生气场合不频繁生硬地连名带姓喊全名。"},{"id":"rule_ooc","cat":"互动规则","title":"保持角色本色","isRule":true,"content":"{{char}}始终保持自身原有性格与逻辑，不因配合{{user}}而突然变得谄媚或失去个性。"}];

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
    "  if (_it.title === '红线') continue;",
    '  let _c = "";',
    "  if (typeof _it.text === 'string' && _it.text.trim()) _c = _it.text;",
    '  else if (_it.book && _it.title) _c = await getwi(_it.book, _it.title);',
    '  if (!_c) continue;',
    "  if (_c.indexOf('[未找到') >= 0 || _c.indexOf('〔未找到') >= 0) continue;",
    '  if (_it.isRule || /^(写作约束|演绎准则)/.test(_it.title || "")) _rules.push(_c); else _body.push(_c);',
    '}',
    '_%><% if (_body.length) { %><USER人设>',
    '以下是 {{user}} 的设定，只属于 {{user}}，禁止混淆 {{user}} 与 {{char}}。',
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
    'let _hit = null;',
    "for (let _j = 0; _j < _l2.length; _j++) { if (_l2[_j] && _l2[_j].title === '红线') { _hit = _l2[_j]; break; } }",
    'let _red = "";',
    "if (_hit) { _red = _hit.text || (_hit.book ? await getwi(_hit.book, '红线') : ''); }",
    "const _redSafe = (_red && _red.indexOf('[未找到') < 0 && _red.indexOf('〔未找到') < 0) ? _red : '';",
    '_%><%- _redSafe %>',
  ].join('\n');

  // =========================
  // Pure Core (Testable)
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

  function matchesChar(title, currentChar) {
    const c = sanitizeCharName(currentChar);
    if (!c) return false;
    const bracket = parseBracketTitle(title);
    if (bracket) {
      const t = normalizeName(bracket.tag);
      if (!t || t === '通用' || t === '模板') return false;
      if (t === c) return true;
      const tb = stripTrailingDigits(t);
      const cb = stripTrailingDigits(c);
      if (tb && cb && tb === cb) return true;
      if (tb.length >= 2 && cb.length >= 2 && (cb.startsWith(tb) || tb.startsWith(cb))) return true;
      return false;
    }
    const nt = normalizeName(title);
    const cb = stripTrailingDigits(c);
    return nt.includes(c) || (cb.length >= 2 && nt.includes(cb));
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

  function createDefaultStore() {
    return {
      v: 4,
      targetMode: 'persona', // 'persona' | 'chat'
      defaultPresetId: '',
      recentBooks: [],
      customEntries: [], // [{ id, title, content, isRule? }]
      builtinEdits: {}, // { [title]: content }
      presets: [], // [{ id, label, items: [{ book, title }] }]
      lastPersonaItems: [], // [{ book, title }]
    };
  }

  function normalizeStore(raw) {
    const base = createDefaultStore();
    if (!raw || typeof raw !== 'object') return base;
    if (raw.targetMode === 'chat' || raw.targetMode === 'persona') base.targetMode = raw.targetMode;
    if (typeof raw.defaultPresetId === 'string') base.defaultPresetId = raw.defaultPresetId;
    if (Array.isArray(raw.recentBooks)) {
      base.recentBooks = [...new Set(raw.recentBooks.filter(x => typeof x === 'string' && x.trim()))].slice(0, 12);
    }
    if (Array.isArray(raw.customEntries)) {
      const seen = new Set();
      for (const e of raw.customEntries) {
        if (!e || typeof e.title !== 'string' || !e.title.trim()) continue;
        const title = e.title.trim();
        if (seen.has(title)) continue;
        seen.add(title);
        base.customEntries.push({
          id: typeof e.id === 'string' && e.id ? e.id : 'c_' + Date.now().toString(36) + '_' + seen.size,
          title,
          content: typeof e.content === 'string' ? e.content : '',
          isRule: Boolean(e.isRule),
        });
      }
    }
    if (raw.builtinEdits && typeof raw.builtinEdits === 'object') {
      for (const [k, v] of Object.entries(raw.builtinEdits)) {
        if (typeof k === 'string' && typeof v === 'string') base.builtinEdits[k] = v;
      }
    }
    if (Array.isArray(raw.presets)) {
      for (let i = 0; i < raw.presets.length; i++) {
        const p = raw.presets[i];
        if (!p || typeof p !== 'object' || !Array.isArray(p.items)) continue;
        const items = p.items
          .filter(it => it && typeof it.book === 'string' && typeof it.title === 'string' && it.book && it.title)
          .map(it => ({ book: it.book, title: it.title }));
        base.presets.push({
          id: typeof p.id === 'string' && p.id ? p.id : 'p_' + Date.now().toString(36) + '_' + i,
          label: typeof p.label === 'string' && p.label.trim() ? p.label.trim() : '方案 ' + (i + 1),
          items,
        });
      }
    }
    if (Array.isArray(raw.lastPersonaItems)) {
      base.lastPersonaItems = raw.lastPersonaItems
        .filter(it => it && typeof it.book === 'string' && typeof it.title === 'string' && it.book && it.title)
        .map(it => ({ book: it.book, title: it.title }));
    }
    return base;
  }

  function getLibraryGroups(store) {
    const map = new Map();
    for (const item of BUILTIN_LIBRARY) {
      const content = Object.prototype.hasOwnProperty.call(store.builtinEdits, item.title)
        ? store.builtinEdits[item.title]
        : item.content;
      if (!map.has(item.cat)) map.set(item.cat, []);
      map.get(item.cat).push({
        book: LIB_BOOK,
        title: item.title,
        content,
        isRule: Boolean(item.isRule),
        isCustom: false,
      });
    }
    const groups = [...map.entries()].map(([cat, items]) => ({ cat, items }));
    groups.push({
      cat: '我的自定义',
      isCustomGroup: true,
      items: (store.customEntries || []).map(e => ({
        book: LIB_BOOK,
        title: e.title,
        content: e.content,
        isRule: Boolean(e.isRule),
        isCustom: true,
      })),
    });
    return groups;
  }

  function findLibraryEntry(store, title) {
    for (const e of store.customEntries || []) {
      if (e.title === title) return { title: e.title, content: e.content, isRule: Boolean(e.isRule), isCustom: true };
    }
    for (const item of BUILTIN_LIBRARY) {
      if (item.title === title) {
        const content = Object.prototype.hasOwnProperty.call(store.builtinEdits, item.title)
          ? store.builtinEdits[item.title]
          : item.content;
        return { title: item.title, content, isRule: Boolean(item.isRule), isCustom: false };
      }
    }
    return null;
  }

  // Automatic smart grouping for any user worldbook without forcing any naming rule
  function organizeWorldbookEntries(entries, currentChar, showAllChars, query) {
    const q = normalizeName(query).toLocaleLowerCase();
    const list = (entries || [])
      .filter(e => e && typeof e.name === 'string' && e.name.trim())
      .filter(e => {
        if (!q) return true;
        const nameHit = normalizeName(e.name).toLocaleLowerCase().includes(q);
        const bodyHit = normalizeName(e.content || '').toLocaleLowerCase().includes(q);
        return nameHit || bodyHit;
      });

    // Check if this book is a character-IF book (>= 40% entries use 【...】 or [...] brackets)
    const bracketCount = list.filter(e => Boolean(parseBracketTitle(e.name))).length;
    if (list.length >= 3 && bracketCount / list.length >= 0.4) {
      const current = [];
      const common = [];
      const others = [];
      for (const e of list) {
        const b = parseBracketTitle(e.name);
        if (b && b.tag === '模板') continue;
        if (matchesChar(e.name, currentChar)) current.push(e);
        else if ((b && b.tag === '通用') || /^通用[·\-\s_:：/]/.test(e.name)) common.push(e);
        else others.push(e);
      }
      const sections = [];
      if (current.length) sections.push({ cat: sanitizeCharName(currentChar) || '当前角色', stripBracket: true, items: current });
      if (common.length) sections.push({ cat: '通用', stripBracket: true, items: common });
      if (showAllChars && others.length) sections.push({ cat: '其他角色', stripBracket: false, items: others });
      return { kind: 'if', hasHiddenOthers: !showAllChars && others.length > 0, hiddenCount: others.length, sections };
    }

    // Check if this book naturally uses "前缀·名称" (>= 4 entries sharing repeated · prefixes)
    const prefixCounts = new Map();
    for (const e of list) {
      const m = e.name.match(/^([^·]{1,10})·(.+)$/);
      if (m) prefixCounts.set(m[1].trim(), (prefixCounts.get(m[1].trim()) || 0) + 1);
    }
    let groupedHits = 0;
    for (const c of prefixCounts.values()) if (c >= 2) groupedHits += c;

    if (groupedHits >= 4) {
      const buckets = new Map();
      for (const e of list) {
        const m = e.name.match(/^([^·]{1,10})·(.+)$/);
        const cat = (m && (prefixCounts.get(m[1].trim()) || 0) >= 2) ? m[1].trim() : '其他';
        if (!buckets.has(cat)) buckets.set(cat, []);
        buckets.get(cat).push(e);
      }
      const sections = [];
      for (const [cat, items] of buckets.entries()) {
        if (cat !== '其他') sections.push({ cat, stripPrefix: true, items });
      }
      if (buckets.has('其他')) sections.push({ cat: '其他', stripPrefix: false, items: buckets.get('其他') });
      return { kind: 'prefix', hasHiddenOthers: false, hiddenCount: 0, sections };
    }

    // Default: clean flat list in original worldbook order!
    return { kind: 'flat', hasHiddenOthers: false, hiddenCount: 0, sections: list.length ? [{ cat: '', stripPrefix: false, items: list }] : [] };
  }

  function displayEntryLabel(name, section) {
    if (section?.stripBracket) {
      const b = parseBracketTitle(name);
      if (b && b.shortTitle) return b.shortTitle;
    }
    if (section?.stripPrefix && section.cat && name.startsWith(section.cat + '·')) {
      const s = name.slice(section.cat.length + 1).trim();
      if (s) return s;
    }
    return name;
  }

  function assembleOutput(selectedSet, store, wbContentMap) {
    const body = [];
    const rules = [];
    const redlines = [];
    const wiPayload = [];

    for (const k of selectedSet) {
      const { book, title } = parseKey(k);
      if (!book || !title) continue;
      if (book === LIB_BOOK) {
        const entry = findLibraryEntry(store, title);
        if (!entry) continue;
        const text = String(entry.content || '').trim();
        if (!text) continue;
        wiPayload.push({ book: LIB_BOOK, title, text, isRule: entry.isRule });
        if (entry.isRule) rules.push(text);
        else body.push(text);
      } else {
        const text = String(wbContentMap?.[book]?.[title] || '').trim();
        wiPayload.push({ book, title });
        if (!text) continue;
        if (title === '红线') redlines.push(text);
        else if (/^(写作约束|演绎准则)/.test(title)) rules.push(text);
        else body.push(text);
      }
    }

    const blocks = [];
    if (body.length) blocks.push('<USER人设>\n' + body.join('\n\n') + '\n</USER人设>');
    if (rules.length) blocks.push('<USER写作规则>\n' + rules.join('\n\n') + '\n</USER写作规则>');
    if (redlines.length) blocks.push('<USER红线>\n' + redlines.join('\n\n') + '\n</USER红线>');

    return {
      text: blocks.join('\n\n'),
      wi: wiPayload,
      count: wiPayload.length,
    };
  }

  // Safely merge managed <USER人设>/<USER写作规则>/<USER红线> blocks into existing Persona description
  function mergeIntoPersonaDescription(existingDesc, generatedBlock) {
    const cleaned = String(existingDesc || '')
      .replace(/\n*<USER人设>[\s\S]*?<\/USER人设>/g, '')
      .replace(/\n*<USER写作规则>[\s\S]*?<\/USER写作规则>/g, '')
      .replace(/\n*<USER红线>[\s\S]*?<\/USER红线>/g, '')
      .trim();
    const block = String(generatedBlock || '').trim();
    if (!block) return cleaned;
    if (!cleaned) return block;
    return cleaned + '\n\n' + block;
  }

  function parseSavedChatPicker(raw) {
    let obj = raw;
    if (typeof obj === 'string') {
      try { obj = JSON.parse(obj); } catch (_) { obj = null; }
    }
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.wi)) {
      return { hasSaved: false, items: [] };
    }
    const items = [];
    const seen = new Set();
    for (const it of obj.wi) {
      if (!it || typeof it !== 'object') continue;
      const book = typeof it.book === 'string' && it.book ? it.book : (typeof it.text === 'string' ? LIB_BOOK : '');
      const title = typeof it.title === 'string' ? it.title : '';
      if (!book || !title) continue;
      const k = itemKey(book, title);
      if (seen.has(k)) continue;
      seen.add(k);
      items.push({ book, title });
    }
    return { hasSaved: true, items };
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
      recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
      effect: { sticky: null, cooldown: null, delay: null },
    };
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
        position: { type: 'after_character_definition', role: 'system', depth: 4, order: 0 },
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
        position: { type: 'at_depth', role: 'system', depth: 1, order: 1 },
        probability: 100,
        recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
        effect: { sticky: null, cooldown: null, delay: null },
      },
    ];
  }

  const Core = {
    APP_VERSION,
    LIB_BOOK,
    BUILTIN_LIBRARY,
    itemKey,
    parseKey,
    normalizeName,
    sanitizeCharName,
    matchesChar,
    inferThemeFromTextColor,
    createDefaultStore,
    normalizeStore,
    getLibraryGroups,
    findLibraryEntry,
    organizeWorldbookEntries,
    displayEntryLabel,
    assembleOutput,
    mergeIntoPersonaDescription,
    parseSavedChatPicker,
    buildWorldbookEntry,
    buildOpeningWorldbookEntries,
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
      if (window.parent && window.parent.document) { pwin = window.parent; pdoc = pwin.document; }
    } catch (_) {}
    return { win: window, pwin, pdoc };
  })();

  function getApi(name) {
    const owners = [window, globalThis, Env.pwin, window.TavernHelper, Env.pwin.TavernHelper, window.SillyTavern, Env.pwin.SillyTavern];
    for (const owner of owners) {
      try { if (owner && owner[name] != null) return { value: owner[name], owner }; } catch (_) {}
    }
    return null;
  }

  function getFn(name) {
    const api = getApi(name);
    return api && typeof api.value === 'function' ? api.value.bind(api.owner) : null;
  }

  function getStContext() {
    try { return getApi('SillyTavern')?.value?.getContext?.() || null; } catch (_) { return null; }
  }

  function notify(msg, type) {
    const t = Env.pwin.toastr || window.toastr;
    const level = type || 'info';
    if (t && typeof t[level] === 'function') {
      try { t[level](msg); return; } catch (_) {}
    }
    console.log('[User人设]', msg);
  }

  function loadStore() {
    try {
      const raw = Env.pwin.localStorage?.getItem(STORE_KEY);
      if (raw) return normalizeStore(JSON.parse(raw));
    } catch (_) {}
    return createDefaultStore();
  }

  function saveStore(store) {
    try { Env.pwin.localStorage?.setItem(STORE_KEY, JSON.stringify(store)); } catch (_) {}
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
    if (ctx && (ctx.characterId === undefined || ctx.characterId === null) && !ctx.groupId) return '';
    const fn = getFn('getCurrentCharacterName');
    if (fn) {
      try { const n = sanitizeCharName(fn()); if (n) return n; } catch (_) {}
    }
    if (ctx && ctx.characterId != null && typeof ctx.name2 === 'string') return sanitizeCharName(ctx.name2);
    return '';
  }

  function hasActiveChat() {
    const ctx = getStContext();
    if (!ctx) return true;
    return Boolean(ctx.chatId || ctx.groupId || ctx.characterId != null);
  }

  function readChatPickerVar() {
    const fn = getFn('getVariables');
    if (fn) {
      try { const v = fn({ type: 'chat' }); if (v && typeof v === 'object') return v[VAR_KEY]; } catch (_) {}
    }
    return getStContext()?.chatMetadata?.variables?.[VAR_KEY];
  }

  async function writeChatPickerVar(payload) {
    const insertFn = getFn('insertOrAssignVariables');
    if (insertFn) {
      await Promise.resolve(insertFn({ [VAR_KEY]: payload }, { type: 'chat' }));
      return;
    }
    const updateFn = getFn('updateVariablesWith');
    if (updateFn) {
      await Promise.resolve(updateFn(vars => ({ ...(vars || {}), [VAR_KEY]: payload }), { type: 'chat' }));
      return;
    }
    throw new Error('未找到聊天变量接口');
  }

  async function writeToCurrentPersona(generatedBlock) {
    const getP = getFn('getPersona');
    const replaceP = getFn('replacePersona');
    if (!getP || !replaceP) throw new Error('当前酒馆助手版本不支持直接写入用户人设');
    const current = getP('current');
    if (!current) throw new Error('未找到当前启用的用户人设');
    const nextDesc = mergeIntoPersonaDescription(current.description, generatedBlock);
    await Promise.resolve(replaceP('current', { description: nextDesc }, { render: 'immediate' }));
    return current.name || '当前人设';
  }

  async function listHostWorldbooks() {
    const fn = getFn('getWorldbookNames');
    if (!fn) return [];
    try {
      const names = await Promise.resolve(fn());
      return Array.isArray(names) ? names.filter(n => typeof n === 'string' && n && n !== OPENING_BOOK) : [];
    } catch (_) {
      return [];
    }
  }

  async function loadWorldbookEntries(bookName) {
    const fn = getFn('getWorldbook');
    if (!fn) return [];
    try {
      const entries = await Promise.resolve(fn(bookName));
      return Array.isArray(entries) ? entries : [];
    } catch (_) {
      return [];
    }
  }

  async function ensureOpeningBookSilent() {
    const namesFn = getFn('getWorldbookNames');
    const createFn = getFn('createWorldbook');
    const globalFn = getFn('getGlobalWorldbookNames');
    const rebindFn = getFn('rebindGlobalWorldbooks');
    if (!namesFn || !createFn || !globalFn || !rebindFn) return;
    try {
      const all = await Promise.resolve(namesFn());
      if (Array.isArray(all) && !all.includes(OPENING_BOOK)) {
        await Promise.resolve(createFn(OPENING_BOOK, buildOpeningWorldbookEntries()));
      }
      const globals = await Promise.resolve(globalFn());
      if (Array.isArray(globals) && !globals.includes(OPENING_BOOK)) {
        await Promise.resolve(rebindFn([...globals, OPENING_BOOK]));
      }
    } catch (err) {
      console.warn('[User人设] 自动启用总控世界书跳过', err);
    }
  }

  async function createEntryInWorldbook(bookName, entry) {
    const fn = getFn('createWorldbookEntries');
    if (!fn) throw new Error('缺少写入世界书接口');
    await Promise.resolve(fn(bookName, [entry], { render: 'debounced' }));
  }

  async function updateEntryInWorldbook(bookName, oldTitle, newTitle, newContent) {
    const fn = getFn('updateWorldbookWith');
    if (!fn) throw new Error('缺少更新世界书接口');
    await Promise.resolve(fn(bookName, entries => entries.map(e => (e && e.name === oldTitle ? { ...e, name: newTitle, content: newContent } : e)), { render: 'debounced' }));
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
    const id = Env.pwin.setTimeout(() => { timers.delete(id); if (!dead) fn(); }, ms);
    timers.add(id);
    return id;
  }

  function listen(target, eventName, handler, options) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(eventName, handler, options);
    cleanup.push(() => { try { target.removeEventListener(eventName, handler, options); } catch (_) {} });
  }

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  // =========================
  // Adaptive iOS Liquid Glass UI
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
      --upp-shell-bg: linear-gradient(165deg, rgba(255, 255, 255, 0.92) 0%, rgba(244, 247, 252, 0.88) 100%);
      --upp-shell-border: rgba(255, 255, 255, 0.88);
      --upp-shell-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.96), 0 24px 64px rgba(15, 23, 42, 0.18), 0 4px 16px rgba(15, 23, 42, 0.06);
      --upp-divider: rgba(27, 30, 40, 0.07);
      --upp-card-bg: rgba(255, 255, 255, 0.66);
      --upp-card-border: rgba(255, 255, 255, 0.86);
      --upp-card-shadow: 0 2px 10px rgba(15, 23, 42, 0.03), inset 0 1px 0 rgba(255, 255, 255, 0.90);
      --upp-tx: #1b1e28;
      --upp-tx2: rgba(27, 30, 40, 0.60);
      --upp-tx3: rgba(27, 30, 40, 0.44);
      --upp-track-bg: rgba(27, 30, 40, 0.055);
      --upp-seg-active-bg: #ffffff;
      --upp-seg-active-shadow: 0 2px 8px rgba(15, 23, 42, 0.09), 0 0.5px 1px rgba(15, 23, 42, 0.05);
      --upp-chip-bg: rgba(255, 255, 255, 0.86);
      --upp-chip-hover: #ffffff;
      --upp-chip-border: rgba(27, 30, 40, 0.09);
      --upp-chip-tx: #262b38;
      --upp-accent: #3a7bd5;
      --upp-accent-bg: rgba(58, 123, 213, 0.13);
      --upp-accent-border: rgba(58, 123, 213, 0.45);
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
      --upp-foot-bg: rgba(255, 255, 255, 0.62);
      --upp-input-bg: rgba(255, 255, 255, 0.90);
      --upp-input-border: rgba(27, 30, 40, 0.13);
      --upp-danger-tx: #b52b2b;
      --upp-scroll: rgba(27, 30, 40, 0.16);
      --upp-handle: rgba(27, 30, 40, 0.16);
    }

    .upp-backdrop[data-theme="dark"] {
      --upp-veil: rgba(6, 8, 14, 0.62);
      --upp-shell-bg: linear-gradient(165deg, rgba(28, 31, 41, 0.92) 0%, rgba(20, 22, 30, 0.94) 100%);
      --upp-shell-border: rgba(255, 255, 255, 0.13);
      --upp-shell-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 24px 64px rgba(0, 0, 0, 0.52);
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
      --upp-danger-tx: #fbb8b8;
      --upp-scroll: rgba(255, 255, 255, 0.16);
      --upp-handle: rgba(255, 255, 255, 0.22);
    }

    @keyframes upp-fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes upp-pop-in { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
    @keyframes upp-sheet-up { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: translateY(0); } }

    .upp-backdrop {
      position: fixed; inset: 0; z-index: 2147483000;
      background: var(--upp-veil); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center; padding: 18px;
      color: var(--upp-tx); animation: upp-fade-in 0.18s var(--upp-ease);
    }
    .upp-backdrop[hidden] { display: none; }

    .upp-modal {
      width: 100%; max-width: 560px; max-height: 85dvh;
      background: var(--upp-shell-bg); backdrop-filter: blur(28px) saturate(185%); -webkit-backdrop-filter: blur(28px) saturate(185%);
      color: var(--upp-tx); border: 1px solid var(--upp-shell-border); border-radius: 22px;
      box-shadow: var(--upp-shell-shadow); display: flex; flex-direction: column; overflow: hidden;
      animation: upp-pop-in 0.22s var(--upp-ease);
    }

    .upp-grab { display: none; width: 36px; height: 4px; border-radius: 999px; background: var(--upp-handle); margin: 8px auto 0; flex-shrink: 0; }

    .upp-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 16px 10px; flex-shrink: 0; }
    .upp-head-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .upp-title { font-size: 16px; font-weight: 600; color: var(--upp-tx); white-space: nowrap; }
    .upp-char-tag {
      font-size: 12px; font-weight: 500; line-height: 1; padding: 5px 10px; border-radius: 999px;
      background: var(--upp-badge-bg); color: var(--upp-badge-tx);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;
    }
    .upp-char-tag[hidden] { display: none; }

    .upp-close-btn {
      width: 30px; height: 30px; border-radius: 999px;
      border: 1px solid var(--upp-btn-border); background: var(--upp-btn-bg); color: var(--upp-tx2);
      font-size: 17px; line-height: 1; display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; flex-shrink: 0;
    }
    .upp-close-btn:hover { background: var(--upp-btn-hover); color: var(--upp-tx); }

    .upp-tabs-wrap { padding: 0 16px 10px; flex-shrink: 0; border-bottom: 1px solid var(--upp-divider); }
    .upp-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; padding: 3px; border-radius: 13px; background: var(--upp-track-bg); }
    .upp-tab {
      height: 33px; border-radius: 10px; border: none; background: transparent; color: var(--upp-tx2);
      font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
      cursor: pointer; white-space: nowrap;
      transition: background 0.16s var(--upp-ease), color 0.16s ease, box-shadow 0.16s var(--upp-ease);
    }
    .upp-tab:hover { color: var(--upp-tx); }
    .upp-tab.is-active { background: var(--upp-seg-active-bg); color: var(--upp-tx); font-weight: 600; box-shadow: var(--upp-seg-active-shadow); }
    .upp-tab-count { font-size: 11px; font-weight: 600; line-height: 1; padding: 2px 6px; border-radius: 999px; background: var(--upp-badge-bg); color: var(--upp-badge-tx); }

    .upp-body {
      flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
      padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 10px;
      scrollbar-width: thin; scrollbar-color: var(--upp-scroll) transparent;
    }
    .upp-body::-webkit-scrollbar { width: 5px; }
    .upp-body::-webkit-scrollbar-track { background: transparent; }
    .upp-body::-webkit-scrollbar-thumb { background: var(--upp-scroll); border-radius: 999px; }

    .upp-books-strip { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
    .upp-books-strip::-webkit-scrollbar { display: none; }
    .upp-book-pill {
      height: 31px; padding: 0 12px; border-radius: 999px; flex-shrink: 0;
      border: 1px solid var(--upp-chip-border); background: var(--upp-chip-bg); color: var(--upp-tx2);
      font-size: 12px; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
    }
    .upp-book-pill.is-active { background: var(--upp-accent-bg); border-color: var(--upp-accent-border); color: var(--upp-accent-tx); font-weight: 600; }

    .upp-search-input {
      width: 100%; height: 34px; border-radius: 11px;
      border: 1px solid var(--upp-input-border); background: var(--upp-input-bg); color: var(--upp-tx);
      padding: 0 12px; font: inherit; font-size: 13px; outline: none;
    }
    .upp-search-input::placeholder { color: var(--upp-tx3); }
    .upp-search-input:focus { border-color: var(--upp-accent-border); box-shadow: 0 0 0 3px var(--upp-accent-bg); }

    .upp-group {
      background: var(--upp-card-bg); border: 1px solid var(--upp-card-border);
      box-shadow: var(--upp-card-shadow); border-radius: 15px; padding: 11px 12px;
      display: flex; flex-direction: column; gap: 9px;
    }
    .upp-group-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .upp-group-title { font-size: 13px; font-weight: 600; color: var(--upp-tx); display: inline-flex; align-items: center; gap: 6px; }
    .upp-group-badge { font-size: 11px; font-weight: 600; color: var(--upp-badge-tx); background: var(--upp-badge-bg); border-radius: 999px; padding: 1px 7px; }

    .upp-chips { display: flex; flex-wrap: wrap; gap: 7px; }
    .upp-chip {
      min-height: 34px; padding: 6px 12px; border-radius: 10px;
      border: 1px solid var(--upp-chip-border); background: var(--upp-chip-bg); color: var(--upp-chip-tx);
      font-size: 13px; line-height: 1.25; cursor: pointer;
      display: inline-flex; align-items: center; gap: 6px; text-align: left; word-break: break-word;
      transition: background 0.14s var(--upp-ease), border-color 0.14s ease, color 0.14s ease, transform 0.10s ease;
    }
    .upp-chip:hover { background: var(--upp-chip-hover); }
    .upp-chip:active { transform: scale(0.97); }
    .upp-chip.is-selected { background: var(--upp-accent-bg); border-color: var(--upp-accent-border); color: var(--upp-accent-tx); font-weight: 500; }
    .upp-chip.is-selected::before { content: ""; width: 6px; height: 6px; border-radius: 999px; background: var(--upp-accent); flex-shrink: 0; }
    .upp-chip.is-editing { border-style: dashed; }

    .upp-mini-btn {
      height: 26px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--upp-btn-border);
      background: var(--upp-btn-bg); color: var(--upp-tx2); font-size: 12px; font-weight: 500;
      display: inline-flex; align-items: center; justify-content: center; cursor: pointer; white-space: nowrap;
    }
    .upp-mini-btn:hover { background: var(--upp-btn-hover); color: var(--upp-tx); }
    .upp-mini-btn.is-active { background: var(--upp-accent-bg); border-color: var(--upp-accent-border); color: var(--upp-accent-tx); }
    .upp-mini-btn.is-danger { color: var(--upp-danger-tx); }

    .upp-subbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .upp-subbar-hint { font-size: 12px; color: var(--upp-tx3); }
    .upp-subbar-actions { display: flex; align-items: center; gap: 6px; }

    .upp-inline-save { display: flex; gap: 7px; }
    .upp-input, .upp-textarea {
      width: 100%; border: 1px solid var(--upp-input-border); background: var(--upp-input-bg); color: var(--upp-tx);
      border-radius: 10px; padding: 8px 11px; font: inherit; font-size: 13px; outline: none;
    }
    .upp-input::placeholder, .upp-textarea::placeholder { color: var(--upp-tx3); }
    .upp-input:focus, .upp-textarea:focus { border-color: var(--upp-accent-border); box-shadow: 0 0 0 3px var(--upp-accent-bg); }
    .upp-textarea { resize: vertical; min-height: 84px; line-height: 1.5; }
    .upp-textarea.is-tall { min-height: 150px; }

    .upp-form {
      background: var(--upp-card-bg); border: 1px solid var(--upp-card-border);
      box-shadow: var(--upp-card-shadow); border-radius: 15px; padding: 13px;
      display: flex; flex-direction: column; gap: 9px;
    }
    .upp-form-error { font-size: 12px; color: var(--upp-danger-tx); }
    .upp-form-actions { display: flex; justify-content: flex-end; gap: 8px; }

    .upp-row-list { display: flex; flex-direction: column; gap: 7px; }
    .upp-row-item {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 9px 11px; border-radius: 12px; border: 1px solid var(--upp-chip-border); background: var(--upp-chip-bg);
    }
    .upp-row-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto; }
    .upp-star-btn {
      width: 26px; height: 26px; border-radius: 999px; border: none; background: transparent;
      color: var(--upp-tx3); font-size: 15px; cursor: pointer; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .upp-star-btn.is-default { color: #e2a024; }
    .upp-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .upp-row-title { font-size: 13px; font-weight: 500; color: var(--upp-tx); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .upp-row-sub { font-size: 11px; color: var(--upp-tx3); }
    .upp-row-btns { display: flex; align-items: center; gap: 5px; flex-shrink: 0; }

    .upp-preview-pre {
      margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.55;
      color: var(--upp-tx); background: var(--upp-input-bg); border: 1px solid var(--upp-input-border);
      border-radius: 12px; padding: 12px; max-height: 50dvh; overflow-y: auto;
    }

    .upp-empty { font-size: 12px; color: var(--upp-tx3); padding: 4px 0; }

    .upp-foot {
      display: flex; flex-direction: column; gap: 9px;
      padding: 10px 16px 12px; border-top: 1px solid var(--upp-divider); background: var(--upp-foot-bg); flex-shrink: 0;
    }
    .upp-mode-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .upp-mode-label { font-size: 12px; color: var(--upp-tx2); white-space: nowrap; }
    .upp-mode-seg { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; padding: 3px; border-radius: 10px; background: var(--upp-track-bg); }
    .upp-mode-btn {
      height: 26px; padding: 0 11px; border-radius: 8px; border: none; background: transparent;
      color: var(--upp-tx2); font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap;
    }
    .upp-mode-btn.is-active { background: var(--upp-seg-active-bg); color: var(--upp-tx); font-weight: 600; box-shadow: var(--upp-seg-active-shadow); }

    .upp-action-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .upp-action-left, .upp-action-right { display: flex; align-items: center; gap: 8px; }
    .upp-total { font-size: 12px; font-weight: 500; color: var(--upp-tx2); white-space: nowrap; }

    .upp-btn {
      height: 36px; min-width: 68px; padding: 0 14px; border-radius: 999px;
      border: 1px solid var(--upp-btn-border); background: var(--upp-btn-bg); color: var(--upp-btn-tx);
      font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; white-space: nowrap;
    }
    .upp-btn:hover { background: var(--upp-btn-hover); }
    .upp-btn:disabled { opacity: 0.52; cursor: not-allowed; }
    .upp-btn-primary { background: var(--upp-primary-bg); border-color: transparent; color: #ffffff; font-weight: 600; box-shadow: var(--upp-primary-shadow); }
    .upp-btn-primary:hover { background: var(--upp-primary-hover); }

    @media (max-width: 640px) {
      .upp-backdrop { padding: 0; align-items: flex-end; }
      .upp-modal { max-width: 100%; max-height: 88dvh; border-radius: 24px 24px 0 0; border-left: none; border-right: none; border-bottom: none; animation: upp-sheet-up 0.24s var(--upp-ease); }
      .upp-grab { display: block; }
      .upp-head { padding: 10px 16px 8px; }
      .upp-foot { padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px)); }
      .upp-chip { min-height: 36px; padding: 7px 13px; }
    }
  `;

  shadow.innerHTML = `
    <style>${STYLE}</style>
    <div class="upp-backdrop" data-theme="light" hidden>
      <div class="upp-modal" role="dialog" aria-modal="true" aria-label="User 人设">
        <div class="upp-grab" aria-hidden="true"></div>
        <div class="upp-head">
          <div class="upp-head-left">
            <span class="upp-title">User 人设</span>
            <span class="upp-char-tag" hidden></span>
          </div>
          <button type="button" class="upp-close-btn" data-act="close" aria-label="关闭">×</button>
        </div>
        <div class="upp-tabs-wrap">
          <div class="upp-tabs" role="tablist">
            <button type="button" class="upp-tab is-active" data-tab="lib" role="tab">条目库</button>
            <button type="button" class="upp-tab" data-tab="wb" role="tab">世界书</button>
            <button type="button" class="upp-tab" data-tab="presets" role="tab">方案</button>
          </div>
        </div>
        <div class="upp-body"></div>
        <div class="upp-foot">
          <div class="upp-mode-row">
            <span class="upp-mode-label">写入位置</span>
            <div class="upp-mode-seg">
              <button type="button" class="upp-mode-btn is-active" data-mode="persona">填入用户人设</button>
              <button type="button" class="upp-mode-btn" data-mode="chat">仅当前聊天</button>
            </div>
          </div>
          <div class="upp-action-row">
            <div class="upp-action-left">
              <button type="button" class="upp-btn" data-act="clear">清空</button>
              <button type="button" class="upp-btn" data-act="preview">预览</button>
            </div>
            <div class="upp-action-right">
              <span class="upp-total">已选 0</span>
              <button type="button" class="upp-btn upp-btn-primary" data-act="save">保存</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const $ = sel => shadow.querySelector(sel);
  const elBackdrop = $('.upp-backdrop');
  const elCharTag = $('.upp-char-tag');
  const elTabs = $('.upp-tabs');
  const elBody = $('.upp-body');
  const elTotal = $('.upp-total');
  const elSaveBtn = $('[data-act="save"]');

  const state = {
    open: false,
    loading: false,
    saving: false,
    tab: 'lib', // 'lib' | 'wb' | 'presets'
    subView: '', // '' | 'preview' | 'edit' | 'new'
    editPickMode: false,
    charName: '',
    store: loadStore(),
    selected: new Set(),
    hostBooks: [],
    activeWb: '',
    wbCache: Object.create(null), // { [bookName]: WorldbookEntry[] }
    wbSearch: '',
    showAllChars: false,
    presetNameInput: '',
    importOpen: false,
    importText: '',
    draft: { book: '', oldTitle: '', title: '', content: '', isCustom: false, error: '', busy: false },
  };

  function countSelectedBySource() {
    let lib = 0, wb = 0;
    for (const k of state.selected) {
      if (parseKey(k).book === LIB_BOOK) lib++;
      else wb++;
    }
    return { lib, wb };
  }

  function buildWbContentMap() {
    const map = Object.create(null);
    for (const [book, entries] of Object.entries(state.wbCache)) {
      map[book] = Object.create(null);
      for (const e of entries || []) {
        if (e && e.name) map[book][e.name] = e.content || '';
      }
    }
    return map;
  }

  async function ensureWbLoaded(bookName) {
    if (!bookName || bookName === LIB_BOOK) return;
    if (Array.isArray(state.wbCache[bookName])) return;
    state.wbCache[bookName] = await loadWorldbookEntries(bookName);
  }

  async function ensureSelectedWbsLoaded() {
    const needed = new Set();
    for (const k of state.selected) {
      const b = parseKey(k).book;
      if (b && b !== LIB_BOOK && !Array.isArray(state.wbCache[b])) needed.add(b);
    }
    await Promise.all([...needed].map(b => ensureWbLoaded(b)));
  }

  function renderTabs() {
    const counts = countSelectedBySource();
    const map = { lib: ['条目库', counts.lib], wb: ['世界书', counts.wb], presets: ['方案', state.store.presets.length] };
    elTabs.querySelectorAll('.upp-tab').forEach(btn => {
      const t = btn.dataset.tab;
      btn.classList.toggle('is-active', state.tab === t && !state.subView);
      const [label, n] = map[t];
      btn.innerHTML = esc(label) + (n > 0 ? '<span class="upp-tab-count">' + n + '</span>' : '');
    });
  }

  function renderFooter() {
    elTotal.textContent = '已选 ' + state.selected.size;
    elSaveBtn.disabled = state.loading || state.saving;
    shadow.querySelectorAll('.upp-mode-btn').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.mode === state.store.targetMode);
    });
  }

  function renderLibTab() {
    const groups = getLibraryGroups(state.store);
    const parts = [
      '<div class="upp-subbar">' +
        '<span class="upp-subbar-hint">' + (state.editPickMode ? '点任意条目即可修改正文' : '点标签即可勾选，免手写') + '</span>' +
        '<div class="upp-subbar-actions">' +
          '<button type="button" class="upp-mini-btn' + (state.editPickMode ? ' is-active' : '') + '" data-act="toggle-edit">' + (state.editPickMode ? '完成编辑' : '改正文') + '</button>' +
          '<button type="button" class="upp-mini-btn" data-act="open-new-lib">+ 新建</button>' +
        '</div>' +
      '</div>',
    ];

    for (const g of groups) {
      let selCount = 0;
      for (const it of g.items) {
        if (state.selected.has(itemKey(LIB_BOOK, it.title))) selCount++;
      }
      const chips = g.items.map(it => {
        const isSel = state.selected.has(itemKey(LIB_BOOK, it.title));
        return '<button type="button" class="upp-chip' + (isSel ? ' is-selected' : '') + (state.editPickMode ? ' is-editing' : '') +
          '" data-book="' + esc(LIB_BOOK) + '" data-title="' + esc(it.title) + '">' + esc(it.title) + '</button>';
      }).join('');

      parts.push(
        '<section class="upp-group">' +
          '<div class="upp-group-head">' +
            '<span class="upp-group-title">' + esc(g.cat) + (selCount > 0 ? '<span class="upp-group-badge">' + selCount + '</span>' : '') + '</span>' +
            (g.isCustomGroup ? '<button type="button" class="upp-mini-btn" data-act="open-new-lib">+ 添加</button>' : '') +
          '</div>' +
          (chips ? '<div class="upp-chips">' + chips + '</div>' : '<div class="upp-empty">点「+ 添加」写你自己的常用设定</div>') +
        '</section>'
      );
    }
    return parts.join('');
  }

  function renderWbTab() {
    if (!state.hostBooks.length) {
      return '<section class="upp-group"><div class="upp-empty">当前酒馆里没有可用的世界书，可直接用「条目库」。</div></section>';
    }

    // Order books: recent books first, then rest
    const recentSet = new Set(state.store.recentBooks);
    const orderedBooks = [
      ...state.store.recentBooks.filter(b => state.hostBooks.includes(b)),
      ...state.hostBooks.filter(b => !recentSet.has(b)),
    ];
    if (!state.activeWb || !state.hostBooks.includes(state.activeWb)) {
      state.activeWb = orderedBooks[0] || '';
    }

    const pills = orderedBooks.map(name => {
      let n = 0;
      for (const k of state.selected) if (parseKey(k).book === name) n++;
      return '<button type="button" class="upp-book-pill' + (state.activeWb === name ? ' is-active' : '') +
        '" data-pick-wb="' + esc(name) + '">' + esc(name) + (n > 0 ? ' · ' + n : '') + '</button>';
    }).join('');

    const parts = ['<div class="upp-books-strip">' + pills + '</div>'];
    const entries = state.wbCache[state.activeWb];

    if (!Array.isArray(entries)) {
      parts.push('<div class="upp-empty">加载世界书…</div>');
      return parts.join('');
    }

    if (entries.length > 12 || state.wbSearch) {
      parts.push('<input type="text" class="upp-search-input" data-wb-search="1" value="' + esc(state.wbSearch) + '" placeholder="搜标题或正文" />');
    }

    parts.push(
      '<div class="upp-subbar">' +
        '<span class="upp-subbar-hint">' + (state.editPickMode ? '点任意条目修改正文' : '共 ' + entries.length + ' 条') + '</span>' +
        '<div class="upp-subbar-actions">' +
          '<button type="button" class="upp-mini-btn' + (state.editPickMode ? ' is-active' : '') + '" data-act="toggle-edit">' + (state.editPickMode ? '完成编辑' : '改正文') + '</button>' +
          '<button type="button" class="upp-mini-btn" data-act="open-new-wb">+ 新建</button>' +
        '</div>' +
      '</div>'
    );

    const org = organizeWorldbookEntries(entries, state.charName, state.showAllChars, state.wbSearch);
    if (!org.sections.length) {
      parts.push('<section class="upp-group"><div class="upp-empty">' + (state.wbSearch ? '没有找到匹配条目' : '这本书暂无条目') + '</div></section>');
    } else {
      for (const sec of org.sections) {
        let selCount = 0;
        for (const e of sec.items) if (state.selected.has(itemKey(state.activeWb, e.name))) selCount++;
        const chips = sec.items.map(e => {
          const isSel = state.selected.has(itemKey(state.activeWb, e.name));
          const label = displayEntryLabel(e.name, sec);
          return '<button type="button" class="upp-chip' + (isSel ? ' is-selected' : '') + (state.editPickMode ? ' is-editing' : '') +
            '" data-book="' + esc(state.activeWb) + '" data-title="' + esc(e.name) + '" title="' + esc(e.name) + '">' + esc(label) + '</button>';
        }).join('');

        parts.push(
          '<section class="upp-group">' +
            (sec.cat ? '<div class="upp-group-head"><span class="upp-group-title">' + esc(sec.cat) + (selCount > 0 ? '<span class="upp-group-badge">' + selCount + '</span>' : '') + '</span></div>' : '') +
            '<div class="upp-chips">' + chips + '</div>' +
          '</section>'
        );
      }
    }

    if (org.hasHiddenOthers) {
      parts.push('<button type="button" class="upp-mini-btn" data-act="show-all-chars">显示其余 ' + org.hiddenCount + ' 条其他角色路线</button>');
    }

    return parts.join('');
  }

  function renderPresetsTab() {
    const rows = (state.store.presets || []).map(p => {
      const isDef = p.id === state.store.defaultPresetId;
      return '<div class="upp-row-item">' +
        '<div class="upp-row-left">' +
          '<button type="button" class="upp-star-btn' + (isDef ? ' is-default' : '') + '" data-preset-def="' + esc(p.id) + '" title="设为新聊天默认">' + (isDef ? '★' : '☆') + '</button>' +
          '<div class="upp-row-main">' +
            '<span class="upp-row-title">' + esc(p.label) + '</span>' +
            '<span class="upp-row-sub">' + p.items.length + ' 条设定</span>' +
          '</div>' +
        '</div>' +
        '<div class="upp-row-btns">' +
          '<button type="button" class="upp-mini-btn is-active" data-preset-apply="' + esc(p.id) + '">套用</button>' +
          '<button type="button" class="upp-mini-btn" data-preset-overwrite="' + esc(p.id) + '">覆盖</button>' +
          '<button type="button" class="upp-mini-btn is-danger" data-preset-del="' + esc(p.id) + '">删</button>' +
        '</div>' +
      '</div>';
    }).join('');

    return '<section class="upp-group">' +
      '<div class="upp-group-head"><span class="upp-group-title">把当前勾选存成方案</span><span class="upp-row-sub">已选 ' + state.selected.size + ' 条</span></div>' +
      '<div class="upp-inline-save">' +
        '<input type="text" class="upp-input" data-preset-input="1" value="' + esc(state.presetNameInput) + '" placeholder="输入方案名，如：甜妹日常" />' +
        '<button type="button" class="upp-btn upp-btn-primary" data-act="create-preset">保存</button>' +
      '</div>' +
    '</section>' +
    '<section class="upp-group">' +
      '<div class="upp-group-head"><span class="upp-group-title">已存方案</span></div>' +
      '<div class="upp-row-list">' + (rows || '<div class="upp-empty">选好标签后在上方输个名字，下次就能一键切换</div>') + '</div>' +
    '</section>' +
    '<section class="upp-group">' +
      '<div class="upp-group-head">' +
        '<span class="upp-group-title">换设备同步</span>' +
        '<div class="upp-row-btns">' +
          '<button type="button" class="upp-mini-btn" data-act="export-store">导出</button>' +
          '<button type="button" class="upp-mini-btn" data-act="toggle-import">导入</button>' +
        '</div>' +
      '</div>' +
      (state.importOpen
        ? '<textarea class="upp-textarea" data-import-text="1" placeholder="粘贴导出的 JSON">' + esc(state.importText) + '</textarea>' +
          '<div class="upp-form-actions"><button type="button" class="upp-mini-btn is-active" data-act="confirm-import">确认导入</button></div>'
        : '') +
    '</section>';
  }

  function renderSubView() {
    if (state.subView === 'preview') {
      const out = assembleOutput(state.selected, state.store, buildWbContentMap());
      return '<section class="upp-group">' +
        '<div class="upp-group-head">' +
          '<span class="upp-group-title">效果预览<span class="upp-group-badge">' + out.count + ' 条 · ' + out.text.length + ' 字</span></span>' +
          '<button type="button" class="upp-mini-btn" data-act="close-sub">返回</button>' +
        '</div>' +
        (out.text ? '<pre class="upp-preview-pre">' + esc(out.text) + '</pre>' : '<div class="upp-empty">还没勾选任何条目</div>') +
      '</section>';
    }

    const d = state.draft;
    const isNew = state.subView === 'new';
    const canRename = isNew || d.book !== LIB_BOOK || d.isCustom;
    return '<div class="upp-form">' +
      '<div class="upp-group-head">' +
        '<span class="upp-group-title">' + (isNew ? '新建条目' : '修改条目') + '</span>' +
        (d.book !== LIB_BOOK ? '<span class="upp-row-sub">' + esc(d.book) + '</span>' : '') +
      '</div>' +
      '<input type="text" class="upp-input" data-draft-field="title" value="' + esc(d.title) + '"' + (canRename ? '' : ' disabled') + ' placeholder="标题" />' +
      '<textarea class="upp-textarea is-tall" data-draft-field="content" placeholder="写这条人设的具体描述">' + esc(d.content) + '</textarea>' +
      (d.error ? '<div class="upp-form-error">' + esc(d.error) + '</div>' : '') +
      '<div class="upp-form-actions">' +
        (!isNew && d.book === LIB_BOOK && d.isCustom ? '<button type="button" class="upp-btn" style="color:var(--upp-danger-tx)" data-act="delete-custom">删除</button>' : '') +
        '<button type="button" class="upp-btn" data-act="close-sub">取消</button>' +
        '<button type="button" class="upp-btn upp-btn-primary" data-act="save-draft"' + (d.busy ? ' disabled' : '') + '>保存</button>' +
      '</div>' +
    '</div>';
  }

  function renderBody(preserveFocusSelector) {
    if (state.loading) {
      elBody.innerHTML = '<div class="upp-empty">加载中…</div>';
      return;
    }
    const prevScroll = elBody.scrollTop;
    let caret = null;
    if (preserveFocusSelector) {
      const a = shadow.activeElement;
      if (a && a.matches?.(preserveFocusSelector)) caret = a.selectionStart;
    }

    if (state.subView) elBody.innerHTML = renderSubView();
    else if (state.tab === 'wb') elBody.innerHTML = renderWbTab();
    else if (state.tab === 'presets') elBody.innerHTML = renderPresetsTab();
    else elBody.innerHTML = renderLibTab();

    elBody.scrollTop = prevScroll;
    if (preserveFocusSelector && caret !== null) {
      const inp = shadow.querySelector(preserveFocusSelector);
      if (inp) { inp.focus(); try { inp.setSelectionRange(caret, caret); } catch (_) {} }
    }
  }

  function renderAll() {
    if (state.charName) { elCharTag.textContent = state.charName; elCharTag.hidden = false; }
    else elCharTag.hidden = true;
    renderTabs();
    renderBody(null);
    renderFooter();
  }

  async function refreshState() {
    elBackdrop.dataset.theme = detectHostTheme();
    state.loading = true;
    state.charName = readCurrentCharName();
    state.store = loadStore();
    renderAll();

    state.hostBooks = await listHostWorldbooks();
    if (dead) return;

    // Load selection based on current target mode
    const nextSel = new Set();
    if (state.store.targetMode === 'chat') {
      const saved = parseSavedChatPicker(readChatPickerVar());
      if (saved.hasSaved) {
        for (const it of saved.items) nextSel.add(itemKey(it.book, it.title));
      } else if (state.store.defaultPresetId) {
        const def = state.store.presets.find(p => p.id === state.store.defaultPresetId);
        if (def) for (const it of def.items) nextSel.add(itemKey(it.book, it.title));
      }
    } else {
      for (const it of state.store.lastPersonaItems || []) nextSel.add(itemKey(it.book, it.title));
    }
    state.selected = nextSel;

    if (state.tab === 'wb' && state.activeWb) {
      await ensureWbLoaded(state.activeWb);
    }
    state.loading = false;
    renderAll();
  }

  function openModal() {
    if (dead) return;
    elBackdrop.dataset.theme = detectHostTheme();
    state.open = true;
    state.subView = '';
    state.editPickMode = false;
    state.wbSearch = '';
    elBackdrop.hidden = false;
    syncMenuExpanded();
    void refreshState();
  }

  function closeModal() {
    state.open = false;
    state.subView = '';
    state.editPickMode = false;
    elBackdrop.hidden = true;
    syncMenuExpanded();
  }

  async function handleSave() {
    if (state.saving || state.loading) return;
    state.saving = true;
    renderFooter();
    try {
      await ensureSelectedWbsLoaded();
      const out = assembleOutput(state.selected, state.store, buildWbContentMap());

      if (state.store.targetMode === 'persona') {
        const personaName = await writeToCurrentPersona(out.text);
        state.store.lastPersonaItems = out.wi.map(({ book, title }) => ({ book, title }));
        saveStore(state.store);
        closeModal();
        notify(out.count > 0 ? '已写入用户人设「' + personaName + '」（' + out.count + ' 条）' : '已从用户人设清除生成段', 'success');
      } else {
        if (!hasActiveChat()) {
          notify('请先打开一个聊天，或切到「填入用户人设」', 'warning');
          return;
        }
        await ensureOpeningBookSilent();
        await writeChatPickerVar({ v: 1, char: state.charName, wi: out.wi });
        closeModal();
        notify(out.count > 0 ? '已保存到当前聊天（' + out.count + ' 条）' : '已清空当前聊天人设', 'success');
      }
    } catch (err) {
      notify('保存失败：' + (err?.message || String(err)), 'error');
    } finally {
      state.saving = false;
      renderFooter();
    }
  }

  async function handleSaveDraft() {
    const d = state.draft;
    if (d.busy) return;
    const title = String(d.title || '').trim();
    const content = String(d.content || '').trim();
    if (!title) { d.error = '请填写标题'; renderBody(null); return; }
    if (!content) { d.error = '请填写正文'; renderBody(null); return; }

    if (d.book === LIB_BOOK) {
      if (state.subView === 'new') {
        if (findLibraryEntry(state.store, title)) { d.error = '已有同名条目'; renderBody(null); return; }
        state.store.customEntries.push({ id: 'c_' + Date.now().toString(36), title, content, isRule: false });
        state.selected.add(itemKey(LIB_BOOK, title));
      } else if (d.isCustom) {
        const item = state.store.customEntries.find(e => e.title === d.oldTitle);
        if (item) {
          item.title = title;
          item.content = content;
          if (title !== d.oldTitle && state.selected.has(itemKey(LIB_BOOK, d.oldTitle))) {
            state.selected.delete(itemKey(LIB_BOOK, d.oldTitle));
            state.selected.add(itemKey(LIB_BOOK, title));
          }
        }
      } else {
        state.store.builtinEdits[d.oldTitle] = content;
      }
      saveStore(state.store);
      state.subView = '';
      notify('已保存', 'success');
      renderAll();
      return;
    }

    // Worldbook create or edit
    d.busy = true;
    d.error = '';
    renderBody(null);
    try {
      if (state.subView === 'new') {
        await createEntryInWorldbook(d.book, buildWorldbookEntry(title, content));
        state.selected.add(itemKey(d.book, title));
      } else {
        await updateEntryInWorldbook(d.book, d.oldTitle, title, content);
        if (title !== d.oldTitle && state.selected.has(itemKey(d.book, d.oldTitle))) {
          state.selected.delete(itemKey(d.book, d.oldTitle));
          state.selected.add(itemKey(d.book, title));
        }
      }
      state.wbCache[d.book] = await loadWorldbookEntries(d.book);
      state.subView = '';
      notify('已写入世界书', 'success');
      renderAll();
    } catch (err) {
      d.busy = false;
      d.error = '写入失败：' + (err?.message || String(err));
      renderBody(null);
    }
  }

  // =========================
  // Events
  // =========================

  listen(elBackdrop, 'click', ev => { if (ev.target === elBackdrop) closeModal(); });

  listen(shadow, 'input', ev => {
    const el = ev.target;
    if (el?.dataset?.wbSearch) {
      state.wbSearch = el.value;
      renderBody('[data-wb-search]');
    } else if (el?.dataset?.presetInput) {
      state.presetNameInput = el.value;
    } else if (el?.dataset?.importText) {
      state.importText = el.value;
    } else if (el?.dataset?.draftField) {
      state.draft[el.dataset.draftField] = el.value;
      if (state.draft.error) { state.draft.error = ''; shadow.querySelector('.upp-form-error')?.remove(); }
    }
  });

  listen(shadow, 'click', ev => {
    const btn = ev.target.closest('button');
    if (!btn) return;

    const act = btn.dataset.act;
    if (act === 'close') { closeModal(); return; }
    if (act === 'save') { void handleSave(); return; }
    if (act === 'clear') { state.selected = new Set(); renderAll(); return; }
    if (act === 'close-sub') { state.subView = ''; renderAll(); return; }
    if (act === 'toggle-edit') { state.editPickMode = !state.editPickMode; renderBody(null); return; }
    if (act === 'show-all-chars') { state.showAllChars = true; renderBody(null); return; }

    if (act === 'preview') {
      void ensureSelectedWbsLoaded().then(() => {
        state.subView = state.subView === 'preview' ? '' : 'preview';
        renderAll();
      });
      return;
    }

    if (act === 'open-new-lib') {
      state.draft = { book: LIB_BOOK, oldTitle: '', title: '', content: '', isCustom: true, error: '', busy: false };
      state.subView = 'new';
      renderAll();
      return;
    }
    if (act === 'open-new-wb') {
      if (!state.activeWb) return;
      state.draft = { book: state.activeWb, oldTitle: '', title: '', content: '', isCustom: false, error: '', busy: false };
      state.subView = 'new';
      renderAll();
      return;
    }
    if (act === 'save-draft') { void handleSaveDraft(); return; }
    if (act === 'delete-custom') {
      const t = state.draft.oldTitle;
      state.store.customEntries = state.store.customEntries.filter(e => e.title !== t);
      state.selected.delete(itemKey(LIB_BOOK, t));
      saveStore(state.store);
      state.subView = '';
      renderAll();
      return;
    }

    if (act === 'create-preset') {
      const label = String(state.presetNameInput || '').trim();
      if (!label) { notify('先输个方案名', 'warning'); return; }
      const items = [...state.selected].map(parseKey).filter(x => x.book && x.title);
      state.store.presets.unshift({ id: 'p_' + Date.now().toString(36), label, items });
      state.presetNameInput = '';
      saveStore(state.store);
      notify('已存为方案：' + label, 'success');
      renderAll();
      return;
    }

    if (act === 'export-store') {
      const txt = JSON.stringify({ presets: state.store.presets, customEntries: state.store.customEntries, defaultPresetId: state.store.defaultPresetId }, null, 2);
      const copyFn = getApi('builtin')?.value?.copyText;
      if (typeof copyFn === 'function') { try { copyFn(txt); notify('已复制方案 JSON', 'success'); return; } catch (_) {} }
      Env.pwin.navigator?.clipboard?.writeText?.(txt).then(() => notify('已复制方案 JSON', 'success'));
      return;
    }
    if (act === 'toggle-import') { state.importOpen = !state.importOpen; renderBody(null); return; }
    if (act === 'confirm-import') {
      try {
        const data = JSON.parse(state.importText || '');
        if (Array.isArray(data.presets)) state.store.presets = normalizeStore({ presets: data.presets }).presets;
        if (Array.isArray(data.customEntries)) state.store.customEntries = normalizeStore({ customEntries: data.customEntries }).customEntries;
        if (typeof data.defaultPresetId === 'string') state.store.defaultPresetId = data.defaultPresetId;
        saveStore(state.store);
        state.importOpen = false;
        state.importText = '';
        notify('导入成功', 'success');
        renderAll();
      } catch (_) {
        notify('JSON 格式不对', 'error');
      }
      return;
    }

    if (btn.dataset.mode) {
      state.store.targetMode = btn.dataset.mode === 'chat' ? 'chat' : 'persona';
      saveStore(state.store);
      void refreshState();
      return;
    }

    if (btn.dataset.tab) {
      state.tab = btn.dataset.tab;
      state.subView = '';
      state.editPickMode = false;
      elBody.scrollTop = 0;
      if (state.tab === 'wb' && state.hostBooks.length) {
        const targetBook = state.activeWb || state.store.recentBooks.find(b => state.hostBooks.includes(b)) || state.hostBooks[0];
        state.activeWb = targetBook;
        void ensureWbLoaded(targetBook).then(() => renderAll());
      } else {
        renderAll();
      }
      return;
    }

    if (btn.dataset.pickWb) {
      const name = btn.dataset.pickWb;
      state.activeWb = name;
      state.wbSearch = '';
      state.showAllChars = false;
      state.store.recentBooks = [name, ...state.store.recentBooks.filter(x => x !== name)].slice(0, 12);
      saveStore(state.store);
      renderBody(null);
      void ensureWbLoaded(name).then(() => renderAll());
      return;
    }

    if (btn.dataset.presetApply) {
      const p = state.store.presets.find(x => x.id === btn.dataset.presetApply);
      if (p) {
        state.selected = new Set(p.items.map(it => itemKey(it.book, it.title)));
        notify('已套用「' + p.label + '」，点底部保存生效', 'info');
        renderAll();
      }
      return;
    }
    if (btn.dataset.presetOverwrite) {
      const p = state.store.presets.find(x => x.id === btn.dataset.presetOverwrite);
      if (p) {
        p.items = [...state.selected].map(parseKey).filter(x => x.book && x.title);
        saveStore(state.store);
        notify('已更新「' + p.label + '」', 'success');
        renderAll();
      }
      return;
    }
    if (btn.dataset.presetDel) {
      const id = btn.dataset.presetDel;
      state.store.presets = state.store.presets.filter(x => x.id !== id);
      if (state.store.defaultPresetId === id) state.store.defaultPresetId = '';
      saveStore(state.store);
      renderAll();
      return;
    }
    if (btn.dataset.presetDef) {
      const id = btn.dataset.presetDef;
      state.store.defaultPresetId = state.store.defaultPresetId === id ? '' : id;
      saveStore(state.store);
      renderAll();
      return;
    }

    if (btn.dataset.book && btn.dataset.title) {
      const book = btn.dataset.book;
      const title = btn.dataset.title;
      if (state.editPickMode) {
        if (book === LIB_BOOK) {
          const entry = findLibraryEntry(state.store, title);
          if (entry) {
            state.draft = { book: LIB_BOOK, oldTitle: title, title: entry.title, content: entry.content, isCustom: entry.isCustom, error: '', busy: false };
            state.subView = 'edit';
            renderAll();
          }
        } else {
          const content = buildWbContentMap()[book]?.[title] || '';
          state.draft = { book, oldTitle: title, title, content, isCustom: false, error: '', busy: false };
          state.subView = 'edit';
          renderAll();
        }
        return;
      }
      const k = itemKey(book, title);
      if (state.selected.has(k)) state.selected.delete(k);
      else state.selected.add(k);
      renderTabs();
      renderBody(null);
      renderFooter();
    }
  });

  listen(Env.pdoc, 'keydown', ev => {
    if (!state.open || ev.key !== 'Escape') return;
    ev.stopPropagation();
    if (state.subView) { state.subView = ''; renderAll(); }
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
  menuEntry.setAttribute('aria-label', '打开 User 人设');
  menuEntry.setAttribute('aria-controls', APP_ID);
  menuEntry.setAttribute('aria-expanded', 'false');
  menuEntry.title = 'User 人设';
  menuEntry.innerHTML =
    '<span class="extensionsMenuExtensionButton" aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' +
      '</svg>' +
    '</span><span>User 人设</span>';

  function syncMenuExpanded() { menuEntry.setAttribute('aria-expanded', String(state.open)); }
  listen(menuEntry, 'click', ev => { ev.preventDefault(); if (state.open) closeModal(); else openModal(); });
  listen(menuEntry, 'keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (state.open) closeModal(); else openModal(); } });

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
      const sub = eventOnFn(getBtnEvtFn(BUTTON_NAME), () => { if (state.open) closeModal(); else openModal(); });
      if (sub?.stop) cleanup.push(() => sub.stop());
    } catch (_) {}
  }

  if (eventOnFn && tavernEvents?.CHAT_CHANGED) {
    try {
      const sub = eventOnFn(tavernEvents.CHAT_CHANGED, () => { if (state.open) void refreshState(); });
      if (sub?.stop) cleanup.push(() => sub.stop());
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
