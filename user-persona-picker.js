;(function () {
  'use strict';

  const APP_VERSION = '6.1.0';
  const APP_ID = 'user-persona-picker-host';
  const MENU_ENTRY_ID = 'user-persona-picker-menu-entry';
  const DISPOSE_EVENT = 'user-persona-picker-dispose';
  const BUTTON_NAME = 'User人设';
  const GLOBAL_VAR_KEY = 'upp_v6_store';
  const LOCAL_STORE_KEY = 'userPersonaPicker.v6';

  // =========================
  // Pure Core (Testable)
  // =========================

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function normalizeText(str) {
    return String(str || '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').toLowerCase();
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function createEmptyStore() {
    return {
      version: 6,
      settings: {
        autoApplyBindings: true,
        pinnedWorldbooks: [],
        collapsedGroups: {},
      },
      personaVersions: {},
      snapshots: [],
      bindings: {
        chats: {},
        characters: {},
      },
    };
  }

  function sanitizePlainMap(obj) {
    const out = {};
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
    Object.keys(obj).forEach(k => {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
      out[k] = obj[k];
    });
    return out;
  }

  function sanitizeBoolMap(obj) {
    const out = {};
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
    Object.keys(obj).forEach(k => {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
      if (typeof obj[k] === 'boolean') out[k] = obj[k];
    });
    return out;
  }

  function sanitizeStore(raw) {
    const base = createEmptyStore();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;

    const st = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    base.settings.autoApplyBindings = st.autoApplyBindings !== false;
    base.settings.pinnedWorldbooks = Array.isArray(st.pinnedWorldbooks)
      ? Array.from(new Set(st.pinnedWorldbooks.map(x => String(x || '').trim()).filter(Boolean)))
      : [];
    base.settings.collapsedGroups = sanitizeBoolMap(st.collapsedGroups);

    const pvRaw = sanitizePlainMap(raw.personaVersions);
    Object.keys(pvRaw).forEach(avatarId => {
      const list = Array.isArray(pvRaw[avatarId]) ? pvRaw[avatarId] : [];
      const cleanList = list
        .filter(v => v && typeof v === 'object')
        .map(v => ({
          id: String(v.id || uid('pv')),
          name: String(v.name || '未命名版本').slice(0, 60),
          description: String(v.description || ''),
          lorebook: typeof v.lorebook === 'string' ? v.lorebook : '',
          updatedAt: Number(v.updatedAt) || Date.now(),
        }));
      if (cleanList.length) base.personaVersions[avatarId] = cleanList;
    });

    if (Array.isArray(raw.snapshots)) {
      base.snapshots = raw.snapshots
        .filter(s => s && typeof s === 'object' && typeof s.name === 'string')
        .map(s => {
          const sc = s.scope && typeof s.scope === 'object' ? s.scope : {};
          const wbRaw = s.worldbooks && typeof s.worldbooks === 'object' ? s.worldbooks : null;
          let cleanWb = null;
          if (wbRaw) {
            const entriesOut = {};
            const eMap = sanitizePlainMap(wbRaw.entries);
            Object.keys(eMap).forEach(bk => {
              entriesOut[bk] = sanitizeBoolMap(eMap[bk]);
            });
            cleanWb = {
              global: Array.isArray(wbRaw.global) ? wbRaw.global.map(String) : null,
              char: wbRaw.char && typeof wbRaw.char === 'object'
                ? {
                    primary: wbRaw.char.primary ? String(wbRaw.char.primary) : null,
                    additional: Array.isArray(wbRaw.char.additional) ? wbRaw.char.additional.map(String) : [],
                  }
                : null,
              chat: typeof wbRaw.chat === 'string' ? wbRaw.chat : null,
              entries: entriesOut,
            };
          }
          const prRaw = s.preset && typeof s.preset === 'object' ? s.preset : null;
          const rgRaw = s.regex && typeof s.regex === 'object' ? s.regex : null;
          const psRaw = s.persona && typeof s.persona === 'object' ? s.persona : null;
          return {
            id: String(s.id || uid('snap')),
            name: String(s.name || '未命名快照').slice(0, 60),
            group: String(s.group || '').trim().slice(0, 30),
            note: String(s.note || '').trim().slice(0, 120),
            updatedAt: Number(s.updatedAt) || Date.now(),
            scope: {
              persona: sc.persona !== false && !!psRaw,
              worldbooks: sc.worldbooks !== false && !!cleanWb,
              preset: sc.preset !== false && !!prRaw,
              regex: sc.regex !== false && !!rgRaw,
            },
            persona: psRaw
              ? {
                  avatarId: String(psRaw.avatarId || ''),
                  name: String(psRaw.name || ''),
                  versionId: psRaw.versionId ? String(psRaw.versionId) : '',
                  versionName: psRaw.versionName ? String(psRaw.versionName) : '',
                  description: typeof psRaw.description === 'string' ? psRaw.description : '',
                  lorebook: typeof psRaw.lorebook === 'string' ? psRaw.lorebook : '',
                }
              : null,
            worldbooks: cleanWb,
            preset: prRaw
              ? {
                  name: String(prRaw.name || ''),
                  prompts: sanitizeBoolMap(prRaw.prompts),
                  groups: sanitizeBoolMap(prRaw.groups),
                }
              : null,
            regex: rgRaw
              ? {
                  global: sanitizeBoolMap(rgRaw.global),
                  character: sanitizeBoolMap(rgRaw.character),
                  preset: sanitizeBoolMap(rgRaw.preset),
                }
              : null,
          };
        });
    }

    const bd = raw.bindings && typeof raw.bindings === 'object' ? raw.bindings : {};
    const validIds = new Set(base.snapshots.map(s => s.id));
    const chatsMap = sanitizePlainMap(bd.chats);
    Object.keys(chatsMap).forEach(k => {
      const v = String(chatsMap[k] || '');
      if (v && validIds.has(v)) base.bindings.chats[k] = v;
    });
    const charsMap = sanitizePlainMap(bd.characters);
    Object.keys(charsMap).forEach(k => {
      const v = String(charsMap[k] || '');
      if (v && validIds.has(v)) base.bindings.characters[k] = v;
    });

    return base;
  }

  function exportStoreJson(store) {
    return JSON.stringify({
      format: 'user-persona-snapshot-v6',
      version: 6,
      exportedAt: Date.now(),
      data: sanitizeStore(store),
    }, null, 2);
  }

  function parseImportJson(rawText) {
    let parsed;
    try { parsed = JSON.parse(String(rawText || '')); } catch (_) {
      throw new Error('JSON 格式无效，请检查文件内容');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('备份文件结构无效');
    }
    if (parsed.format === 'user-persona-snapshot-v6' && parsed.data) {
      return sanitizeStore(parsed.data);
    }
    if (parsed.version === 6 && (Array.isArray(parsed.snapshots) || parsed.personaVersions)) {
      return sanitizeStore(parsed);
    }
    throw new Error('不是本插件导出的快照备份文件');
  }

  // BaiBai Tools presetPromptGroups parser & layout builder
  function extractPresetGroups(preset) {
    const ppg = preset && preset.extensions && preset.extensions.baibaiToolkit
      ? preset.extensions.baibaiToolkit.presetPromptGroups
      : null;
    if (!ppg || typeof ppg !== 'object') {
      return { groups: [], groupsById: {}, promptGroupMap: {} };
    }
    const rawGroups = Array.isArray(ppg.groups) ? ppg.groups : [];
    const groups = rawGroups
      .filter(g => g && typeof g === 'object' && g.id != null && String(g.id).trim())
      .map((g, idx) => ({
        id: String(g.id),
        name: String(g.name || '未命名分组'),
        order: typeof g.order === 'number' ? g.order : idx,
        collapsed: g.collapsed === true,
        enabled: g.enabled !== false,
      }));
    const groupsById = {};
    groups.forEach(g => { groupsById[g.id] = g; });

    const promptGroupMap = {};
    const rawPrompts = sanitizePlainMap(ppg.prompts);
    Object.keys(rawPrompts).forEach(pid => {
      const meta = rawPrompts[pid];
      const gid = meta && meta.groupId != null ? String(meta.groupId) : '';
      if (gid && groupsById[gid]) {
        promptGroupMap[pid] = gid;
      }
    });

    return { groups, groupsById, promptGroupMap };
  }

  // Render each BaiBai group once at its first member's real position; ungrouped prompts stay inline
  function buildPresetRenderNodes(preset, opts) {
    const prompts = preset && Array.isArray(preset.prompts) ? preset.prompts : [];
    const { groups, groupsById, promptGroupMap } = extractPresetGroups(preset);
    const q = normalizeText(opts?.search || '');
    const onlyOn = !!opts?.onlyOn;

    // Collect members per group in real prompt order
    const membersByGroup = {};
    groups.forEach(g => { membersByGroup[g.id] = []; });
    prompts.forEach(p => {
      if (!p || !p.id) return;
      const gid = promptGroupMap[p.id];
      if (gid && membersByGroup[gid]) membersByGroup[gid].push(p);
    });

    const matchesPrompt = p => {
      if (onlyOn && !p.enabled) return false;
      if (!q) return true;
      return normalizeText((p.name || '') + ' ' + (p.content || '') + ' ' + (p.id || '')).includes(q);
    };

    const emittedGroups = new Set();
    const nodes = [];

    prompts.forEach(p => {
      if (!p || !p.id) return;
      const gid = promptGroupMap[p.id];
      if (gid && groupsById[gid]) {
        if (emittedGroups.has(gid)) return;
        emittedGroups.add(gid);
        const grp = groupsById[gid];
        const allMembers = membersByGroup[gid] || [];
        const groupNameMatched = !!q && normalizeText(grp.name).includes(q);
        let shownMembers = allMembers.filter(m => {
          if (onlyOn && (!grp.enabled || !m.enabled)) return false;
          if (!q || groupNameMatched) return true;
          return normalizeText((m.name || '') + ' ' + (m.content || '') + ' ' + (m.id || '')).includes(q);
        });
        if (!shownMembers.length) return;
        const enabledCount = allMembers.filter(m => m.enabled).length;
        nodes.push({
          type: 'group',
          group: grp,
          items: shownMembers,
          totalCount: allMembers.length,
          enabledCount,
          forceExpand: !!q || onlyOn,
        });
      } else {
        if (!matchesPrompt(p)) return;
        nodes.push({ type: 'prompt', prompt: p });
      }
    });

    return { nodes, hasGroups: groups.length > 0, groups };
  }

  // XML / Wrapper tag hygiene inspector (never mutates user content)
  const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr']);

  function analyzeEntryTags(content) {
    const raw = String(content || '');
    const cleaned = raw.replace(/<%[\s\S]*?%>/g, '').replace(/<!--[\s\S]*?-->/g, '');
    const re = /<\s*(\/?)\s*([a-zA-Z\u4e00-\u9fa5][a-zA-Z0-9_\-\u4e00-\u9fa5]*)(?:\s+[^<>]*)?(\/?)\s*>/g;
    const stack = [];
    const unclosed = [];
    const topWrappers = [];
    let match;

    while ((match = re.exec(cleaned)) !== null) {
      const isClose = match[1] === '/';
      const tagName = match[2];
      const tagKey = tagName.toLowerCase();
      const isSelf = match[3] === '/' || VOID_TAGS.has(tagKey);
      if (isSelf) continue;

      if (!isClose) {
        if (stack.length === 0) topWrappers.push(tagName);
        stack.push({ name: tagName, key: tagKey });
      } else {
        let found = -1;
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].key === tagKey) { found = i; break; }
        }
        if (found >= 0) {
          for (let j = stack.length - 1; j > found; j--) {
            unclosed.push(stack[j].name);
          }
          stack.length = found;
        } else {
          unclosed.push('/' + tagName);
        }
      }
    }
    while (stack.length) {
      unclosed.push(stack.pop().name);
    }

    return {
      unclosed: Array.from(new Set(unclosed)),
      topWrappers: Array.from(new Set(topWrappers)),
    };
  }

  function inspectTagHygiene(entries) {
    const byUid = {};
    const wrapperOwners = {};
    const list = Array.isArray(entries) ? entries : [];

    list.forEach(entry => {
      if (!entry || !entry.enabled) return;
      const res = analyzeEntryTags(entry.content || '');
      const key = String(entry.uid);
      byUid[key] = { unclosed: res.unclosed, duplicateTags: [] };
      res.topWrappers.forEach(tag => {
        const lk = tag.toLowerCase();
        if (!wrapperOwners[lk]) wrapperOwners[lk] = { display: tag, uids: [] };
        wrapperOwners[lk].uids.push(key);
      });
    });

    const duplicateTags = [];
    Object.keys(wrapperOwners).forEach(lk => {
      const info = wrapperOwners[lk];
      if (info.uids.length >= 2) {
        duplicateTags.push({ tag: info.display, count: info.uids.length, uids: info.uids });
        info.uids.forEach(u => {
          if (byUid[u]) byUid[u].duplicateTags.push(info.display);
        });
      }
    });

    let unclosedCount = 0;
    Object.keys(byUid).forEach(u => {
      if (byUid[u].unclosed.length) unclosedCount++;
    });

    return { byUid, duplicateTags, unclosedCount };
  }

  function computeLineDiff(beforeText, afterText) {
    const a = String(beforeText || '').replace(/\r\n/g, '\n').split('\n');
    const b = String(afterText || '').replace(/\r\n/g, '\n').split('\n');
    if (a.length === 1 && a[0] === '' && b.length === 1 && b[0] === '') return [];

    if (a.length * b.length > 160000) {
      const out = [];
      const maxLen = Math.max(a.length, b.length);
      for (let i = 0; i < maxLen; i++) {
        if (a[i] === b[i]) out.push({ type: 'same', text: a[i] });
        else {
          if (i < a.length) out.push({ type: 'del', text: a[i] });
          if (i < b.length) out.push({ type: 'add', text: b[i] });
        }
      }
      return out;
    }

    const m = a.length;
    const n = b.length;
    const dp = new Array(m + 1);
    for (let i = 0; i <= m; i++) dp[i] = new Uint16Array(n + 1);

    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
        else dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
      }
    }

    const out = [];
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (a[i] === b[j]) {
        out.push({ type: 'same', text: a[i] });
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        out.push({ type: 'del', text: a[i] });
        i++;
      } else {
        out.push({ type: 'add', text: b[j] });
        j++;
      }
    }
    while (i < m) { out.push({ type: 'del', text: a[i++] }); }
    while (j < n) { out.push({ type: 'add', text: b[j++] }); }
    return out;
  }

  function extractPersonaBaseName(name) {
    let s = String(name || '').trim();
    if (!s) return '';
    s = s.replace(/\s*[\(（\[【][^\)）\]】]{1,20}[\)）\]】]\s*$/g, '');
    s = s.replace(/[\s_\-·・/]+(v?\d+|第?\d+版|[\u4e00-\u9fa5a-zA-Z0-9]{1,8}版|au|日常|现代|古风|校园|战损|黑化|备份|测试)$/i, '');
    s = s.replace(/\d+$/g, '').trim();
    return s || String(name || '').trim();
  }

  function detectProliferatedPersonas(personas) {
    const groups = new Map();
    (Array.isArray(personas) ? personas : []).forEach(p => {
      if (!p || !p.avatar_id) return;
      const base = extractPersonaBaseName(p.name);
      const key = base.toLowerCase();
      if (!key) return;
      if (!groups.has(key)) groups.set(key, { baseName: base, items: [] });
      groups.get(key).items.push(p);
    });
    return Array.from(groups.values()).filter(g => g.items.length >= 2);
  }

  function resolveBindingForContext(bindings, chatId, charId) {
    if (!bindings || typeof bindings !== 'object') return null;
    if (chatId && bindings.chats && bindings.chats[chatId]) {
      return { snapshotId: bindings.chats[chatId], source: 'chat' };
    }
    if (charId && bindings.characters && bindings.characters[charId]) {
      return { snapshotId: bindings.characters[charId], source: 'character' };
    }
    return null;
  }

  function buildCleanCopyText(entries) {
    return (Array.isArray(entries) ? entries : [])
      .filter(e => e && e.enabled && String(e.content || '').trim())
      .map(e => String(e.content || '').trim())
      .join('\n\n');
  }

  function formatTimeShort(ts) {
    const n = Number(ts);
    if (!n) return '';
    const d = new Date(n);
    const pad = v => String(v).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function inferThemeFromTextColor(colorStr, hasIgLight) {
    if (hasIgLight) return 'light';
    const m = String(colorStr || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (!m) return 'light';
    const r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return lum < 140 ? 'light' : 'dark';
  }

  const Core = {
    APP_VERSION,
    createEmptyStore,
    sanitizeStore,
    exportStoreJson,
    parseImportJson,
    extractPresetGroups,
    buildPresetRenderNodes,
    analyzeEntryTags,
    inspectTagHygiene,
    computeLineDiff,
    extractPersonaBaseName,
    detectProliferatedPersonas,
    resolveBindingForContext,
    buildCleanCopyText,
    formatTimeShort,
    inferThemeFromTextColor,
    normalizeText,
  };

  if (typeof globalThis !== 'undefined') {
    globalThis.__USER_PERSONA_PICKER_CORE__ = Core;
  }

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  // =========================
  // Host Environment & APIs
  // =========================

  const Env = (function () {
    let pwin = window;
    let pdoc = document;
    try {
      if (window.parent && window.parent !== window && window.parent.document) {
        pwin = window.parent;
        pdoc = window.parent.document;
      }
    } catch (_) {}
    return { pwin, pdoc };
  })();

  function getApi(name) {
    try { if (typeof window[name] !== 'undefined') return { owner: window, value: window[name] }; } catch (_) {}
    try { if (typeof Env.pwin[name] !== 'undefined') return { owner: Env.pwin, value: Env.pwin[name] }; } catch (_) {}
    return null;
  }

  function getFn(name) {
    const api = getApi(name);
    if (api && typeof api.value === 'function') {
      return api.value.bind(api.owner);
    }
    return null;
  }

  function toast(msg, type) {
    const t = Env.pwin.toastr || window.toastr;
    if (t && typeof t[type || 'info'] === 'function') {
      t[type || 'info'](String(msg), 'User 快照');
    } else {
      console.log('[User快照]', msg);
    }
  }

  function detectHostTheme() {
    try {
      const rootStyle = Env.pwin.getComputedStyle(Env.pdoc.documentElement);
      const hasIgLight = !!rootStyle.getPropertyValue('--ig-panel-bg').trim();
      const bodyColor = Env.pwin.getComputedStyle(Env.pdoc.body || Env.pdoc.documentElement).color;
      const smartColor = rootStyle.getPropertyValue('--SmartThemeBodyColor').trim();
      return inferThemeFromTextColor(bodyColor || smartColor, hasIgLight);
    } catch (_) {
      return 'light';
    }
  }

  function getSTContext() {
    try {
      const st = Env.pwin.SillyTavern || window.SillyTavern;
      if (st && typeof st.getContext === 'function') return st.getContext();
    } catch (_) {}
    return null;
  }

  function readCurrentCharInfo() {
    const getName = getFn('getCurrentCharacterName');
    const getId = getFn('getCurrentCharacterId');
    let name = '';
    let id = '';
    try { name = String(getName ? (getName() || '') : '').trim(); } catch (_) {}
    try { id = String(getId ? (getId() || '') : '').trim(); } catch (_) {}
    if (name === 'SillyTavern System') { name = ''; id = ''; }
    if (!id && !name) {
      const ctx = getSTContext();
      if (ctx && ctx.characterId !== undefined && ctx.characterId !== null && Array.isArray(ctx.characters)) {
        const ch = ctx.characters[ctx.characterId];
        if (ch && ch.name && ch.name !== 'SillyTavern System') {
          name = String(ch.name);
          id = String(ch.avatar || ch.name);
        }
      }
    }
    return { id: id || name, name };
  }

  function readCurrentChatId() {
    try {
      const ctx = getSTContext();
      if (ctx) {
        const cid = typeof ctx.getCurrentChatId === 'function' ? ctx.getCurrentChatId() : ctx.chatId;
        if (cid && String(cid).trim()) return String(cid).trim();
      }
    } catch (_) {}
    return '';
  }

  function loadStoreSync() {
    let fromGlobal = null;
    try {
      const getVars = getFn('getVariables');
      if (getVars) {
        const gv = getVars({ type: 'global' });
        if (gv && gv[GLOBAL_VAR_KEY] && typeof gv[GLOBAL_VAR_KEY] === 'object') {
          fromGlobal = gv[GLOBAL_VAR_KEY];
        }
      }
    } catch (_) {}

    let fromLocal = null;
    try {
      const raw = Env.pwin.localStorage.getItem(LOCAL_STORE_KEY);
      if (raw) fromLocal = JSON.parse(raw);
    } catch (_) {}

    if (fromGlobal && fromLocal) {
      const gCount = (fromGlobal.snapshots?.length || 0) + Object.keys(fromGlobal.personaVersions || {}).length;
      const lCount = (fromLocal.snapshots?.length || 0) + Object.keys(fromLocal.personaVersions || {}).length;
      return sanitizeStore(gCount >= lCount ? fromGlobal : fromLocal);
    }
    return sanitizeStore(fromGlobal || fromLocal || createEmptyStore());
  }

  let saveGlobalTimer = null;
  function persistStore(store) {
    const clean = sanitizeStore(store);
    try {
      Env.pwin.localStorage.setItem(LOCAL_STORE_KEY, JSON.stringify(clean));
    } catch (e) {
      console.warn('[User快照] localStorage 写入失败', e);
    }
    if (saveGlobalTimer) Env.pwin.clearTimeout(saveGlobalTimer);
    saveGlobalTimer = Env.pwin.setTimeout(async () => {
      saveGlobalTimer = null;
      if (dead) return;
      try {
        const upsert = getFn('insertOrAssignVariables');
        if (upsert) {
          await upsert({ [GLOBAL_VAR_KEY]: clean }, { type: 'global' });
        }
      } catch (e) {
        console.warn('[User快照] 全局变量同步失败', e);
      }
    }, 250);
    return clean;
  }

  const Host = {
    listPersonas() {
      const getIds = getFn('getPersonaIds');
      const getP = getFn('getPersona');
      if (!getIds || !getP) return [];
      const ids = getIds() || [];
      const out = [];
      ids.forEach(id => {
        try {
          const p = getP(id);
          if (p) out.push(p);
        } catch (_) {}
      });
      return out;
    },
    getCurrentPersona() {
      const getP = getFn('getPersona');
      const getId = getFn('getCurrentPersonaId');
      if (!getP) return null;
      try {
        const id = getId ? getId() : null;
        if (id) return getP(id);
        return getP('current');
      } catch (_) {
        return null;
      }
    },
    async switchPersona(avatarId, name) {
      const getCurId = getFn('getCurrentPersonaId');
      if (getCurId && getCurId() === avatarId) return true;

      try {
        const escaped = String(avatarId || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const el = Env.pdoc.querySelector(`#user_avatar_block .avatar-container[data-avatar-id="${escaped}"]`);
        if (el && typeof el.click === 'function') {
          el.click();
          await new Promise(r => Env.pwin.setTimeout(r, 80));
          if (!getCurId || getCurId() === avatarId) return true;
        }
      } catch (_) {}

      try {
        const slash = getFn('triggerSlash');
        if (slash && name) {
          await slash('/persona mode=lookup ' + String(name).replace(/[\r\n|]/g, ' ').trim());
          await new Promise(r => Env.pwin.setTimeout(r, 80));
          if (!getCurId || getCurId() === avatarId) return true;
        }
      } catch (_) {}

      return !!(getCurId && getCurId() === avatarId);
    },
    async updatePersonaInPlace(avatarId, description, lorebook) {
      const rep = getFn('replacePersona');
      if (!rep) throw new Error('当前酒馆助手版本不支持 replacePersona');
      const patch = { description: String(description || '') };
      if (typeof lorebook === 'string') patch.lorebook = lorebook;
      await rep(avatarId || 'current', patch, { render: 'immediate' });
    },
    async deletePersonaById(avatarId) {
      const del = getFn('deletePersona');
      if (!del) throw new Error('当前酒馆助手版本不支持 deletePersona');
      return await del(avatarId);
    },

    listWorldbooks() {
      const fn = getFn('getWorldbookNames');
      try { return fn ? (fn() || []) : []; } catch (_) { return []; }
    },
    getGlobalWorldbooks() {
      const fn = getFn('getGlobalWorldbookNames');
      try { return fn ? (fn() || []) : []; } catch (_) { return []; }
    },
    async setGlobalWorldbooks(names) {
      const fn = getFn('rebindGlobalWorldbooks');
      if (fn) await fn(names);
    },
    getCharWorldbooks() {
      const fn = getFn('getCharWorldbookNames');
      try {
        const ch = readCurrentCharInfo();
        if (!ch.name) return { primary: null, additional: [] };
        return fn ? (fn('current') || { primary: null, additional: [] }) : { primary: null, additional: [] };
      } catch (_) {
        return { primary: null, additional: [] };
      }
    },
    async setCharWorldbooks(wbObj) {
      const fn = getFn('rebindCharWorldbooks');
      if (fn && wbObj) await fn('current', wbObj);
    },
    getChatWorldbook() {
      const fn = getFn('getChatWorldbookName');
      try { return fn ? (fn('current') || null) : null; } catch (_) { return null; }
    },
    async setChatWorldbook(name) {
      const fn = getFn('rebindChatWorldbook');
      if (fn) await fn('current', name || '');
    },
    async getWorldbookEntries(bookName) {
      const fn = getFn('getWorldbook');
      if (!fn || !bookName) return [];
      try { return (await fn(bookName)) || []; } catch (_) { return []; }
    },
    async toggleWorldbookEntry(bookName, uidNum, enabled) {
      const fn = getFn('updateWorldbookWith');
      if (!fn) throw new Error('不支持 updateWorldbookWith');
      await fn(bookName, entries => {
        entries.forEach(e => {
          if (String(e.uid) === String(uidNum)) e.enabled = !!enabled;
        });
        return entries;
      });
    },
    async batchToggleWorldbookEntries(bookName, uidMap) {
      const fn = getFn('updateWorldbookWith');
      if (!fn) throw new Error('不支持 updateWorldbookWith');
      let changed = 0;
      let skipped = 0;
      const wantedKeys = Object.keys(uidMap || {});
      const matched = new Set();
      await fn(bookName, entries => {
        entries.forEach(e => {
          const k = String(e.uid);
          if (Object.prototype.hasOwnProperty.call(uidMap, k)) {
            matched.add(k);
            const target = !!uidMap[k];
            if (e.enabled !== target) {
              e.enabled = target;
              changed++;
            }
          }
        });
        return entries;
      });
      wantedKeys.forEach(k => { if (!matched.has(k)) skipped++; });
      return { changed, skipped };
    },
    async updateWorldbookEntry(bookName, uidNum, name, content, strategyType) {
      const fn = getFn('updateWorldbookWith');
      if (!fn) throw new Error('不支持 updateWorldbookWith');
      await fn(bookName, entries => {
        entries.forEach(e => {
          if (String(e.uid) === String(uidNum)) {
            e.name = name;
            e.content = content;
            if (strategyType && e.strategy) e.strategy.type = strategyType;
          }
        });
        return entries;
      });
    },
    async createWorldbookEntry(bookName, { name, content, strategyType }) {
      const fn = getFn('createWorldbookEntries');
      if (!fn) throw new Error('不支持 createWorldbookEntries');
      await fn(bookName, [{
        name: name || '新条目',
        enabled: true,
        content: content || '',
        strategy: {
          type: strategyType || 'constant',
          keys: [],
          keys_secondary: { logic: 'and_any', keys: [] },
          scan_depth: 'same_as_global',
        },
        position: {
          type: 'after_character_definition',
          role: 'system',
          depth: 2,
          order: 100,
        },
      }]);
    },

    listPresets() {
      const fn = getFn('getPresetNames');
      try { return fn ? (fn() || []) : []; } catch (_) { return []; }
    },
    getLoadedPresetName() {
      const fn = getFn('getLoadedPresetName');
      try { return fn ? (fn() || '') : ''; } catch (_) { return ''; }
    },
    loadPreset(name) {
      const fn = getFn('loadPreset');
      return fn ? !!fn(name) : false;
    },
    getInUsePreset() {
      const fn = getFn('getPreset');
      try { return fn ? fn('in_use') : null; } catch (_) { return null; }
    },
    async togglePresetPrompt(promptId, enabled) {
      const fn = getFn('updatePresetWith');
      if (!fn) throw new Error('不支持 updatePresetWith');
      await fn('in_use', preset => {
        (preset.prompts || []).forEach(p => {
          if (p.id === promptId) p.enabled = !!enabled;
        });
        return preset;
      }, { render: 'debounced' });
    },
    async togglePresetGroup(groupId, enabled) {
      const fn = getFn('updatePresetWith');
      if (!fn) throw new Error('不支持 updatePresetWith');
      await fn('in_use', preset => {
        const groups = preset.extensions?.baibaiToolkit?.presetPromptGroups?.groups;
        if (Array.isArray(groups)) {
          groups.forEach(g => {
            if (String(g.id) === String(groupId)) g.enabled = !!enabled;
          });
        }
        return preset;
      }, { render: 'immediate' });
    },
    async batchTogglePresetStates(promptMap, groupMap) {
      const fn = getFn('updatePresetWith');
      if (!fn) throw new Error('不支持 updatePresetWith');
      let changed = 0;
      let skipped = 0;
      const wantedPrompts = Object.keys(promptMap || {});
      const matchedPrompts = new Set();
      const wantedGroups = Object.keys(groupMap || {});
      const matchedGroups = new Set();

      await fn('in_use', preset => {
        (preset.prompts || []).forEach(p => {
          if (Object.prototype.hasOwnProperty.call(promptMap || {}, p.id)) {
            matchedPrompts.add(p.id);
            const target = !!promptMap[p.id];
            if (p.enabled !== target) {
              p.enabled = target;
              changed++;
            }
          }
        });
        const groups = preset.extensions?.baibaiToolkit?.presetPromptGroups?.groups;
        if (Array.isArray(groups) && wantedGroups.length) {
          groups.forEach(g => {
            const gid = String(g.id);
            if (Object.prototype.hasOwnProperty.call(groupMap, gid)) {
              matchedGroups.add(gid);
              const target = !!groupMap[gid];
              if ((g.enabled !== false) !== target) {
                g.enabled = target;
                changed++;
              }
            }
          });
        }
        return preset;
      }, { render: 'immediate' });

      wantedPrompts.forEach(k => { if (!matchedPrompts.has(k)) skipped++; });
      wantedGroups.forEach(k => { if (!matchedGroups.has(k)) skipped++; });
      return { changed, skipped };
    },
    async updatePresetPrompt(promptId, name, content) {
      const fn = getFn('updatePresetWith');
      if (!fn) throw new Error('不支持 updatePresetWith');
      await fn('in_use', preset => {
        (preset.prompts || []).forEach(p => {
          if (p.id === promptId) {
            p.name = name;
            if (typeof p.content === 'string' || content !== undefined) {
              p.content = content;
            }
          }
        });
        return preset;
      }, { render: 'immediate' });
    },

    getRegexes(scope) {
      const fn = getFn('getTavernRegexes');
      if (!fn) return [];
      try {
        if (scope === 'character') {
          const ch = readCurrentCharInfo();
          if (!ch.name) return [];
          return fn({ type: 'character', name: 'current' }) || [];
        }
        if (scope === 'preset') {
          return fn({ type: 'preset', name: 'in_use' }) || [];
        }
        return fn({ type: 'global' }) || [];
      } catch (_) {
        return [];
      }
    },
    async toggleRegex(scope, id, enabled) {
      const fn = getFn('updateTavernRegexesWith');
      if (!fn) throw new Error('不支持 updateTavernRegexesWith');
      const opt = scope === 'character'
        ? { type: 'character', name: 'current' }
        : scope === 'preset'
          ? { type: 'preset', name: 'in_use' }
          : { type: 'global' };
      await fn(list => {
        list.forEach(r => { if (r.id === id) r.enabled = !!enabled; });
        return list;
      }, opt);
    },
    async batchToggleRegexes(scope, idMap) {
      const fn = getFn('updateTavernRegexesWith');
      if (!fn) return { changed: 0, skipped: 0 };
      const wantedKeys = Object.keys(idMap || {});
      if (!wantedKeys.length) return { changed: 0, skipped: 0 };
      const opt = scope === 'character'
        ? { type: 'character', name: 'current' }
        : scope === 'preset'
          ? { type: 'preset', name: 'in_use' }
          : { type: 'global' };
      let changed = 0;
      let skipped = 0;
      const matched = new Set();
      try {
        await fn(list => {
          list.forEach(r => {
            if (Object.prototype.hasOwnProperty.call(idMap, r.id)) {
              matched.add(r.id);
              const target = !!idMap[r.id];
              if (r.enabled !== target) {
                r.enabled = target;
                changed++;
              }
            }
          });
          return list;
        }, opt);
      } catch (_) {
        return { changed: 0, skipped: wantedKeys.length };
      }
      wantedKeys.forEach(k => { if (!matched.has(k)) skipped++; });
      return { changed, skipped };
    },
  };

  // =========================
  // Cleanup Old Instance
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

  function listen(target, type, fn, opts) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, fn, opts);
    cleanup.push(() => { try { target.removeEventListener(type, fn, opts); } catch (_) {} });
  }

  // =========================
  // Snapshot Capture & Apply
  // =========================

  function getDefaultSnapshotBooks(store) {
    const set = new Set();
    (store.settings.pinnedWorldbooks || []).forEach(b => set.add(b));
    Host.getGlobalWorldbooks().forEach(b => set.add(b));
    const cw = Host.getCharWorldbooks();
    if (cw.primary) set.add(cw.primary);
    (cw.additional || []).forEach(b => set.add(b));
    const chatWb = Host.getChatWorldbook();
    if (chatWb) set.add(chatWb);
    const curP = Host.getCurrentPersona();
    if (curP && curP.lorebook) set.add(curP.lorebook);
    return Array.from(set).filter(Boolean);
  }

  function findMatchingPersonaVersion(store, avatarId, liveDesc) {
    const list = (store.personaVersions && store.personaVersions[avatarId]) || [];
    return list.find(v => String(v.description || '') === String(liveDesc || '')) || null;
  }

  function autoBackupPersonaBeforeOverwrite(store, persona) {
    if (!persona || !persona.avatar_id) return;
    const desc = String(persona.description || '');
    if (!desc.trim()) return;
    const list = store.personaVersions[persona.avatar_id] || [];
    if (list.some(v => v.description === desc)) return;
    const backupName = '切换前备份';
    const next = list.filter(v => v.name !== backupName);
    next.unshift({
      id: uid('pv'),
      name: backupName,
      description: desc,
      lorebook: persona.lorebook || '',
      updatedAt: Date.now(),
    });
    store.personaVersions[persona.avatar_id] = next;
  }

  async function captureLiveSnapshot(opts, store) {
    const scope = {
      persona: !!opts.scope.persona,
      worldbooks: !!opts.scope.worldbooks,
      preset: !!opts.scope.preset,
      regex: !!opts.scope.regex,
    };

    const snap = {
      id: opts.id || uid('snap'),
      name: String(opts.name || '未命名快照').trim().slice(0, 60),
      group: String(opts.group || '').trim().slice(0, 30),
      note: String(opts.note || '').trim().slice(0, 120),
      updatedAt: Date.now(),
      scope,
      persona: null,
      worldbooks: null,
      preset: null,
      regex: null,
    };

    if (scope.persona) {
      const p = Host.getCurrentPersona();
      if (p) {
        const matched = findMatchingPersonaVersion(store, p.avatar_id, p.description);
        snap.persona = {
          avatarId: p.avatar_id,
          name: p.name,
          versionId: matched ? matched.id : '',
          versionName: matched ? matched.name : '',
          description: p.description || '',
          lorebook: p.lorebook || '',
        };
      } else {
        snap.scope.persona = false;
      }
    }

    if (scope.worldbooks) {
      const booksToCapture = Array.isArray(opts.selectedBooks) ? opts.selectedBooks : getDefaultSnapshotBooks(store);
      const entries = {};
      for (const bk of booksToCapture) {
        const list = await Host.getWorldbookEntries(bk);
        if (!list.length) continue;
        const map = {};
        list.forEach(e => { map[String(e.uid)] = !!e.enabled; });
        entries[bk] = map;
      }
      const ch = readCurrentCharInfo();
      snap.worldbooks = {
        global: Host.getGlobalWorldbooks(),
        char: ch.name ? Host.getCharWorldbooks() : null,
        chat: readCurrentChatId() ? Host.getChatWorldbook() : null,
        entries,
      };
    }

    if (scope.preset) {
      const pName = Host.getLoadedPresetName();
      const preset = Host.getInUsePreset();
      if (preset && Array.isArray(preset.prompts)) {
        const map = {};
        preset.prompts.forEach(p => { map[p.id] = !!p.enabled; });
        const grpMap = {};
        const { groups } = extractPresetGroups(preset);
        groups.forEach(g => { grpMap[g.id] = g.enabled !== false; });
        snap.preset = { name: pName, prompts: map, groups: grpMap };
      } else {
        snap.scope.preset = false;
      }
    }

    if (scope.regex) {
      const mapList = list => {
        const m = {};
        (list || []).forEach(r => { if (r && r.id) m[r.id] = !!r.enabled; });
        return m;
      };
      snap.regex = {
        global: mapList(Host.getRegexes('global')),
        character: mapList(Host.getRegexes('character')),
        preset: mapList(Host.getRegexes('preset')),
      };
    }

    return snap;
  }

  let isApplyingSnapshot = false;
  async function applySnapshotLive(snap, store, silentPrefix) {
    if (!snap || isApplyingSnapshot) return;
    isApplyingSnapshot = true;
    let totalSkipped = 0;

    try {
      if (snap.scope.persona && snap.persona && snap.persona.avatarId) {
        const personas = Host.listPersonas();
        const target = personas.find(p => p.avatar_id === snap.persona.avatarId)
          || personas.find(p => p.name === snap.persona.name);
        if (target) {
          await Host.switchPersona(target.avatar_id, target.name);
          let desc = snap.persona.description;
          let lorebook = snap.persona.lorebook;
          if (snap.persona.versionId) {
            const verList = (store.personaVersions && store.personaVersions[target.avatar_id]) || [];
            const foundVer = verList.find(v => v.id === snap.persona.versionId);
            if (foundVer) {
              desc = foundVer.description;
              lorebook = foundVer.lorebook;
            }
          }
          if (target.description !== desc || (typeof lorebook === 'string' && target.lorebook !== lorebook)) {
            autoBackupPersonaBeforeOverwrite(store, target);
            persistStore(store);
            await Host.updatePersonaInPlace(target.avatar_id, desc, lorebook);
          }
        } else {
          totalSkipped++;
        }
      }

      if (snap.scope.worldbooks && snap.worldbooks) {
        const allBooks = new Set(Host.listWorldbooks());
        if (Array.isArray(snap.worldbooks.global)) {
          const validGlobal = snap.worldbooks.global.filter(b => allBooks.has(b));
          totalSkipped += snap.worldbooks.global.length - validGlobal.length;
          await Host.setGlobalWorldbooks(validGlobal);
        }
        if (snap.worldbooks.char && readCurrentCharInfo().name) {
          const primary = snap.worldbooks.char.primary && allBooks.has(snap.worldbooks.char.primary)
            ? snap.worldbooks.char.primary : null;
          const additional = (snap.worldbooks.char.additional || []).filter(b => allBooks.has(b));
          await Host.setCharWorldbooks({ primary, additional });
        }
        if (snap.worldbooks.chat !== null && readCurrentChatId()) {
          if (!snap.worldbooks.chat || allBooks.has(snap.worldbooks.chat)) {
            await Host.setChatWorldbook(snap.worldbooks.chat || '');
          } else {
            totalSkipped++;
          }
        }
        const entriesMap = snap.worldbooks.entries || {};
        for (const bk of Object.keys(entriesMap)) {
          if (!allBooks.has(bk)) {
            totalSkipped++;
            continue;
          }
          const res = await Host.batchToggleWorldbookEntries(bk, entriesMap[bk]);
          totalSkipped += res.skipped;
        }
      }

      if (snap.scope.preset && snap.preset) {
        const allPresets = Host.listPresets();
        if (snap.preset.name && allPresets.includes(snap.preset.name)) {
          if (Host.getLoadedPresetName() !== snap.preset.name) {
            Host.loadPreset(snap.preset.name);
            await new Promise(r => Env.pwin.setTimeout(r, 120));
          }
          const res = await Host.batchTogglePresetStates(snap.preset.prompts || {}, snap.preset.groups || {});
          totalSkipped += res.skipped;
        } else if (snap.preset.name) {
          totalSkipped++;
        }
      }

      if (snap.scope.regex && snap.regex) {
        for (const sc of ['global', 'character', 'preset']) {
          if (sc === 'character' && !readCurrentCharInfo().name) continue;
          const res = await Host.batchToggleRegexes(sc, snap.regex[sc] || {});
          totalSkipped += res.skipped;
        }
      }

      const prefix = silentPrefix || '已应用快照';
      toast(totalSkipped > 0
        ? `${prefix}「${snap.name}」（跳过 ${totalSkipped} 项缺失引用）`
        : `${prefix}「${snap.name}」`, 'success');
    } catch (err) {
      console.error('[User快照] 应用失败', err);
      toast('应用快照失败：' + (err?.message || err), 'error');
    } finally {
      isApplyingSnapshot = false;
    }
  }

  // =========================
  // Icons (Crisp Inline SVG)
  // =========================

  const ICONS = {
    close: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    star: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21 7 14.2 2 9.3l6.9-1z"/></svg>',
    starFill: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21 7 14.2 2 9.3l6.9-1z"/></svg>',
    copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    refresh: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/></svg>',
    edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    diff: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M5 8h4M7 6v4M15 16h4"/></svg>',
    merge: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M6 8.5v2a3.5 3.5 0 0 0 3.5 3.5h5A3.5 3.5 0 0 0 18 10.5v-2M12 14v1.5"/></svg>',
    backup: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    eye: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
    chevron: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    warn: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    camera: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  };

  // =========================
  // Styles (Liquid Glass, Fixed Height, Persistent Footer Flow)
  // =========================

  const STYLE_CSS = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 13px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }

.upp-backdrop {
  --bg: rgba(247, 249, 253, 0.95);
  --surface: rgba(255, 255, 255, 0.78);
  --surface-strong: rgba(255, 255, 255, 0.96);
  --surface-hover: rgba(58, 123, 213, 0.08);
  --border: rgba(25, 36, 56, 0.11);
  --border-strong: rgba(25, 36, 56, 0.18);
  --text: #1c2434;
  --muted: #647087;
  --accent: #3a7bd5;
  --accent-soft: rgba(58, 123, 213, 0.12);
  --accent-text: #ffffff;
  --ok: #1d9a6c;
  --ok-soft: rgba(29, 154, 108, 0.13);
  --warn: #c77716;
  --warn-soft: rgba(199, 119, 22, 0.13);
  --danger: #d64545;
  --danger-soft: rgba(214, 69, 69, 0.11);
  --switch-off: rgba(28, 36, 52, 0.18);
  --shadow: 0 22px 60px rgba(18, 28, 48, 0.18);

  position: fixed;
  inset: 0;
  z-index: 2147483000;
  background: rgba(16, 22, 34, 0.36);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  color: var(--text);
}

.upp-backdrop[data-theme="dark"] {
  --bg: rgba(24, 28, 37, 0.96);
  --surface: rgba(36, 42, 56, 0.78);
  --surface-strong: rgba(42, 49, 64, 0.96);
  --surface-hover: rgba(104, 160, 245, 0.13);
  --border: rgba(255, 255, 255, 0.1);
  --border-strong: rgba(255, 255, 255, 0.18);
  --text: #edf1f8;
  --muted: #98a3b8;
  --accent: #68a0f5;
  --accent-soft: rgba(104, 160, 245, 0.16);
  --accent-text: #0f1624;
  --ok: #42c994;
  --ok-soft: rgba(66, 201, 148, 0.16);
  --warn: #f0ab4c;
  --warn-soft: rgba(240, 171, 76, 0.16);
  --danger: #f06a6a;
  --danger-soft: rgba(240, 106, 106, 0.16);
  --switch-off: rgba(255, 255, 255, 0.2);
  --shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
  background: rgba(5, 8, 14, 0.62);
}

.upp-modal {
  position: relative;
  width: min(760px, calc(100vw - 24px));
  height: min(680px, 86dvh);
  background: var(--bg);
  backdrop-filter: blur(22px) saturate(150%);
  -webkit-backdrop-filter: blur(22px) saturate(150%);
  border: 1px solid var(--border-strong);
  border-radius: 18px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Header */
.upp-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 16px 9px;
  border-bottom: 1px solid var(--border);
}
.upp-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.upp-title {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.01em;
  white-space: nowrap;
}
.upp-ctx-chip {
  font-size: 11px;
  color: var(--muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px 8px;
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.upp-head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 5 Single-Purpose Nav Tabs */
.upp-tabs {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  overflow-x: auto;
  scrollbar-width: none;
}
.upp-tabs::-webkit-scrollbar { display: none; }
.upp-tab {
  height: 30px;
  padding: 0 12px;
  border-radius: 9px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background 0.14s, color 0.14s, border-color 0.14s;
}
.upp-tab:hover { color: var(--text); background: var(--surface-hover); }
.upp-tab.active {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: rgba(58, 123, 213, 0.28);
}
.upp-tab-count {
  font-size: 11px;
  opacity: 0.78;
}

/* Pinned Toolbar */
.upp-toolbar {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
}
.upp-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.upp-row-nowrap {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.upp-spacer { flex: 1; min-width: 4px; }

/* Uniform Controls (height 30px, radius 9px) */
.upp-btn, .upp-select, .upp-input-wrap {
  height: 30px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: var(--surface-strong);
  color: var(--text);
  font-size: 12px;
  font-family: inherit;
}
.upp-btn {
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.upp-btn:hover { background: var(--surface-hover); border-color: var(--border-strong); }
.upp-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.upp-btn.icon-only { width: 30px; padding: 0; }
.upp-btn.primary {
  background: var(--accent);
  color: var(--accent-text);
  border-color: var(--accent);
  font-weight: 550;
}
.upp-btn.primary:hover { filter: brightness(1.06); }
.upp-btn.active {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: rgba(58, 123, 213, 0.35);
}
.upp-btn.danger { color: var(--danger); }
.upp-btn.danger:hover { background: var(--danger-soft); border-color: rgba(214, 69, 69, 0.35); }
.upp-btn.pinned { color: var(--warn); background: var(--warn-soft); border-color: rgba(199, 119, 22, 0.32); }

.upp-select {
  padding: 0 24px 0 9px;
  cursor: pointer;
  max-width: 220px;
  outline: none;
}
.upp-select:focus { border-color: var(--accent); }

.upp-input-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 9px;
  flex: 1;
  min-width: 120px;
}
.upp-input-wrap svg { color: var(--muted); flex-shrink: 0; }
.upp-input-wrap input {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  font-family: inherit;
  outline: none;
}
.upp-input-wrap input::placeholder { color: var(--muted); }

/* Toggle Switch */
.upp-switch {
  position: relative;
  width: 34px;
  height: 20px;
  border-radius: 999px;
  border: none;
  background: var(--switch-off);
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  transition: background 0.16s ease;
}
.upp-switch::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.22);
  transition: transform 0.16s ease;
}
.upp-switch[aria-checked="true"] { background: var(--accent); }
.upp-switch[aria-checked="true"]::after { transform: translateX(14px); }

.upp-switch-label {
  height: 30px;
  padding: 0 9px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: var(--surface-strong);
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  user-select: none;
}

/* Scroll Body */
.upp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 12px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.upp-body > * { flex-shrink: 0; }
.upp-body::-webkit-scrollbar,
.upp-drawer-body::-webkit-scrollbar,
.upp-pop-list::-webkit-scrollbar { width: 5px; height: 5px; }
.upp-body::-webkit-scrollbar-thumb,
.upp-drawer-body::-webkit-scrollbar-thumb,
.upp-pop-list::-webkit-scrollbar-thumb {
  background: rgba(120, 132, 154, 0.35);
  border-radius: 999px;
}

/* Persistent Workflow Footer (Always visible on every tab!) */
.upp-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 16px;
  border-top: 1px solid var(--border);
  background: var(--surface);
}
.upp-foot-status {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.upp-foot-status strong {
  color: var(--text);
  font-weight: 600;
}
.upp-foot-actions {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
}
.upp-foot-actions .upp-btn {
  height: 32px;
  padding: 0 12px;
}

/* Pill Chips */
.upp-pill-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 1px;
  scrollbar-width: none;
}
.upp-pill-strip::-webkit-scrollbar { display: none; }
.upp-pill {
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.upp-pill:hover { color: var(--text); border-color: var(--border-strong); }
.upp-pill.active {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: rgba(58, 123, 213, 0.35);
  font-weight: 550;
}

/* Cards & Entry Rows */
.upp-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 13px;
  padding: 11px 13px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.upp-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.upp-card-title {
  font-size: 13.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.upp-card-meta {
  font-size: 11.5px;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.upp-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  border: 1px solid var(--border);
  background: var(--surface-strong);
  color: var(--muted);
  white-space: nowrap;
}
.upp-badge.accent { color: var(--accent); background: var(--accent-soft); border-color: rgba(58, 123, 213, 0.28); }
.upp-badge.ok { color: var(--ok); background: var(--ok-soft); border-color: rgba(29, 154, 108, 0.28); }
.upp-badge.warn { color: var(--warn); background: var(--warn-soft); border-color: rgba(199, 119, 22, 0.3); }

/* BaiBai Collapsible Preset Group Block */
.upp-group-box {
  border: 1px solid var(--border);
  border-radius: 13px;
  background: var(--surface);
  overflow: hidden;
}
.upp-group-box.is-disabled {
  opacity: 0.72;
}
.upp-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 11px;
  background: var(--surface-strong);
}
.upp-group-toggle-btn {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  background: none;
  border: none;
  padding: 0;
  color: var(--text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
}
.upp-group-chev {
  display: inline-flex;
  color: var(--muted);
  transition: transform 0.14s ease;
  flex-shrink: 0;
}
.upp-group-box.is-collapsed .upp-group-chev {
  transform: rotate(-90deg);
}
.upp-group-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.upp-group-items {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px 8px 8px;
  border-top: 1px solid var(--border);
}
.upp-group-box.is-collapsed .upp-group-items {
  display: none;
}

.upp-entry-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.upp-entry-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface);
  transition: background 0.12s, border-color 0.12s;
}
.upp-entry-row:hover {
  background: var(--surface-strong);
  border-color: var(--border-strong);
}
.upp-entry-row.is-on {
  border-color: rgba(58, 123, 213, 0.28);
  background: var(--surface-strong);
}
.upp-entry-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  padding: 0;
  text-align: left;
  color: inherit;
  cursor: pointer;
  font: inherit;
}
.upp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.upp-dot.constant { background: #3b82f6; }
.upp-dot.selective { background: #22c55e; }
.upp-dot.vectorized { background: #a855f7; }
.upp-role-tag {
  font-size: 10px;
  font-weight: 650;
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--accent-soft);
  color: var(--accent);
  flex-shrink: 0;
  text-transform: uppercase;
}
.upp-role-tag.placeholder {
  background: var(--surface);
  color: var(--muted);
  border: 1px solid var(--border);
}
.upp-entry-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.upp-entry-name {
  font-size: 13px;
  font-weight: 520;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.upp-entry-preview {
  font-size: 11.5px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* User Tab Preview */
.upp-persona-live-box {
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--text);
  background: var(--surface-strong);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  max-height: 150px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  cursor: pointer;
}
.upp-persona-live-box:hover { border-color: var(--accent); }
.upp-persona-live-box.is-empty { color: var(--muted); }

/* Book Selector */
.upp-book-trigger {
  flex: 1;
  min-width: 140px;
  max-width: 280px;
  justify-content: space-between;
}
.upp-book-trigger span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Binding Strip */
.upp-bind-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 11px;
  border-radius: 10px;
  background: var(--accent-soft);
  border: 1px solid rgba(58, 123, 213, 0.25);
  font-size: 12px;
}

/* Empty State */
.upp-empty {
  text-align: center;
  color: var(--muted);
  padding: 36px 16px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

/* Sub-Drawer Overlay */
.upp-drawer-mask {
  position: absolute;
  inset: 0;
  z-index: 20;
  background: rgba(15, 22, 36, 0.34);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.upp-drawer {
  width: min(620px, 100%);
  max-height: 100%;
  background: var(--surface-strong);
  border: 1px solid var(--border-strong);
  border-radius: 15px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.upp-drawer-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  font-weight: 600;
  font-size: 14px;
}
.upp-drawer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 13px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.upp-drawer-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--border);
}

.upp-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.upp-field label {
  font-size: 12px;
  color: var(--muted);
  font-weight: 550;
}
.upp-text-input, .upp-textarea {
  width: 100%;
  border-radius: 9px;
  border: 1px solid var(--border-strong);
  background: var(--bg);
  color: var(--text);
  font-family: inherit;
  font-size: 12.5px;
  padding: 7px 10px;
  outline: none;
}
.upp-text-input:focus, .upp-textarea:focus { border-color: var(--accent); }
.upp-textarea {
  min-height: 180px;
  resize: vertical;
  line-height: 1.55;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "PingFang SC", monospace;
}

.upp-check-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.upp-check-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 9px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: var(--surface);
  cursor: pointer;
  font-size: 12px;
  user-select: none;
}
.upp-check-item input { accent-color: var(--accent); margin: 0; }
.upp-check-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.upp-pop-list {
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px;
  background: var(--bg);
}

/* Diff View */
.upp-diff-box {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  padding: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  max-height: 300px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.upp-diff-line { padding: 1px 6px; border-radius: 4px; }
.upp-diff-line.del { background: var(--danger-soft); color: var(--danger); }
.upp-diff-line.add { background: var(--ok-soft); color: var(--ok); }
.upp-diff-line.same { color: var(--muted); }

/* Detail Section inside Snapshot View */
.upp-sec-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 2px;
}
.upp-detail-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 9px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg);
  cursor: pointer;
  font-size: 12px;
  color: var(--text);
  text-align: left;
  width: 100%;
}
.upp-detail-item:hover { border-color: var(--accent); background: var(--surface-hover); }

@media (max-width: 640px) {
  .upp-backdrop { padding: 0; align-items: flex-end; }
  .upp-modal {
    width: 100vw;
    height: 86dvh;
    border-radius: 18px 18px 0 0;
    border-bottom: none;
  }
  .upp-header { padding: 10px 12px 8px; }
  .upp-tabs { padding: 7px 12px; gap: 4px; }
  .upp-tab { padding: 0 9px; font-size: 12px; }
  .upp-toolbar { padding: 8px 12px; }
  .upp-body { padding: 10px 12px 12px; }
  .upp-footer { padding: 9px 12px; }
  .upp-check-grid { grid-template-columns: 1fr; }
}
`;

  // =========================
  // UI State & Shadow Host
  // =========================

  const state = {
    open: false,
    tab: 'snapshots', // snapshots | user | worldbook | preset | regex
    store: loadStoreSync(),
    charInfo: { id: '', name: '' },
    chatId: '',

    snapGroup: '',
    snapSearch: '',

    personas: [],
    currentPersona: null,

    worldbooks: [],
    globalWorldbooks: [],
    charWorldbooks: { primary: null, additional: [] },
    chatWorldbook: null,
    activeBook: '',
    bookEntriesCache: {},
    wbEntrySearch: '',
    wbOnlyOn: false,

    presets: [],
    loadedPresetName: '',
    inUsePreset: null,
    presetSearch: '',
    presetOnlyOn: false,
    presetFoldState: {}, // `${presetName}::${groupId}` -> boolean (true = collapsed)

    regexScope: 'global',
    regexList: [],
    regexSearch: '',
    regexOnlyOn: false,

    drawer: null,
  };

  const host = Env.pdoc.createElement('div');
  host.id = APP_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${STYLE_CSS}</style>
<div class="upp-backdrop" hidden>
  <div class="upp-modal" role="dialog" aria-modal="true" aria-label="User 组装与快照">
    <div class="upp-header">
      <div class="upp-title-wrap">
        <span class="upp-title">User 组装与快照</span>
        <span class="upp-ctx-chip" id="upp-ctx-chip" hidden></span>
      </div>
      <div class="upp-head-actions">
        <button class="upp-btn icon-only" id="upp-refresh-btn" title="刷新">${ICONS.refresh}</button>
        <button class="upp-btn icon-only" id="upp-close-btn" title="关闭">${ICONS.close}</button>
      </div>
    </div>
    <div class="upp-tabs" id="upp-tabs"></div>
    <div class="upp-toolbar" id="upp-toolbar"></div>
    <div class="upp-body" id="upp-body"></div>
    <div class="upp-footer" id="upp-footer"></div>
    <div class="upp-drawer-mask" id="upp-drawer-mask" hidden></div>
  </div>
</div>`;

  const elBackdrop = shadow.querySelector('.upp-backdrop');
  const elCtxChip = shadow.getElementById('upp-ctx-chip');
  const elTabs = shadow.getElementById('upp-tabs');
  const elToolbar = shadow.getElementById('upp-toolbar');
  const elBody = shadow.getElementById('upp-body');
  const elFooter = shadow.getElementById('upp-footer');
  const elDrawerMask = shadow.getElementById('upp-drawer-mask');

  // =========================
  // Data Refresh
  // =========================

  async function ensureBookEntries(bookName, force) {
    if (!bookName) return [];
    if (!force && Array.isArray(state.bookEntriesCache[bookName])) {
      return state.bookEntriesCache[bookName];
    }
    const list = await Host.getWorldbookEntries(bookName);
    state.bookEntriesCache[bookName] = list;
    return list;
  }

  async function refreshAll(forceBookReload) {
    state.store = loadStoreSync();
    state.charInfo = readCurrentCharInfo();
    state.chatId = readCurrentChatId();

    state.personas = Host.listPersonas();
    state.currentPersona = Host.getCurrentPersona();
    state.worldbooks = Host.listWorldbooks();
    state.globalWorldbooks = Host.getGlobalWorldbooks();
    state.charWorldbooks = Host.getCharWorldbooks();
    state.chatWorldbook = Host.getChatWorldbook();

    if (!state.activeBook || !state.worldbooks.includes(state.activeBook)) {
      const preferred = getDefaultSnapshotBooks(state.store).find(b => state.worldbooks.includes(b));
      state.activeBook = preferred || state.worldbooks[0] || '';
    }
    if (state.activeBook && (state.tab === 'worldbook' || forceBookReload)) {
      await ensureBookEntries(state.activeBook, !!forceBookReload);
    }

    state.presets = Host.listPresets();
    state.loadedPresetName = Host.getLoadedPresetName();
    state.inUsePreset = Host.getInUsePreset();
    state.regexList = Host.getRegexes(state.regexScope);

    render();
  }

  // =========================
  // Rendering
  // =========================

  function renderHeader() {
    const label = state.charInfo.name || (state.currentPersona ? state.currentPersona.name : '');
    if (label) {
      elCtxChip.textContent = label;
      elCtxChip.hidden = false;
    } else {
      elCtxChip.hidden = true;
    }
  }

  function renderTabs() {
    const snapCount = state.store.snapshots.length;
    const tabs = [
      { id: 'snapshots', label: '快照', count: snapCount || '' },
      { id: 'user', label: 'User', count: '' },
      { id: 'worldbook', label: '世界书', count: '' },
      { id: 'preset', label: '预设', count: '' },
      { id: 'regex', label: '正则', count: '' },
    ];
    elTabs.innerHTML = tabs.map(t => `
      <button class="upp-tab ${state.tab === t.id ? 'active' : ''}" data-tab="${t.id}">
        <span>${t.label}</span>
        ${t.count !== '' ? `<span class="upp-tab-count">${t.count}</span>` : ''}
      </button>
    `).join('');
  }

  function renderFooter() {
    const bound = resolveBindingForContext(state.store.bindings, state.chatId, state.charInfo.id);
    const boundSnap = bound ? state.store.snapshots.find(s => s.id === bound.snapshotId) : null;
    const parts = [];
    if (state.currentPersona?.name) parts.push(`User: ${state.currentPersona.name}`);
    if (state.loadedPresetName) parts.push(`预设: ${state.loadedPresetName}`);

    const statusHtml = boundSnap
      ? `<span>已绑定 <strong>${escapeHtml(boundSnap.name)}</strong></span>`
      : `<span>${escapeHtml(parts.join(' · ') || '组装完成后可随时保存为快照')}</span>`;

    elFooter.innerHTML = `
      <div class="upp-foot-status">${statusHtml}</div>
      <div class="upp-foot-actions">
        ${boundSnap ? `<button class="upp-btn" id="upp-foot-update-btn" data-snap-update="${boundSnap.id}">更新当前快照</button>` : ''}
        <button class="upp-btn primary" id="upp-foot-save-snap-btn">${ICONS.camera}<span>保存快照</span></button>
      </div>
    `;
  }

  // --- Tab 1: Snapshots ---
  function renderSnapshotsToolbar() {
    const snaps = state.store.snapshots;
    const groups = Array.from(new Set(snaps.map(s => s.group).filter(Boolean)));
    if (state.snapGroup && !groups.includes(state.snapGroup)) state.snapGroup = '';
    const autoOn = !!state.store.settings.autoApplyBindings;

    elToolbar.innerHTML = `
      <div class="upp-row">
        <div class="upp-input-wrap">
          ${ICONS.search}
          <input type="text" id="upp-snap-search" placeholder="搜索快照名称或分组…" value="${escapeHtml(state.snapSearch)}" />
        </div>
        <label class="upp-switch-label" title="切换聊天或角色时自动切回绑定快照">
          <span>自动切换</span>
          <button type="button" class="upp-switch" id="upp-auto-bind-sw" role="switch" aria-checked="${autoOn}"></button>
        </label>
        <button class="upp-btn" id="upp-backup-btn">${ICONS.backup}<span>备份</span></button>
      </div>
      ${groups.length ? `
        <div class="upp-pill-strip">
          <button class="upp-pill ${state.snapGroup === '' ? 'active' : ''}" data-snap-group="">全部</button>
          ${groups.map(g => `<button class="upp-pill ${state.snapGroup === g ? 'active' : ''}" data-snap-group="${escapeHtml(g)}">${escapeHtml(g)}</button>`).join('')}
        </div>
      ` : ''}
    `;
  }

  function renderSnapshotsBody() {
    const snaps = state.store.snapshots;
    const q = normalizeText(state.snapSearch);
    const filtered = snaps.filter(s => {
      if (state.snapGroup && s.group !== state.snapGroup) return false;
      if (q && !normalizeText(s.name + ' ' + s.group + ' ' + s.note).includes(q)) return false;
      return true;
    });

    const bound = resolveBindingForContext(state.store.bindings, state.chatId, state.charInfo.id);
    const boundSnap = bound ? snaps.find(s => s.id === bound.snapshotId) : null;

    let html = '';
    if (boundSnap) {
      const srcText = bound.source === 'chat' ? '本聊天' : '本角色';
      html += `
        <div class="upp-bind-strip">
          <span>${srcText}已绑定：<strong>${escapeHtml(boundSnap.name)}</strong></span>
          <div class="upp-row-nowrap">
            <button class="upp-btn" data-snap-apply="${boundSnap.id}">立即应用</button>
            <button class="upp-btn" data-unbind-src="${bound.source}">解绑</button>
          </div>
        </div>
      `;
    }

    if (!filtered.length) {
      html += `
        <div class="upp-empty">
          <span>${snaps.length ? '没有匹配的快照' : '先在上方各页调好 User、世界书、预设与正则，再点右下角「保存快照」'}</span>
          ${!snaps.length ? `<button class="upp-btn primary" data-open-save-snap>${ICONS.camera}<span>保存当前状态为第一份快照</span></button>` : ''}
        </div>
      `;
      elBody.innerHTML = html;
      return;
    }

    html += filtered.map(s => {
      const scopeBadges = [];
      if (s.scope.persona && s.persona) {
        const pvLabel = s.persona.versionName ? `${s.persona.name} · ${s.persona.versionName}` : s.persona.name;
        scopeBadges.push(`<span class="upp-badge accent">User: ${escapeHtml(pvLabel)}</span>`);
      }
      if (s.scope.worldbooks && s.worldbooks) {
        const bkCount = Object.keys(s.worldbooks.entries || {}).length;
        scopeBadges.push(`<span class="upp-badge">世界书 ${bkCount} 本</span>`);
      }
      if (s.scope.preset && s.preset) {
        scopeBadges.push(`<span class="upp-badge">预设: ${escapeHtml(s.preset.name || '当前')}</span>`);
      }
      if (s.scope.regex && s.regex) {
        scopeBadges.push(`<span class="upp-badge">正则</span>`);
      }
      const isChatBound = state.chatId && state.store.bindings.chats[state.chatId] === s.id;
      const isCharBound = state.charInfo.id && state.store.bindings.characters[state.charInfo.id] === s.id;

      return `
        <div class="upp-card">
          <div class="upp-card-head">
            <div class="upp-row-nowrap">
              <span class="upp-card-title">${escapeHtml(s.name)}</span>
              ${s.group ? `<span class="upp-badge">${escapeHtml(s.group)}</span>` : ''}
              ${isChatBound ? `<span class="upp-badge ok">本聊天</span>` : ''}
              ${isCharBound ? `<span class="upp-badge ok">本角色</span>` : ''}
            </div>
            <span class="upp-card-meta">${formatTimeShort(s.updatedAt)}</span>
          </div>
          <div class="upp-card-meta">${scopeBadges.join('')}</div>
          ${s.note ? `<div class="upp-card-meta">${escapeHtml(s.note)}</div>` : ''}
          <div class="upp-row">
            <button class="upp-btn primary" data-snap-apply="${s.id}">应用</button>
            <button class="upp-btn" data-snap-view="${s.id}">${ICONS.eye}<span>查看</span></button>
            <button class="upp-btn" data-snap-update="${s.id}">覆盖更新</button>
            <button class="upp-btn" data-snap-bind="${s.id}">${ICONS.link}<span>绑定</span></button>
            <div class="upp-spacer"></div>
            <button class="upp-btn icon-only danger" data-snap-del="${s.id}" title="删除快照">${ICONS.trash}</button>
          </div>
        </div>
      `;
    }).join('');

    elBody.innerHTML = html;
  }

  // --- Tab 2: User (Dedicated, Zero Proliferation) ---
  function renderUserToolbar() {
    const curP = state.currentPersona;
    const pVersions = curP ? (state.store.personaVersions[curP.avatar_id] || []) : [];
    const dupGroups = detectProliferatedPersonas(state.personas);
    const personaOptions = state.personas.map(p =>
      `<option value="${escapeHtml(p.avatar_id)}" ${curP && p.avatar_id === curP.avatar_id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('');

    elToolbar.innerHTML = `
      <div class="upp-row">
        <select class="upp-select" id="upp-persona-select" title="切换当前 User">${personaOptions || '<option value="">无可用 User</option>'}</select>
        <button class="upp-btn" id="upp-persona-edit-btn" ${curP ? '' : 'disabled'}>${ICONS.edit}<span>编辑正文</span></button>
        <button class="upp-btn" id="upp-persona-savever-btn" ${curP ? '' : 'disabled'}>${ICONS.plus}<span>存为版本</span></button>
        <button class="upp-btn" id="upp-persona-diff-btn" ${curP && pVersions.length ? '' : 'disabled'}>${ICONS.diff}<span>对比</span></button>
        <div class="upp-spacer"></div>
        <button class="upp-btn ${dupGroups.length ? 'active' : ''}" id="upp-persona-merge-btn" title="将同名或旧分身收回为内部版本">${ICONS.merge}<span>整理分身${dupGroups.length ? ' ' + dupGroups.length : ''}</span></button>
      </div>
    `;
  }

  function renderUserBody() {
    const curP = state.currentPersona;
    if (!curP) {
      elBody.innerHTML = `<div class="upp-empty">未读取到当前 User 人设</div>`;
      return;
    }

    const pVersions = state.store.personaVersions[curP.avatar_id] || [];
    const matchedVer = findMatchingPersonaVersion(state.store, curP.avatar_id, curP.description);
    const liveDesc = String(curP.description || '');

    let html = `
      <div class="upp-card">
        <div class="upp-card-head">
          <div class="upp-row-nowrap">
            <span class="upp-card-title">${escapeHtml(curP.name)}</span>
            ${matchedVer ? `<span class="upp-badge accent">${escapeHtml(matchedVer.name)}</span>` : '<span class="upp-badge">当前实时</span>'}
            ${curP.lorebook ? `<span class="upp-badge">绑定世界书: ${escapeHtml(curP.lorebook)}</span>` : ''}
          </div>
          <span class="upp-card-meta">${liveDesc.length} 字</span>
        </div>
        <div class="upp-persona-live-box ${liveDesc.trim() ? '' : 'is-empty'}" id="upp-persona-preview-box">${escapeHtml(liveDesc.trim() ? liveDesc : '暂无描述，点击编辑')}</div>
      </div>
      <div class="upp-sec-title" style="padding: 2px 2px;">
        <span>内部描述版本（不新建同名 User）</span>
        <span>${pVersions.length} 个</span>
      </div>
    `;

    if (!pVersions.length) {
      html += `<div class="upp-empty" style="padding: 24px 16px;">还没有保存过「${escapeHtml(curP.name)}」的内部版本，点上方「存为版本」或「整理分身」即可收纳。</div>`;
      elBody.innerHTML = html;
      return;
    }

    html += `<div class="upp-entry-list">` + pVersions.map(v => {
      const isCur = matchedVer && matchedVer.id === v.id;
      const snippet = String(v.description || '').replace(/\s+/g, ' ').trim().slice(0, 72);
      return `
        <div class="upp-entry-row ${isCur ? 'is-on' : ''}">
          <button class="upp-entry-main" data-pv-view="${v.id}">
            <div class="upp-entry-text">
              <div class="upp-entry-name">${escapeHtml(v.name)} ${isCur ? '<span class="upp-badge accent" style="margin-left:4px;">使用中</span>' : ''}</div>
              <div class="upp-entry-preview">${escapeHtml(snippet || '空描述')}</div>
            </div>
          </button>
          <button class="upp-btn ${isCur ? '' : 'primary'}" data-pv-apply="${v.id}" ${isCur ? 'disabled' : ''}>${isCur ? '当前' : '切换'}</button>
          <button class="upp-btn icon-only danger" data-pv-del-inline="${v.id}" title="删除版本">${ICONS.trash}</button>
        </div>
      `;
    }).join('') + `</div>`;

    elBody.innerHTML = html;
  }

  // --- Tab 3: Worldbooks ---
  function renderWorldbookToolbar() {
    const activeBook = state.activeBook;
    const isPinned = activeBook && state.store.settings.pinnedWorldbooks.includes(activeBook);
    const isGlobal = activeBook && state.globalWorldbooks.includes(activeBook);

    elToolbar.innerHTML = `
      <div class="upp-row">
        <button class="upp-btn upp-book-trigger" id="upp-book-picker-btn" title="选择或搜索世界书">
          <span>${escapeHtml(activeBook || '选择世界书')}</span>
          ${ICONS.chevron}
        </button>
        <button class="upp-btn icon-only ${isPinned ? 'pinned' : ''}" id="upp-pin-book-btn" title="${isPinned ? '取消置顶' : '置顶常用世界书'}" ${activeBook ? '' : 'disabled'}>${isPinned ? ICONS.starFill : ICONS.star}</button>
        <button class="upp-btn ${isGlobal ? 'active' : ''}" id="upp-global-book-btn" title="全局绑定开关" ${activeBook ? '' : 'disabled'}>全局</button>
        <div class="upp-spacer"></div>
        <button class="upp-btn" id="upp-new-wb-entry-btn" ${activeBook ? '' : 'disabled'}>${ICONS.plus}<span>新建条目</span></button>
        <button class="upp-btn icon-only" id="upp-copy-wb-btn" title="复制已开条目纯文本" ${activeBook ? '' : 'disabled'}>${ICONS.copy}</button>
      </div>
      <div class="upp-row">
        <div class="upp-input-wrap">
          ${ICONS.search}
          <input type="text" id="upp-wb-search" placeholder="搜索条目标题或正文…" value="${escapeHtml(state.wbEntrySearch)}" />
        </div>
        <button class="upp-btn ${state.wbOnlyOn ? 'active' : ''}" id="upp-wb-only-on-btn">只看已开</button>
        <button class="upp-btn" id="upp-wb-all-off-btn" ${activeBook ? '' : 'disabled'}>全关</button>
      </div>
    `;
  }

  function renderWorldbookBody() {
    const activeBook = state.activeBook;
    if (!activeBook) {
      elBody.innerHTML = `<div class="upp-empty">酒馆中暂无世界书</div>`;
      return;
    }

    const entries = state.bookEntriesCache[activeBook] || [];
    const hygiene = inspectTagHygiene(entries);
    const q = normalizeText(state.wbEntrySearch);
    const filtered = entries.filter(e => {
      if (state.wbOnlyOn && !e.enabled) return false;
      if (q && !normalizeText((e.name || '') + ' ' + (e.content || '')).includes(q)) return false;
      return true;
    });

    let html = '';
    if (hygiene.unclosedCount > 0 || hygiene.duplicateTags.length > 0) {
      const notes = [];
      if (hygiene.unclosedCount > 0) notes.push(`${hygiene.unclosedCount} 条存在未闭合标签`);
      if (hygiene.duplicateTags.length > 0) {
        notes.push(`重复包裹标签：${hygiene.duplicateTags.map(d => '<' + d.tag + '>').join('、')}`);
      }
      html += `<div class="upp-card-meta" style="padding: 2px 4px;"><span class="upp-badge warn">${ICONS.warn} ${escapeHtml(notes.join(' · '))}</span></div>`;
    }

    if (!filtered.length) {
      html += `<div class="upp-empty">${entries.length ? '没有匹配的条目' : '当前世界书暂无条目'}</div>`;
      elBody.innerHTML = html;
      return;
    }

    html += `<div class="upp-entry-list">` + filtered.map(e => {
      const stType = e.strategy?.type || 'constant';
      const h = hygiene.byUid[String(e.uid)];
      const warnTag = h && (h.unclosed.length || h.duplicateTags.length)
        ? `<span class="upp-badge warn" title="${escapeHtml([
            h.unclosed.length ? '未闭合: ' + h.unclosed.join(', ') : '',
            h.duplicateTags.length ? '重复包裹: ' + h.duplicateTags.join(', ') : '',
          ].filter(Boolean).join('；'))}">${ICONS.warn}</span>`
        : '';
      const snippet = String(e.content || '').replace(/\s+/g, ' ').trim().slice(0, 72);
      return `
        <div class="upp-entry-row ${e.enabled ? 'is-on' : ''}" data-wb-row="${e.uid}">
          <button class="upp-entry-main" data-wb-open="${e.uid}">
            <span class="upp-dot ${stType}" title="${stType === 'constant' ? '蓝灯常驻' : stType === 'selective' ? '绿灯触发' : '向量'}"></span>
            <div class="upp-entry-text">
              <div class="upp-entry-name">${escapeHtml(e.name || '(未命名条目)')}</div>
              <div class="upp-entry-preview">${escapeHtml(snippet || '空正文')}</div>
            </div>
            ${warnTag}
          </button>
          <button type="button" class="upp-switch" role="switch" aria-checked="${!!e.enabled}" data-wb-toggle="${e.uid}"></button>
        </div>
      `;
    }).join('') + `</div>`;

    elBody.innerHTML = html;
  }

  // --- Tab 4: Preset (with BaiBai presetPromptGroups support) ---
  function isPresetGroupCollapsed(group) {
    const key = `${state.loadedPresetName}::${group.id}`;
    if (Object.prototype.hasOwnProperty.call(state.presetFoldState, key)) {
      return !!state.presetFoldState[key];
    }
    return !!group.collapsed;
  }

  function renderPresetToolbar() {
    const presetOpts = state.presets.map(name =>
      `<option value="${escapeHtml(name)}" ${name === state.loadedPresetName ? 'selected' : ''}>${escapeHtml(name)}</option>`
    ).join('');
    const { groups } = extractPresetGroups(state.inUsePreset);
    const anyExpanded = groups.some(g => !isPresetGroupCollapsed(g));

    elToolbar.innerHTML = `
      <div class="upp-row">
        <select class="upp-select" id="upp-preset-select" title="切换预设">${presetOpts || '<option value="">无可用预设</option>'}</select>
        <div class="upp-input-wrap">
          ${ICONS.search}
          <input type="text" id="upp-preset-search" placeholder="搜索分组、提示词或正文…" value="${escapeHtml(state.presetSearch)}" />
        </div>
        <button class="upp-btn ${state.presetOnlyOn ? 'active' : ''}" id="upp-preset-only-on-btn">只看已开</button>
        ${groups.length ? `<button class="upp-btn" id="upp-preset-fold-all-btn">${anyExpanded ? '全部折叠' : '全部展开'}</button>` : ''}
      </div>
    `;
  }

  function renderPresetPromptRowHtml(p) {
    const placeholderIds = new Set(['worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'worldInfoAfter', 'dialogueExamples', 'chatHistory']);
    const isPh = placeholderIds.has(p.id);
    const roleShort = isPh ? '占位' : (p.role === 'user' ? 'USR' : p.role === 'assistant' ? 'AST' : 'SYS');
    const snippet = isPh ? '酒馆原生占位槽位' : String(p.content || '').replace(/\s+/g, ' ').trim().slice(0, 72);
    return `
      <div class="upp-entry-row ${p.enabled ? 'is-on' : ''}" data-pr-row="${escapeHtml(p.id)}">
        <button class="upp-entry-main" data-pr-open="${escapeHtml(p.id)}">
          <span class="upp-role-tag ${isPh ? 'placeholder' : ''}">${roleShort}</span>
          <div class="upp-entry-text">
            <div class="upp-entry-name">${escapeHtml(p.name || p.id)}</div>
            <div class="upp-entry-preview">${escapeHtml(snippet || '空正文')}</div>
          </div>
        </button>
        <button type="button" class="upp-switch" role="switch" aria-checked="${!!p.enabled}" data-pr-toggle="${escapeHtml(p.id)}"></button>
      </div>
    `;
  }

  function renderPresetBody() {
    const { nodes } = buildPresetRenderNodes(state.inUsePreset, {
      search: state.presetSearch,
      onlyOn: state.presetOnlyOn,
    });

    if (!nodes.length) {
      const hasAny = !!(state.inUsePreset && Array.isArray(state.inUsePreset.prompts) && state.inUsePreset.prompts.length);
      elBody.innerHTML = `<div class="upp-empty">${hasAny ? '没有匹配的提示词' : '未能读取当前预设条目'}</div>`;
      return;
    }

    elBody.innerHTML = `<div class="upp-entry-list">` + nodes.map(node => {
      if (node.type === 'prompt') {
        return renderPresetPromptRowHtml(node.prompt);
      }
      const g = node.group;
      const collapsed = node.forceExpand ? false : isPresetGroupCollapsed(g);
      return `
        <div class="upp-group-box ${collapsed ? 'is-collapsed' : ''} ${g.enabled ? '' : 'is-disabled'}" data-prg-box="${escapeHtml(g.id)}">
          <div class="upp-group-head">
            <button type="button" class="upp-group-toggle-btn" data-prg-fold="${escapeHtml(g.id)}">
              <span class="upp-group-chev">${ICONS.chevron}</span>
              <span class="upp-group-name">${escapeHtml(g.name)}</span>
              <span class="upp-badge ${g.enabled ? 'accent' : ''}">${node.enabledCount}/${node.totalCount}</span>
            </button>
            <button type="button" class="upp-switch" role="switch" aria-checked="${!!g.enabled}" data-prg-toggle="${escapeHtml(g.id)}" title="分组总开关"></button>
          </div>
          <div class="upp-group-items">
            ${node.items.map(renderPresetPromptRowHtml).join('')}
          </div>
        </div>
      `;
    }).join('') + `</div>`;
  }

  // --- Tab 5: Regex ---
  function renderRegexToolbar() {
    elToolbar.innerHTML = `
      <div class="upp-row">
        <button class="upp-btn ${state.regexScope === 'global' ? 'active' : ''}" data-rg-scope="global">全局</button>
        <button class="upp-btn ${state.regexScope === 'character' ? 'active' : ''}" data-rg-scope="character">当前角色</button>
        <button class="upp-btn ${state.regexScope === 'preset' ? 'active' : ''}" data-rg-scope="preset">当前预设</button>
        <div class="upp-input-wrap">
          ${ICONS.search}
          <input type="text" id="upp-rg-search" placeholder="搜索正则名称或规则…" value="${escapeHtml(state.regexSearch)}" />
        </div>
        <button class="upp-btn ${state.regexOnlyOn ? 'active' : ''}" id="upp-rg-only-on-btn">只看已开</button>
      </div>
    `;
  }

  function renderRegexBody() {
    const list = state.regexList || [];
    const q = normalizeText(state.regexSearch);
    const filtered = list.filter(r => {
      if (state.regexOnlyOn && !r.enabled) return false;
      if (q && !normalizeText((r.script_name || '') + ' ' + (r.find_regex || '')).includes(q)) return false;
      return true;
    });

    if (!filtered.length) {
      elBody.innerHTML = `<div class="upp-empty">${list.length ? '没有匹配的正则' : '当前范围暂无正则脚本'}</div>`;
      return;
    }

    elBody.innerHTML = `<div class="upp-entry-list">` + filtered.map(r => {
      const dest = [r.destination?.display ? '显示' : '', r.destination?.prompt ? '提示词' : ''].filter(Boolean).join('/');
      return `
        <div class="upp-entry-row ${r.enabled ? 'is-on' : ''}" data-rg-row="${escapeHtml(r.id)}">
          <button class="upp-entry-main" data-rg-open="${escapeHtml(r.id)}">
            <div class="upp-entry-text">
              <div class="upp-entry-name">${escapeHtml(r.script_name || '(未命名正则)')}</div>
              <div class="upp-entry-preview">${escapeHtml(r.find_regex || '')}</div>
            </div>
            ${dest ? `<span class="upp-badge">${dest}</span>` : ''}
          </button>
          <button type="button" class="upp-switch" role="switch" aria-checked="${!!r.enabled}" data-rg-toggle="${escapeHtml(r.id)}"></button>
        </div>
      `;
    }).join('') + `</div>`;
  }

  function openSaveSnapshotDrawer() {
    state.drawer = {
      type: 'saveSnapshot',
      name: '',
      group: state.snapGroup || '',
      note: '',
      scope: { persona: true, worldbooks: true, preset: true, regex: true },
      selectedBooks: getDefaultSnapshotBooks(state.store),
    };
    renderDrawer();
  }

  function renderDrawer() {
    const d = state.drawer;
    if (!d) {
      elDrawerMask.hidden = true;
      elDrawerMask.innerHTML = '';
      return;
    }
    elDrawerMask.hidden = false;

    if (d.type === 'bookPicker') {
      const q = normalizeText(d.query || '');
      const pinned = new Set(state.store.settings.pinnedWorldbooks);
      const globals = new Set(state.globalWorldbooks);
      const charSet = new Set([state.charWorldbooks.primary, ...(state.charWorldbooks.additional || [])].filter(Boolean));
      const sorted = [...state.worldbooks].sort((a, b) => {
        const pa = (pinned.has(a) ? 4 : 0) + (globals.has(a) ? 2 : 0) + (charSet.has(a) ? 1 : 0);
        const pb = (pinned.has(b) ? 4 : 0) + (globals.has(b) ? 2 : 0) + (charSet.has(b) ? 1 : 0);
        if (pa !== pb) return pb - pa;
        return a.localeCompare(b, 'zh-CN');
      });
      const shown = sorted.filter(n => !q || normalizeText(n).includes(q));
      elDrawerMask.innerHTML = `
        <div class="upp-drawer">
          <div class="upp-drawer-head">
            <span>选择世界书</span>
            <button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            <div class="upp-input-wrap" style="width:100%;">
              ${ICONS.search}
              <input type="text" id="upp-book-search-input" placeholder="输入世界书名称筛选…" value="${escapeHtml(d.query || '')}" />
            </div>
            <div class="upp-pop-list" style="max-height:360px;">
              ${shown.length ? shown.map(name => {
                const tags = [];
                if (pinned.has(name)) tags.push('<span class="upp-badge warn">置顶</span>');
                if (globals.has(name)) tags.push('<span class="upp-badge accent">全局</span>');
                if (charSet.has(name)) tags.push('<span class="upp-badge ok">角色</span>');
                if (state.chatWorldbook === name) tags.push('<span class="upp-badge ok">聊天</span>');
                return `
                  <button class="upp-detail-item" data-pick-book="${escapeHtml(name)}" style="${name === state.activeBook ? 'border-color:var(--accent);' : ''}">
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(name)}</span>
                    <span class="upp-row-nowrap">${tags.join('')}</span>
                  </button>
                `;
              }).join('') : '<div class="upp-empty" style="padding:18px;">未找到匹配世界书</div>'}
            </div>
          </div>
        </div>
      `;
      later(() => { shadow.getElementById('upp-book-search-input')?.focus(); }, 10);
      return;
    }

    if (d.type === 'entryEditor') {
      const readOnly = !!d.readOnly;
      elDrawerMask.innerHTML = `
        <div class="upp-drawer">
          <div class="upp-drawer-head">
            <span>${escapeHtml(d.heading || '条目详情')}</span>
            <button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            ${d.meta ? `<div class="upp-card-meta">${escapeHtml(d.meta)}</div>` : ''}
            ${d.allowNameEdit ? `
              <div class="upp-field">
                <label>标题</label>
                <input class="upp-text-input" id="upp-ed-name" value="${escapeHtml(d.name || '')}" ${readOnly ? 'readonly' : ''} />
              </div>
            ` : ''}
            ${d.showStrategy ? `
              <div class="upp-field">
                <label>激活方式</label>
                <select class="upp-select" id="upp-ed-strategy" style="max-width:none;width:100%;">
                  <option value="constant" ${d.strategyType === 'constant' ? 'selected' : ''}>蓝灯常驻</option>
                  <option value="selective" ${d.strategyType === 'selective' ? 'selected' : ''}>绿灯关键字触发</option>
                </select>
              </div>
            ` : ''}
            <div class="upp-field">
              <label>正文</label>
              <textarea class="upp-textarea" id="upp-ed-content" ${readOnly ? 'readonly' : ''}>${escapeHtml(d.content || '')}</textarea>
            </div>
          </div>
          <div class="upp-drawer-foot">
            <button class="upp-btn" data-drawer-close>关闭</button>
            ${!readOnly ? `<button class="upp-btn primary" id="upp-ed-save-btn">保存</button>` : ''}
          </div>
        </div>
      `;
      return;
    }

    if (d.type === 'saveSnapshot') {
      const existingGroups = Array.from(new Set(state.store.snapshots.map(s => s.group).filter(Boolean)));
      const pinned = new Set(state.store.settings.pinnedWorldbooks);
      const selectedSet = new Set(d.selectedBooks || []);
      elDrawerMask.innerHTML = `
        <div class="upp-drawer">
          <div class="upp-drawer-head">
            <span>保存快照</span>
            <button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            <div class="upp-field">
              <label>快照名称</label>
              <input class="upp-text-input" id="upp-ss-name" placeholder="例如：日常甜妹 / 现代线" value="${escapeHtml(d.name || '')}" />
            </div>
            <div class="upp-field">
              <label>分组</label>
              <input class="upp-text-input" id="upp-ss-group" placeholder="可选，例如：日常 / 现代 / 某角色" value="${escapeHtml(d.group || '')}" />
              ${existingGroups.length ? `<div class="upp-pill-strip" style="margin-top:4px;">${existingGroups.map(g => `<button type="button" class="upp-pill" data-ss-fill-group="${escapeHtml(g)}">${escapeHtml(g)}</button>`).join('')}</div>` : ''}
            </div>
            <div class="upp-field">
              <label>备注</label>
              <input class="upp-text-input" id="upp-ss-note" placeholder="可选简短说明" value="${escapeHtml(d.note || '')}" />
            </div>
            <div class="upp-field">
              <label>保存范围</label>
              <div class="upp-check-grid">
                <label class="upp-check-item"><input type="checkbox" id="upp-sc-persona" ${d.scope.persona ? 'checked' : ''} /><span>User 人设</span></label>
                <label class="upp-check-item"><input type="checkbox" id="upp-sc-wb" ${d.scope.worldbooks ? 'checked' : ''} /><span>世界书与条目开关</span></label>
                <label class="upp-check-item"><input type="checkbox" id="upp-sc-preset" ${d.scope.preset ? 'checked' : ''} /><span>预设、分组与提示词</span></label>
                <label class="upp-check-item"><input type="checkbox" id="upp-sc-regex" ${d.scope.regex ? 'checked' : ''} /><span>正则开关</span></label>
              </div>
            </div>
            <div class="upp-field" id="upp-ss-books-wrap" ${d.scope.worldbooks ? '' : 'hidden'}>
              <label>记录条目开关的世界书（已选 ${selectedSet.size} 本）</label>
              <div class="upp-pop-list">
                ${state.worldbooks.map(bk => `
                  <label class="upp-check-item" style="border:none;background:transparent;padding:4px 6px;">
                    <input type="checkbox" data-ss-book="${escapeHtml(bk)}" ${selectedSet.has(bk) ? 'checked' : ''} />
                    <span>${escapeHtml(bk)}</span>
                    ${pinned.has(bk) ? '<span class="upp-badge warn" style="margin-left:auto;">置顶</span>' : ''}
                  </label>
                `).join('')}
              </div>
            </div>
          </div>
          <div class="upp-drawer-foot">
            <button class="upp-btn" data-drawer-close>取消</button>
            <button class="upp-btn primary" id="upp-ss-confirm-btn">保存快照</button>
          </div>
        </div>
      `;
      later(() => { shadow.getElementById('upp-ss-name')?.focus(); }, 10);
      return;
    }

    if (d.type === 'viewSnapshot') {
      const s = d.snapshot;
      const wbDetails = d.wbDetails || {};
      const livePrompts = (state.inUsePreset && state.inUsePreset.prompts) || [];
      const promptMap = {};
      livePrompts.forEach(p => { promptMap[p.id] = p; });
      const { groupsById, promptGroupMap } = extractPresetGroups(state.inUsePreset);

      let body = '';
      if (s.scope.persona && s.persona) {
        const pvTitle = s.persona.versionName ? `${s.persona.name} · ${s.persona.versionName}` : s.persona.name;
        body += `
          <div class="upp-sec-title"><span>User 人设</span></div>
          <button class="upp-detail-item" data-view-snap-persona>
            <span>${escapeHtml(pvTitle)}</span>
            <span class="upp-badge">预览正文</span>
          </button>
        `;
      }

      if (s.scope.worldbooks && s.worldbooks) {
        const entriesMap = s.worldbooks.entries || {};
        const bookNames = Object.keys(entriesMap);
        body += `<div class="upp-sec-title"><span>世界书（${bookNames.length} 本）</span></div>`;
        if (!bookNames.length) {
          body += `<div class="upp-card-meta">仅记录绑定关系，未选定条目</div>`;
        }
        bookNames.forEach(bk => {
          const map = entriesMap[bk] || {};
          const onUids = Object.keys(map).filter(u => map[u]);
          const liveList = wbDetails[bk] || [];
          const byUid = {};
          liveList.forEach(e => { byUid[String(e.uid)] = e; });
          body += `<div class="upp-card" style="padding:8px 10px;gap:5px;">
            <div class="upp-card-head">
              <span style="font-weight:600;font-size:12.5px;">${escapeHtml(bk)}</span>
              <span class="upp-badge accent">开 ${onUids.length} / 录 ${Object.keys(map).length}</span>
            </div>
            ${onUids.length ? onUids.map(u => {
              const live = byUid[u];
              return `<button class="upp-detail-item" data-view-snap-wb="${escapeHtml(bk)}" data-view-snap-uid="${escapeHtml(u)}">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(live ? (live.name || '(未命名)') : '已删除条目 #' + u)}</span>
                <span class="upp-badge">${live ? '查看' : '缺失'}</span>
              </button>`;
            }).join('') : '<div class="upp-card-meta">本世界书全部关闭</div>'}
          </div>`;
        });
      }

      if (s.scope.preset && s.preset) {
        const pMap = s.preset.prompts || {};
        const gMap = s.preset.groups || {};
        const onIds = Object.keys(pMap).filter(id => pMap[id]);
        const groupKeys = Object.keys(gMap);
        body += `<div class="upp-sec-title"><span>预设：${escapeHtml(s.preset.name || '当前')}（开 ${onIds.length} 条）</span></div>`;
        if (groupKeys.length) {
          body += `<div class="upp-card-meta">` + groupKeys.map(gid => {
            const gName = groupsById[gid]?.name || gid.slice(0, 8);
            return `<span class="upp-badge ${gMap[gid] ? 'accent' : ''}">${escapeHtml(gName)}：${gMap[gid] ? '开' : '关'}</span>`;
          }).join('') + `</div>`;
        }
        body += `<div class="upp-pop-list" style="max-height:180px;">` + (onIds.length ? onIds.map(id => {
          const live = promptMap[id];
          const gid = promptGroupMap[id];
          const gName = gid && groupsById[gid] ? groupsById[gid].name : '';
          return `<button class="upp-detail-item" data-view-snap-pr="${escapeHtml(id)}">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${gName ? `[${escapeHtml(gName)}] ` : ''}${escapeHtml(live ? (live.name || id) : id)}</span>
            <span class="upp-badge">${live ? '查看' : '切换后可见'}</span>
          </button>`;
        }).join('') : '<div class="upp-card-meta">无开启条目</div>') + `</div>`;
      }

      if (s.scope.regex && s.regex) {
        const countOn = m => Object.keys(m || {}).filter(k => m[k]).length;
        body += `
          <div class="upp-sec-title"><span>正则开关</span></div>
          <div class="upp-card-meta">
            <span class="upp-badge">全局开 ${countOn(s.regex.global)}</span>
            <span class="upp-badge">角色开 ${countOn(s.regex.character)}</span>
            <span class="upp-badge">预设开 ${countOn(s.regex.preset)}</span>
          </div>
        `;
      }

      elDrawerMask.innerHTML = `
        <div class="upp-drawer">
          <div class="upp-drawer-head">
            <span>快照详情 · ${escapeHtml(s.name)}</span>
            <button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">${body || '<div class="upp-empty">空快照</div>'}</div>
          <div class="upp-drawer-foot">
            <button class="upp-btn" data-drawer-close>关闭</button>
            <button class="upp-btn primary" data-snap-apply="${s.id}">应用此快照</button>
          </div>
        </div>
      `;
      return;
    }

    if (d.type === 'bindSnapshot') {
      const s = d.snapshot;
      const isChat = state.chatId && state.store.bindings.chats[state.chatId] === s.id;
      const isChar = state.charInfo.id && state.store.bindings.characters[state.charInfo.id] === s.id;
      elDrawerMask.innerHTML = `
        <div class="upp-drawer" style="width:min(420px,100%);">
          <div class="upp-drawer-head">
            <span>绑定快照 · ${escapeHtml(s.name)}</span>
            <button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            <div class="upp-card">
              <div class="upp-card-head">
                <span>当前聊天</span>
                <span class="upp-card-meta">${escapeHtml(state.chatId || '未打开聊天')}</span>
              </div>
              <div class="upp-row">
                <button class="upp-btn ${isChat ? 'danger' : 'primary'}" id="upp-bind-chat-btn" ${state.chatId ? '' : 'disabled'}>${isChat ? '解除本聊天绑定' : '绑定到本聊天'}</button>
              </div>
            </div>
            <div class="upp-card">
              <div class="upp-card-head">
                <span>当前角色默认</span>
                <span class="upp-card-meta">${escapeHtml(state.charInfo.name || '未打开角色')}</span>
              </div>
              <div class="upp-row">
                <button class="upp-btn ${isChar ? 'danger' : 'primary'}" id="upp-bind-char-btn" ${state.charInfo.id ? '' : 'disabled'}>${isChar ? '解除本角色绑定' : '设为本角色默认'}</button>
              </div>
            </div>
          </div>
          <div class="upp-drawer-foot">
            <button class="upp-btn" data-drawer-close>完成</button>
          </div>
        </div>
      `;
      return;
    }

    if (d.type === 'savePersonaVersion') {
      const p = state.currentPersona;
      const existing = p ? (state.store.personaVersions[p.avatar_id] || []) : [];
      elDrawerMask.innerHTML = `
        <div class="upp-drawer" style="width:min(460px,100%);">
          <div class="upp-drawer-head">
            <span>存为内部描述版本 · ${escapeHtml(p?.name || '')}</span>
            <button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            <div class="upp-field">
              <label>版本名称</label>
              <input class="upp-text-input" id="upp-pv-name" placeholder="例如：默认 / 现代日常 / 古风线" value="${escapeHtml(d.name || '')}" />
            </div>
            ${existing.length ? `
              <div class="upp-field">
                <label>已有版本（点选同名可覆盖）</label>
                <div class="upp-pop-list">
                  ${existing.map(v => `
                    <div class="upp-row-nowrap" style="padding:3px 4px;">
                      <button type="button" class="upp-detail-item" data-pv-fill-name="${escapeHtml(v.name)}">
                        <span>${escapeHtml(v.name)}</span>
                        <span class="upp-card-meta">${formatTimeShort(v.updatedAt)}</span>
                      </button>
                      <button type="button" class="upp-btn icon-only danger" data-pv-del="${v.id}" title="删除版本">${ICONS.trash}</button>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>
          <div class="upp-drawer-foot">
            <button class="upp-btn" data-drawer-close>取消</button>
            <button class="upp-btn primary" id="upp-pv-save-btn">保存版本</button>
          </div>
        </div>
      `;
      later(() => { shadow.getElementById('upp-pv-name')?.focus(); }, 10);
      return;
    }

    if (d.type === 'personaDiff') {
      const p = state.currentPersona;
      const list = p ? (state.store.personaVersions[p.avatar_id] || []) : [];
      const choices = [{ id: '__live__', name: '当前实时正文', description: p ? p.description : '' }, ...list];
      const leftId = d.leftId || (list[0]?.id || '__live__');
      const rightId = d.rightId || '__live__';
      const leftItem = choices.find(c => c.id === leftId) || choices[0];
      const rightItem = choices.find(c => c.id === rightId) || choices[0];
      const diffLines = computeLineDiff(leftItem?.description || '', rightItem?.description || '');

      elDrawerMask.innerHTML = `
        <div class="upp-drawer">
          <div class="upp-drawer-head">
            <span>版本差异对比 · ${escapeHtml(p?.name || '')}</span>
            <button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            <div class="upp-row">
              <select class="upp-select" id="upp-diff-left" style="flex:1;max-width:none;">
                ${choices.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === leftId ? 'selected' : ''}>旧：${escapeHtml(c.name)}</option>`).join('')}
              </select>
              <select class="upp-select" id="upp-diff-right" style="flex:1;max-width:none;">
                ${choices.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === rightId ? 'selected' : ''}>新：${escapeHtml(c.name)}</option>`).join('')}
              </select>
            </div>
            <div class="upp-diff-box">
              ${diffLines.length ? diffLines.map(ln => {
                const prefix = ln.type === 'del' ? '- ' : ln.type === 'add' ? '+ ' : '  ';
                return `<div class="upp-diff-line ${ln.type}">${escapeHtml(prefix + ln.text)}</div>`;
              }).join('') : '<div class="upp-card-meta">两版正文完全一致</div>'}
            </div>
          </div>
          <div class="upp-drawer-foot">
            <button class="upp-btn" data-drawer-close>关闭</button>
          </div>
        </div>
      `;
      return;
    }

    if (d.type === 'mergePersonas') {
      const dupGroups = detectProliferatedPersonas(state.personas);
      const keepId = d.keepId || (state.currentPersona?.avatar_id || state.personas[0]?.avatar_id || '');
      const absorbSet = new Set(d.absorbIds || []);
      elDrawerMask.innerHTML = `
        <div class="upp-drawer">
          <div class="upp-drawer-head">
            <span>整理同名与旧分身 User</span>
            <button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            ${dupGroups.length ? `
              <div class="upp-field">
                <label>快速选中检测到的相似分身组</label>
                <div class="upp-pill-strip">
                  ${dupGroups.map((g, idx) => `<button type="button" class="upp-pill" data-merge-preset-group="${idx}">${escapeHtml(g.baseName)}（${g.items.length}）</button>`).join('')}
                </div>
              </div>
            ` : ''}
            <div class="upp-field">
              <label>保留的主 User</label>
              <select class="upp-select" id="upp-merge-keep" style="max-width:none;width:100%;">
                ${state.personas.map(p => `<option value="${escapeHtml(p.avatar_id)}" ${p.avatar_id === keepId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
              </select>
            </div>
            <div class="upp-field">
              <label>勾选要收回为内部描述版本的旧分身</label>
              <div class="upp-pop-list">
                ${state.personas.filter(p => p.avatar_id !== keepId).map(p => `
                  <label class="upp-check-item" style="border:none;background:transparent;padding:5px 6px;">
                    <input type="checkbox" data-merge-absorb="${escapeHtml(p.avatar_id)}" ${absorbSet.has(p.avatar_id) ? 'checked' : ''} />
                    <span style="font-weight:550;">${escapeHtml(p.name)}</span>
                    <span class="upp-card-meta" style="margin-left:auto;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml((p.description || '').replace(/\s+/g, ' ').slice(0, 36) || '空描述')}</span>
                  </label>
                `).join('') || '<div class="upp-card-meta" style="padding:8px;">没有其他可合并的 User</div>'}
              </div>
            </div>
            <label class="upp-check-item">
              <input type="checkbox" id="upp-merge-delete-old" ${d.deleteOld ? 'checked' : ''} />
              <span>收回后同时从酒馆删除已选中的旧分身</span>
            </label>
          </div>
          <div class="upp-drawer-foot">
            <button class="upp-btn" data-drawer-close>取消</button>
            <button class="upp-btn primary" id="upp-merge-run-btn" ${absorbSet.size ? '' : 'disabled'}>收回 ${absorbSet.size} 个分身</button>
          </div>
        </div>
      `;
      return;
    }

    if (d.type === 'backup') {
      elDrawerMask.innerHTML = `
        <div class="upp-drawer" style="width:min(460px,100%);">
          <div class="upp-drawer-head">
            <span>快照与版本备份</span>
            <button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            <div class="upp-row">
              <button class="upp-btn primary" id="upp-export-json-btn">导出全部 JSON</button>
              <button class="upp-btn" id="upp-import-json-btn">导入 JSON 备份</button>
              <input type="file" id="upp-import-file" accept=".json,application/json" hidden />
            </div>
            <div class="upp-card-meta">包含所有快照、绑定关系及 User 内部描述版本，导入后将与当前列表合并更新。</div>
          </div>
          <div class="upp-drawer-foot">
            <button class="upp-btn" data-drawer-close>关闭</button>
          </div>
        </div>
      `;
    }
  }

  function render() {
    renderHeader();
    renderTabs();
    if (state.tab === 'snapshots') { renderSnapshotsToolbar(); renderSnapshotsBody(); }
    else if (state.tab === 'user') { renderUserToolbar(); renderUserBody(); }
    else if (state.tab === 'worldbook') { renderWorldbookToolbar(); renderWorldbookBody(); }
    else if (state.tab === 'preset') { renderPresetToolbar(); renderPresetBody(); }
    else if (state.tab === 'regex') { renderRegexToolbar(); renderRegexBody(); }
    renderFooter();
    renderDrawer();
  }

  // =========================
  // Snapshot Overwrite Helper
  // =========================

  async function overwriteSnapshotById(sid) {
    const idx = state.store.snapshots.findIndex(x => x.id === sid);
    if (idx < 0) return;
    const old = state.store.snapshots[idx];
    const selectedBooks = old.worldbooks && old.worldbooks.entries
      ? Object.keys(old.worldbooks.entries)
      : getDefaultSnapshotBooks(state.store);
    const updated = await captureLiveSnapshot({
      id: old.id,
      name: old.name,
      group: old.group,
      note: old.note,
      scope: old.scope,
      selectedBooks,
    }, state.store);
    state.store.snapshots[idx] = updated;
    persistStore(state.store);
    render();
    toast(`已用当前状态更新「${old.name}」`, 'success');
  }

  // =========================
  // Event Handling
  // =========================

  listen(shadow.getElementById('upp-close-btn'), 'click', closeModal);
  listen(shadow.getElementById('upp-refresh-btn'), 'click', () => { void refreshAll(true); });
  listen(elBackdrop, 'click', ev => { if (ev.target === elBackdrop) closeModal(); });
  listen(elDrawerMask, 'click', ev => {
    if (ev.target === elDrawerMask) {
      state.drawer = null;
      renderDrawer();
    }
  });

  // Persistent Footer Click
  listen(elFooter, 'click', async ev => {
    const t = ev.target;
    if (t.closest('#upp-foot-save-snap-btn')) {
      openSaveSnapshotDrawer();
      return;
    }
    const updBtn = t.closest('#upp-foot-update-btn');
    if (updBtn) {
      await overwriteSnapshotById(updBtn.getAttribute('data-snap-update'));
    }
  });

  // Tab switch
  listen(elTabs, 'click', async ev => {
    const btn = ev.target.closest('[data-tab]');
    if (!btn) return;
    const next = btn.getAttribute('data-tab');
    if (next === state.tab) return;
    state.tab = next;
    state.drawer = null;
    if (next === 'worldbook' && state.activeBook) {
      await ensureBookEntries(state.activeBook, false);
    } else if (next === 'regex') {
      state.regexList = Host.getRegexes(state.regexScope);
    } else if (next === 'preset') {
      state.inUsePreset = Host.getInUsePreset();
    } else if (next === 'user') {
      state.personas = Host.listPersonas();
      state.currentPersona = Host.getCurrentPersona();
    }
    render();
  });

  // Toolbar click, input & change
  listen(elToolbar, 'click', async ev => {
    const target = ev.target;

    // Snapshots toolbar
    if (target.closest('#upp-auto-bind-sw')) {
      state.store.settings.autoApplyBindings = !state.store.settings.autoApplyBindings;
      persistStore(state.store);
      const sw = shadow.getElementById('upp-auto-bind-sw');
      if (sw) sw.setAttribute('aria-checked', String(state.store.settings.autoApplyBindings));
      toast(state.store.settings.autoApplyBindings ? '已开启切换聊天自动切回快照' : '已暂停自动切换快照');
      return;
    }
    if (target.closest('#upp-backup-btn')) {
      state.drawer = { type: 'backup' };
      renderDrawer();
      return;
    }
    const gBtn = target.closest('[data-snap-group]');
    if (gBtn) {
      state.snapGroup = gBtn.getAttribute('data-snap-group') || '';
      renderSnapshotsToolbar();
      renderSnapshotsBody();
      return;
    }

    // User toolbar
    if (target.closest('#upp-persona-edit-btn') && state.currentPersona) {
      state.drawer = {
        type: 'entryEditor',
        mode: 'editPersona',
        heading: `编辑 User 正文 · ${state.currentPersona.name}`,
        content: state.currentPersona.description || '',
      };
      renderDrawer();
      return;
    }
    if (target.closest('#upp-persona-savever-btn') && state.currentPersona) {
      state.drawer = { type: 'savePersonaVersion', name: '' };
      renderDrawer();
      return;
    }
    if (target.closest('#upp-persona-diff-btn') && state.currentPersona) {
      state.drawer = { type: 'personaDiff' };
      renderDrawer();
      return;
    }
    if (target.closest('#upp-persona-merge-btn')) {
      const dupGroups = detectProliferatedPersonas(state.personas);
      let keepId = state.currentPersona?.avatar_id || state.personas[0]?.avatar_id || '';
      let absorbIds = [];
      if (dupGroups.length) {
        const g = dupGroups[0];
        const curInGroup = g.items.find(x => x.avatar_id === keepId);
        const main = curInGroup || g.items[0];
        keepId = main.avatar_id;
        absorbIds = g.items.filter(x => x.avatar_id !== keepId).map(x => x.avatar_id);
      }
      state.drawer = { type: 'mergePersonas', keepId, absorbIds, deleteOld: false };
      renderDrawer();
      return;
    }

    // Worldbook toolbar
    if (target.closest('#upp-book-picker-btn')) {
      state.drawer = { type: 'bookPicker', query: '' };
      renderDrawer();
      return;
    }
    if (target.closest('#upp-pin-book-btn') && state.activeBook) {
      const list = state.store.settings.pinnedWorldbooks;
      const idx = list.indexOf(state.activeBook);
      if (idx >= 0) list.splice(idx, 1);
      else list.unshift(state.activeBook);
      persistStore(state.store);
      renderWorldbookToolbar();
      return;
    }
    if (target.closest('#upp-global-book-btn') && state.activeBook) {
      const next = new Set(state.globalWorldbooks);
      if (next.has(state.activeBook)) next.delete(state.activeBook);
      else next.add(state.activeBook);
      await Host.setGlobalWorldbooks(Array.from(next));
      state.globalWorldbooks = Host.getGlobalWorldbooks();
      renderWorldbookToolbar();
      return;
    }
    if (target.closest('#upp-new-wb-entry-btn') && state.activeBook) {
      state.drawer = {
        type: 'entryEditor',
        mode: 'createWb',
        heading: `新建条目 · ${state.activeBook}`,
        bookName: state.activeBook,
        allowNameEdit: true,
        showStrategy: true,
        strategyType: 'constant',
        name: '',
        content: '',
      };
      renderDrawer();
      return;
    }
    if (target.closest('#upp-copy-wb-btn') && state.activeBook) {
      const entries = state.bookEntriesCache[state.activeBook] || [];
      const text = buildCleanCopyText(entries);
      if (!text) { toast('本世界书暂无已开启的非空条目', 'warning'); return; }
      try {
        await (Env.pwin.navigator?.clipboard || navigator.clipboard).writeText(text);
        toast('已复制当前已开条目纯文本', 'success');
      } catch (_) {
        state.drawer = { type: 'entryEditor', heading: '复制纯文本', content: text, readOnly: true };
        renderDrawer();
      }
      return;
    }
    if (target.closest('#upp-wb-only-on-btn')) {
      state.wbOnlyOn = !state.wbOnlyOn;
      renderWorldbookToolbar();
      renderWorldbookBody();
      return;
    }
    if (target.closest('#upp-wb-all-off-btn') && state.activeBook) {
      const entries = state.bookEntriesCache[state.activeBook] || [];
      const offMap = {};
      entries.forEach(e => { if (e.enabled) offMap[String(e.uid)] = false; });
      if (!Object.keys(offMap).length) { toast('本世界书已全部关闭'); return; }
      await Host.batchToggleWorldbookEntries(state.activeBook, offMap);
      await ensureBookEntries(state.activeBook, true);
      renderWorldbookBody();
      toast('已关闭本世界书全部条目');
      return;
    }

    // Preset toolbar
    if (target.closest('#upp-preset-only-on-btn')) {
      state.presetOnlyOn = !state.presetOnlyOn;
      renderPresetToolbar();
      renderPresetBody();
      return;
    }
    if (target.closest('#upp-preset-fold-all-btn')) {
      const { groups } = extractPresetGroups(state.inUsePreset);
      const anyExpanded = groups.some(g => !isPresetGroupCollapsed(g));
      groups.forEach(g => {
        state.presetFoldState[`${state.loadedPresetName}::${g.id}`] = anyExpanded;
      });
      renderPresetToolbar();
      renderPresetBody();
      return;
    }

    // Regex toolbar
    const rgSc = target.closest('[data-rg-scope]');
    if (rgSc) {
      state.regexScope = rgSc.getAttribute('data-rg-scope') || 'global';
      state.regexList = Host.getRegexes(state.regexScope);
      renderRegexToolbar();
      renderRegexBody();
      return;
    }
    if (target.closest('#upp-rg-only-on-btn')) {
      state.regexOnlyOn = !state.regexOnlyOn;
      renderRegexToolbar();
      renderRegexBody();
    }
  });

  listen(elToolbar, 'input', ev => {
    const id = ev.target.id;
    if (id === 'upp-snap-search') { state.snapSearch = ev.target.value; renderSnapshotsBody(); }
    else if (id === 'upp-wb-search') { state.wbEntrySearch = ev.target.value; renderWorldbookBody(); }
    else if (id === 'upp-preset-search') { state.presetSearch = ev.target.value; renderPresetBody(); }
    else if (id === 'upp-rg-search') { state.regexSearch = ev.target.value; renderRegexBody(); }
  });

  listen(elToolbar, 'change', async ev => {
    if (ev.target.id === 'upp-persona-select') {
      const targetId = ev.target.value;
      const p = state.personas.find(x => x.avatar_id === targetId);
      if (p) {
        await Host.switchPersona(p.avatar_id, p.name);
        state.currentPersona = Host.getCurrentPersona();
        renderHeader();
        renderUserToolbar();
        renderUserBody();
        renderFooter();
      }
      return;
    }
    if (ev.target.id === 'upp-preset-select') {
      const targetPreset = ev.target.value;
      if (targetPreset && targetPreset !== state.loadedPresetName) {
        Host.loadPreset(targetPreset);
        later(() => {
          state.loadedPresetName = Host.getLoadedPresetName();
          state.inUsePreset = Host.getInUsePreset();
          renderPresetToolbar();
          renderPresetBody();
          renderFooter();
          toast('已切换预设：' + targetPreset, 'success');
        }, 120);
      }
    }
  });

  // Body click delegation
  listen(elBody, 'click', async ev => {
    const t = ev.target;

    if (t.closest('[data-open-save-snap]')) {
      openSaveSnapshotDrawer();
      return;
    }

    // --- Snapshots actions ---
    const applyBtn = t.closest('[data-snap-apply]');
    if (applyBtn) {
      const sid = applyBtn.getAttribute('data-snap-apply');
      const snap = state.store.snapshots.find(x => x.id === sid);
      if (snap) {
        await applySnapshotLive(snap, state.store);
        await refreshAll(true);
      }
      return;
    }
    const viewBtn = t.closest('[data-snap-view]');
    if (viewBtn) {
      const sid = viewBtn.getAttribute('data-snap-view');
      const snap = state.store.snapshots.find(x => x.id === sid);
      if (snap) {
        const wbDetails = {};
        if (snap.scope.worldbooks && snap.worldbooks && snap.worldbooks.entries) {
          for (const bk of Object.keys(snap.worldbooks.entries)) {
            wbDetails[bk] = await ensureBookEntries(bk, false);
          }
        }
        state.drawer = { type: 'viewSnapshot', snapshot: snap, wbDetails };
        renderDrawer();
      }
      return;
    }
    const updBtn = t.closest('[data-snap-update]');
    if (updBtn) {
      await overwriteSnapshotById(updBtn.getAttribute('data-snap-update'));
      return;
    }
    const bindBtn = t.closest('[data-snap-bind]');
    if (bindBtn) {
      const sid = bindBtn.getAttribute('data-snap-bind');
      const snap = state.store.snapshots.find(x => x.id === sid);
      if (snap) {
        state.drawer = { type: 'bindSnapshot', snapshot: snap };
        renderDrawer();
      }
      return;
    }
    const delBtn = t.closest('[data-snap-del]');
    if (delBtn) {
      const sid = delBtn.getAttribute('data-snap-del');
      state.store.snapshots = state.store.snapshots.filter(x => x.id !== sid);
      Object.keys(state.store.bindings.chats).forEach(k => { if (state.store.bindings.chats[k] === sid) delete state.store.bindings.chats[k]; });
      Object.keys(state.store.bindings.characters).forEach(k => { if (state.store.bindings.characters[k] === sid) delete state.store.bindings.characters[k]; });
      persistStore(state.store);
      render();
      toast('已删除快照');
      return;
    }
    const unbindBtn = t.closest('[data-unbind-src]');
    if (unbindBtn) {
      const src = unbindBtn.getAttribute('data-unbind-src');
      if (src === 'chat' && state.chatId) delete state.store.bindings.chats[state.chatId];
      if (src === 'character' && state.charInfo.id) delete state.store.bindings.characters[state.charInfo.id];
      persistStore(state.store);
      renderSnapshotsBody();
      renderFooter();
      toast('已解除绑定');
      return;
    }

    // --- User tab body actions ---
    if (t.closest('#upp-persona-preview-box') && state.currentPersona) {
      state.drawer = {
        type: 'entryEditor',
        mode: 'editPersona',
        heading: `编辑 User 正文 · ${state.currentPersona.name}`,
        content: state.currentPersona.description || '',
      };
      renderDrawer();
      return;
    }
    const pvView = t.closest('[data-pv-view]');
    if (pvView && state.currentPersona) {
      const vid = pvView.getAttribute('data-pv-view');
      const list = state.store.personaVersions[state.currentPersona.avatar_id] || [];
      const ver = list.find(v => v.id === vid);
      if (ver) {
        state.drawer = {
          type: 'entryEditor',
          mode: 'editPersonaVersion',
          versionId: ver.id,
          heading: `编辑内部版本 · ${state.currentPersona.name}`,
          allowNameEdit: true,
          name: ver.name,
          content: ver.description || '',
        };
        renderDrawer();
      }
      return;
    }
    const pvApply = t.closest('[data-pv-apply]');
    if (pvApply && state.currentPersona) {
      const vid = pvApply.getAttribute('data-pv-apply');
      const list = state.store.personaVersions[state.currentPersona.avatar_id] || [];
      const ver = list.find(v => v.id === vid);
      if (ver) {
        autoBackupPersonaBeforeOverwrite(state.store, state.currentPersona);
        persistStore(state.store);
        await Host.updatePersonaInPlace(state.currentPersona.avatar_id, ver.description, ver.lorebook || undefined);
        state.currentPersona = Host.getCurrentPersona();
        renderUserToolbar();
        renderUserBody();
        toast(`已切换至「${ver.name}」`, 'success');
      }
      return;
    }
    const pvDelInline = t.closest('[data-pv-del-inline]');
    if (pvDelInline && state.currentPersona) {
      const vid = pvDelInline.getAttribute('data-pv-del-inline');
      const aid = state.currentPersona.avatar_id;
      state.store.personaVersions[aid] = (state.store.personaVersions[aid] || []).filter(v => v.id !== vid);
      persistStore(state.store);
      renderUserToolbar();
      renderUserBody();
      toast('已删除内部版本');
      return;
    }

    // --- Worldbook surgical switch & entry preview/edit ---
    const wbSw = t.closest('[data-wb-toggle]');
    if (wbSw && state.activeBook) {
      const u = wbSw.getAttribute('data-wb-toggle');
      const entries = state.bookEntriesCache[state.activeBook] || [];
      const entry = entries.find(e => String(e.uid) === String(u));
      if (!entry) return;
      const next = !entry.enabled;
      entry.enabled = next;
      wbSw.setAttribute('aria-checked', String(next));
      const row = wbSw.closest('.upp-entry-row');
      if (row) row.classList.toggle('is-on', next);
      try {
        await Host.toggleWorldbookEntry(state.activeBook, u, next);
        if (state.wbOnlyOn && !next) renderWorldbookBody();
      } catch (err) {
        entry.enabled = !next;
        wbSw.setAttribute('aria-checked', String(!next));
        if (row) row.classList.toggle('is-on', !next);
        toast('切换失败：' + (err?.message || err), 'error');
      }
      return;
    }
    const wbOpen = t.closest('[data-wb-open]');
    if (wbOpen && state.activeBook) {
      const u = wbOpen.getAttribute('data-wb-open');
      const entries = state.bookEntriesCache[state.activeBook] || [];
      const entry = entries.find(e => String(e.uid) === String(u));
      if (entry) {
        state.drawer = {
          type: 'entryEditor',
          mode: 'editWb',
          heading: state.activeBook,
          bookName: state.activeBook,
          uid: entry.uid,
          allowNameEdit: true,
          showStrategy: true,
          strategyType: entry.strategy?.type || 'constant',
          name: entry.name || '',
          content: entry.content || '',
          meta: `UID #${entry.uid} · 顺序 ${entry.position?.order ?? 100}`,
        };
        renderDrawer();
      }
      return;
    }

    // --- Preset BaiBai group fold & master switch ---
    const prgFold = t.closest('[data-prg-fold]');
    if (prgFold) {
      const gid = prgFold.getAttribute('data-prg-fold');
      const box = prgFold.closest('.upp-group-box');
      if (box && gid) {
        const nextCollapsed = !box.classList.contains('is-collapsed');
        box.classList.toggle('is-collapsed', nextCollapsed);
        state.presetFoldState[`${state.loadedPresetName}::${gid}`] = nextCollapsed;
        renderPresetToolbar();
      }
      return;
    }
    const prgSw = t.closest('[data-prg-toggle]');
    if (prgSw && state.inUsePreset) {
      const gid = prgSw.getAttribute('data-prg-toggle');
      const groups = state.inUsePreset.extensions?.baibaiToolkit?.presetPromptGroups?.groups || [];
      const grp = groups.find(g => String(g.id) === String(gid));
      if (!grp) return;
      const next = !(grp.enabled !== false);
      grp.enabled = next;
      prgSw.setAttribute('aria-checked', String(next));
      const box = prgSw.closest('.upp-group-box');
      if (box) box.classList.toggle('is-disabled', !next);
      try {
        await Host.togglePresetGroup(gid, next);
        if (state.presetOnlyOn && !next) renderPresetBody();
      } catch (err) {
        grp.enabled = !next;
        prgSw.setAttribute('aria-checked', String(!next));
        if (box) box.classList.toggle('is-disabled', next);
        toast('切换分组失败：' + (err?.message || err), 'error');
      }
      return;
    }

    // --- Preset prompt switch & preview/edit ---
    const prSw = t.closest('[data-pr-toggle]');
    if (prSw && state.inUsePreset) {
      const pid = prSw.getAttribute('data-pr-toggle');
      const item = (state.inUsePreset.prompts || []).find(p => p.id === pid);
      if (!item) return;
      const next = !item.enabled;
      item.enabled = next;
      prSw.setAttribute('aria-checked', String(next));
      const row = prSw.closest('.upp-entry-row');
      if (row) row.classList.toggle('is-on', next);
      try {
        await Host.togglePresetPrompt(pid, next);
        if (state.presetOnlyOn && !next) renderPresetBody();
      } catch (err) {
        item.enabled = !next;
        prSw.setAttribute('aria-checked', String(!next));
        if (row) row.classList.toggle('is-on', !next);
        toast('切换预设条目失败：' + (err?.message || err), 'error');
      }
      return;
    }
    const prOpen = t.closest('[data-pr-open]');
    if (prOpen && state.inUsePreset) {
      const pid = prOpen.getAttribute('data-pr-open');
      const item = (state.inUsePreset.prompts || []).find(p => p.id === pid);
      if (item) {
        const isPh = typeof item.content !== 'string';
        state.drawer = {
          type: 'entryEditor',
          mode: 'editPreset',
          heading: `预设提示词 · ${state.loadedPresetName}`,
          promptId: item.id,
          allowNameEdit: !isPh,
          readOnly: isPh,
          name: item.name || item.id,
          content: isPh ? '此项为酒馆原生占位槽位，仅支持开关启停。' : item.content,
          meta: `ID: ${item.id} · 角色: ${item.role || 'system'}`,
        };
        renderDrawer();
      }
      return;
    }

    // --- Regex surgical switch & inspect ---
    const rgSw = t.closest('[data-rg-toggle]');
    if (rgSw) {
      const rid = rgSw.getAttribute('data-rg-toggle');
      const item = (state.regexList || []).find(r => r.id === rid);
      if (!item) return;
      const next = !item.enabled;
      item.enabled = next;
      rgSw.setAttribute('aria-checked', String(next));
      const row = rgSw.closest('.upp-entry-row');
      if (row) row.classList.toggle('is-on', next);
      try {
        await Host.toggleRegex(state.regexScope, rid, next);
        if (state.regexOnlyOn && !next) renderRegexBody();
      } catch (err) {
        item.enabled = !next;
        rgSw.setAttribute('aria-checked', String(!next));
        if (row) row.classList.toggle('is-on', !next);
        toast('切换正则失败：' + (err?.message || err), 'error');
      }
      return;
    }
    const rgOpen = t.closest('[data-rg-open]');
    if (rgOpen) {
      const rid = rgOpen.getAttribute('data-rg-open');
      const item = (state.regexList || []).find(r => r.id === rid);
      if (item) {
        const detail = [
          '【查找正则】\n' + (item.find_regex || ''),
          '【替换为】\n' + (item.replace_string || ''),
        ].join('\n\n');
        state.drawer = {
          type: 'entryEditor',
          heading: `正则详情 · ${item.script_name || rid}`,
          content: detail,
          readOnly: true,
          meta: `范围: ${state.regexScope} · 状态: ${item.enabled ? '开启' : '关闭'}`,
        };
        renderDrawer();
      }
    }
  });

  // Drawer interactions
  listen(elDrawerMask, 'input', ev => {
    const d = state.drawer;
    if (!d) return;
    if (d.type === 'bookPicker' && ev.target.id === 'upp-book-search-input') {
      d.query = ev.target.value;
      const listEl = shadow.querySelector('.upp-pop-list');
      if (listEl) {
        const q = normalizeText(d.query);
        const pinned = new Set(state.store.settings.pinnedWorldbooks);
        const globals = new Set(state.globalWorldbooks);
        const charSet = new Set([state.charWorldbooks.primary, ...(state.charWorldbooks.additional || [])].filter(Boolean));
        const sorted = [...state.worldbooks].sort((a, b) => {
          const pa = (pinned.has(a) ? 4 : 0) + (globals.has(a) ? 2 : 0) + (charSet.has(a) ? 1 : 0);
          const pb = (pinned.has(b) ? 4 : 0) + (globals.has(b) ? 2 : 0) + (charSet.has(b) ? 1 : 0);
          if (pa !== pb) return pb - pa;
          return a.localeCompare(b, 'zh-CN');
        });
        const shown = sorted.filter(n => !q || normalizeText(n).includes(q));
        listEl.innerHTML = shown.length ? shown.map(name => {
          const tags = [];
          if (pinned.has(name)) tags.push('<span class="upp-badge warn">置顶</span>');
          if (globals.has(name)) tags.push('<span class="upp-badge accent">全局</span>');
          if (charSet.has(name)) tags.push('<span class="upp-badge ok">角色</span>');
          if (state.chatWorldbook === name) tags.push('<span class="upp-badge ok">聊天</span>');
          return `<button class="upp-detail-item" data-pick-book="${escapeHtml(name)}" style="${name === state.activeBook ? 'border-color:var(--accent);' : ''}">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(name)}</span>
            <span class="upp-row-nowrap">${tags.join('')}</span>
          </button>`;
        }).join('') : '<div class="upp-empty" style="padding:18px;">未找到匹配世界书</div>';
      }
    }
  });

  listen(elDrawerMask, 'change', ev => {
    const d = state.drawer;
    if (!d) return;
    if (d.type === 'saveSnapshot') {
      if (ev.target.id === 'upp-sc-persona') d.scope.persona = ev.target.checked;
      else if (ev.target.id === 'upp-sc-wb') {
        d.scope.worldbooks = ev.target.checked;
        const wrap = shadow.getElementById('upp-ss-books-wrap');
        if (wrap) wrap.hidden = !d.scope.worldbooks;
      }
      else if (ev.target.id === 'upp-sc-preset') d.scope.preset = ev.target.checked;
      else if (ev.target.id === 'upp-sc-regex') d.scope.regex = ev.target.checked;
      else if (ev.target.hasAttribute('data-ss-book')) {
        const bk = ev.target.getAttribute('data-ss-book');
        const set = new Set(d.selectedBooks || []);
        if (ev.target.checked) set.add(bk); else set.delete(bk);
        d.selectedBooks = Array.from(set);
        const lbl = shadow.querySelector('#upp-ss-books-wrap > label');
        if (lbl) lbl.textContent = `记录条目开关的世界书（已选 ${set.size} 本）`;
      }
      return;
    }
    if (d.type === 'personaDiff') {
      if (ev.target.id === 'upp-diff-left') { d.leftId = ev.target.value; renderDrawer(); }
      else if (ev.target.id === 'upp-diff-right') { d.rightId = ev.target.value; renderDrawer(); }
      return;
    }
    if (d.type === 'mergePersonas') {
      if (ev.target.id === 'upp-merge-keep') {
        d.keepId = ev.target.value;
        d.absorbIds = (d.absorbIds || []).filter(id => id !== d.keepId);
        renderDrawer();
      } else if (ev.target.hasAttribute('data-merge-absorb')) {
        const aid = ev.target.getAttribute('data-merge-absorb');
        const set = new Set(d.absorbIds || []);
        if (ev.target.checked) set.add(aid); else set.delete(aid);
        d.absorbIds = Array.from(set);
        const btn = shadow.getElementById('upp-merge-run-btn');
        if (btn) { btn.disabled = !set.size; btn.textContent = `收回 ${set.size} 个分身`; }
      } else if (ev.target.id === 'upp-merge-delete-old') {
        d.deleteOld = ev.target.checked;
      }
      return;
    }
    if (d.type === 'backup' && ev.target.id === 'upp-import-file') {
      const file = ev.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = parseImportJson(reader.result);
          const snapMap = new Map(state.store.snapshots.map(s => [s.id, s]));
          imported.snapshots.forEach(s => snapMap.set(s.id, s));
          state.store.snapshots = Array.from(snapMap.values());
          Object.keys(imported.personaVersions).forEach(aid => {
            const cur = state.store.personaVersions[aid] || [];
            const vMap = new Map(cur.map(v => [v.id, v]));
            imported.personaVersions[aid].forEach(v => vMap.set(v.id, v));
            state.store.personaVersions[aid] = Array.from(vMap.values());
          });
          Object.assign(state.store.bindings.chats, imported.bindings.chats);
          Object.assign(state.store.bindings.characters, imported.bindings.characters);
          persistStore(state.store);
          state.drawer = null;
          render();
          toast('备份导入成功', 'success');
        } catch (err) {
          toast('导入失败：' + (err?.message || err), 'error');
        }
      };
      reader.readAsText(file);
    }
  });

  listen(elDrawerMask, 'click', async ev => {
    const t = ev.target;
    const d = state.drawer;
    if (!d) return;

    if (t.closest('[data-drawer-close]')) {
      state.drawer = d.returnTo || null;
      renderDrawer();
      return;
    }

    const pickBk = t.closest('[data-pick-book]');
    if (pickBk) {
      state.activeBook = pickBk.getAttribute('data-pick-book') || '';
      state.drawer = null;
      await ensureBookEntries(state.activeBook, true);
      render();
      return;
    }

    if (t.closest('#upp-ed-save-btn') && d.type === 'entryEditor') {
      const content = shadow.getElementById('upp-ed-content')?.value ?? '';
      const name = shadow.getElementById('upp-ed-name')?.value?.trim() ?? d.name ?? '';
      const strategyType = shadow.getElementById('upp-ed-strategy')?.value;
      try {
        if (d.mode === 'editPersona' && state.currentPersona) {
          await Host.updatePersonaInPlace(state.currentPersona.avatar_id, content);
          state.currentPersona = Host.getCurrentPersona();
          toast('已保存 User 正文', 'success');
        } else if (d.mode === 'editPersonaVersion' && state.currentPersona) {
          const aid = state.currentPersona.avatar_id;
          const list = state.store.personaVersions[aid] || [];
          const ver = list.find(v => v.id === d.versionId);
          if (ver) {
            ver.name = name || ver.name;
            ver.description = content;
            ver.updatedAt = Date.now();
            persistStore(state.store);
            toast('已更新内部版本', 'success');
          }
        } else if (d.mode === 'editWb') {
          await Host.updateWorldbookEntry(d.bookName, d.uid, name || '未命名条目', content, strategyType);
          await ensureBookEntries(d.bookName, true);
          toast('已保存世界书条目', 'success');
        } else if (d.mode === 'createWb') {
          await Host.createWorldbookEntry(d.bookName, { name: name || '新条目', content, strategyType });
          await ensureBookEntries(d.bookName, true);
          toast('已新建条目', 'success');
        } else if (d.mode === 'editPreset') {
          await Host.updatePresetPrompt(d.promptId, name || d.promptId, content);
          state.inUsePreset = Host.getInUsePreset();
          toast('已保存预设提示词', 'success');
        }
        state.drawer = d.returnTo || null;
        render();
      } catch (err) {
        toast('保存失败：' + (err?.message || err), 'error');
      }
      return;
    }

    const fillGrp = t.closest('[data-ss-fill-group]');
    if (fillGrp) {
      const inp = shadow.getElementById('upp-ss-group');
      if (inp) inp.value = fillGrp.getAttribute('data-ss-fill-group') || '';
      return;
    }
    if (t.closest('#upp-ss-confirm-btn') && d.type === 'saveSnapshot') {
      const name = (shadow.getElementById('upp-ss-name')?.value || '').trim();
      if (!name) { toast('请填写快照名称', 'warning'); return; }
      const group = (shadow.getElementById('upp-ss-group')?.value || '').trim();
      const note = (shadow.getElementById('upp-ss-note')?.value || '').trim();
      if (!d.scope.persona && !d.scope.worldbooks && !d.scope.preset && !d.scope.regex) {
        toast('请至少勾选一项保存范围', 'warning');
        return;
      }
      const snap = await captureLiveSnapshot({
        name, group, note,
        scope: d.scope,
        selectedBooks: d.selectedBooks,
      }, state.store);
      state.store.snapshots.unshift(snap);
      persistStore(state.store);
      state.drawer = null;
      state.tab = 'snapshots';
      render();
      toast(`已保存快照「${snap.name}」`, 'success');
      return;
    }

    if (d.type === 'viewSnapshot') {
      const applyInDrawer = t.closest('[data-snap-apply]');
      if (applyInDrawer) {
        await applySnapshotLive(d.snapshot, state.store);
        state.drawer = null;
        await refreshAll(true);
        return;
      }
      if (t.closest('[data-view-snap-persona]') && d.snapshot.persona) {
        state.drawer = {
          type: 'entryEditor',
          heading: `User 正文 · ${d.snapshot.persona.name}`,
          content: d.snapshot.persona.description || '',
          readOnly: true,
          returnTo: d,
        };
        renderDrawer();
        return;
      }
      const wbItem = t.closest('[data-view-snap-wb]');
      if (wbItem) {
        const bk = wbItem.getAttribute('data-view-snap-wb');
        const u = wbItem.getAttribute('data-view-snap-uid');
        const live = (d.wbDetails[bk] || []).find(e => String(e.uid) === String(u));
        if (live) {
          state.drawer = {
            type: 'entryEditor',
            heading: `${bk} · ${live.name || '(未命名)'}`,
            content: live.content || '',
            readOnly: true,
            returnTo: d,
          };
          renderDrawer();
        }
        return;
      }
      const prItem = t.closest('[data-view-snap-pr]');
      if (prItem) {
        const pid = prItem.getAttribute('data-view-snap-pr');
        const live = (state.inUsePreset?.prompts || []).find(p => p.id === pid);
        if (live) {
          state.drawer = {
            type: 'entryEditor',
            heading: `预设 · ${live.name || pid}`,
            content: typeof live.content === 'string' ? live.content : '原生占位槽位',
            readOnly: true,
            returnTo: d,
          };
          renderDrawer();
        }
        return;
      }
    }

    if (d.type === 'bindSnapshot') {
      const sid = d.snapshot.id;
      if (t.closest('#upp-bind-chat-btn') && state.chatId) {
        if (state.store.bindings.chats[state.chatId] === sid) delete state.store.bindings.chats[state.chatId];
        else state.store.bindings.chats[state.chatId] = sid;
        persistStore(state.store);
        render();
        return;
      }
      if (t.closest('#upp-bind-char-btn') && state.charInfo.id) {
        if (state.store.bindings.characters[state.charInfo.id] === sid) delete state.store.bindings.characters[state.charInfo.id];
        else state.store.bindings.characters[state.charInfo.id] = sid;
        persistStore(state.store);
        render();
        return;
      }
    }

    if (d.type === 'savePersonaVersion' && state.currentPersona) {
      const fillPv = t.closest('[data-pv-fill-name]');
      if (fillPv) {
        const inp = shadow.getElementById('upp-pv-name');
        if (inp) inp.value = fillPv.getAttribute('data-pv-fill-name') || '';
        return;
      }
      const delPv = t.closest('[data-pv-del]');
      if (delPv) {
        const vid = delPv.getAttribute('data-pv-del');
        const aid = state.currentPersona.avatar_id;
        state.store.personaVersions[aid] = (state.store.personaVersions[aid] || []).filter(v => v.id !== vid);
        persistStore(state.store);
        render();
        return;
      }
      if (t.closest('#upp-pv-save-btn')) {
        const vName = (shadow.getElementById('upp-pv-name')?.value || '').trim();
        if (!vName) { toast('请填写版本名称', 'warning'); return; }
        const aid = state.currentPersona.avatar_id;
        const list = state.store.personaVersions[aid] || [];
        const existingIdx = list.findIndex(v => v.name === vName);
        const item = {
          id: existingIdx >= 0 ? list[existingIdx].id : uid('pv'),
          name: vName.slice(0, 60),
          description: state.currentPersona.description || '',
          lorebook: state.currentPersona.lorebook || '',
          updatedAt: Date.now(),
        };
        if (existingIdx >= 0) list[existingIdx] = item;
        else list.unshift(item);
        state.store.personaVersions[aid] = list;
        persistStore(state.store);
        state.drawer = null;
        render();
        toast(`已保存内部版本「${item.name}」`, 'success');
        return;
      }
    }

    if (d.type === 'mergePersonas') {
      const grpBtn = t.closest('[data-merge-preset-group]');
      if (grpBtn) {
        const idx = Number(grpBtn.getAttribute('data-merge-preset-group'));
        const dupGroups = detectProliferatedPersonas(state.personas);
        const g = dupGroups[idx];
        if (g) {
          d.keepId = g.items[0].avatar_id;
          d.absorbIds = g.items.slice(1).map(x => x.avatar_id);
          renderDrawer();
        }
        return;
      }
      if (t.closest('#upp-merge-run-btn')) {
        const keep = state.personas.find(p => p.avatar_id === d.keepId);
        if (!keep) return;
        const list = state.store.personaVersions[keep.avatar_id] || [];
        if ((keep.description || '').trim() && !list.some(v => v.description === keep.description)) {
          list.unshift({
            id: uid('pv'),
            name: '原主描述',
            description: keep.description,
            lorebook: keep.lorebook || '',
            updatedAt: Date.now(),
          });
        }
        let absorbed = 0;
        let deleted = 0;
        for (const aid of (d.absorbIds || [])) {
          const oldP = state.personas.find(p => p.avatar_id === aid);
          if (!oldP) continue;
          let label = oldP.name;
          if (label.startsWith(keep.name) && label.length > keep.name.length) {
            label = label.slice(keep.name.length).replace(/^[\s_\-·・/()（）【】\[\]]+/, '').replace(/[)）】\]]+$/, '') || oldP.name;
          }
          if (list.some(v => v.name === label)) label = `${label} (${absorbed + 1})`;
          list.push({
            id: uid('pv'),
            name: label.slice(0, 60),
            description: oldP.description || '',
            lorebook: oldP.lorebook || '',
            updatedAt: Date.now(),
          });
          absorbed++;
          if (d.deleteOld) {
            try {
              if (await Host.deletePersonaById(oldP.avatar_id)) deleted++;
            } catch (_) {}
          }
        }
        state.store.personaVersions[keep.avatar_id] = list;
        persistStore(state.store);
        state.drawer = null;
        await refreshAll(false);
        toast(deleted > 0
          ? `已收回 ${absorbed} 个分身并删除 ${deleted} 个旧 User`
          : `已收回 ${absorbed} 个分身为「${keep.name}」的内部版本`, 'success');
        return;
      }
    }

    if (d.type === 'backup') {
      if (t.closest('#upp-export-json-btn')) {
        const blob = new Blob([exportStoreJson(state.store)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = Env.pdoc.createElement('a');
        a.href = url;
        a.download = `user-snapshots-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        later(() => URL.revokeObjectURL(url), 1000);
        toast('已导出备份文件', 'success');
        return;
      }
      if (t.closest('#upp-import-json-btn')) {
        shadow.getElementById('upp-import-file')?.click();
      }
    }
  });

  // =========================
  // Modal Open / Close & Host Mounting
  // =========================

  function openModal() {
    elBackdrop.dataset.theme = detectHostTheme();
    state.open = true;
    state.drawer = null;
    elBackdrop.hidden = false;
    syncMenuExpanded();
    void refreshAll(false);
  }

  function closeModal() {
    state.open = false;
    state.drawer = null;
    elBackdrop.hidden = true;
    syncMenuExpanded();
  }

  listen(Env.pdoc, 'keydown', ev => {
    if (ev.key === 'Escape' && state.open) {
      if (state.drawer) { state.drawer = state.drawer.returnTo || null; renderDrawer(); }
      else closeModal();
    }
  });

  let lastAutoKey = '';
  let autoTimer = null;
  function scheduleAutoApplyOnChatChange() {
    if (autoTimer) Env.pwin.clearTimeout(autoTimer);
    autoTimer = later(async () => {
      autoTimer = null;
      if (dead || isApplyingSnapshot) return;
      state.store = loadStoreSync();
      if (!state.store.settings.autoApplyBindings) return;
      const chatId = readCurrentChatId();
      const charInfo = readCurrentCharInfo();
      const bound = resolveBindingForContext(state.store.bindings, chatId, charInfo.id);
      if (!bound) return;
      const key = `${chatId}|${charInfo.id}|${bound.snapshotId}`;
      if (key === lastAutoKey) return;
      const snap = state.store.snapshots.find(s => s.id === bound.snapshotId);
      if (!snap) return;
      lastAutoKey = key;
      await applySnapshotLive(snap, state.store, '已自动切回快照');
      if (state.open) await refreshAll(true);
    }, 350);
  }

  const menuEntry = Env.pdoc.createElement('div');
  menuEntry.id = MENU_ENTRY_ID;
  menuEntry.className = 'list-group-item flex-container flexGap5 interactable';
  menuEntry.tabIndex = 0;
  menuEntry.setAttribute('role', 'button');
  menuEntry.setAttribute('aria-expanded', 'false');
  menuEntry.innerHTML =
    '<span class="extensionsMenuExtensionButton" aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' +
      '</svg>' +
    '</span><span>User 组装与快照</span>';

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

  const eventOnFn = getFn('eventOn');
  const getBtnEvtFn = getFn('getButtonEvent');
  const tavernEvents = getApi('tavern_events')?.value;

  if (eventOnFn && getBtnEvtFn) {
    try {
      const btnEvt = getBtnEvtFn(BUTTON_NAME);
      if (btnEvt) {
        const s = eventOnFn(btnEvt, () => { if (state.open) closeModal(); else openModal(); });
        if (s?.stop) cleanup.push(() => s.stop());
      }
    } catch (_) {}
  }
  if (eventOnFn && tavernEvents?.APP_READY) {
    try { const s = eventOnFn(tavernEvents.APP_READY, () => mountExtensionMenu()); if (s?.stop) cleanup.push(() => s.stop()); } catch (_) {}
  }
  if (eventOnFn && tavernEvents?.EXTENSIONS_FIRST_LOAD) {
    try { const s = eventOnFn(tavernEvents.EXTENSIONS_FIRST_LOAD, () => mountExtensionMenu()); if (s?.stop) cleanup.push(() => s.stop()); } catch (_) {}
  }
  if (eventOnFn && tavernEvents?.CHAT_CHANGED) {
    try { const s = eventOnFn(tavernEvents.CHAT_CHANGED, () => scheduleAutoApplyOnChatChange()); if (s?.stop) cleanup.push(() => s.stop()); } catch (_) {}
  }
  if (!mountExtensionMenu()) {
    later(() => mountExtensionMenu(), 800);
    later(() => mountExtensionMenu(), 2500);
  }

  function dispose() {
    if (dead) return;
    dead = true;
    timers.forEach(id => Env.pwin.clearTimeout(id));
    timers.clear();
    if (saveGlobalTimer) Env.pwin.clearTimeout(saveGlobalTimer);
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
