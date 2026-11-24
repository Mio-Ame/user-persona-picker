// Pure core logic for 快照管家 (Native SillyTavern Extension v7.5.0)
// Zero DOM / host dependencies — 100% unit-testable in Node ESM.

export const APP_VERSION = '7.5.0';
export const THEME_MODES = ['paper', 'ink', 'warm', 'sakura', 'host', 'glass-dark'];

export function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

export function normalizeText(str) {
  return String(str || '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').toLowerCase();
}

export function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function createEmptyStore() {
  return {
    version: 7,
    settings: {
      autoApplyBindings: true,
      showFloatingBall: true,
      presetGroupsDefaultCollapsed: true,
      themeMode: 'paper',
      fabSide: 'right',
      fabY: 0.68,
      pinnedWorldbooks: [],
    },
    personaVersions: {},
    snapshots: [],
    bindings: {
      chats: {},
      characters: {},
    },
  };
}

export function sanitizePlainMap(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  Object.keys(obj).forEach(k => {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
    out[k] = obj[k];
  });
  return out;
}

export function sanitizeBoolMap(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  Object.keys(obj).forEach(k => {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
    if (typeof obj[k] === 'boolean') out[k] = obj[k];
  });
  return out;
}

export function sanitizeStore(raw) {
  const base = createEmptyStore();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;

  const st = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  base.settings.autoApplyBindings = st.autoApplyBindings !== false;
  base.settings.showFloatingBall = st.showFloatingBall !== false;
  base.settings.presetGroupsDefaultCollapsed = st.presetGroupsDefaultCollapsed !== false;
  base.settings.themeMode = THEME_MODES.includes(st.themeMode) ? st.themeMode : 'paper';
  base.settings.fabSide = st.fabSide === 'left' ? 'left' : 'right';
  const yNum = Number(st.fabY);
  base.settings.fabY = Number.isFinite(yNum) ? Math.min(0.92, Math.max(0.08, yNum)) : 0.68;
  base.settings.pinnedWorldbooks = Array.isArray(st.pinnedWorldbooks)
    ? Array.from(new Set(st.pinnedWorldbooks.map(x => String(x || '').trim()).filter(Boolean)))
    : [];

  const pvRaw = sanitizePlainMap(raw.personaVersions);
  Object.keys(pvRaw).forEach(avatarId => {
    const list = Array.isArray(pvRaw[avatarId]) ? pvRaw[avatarId] : [];
    const cleanList = list
      .filter(v => v && typeof v === 'object')
      .map(v => ({
        id: String(v.id || uid('pv')),
        name: String(v.name || '未命名版本').slice(0, 60),
        displayName: typeof v.displayName === 'string' ? v.displayName.trim().slice(0, 60) : '',
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
            deletedBooks: Array.isArray(wbRaw.deletedBooks)
              ? Array.from(new Set(wbRaw.deletedBooks.map(String).filter(Boolean)))
              : [],
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

export function exportStoreJson(store) {
  return JSON.stringify({
    format: 'user-persona-snapshot-v7',
    version: 7,
    exportedAt: Date.now(),
    data: sanitizeStore(store),
  }, null, 2);
}

export function parseImportJson(rawText) {
  let parsed;
  try { parsed = JSON.parse(String(rawText || '')); } catch (_) {
    throw new Error('JSON 格式无效，请检查文件内容');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('备份文件结构无效');
  }
  if ((parsed.format === 'user-persona-snapshot-v7' || parsed.format === 'user-persona-snapshot-v6') && parsed.data) {
    return sanitizeStore(parsed.data);
  }
  if ((parsed.version === 7 || parsed.version === 6) && (Array.isArray(parsed.snapshots) || parsed.personaVersions)) {
    return sanitizeStore(parsed);
  }
  throw new Error('不是本插件导出的快照备份文件');
}

// =========================
// Native SillyTavern Preset & BaiBai Group Normalization
// =========================

export function pickActivePromptOrder(promptOrderArr) {
  if (!Array.isArray(promptOrderArr) || !promptOrderArr.length) return [];
  // Prefer SillyTavern's default chat-completion order block (character_id === 100001)
  const block = promptOrderArr.find(b => b && b.character_id === 100001 && Array.isArray(b.order))
    || promptOrderArr.find(b => b && Array.isArray(b.order));
  return block ? block.order : [];
}

export function extractBaiBaiGroups(rawPreset, runtimeState, fallbackPreset) {
  const candidates = [
    runtimeState,
    rawPreset?.extensions?.baibaiToolkit?.presetPromptGroups,
    fallbackPreset?.extensions?.baibaiToolkit?.presetPromptGroups,
  ];
  const src = candidates.find(c => c && typeof c === 'object' && Array.isArray(c.groups) && c.groups.length) || null;

  if (!src) {
    return { groups: [], groupsById: {}, promptGroupMap: {} };
  }

  const rawGroups = Array.isArray(src.groups) ? src.groups : [];
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
  const rawPrompts = sanitizePlainMap(src.prompts);
  Object.keys(rawPrompts).forEach(pid => {
    const meta = rawPrompts[pid];
    const gid = meta && meta.groupId != null ? String(meta.groupId) : '';
    if (gid && groupsById[gid]) {
      promptGroupMap[pid] = gid;
    }
  });

  return { groups, groupsById, promptGroupMap };
}

// Convert native SillyTavern oai_settings / completion preset JSON into unified model
export function normalizeNativePreset(rawPreset, runtimeBaiBaiState, fallbackDiskPreset) {
  if (!rawPreset || typeof rawPreset !== 'object') {
    return { prompts: [], groups: [], groupsById: {}, promptGroupMap: {} };
  }

  const rawPrompts = Array.isArray(rawPreset.prompts) ? rawPreset.prompts : [];
  const promptById = new Map();
  rawPrompts.forEach(p => {
    if (!p || typeof p !== 'object') return;
    const id = String(p.identifier ?? p.id ?? '').trim();
    if (id) promptById.set(id, p);
  });

  const orderList = pickActivePromptOrder(rawPreset.prompt_order);
  const prompts = [];
  const seen = new Set();

  if (orderList.length) {
    orderList.forEach(item => {
      if (!item || !item.identifier) return;
      const id = String(item.identifier);
      if (seen.has(id)) return;
      const def = promptById.get(id);
      if (!def) return;
      seen.add(id);
      prompts.push({
        id,
        name: String(def.name || id),
        enabled: !!item.enabled,
        role: String(def.role || 'system'),
        marker: !!def.marker,
        content: def.marker ? undefined : String(def.content ?? ''),
      });
    });
  } else {
    rawPrompts.forEach(def => {
      const id = String(def.identifier ?? def.id ?? '').trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      prompts.push({
        id,
        name: String(def.name || id),
        enabled: def.enabled !== false,
        role: String(def.role || 'system'),
        marker: !!def.marker,
        content: def.marker ? undefined : String(def.content ?? ''),
      });
    });
  }

  const { groups, groupsById, promptGroupMap } = extractBaiBaiGroups(rawPreset, runtimeBaiBaiState, fallbackDiskPreset);
  return { prompts, groups, groupsById, promptGroupMap };
}

// Render each BaiBai group once at its first member's real order; ungrouped prompts stay inline
export function buildPresetRenderNodes(normalizedPreset, opts) {
  const prompts = normalizedPreset && Array.isArray(normalizedPreset.prompts) ? normalizedPreset.prompts : [];
  const groups = normalizedPreset && Array.isArray(normalizedPreset.groups) ? normalizedPreset.groups : [];
  const groupsById = (normalizedPreset && normalizedPreset.groupsById) || {};
  const promptGroupMap = (normalizedPreset && normalizedPreset.promptGroupMap) || {};
  const q = normalizeText(opts?.search || '');
  const onlyOn = !!opts?.onlyOn;

  const membersByGroup = {};
  groups.forEach(g => { membersByGroup[g.id] = []; });
  prompts.forEach(p => {
    const gid = promptGroupMap[p.id];
    if (gid && membersByGroup[gid]) membersByGroup[gid].push(p);
  });

  const emittedGroups = new Set();
  const nodes = [];

  prompts.forEach(p => {
    const gid = promptGroupMap[p.id];
    if (gid && groupsById[gid]) {
      if (emittedGroups.has(gid)) return;
      emittedGroups.add(gid);
      const grp = groupsById[gid];
      const allMembers = membersByGroup[gid] || [];
      const groupNameMatched = !!q && normalizeText(grp.name).includes(q);
      const shownMembers = allMembers.filter(m => {
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
      if (onlyOn && !p.enabled) return;
      if (q && !normalizeText((p.name || '') + ' ' + (p.content || '') + ' ' + (p.id || '')).includes(q)) return;
      nodes.push({ type: 'prompt', prompt: p });
    }
  });

  return { nodes, hasGroups: groups.length > 0, groups };
}

// Grouped Snapshot Preset Inspector model:
// Overlays saved snapshot prompt/group switches onto the REAL preset definition (even for non-active presets!)
export function buildSnapshotPresetInspectModel(snapPreset, normalizedPreset, opts) {
  const savedPrompts = (snapPreset && snapPreset.prompts) || {};
  const savedGroups = (snapPreset && snapPreset.groups) || {};
  const prompts = normalizedPreset && Array.isArray(normalizedPreset.prompts) ? normalizedPreset.prompts : [];
  const groups = normalizedPreset && Array.isArray(normalizedPreset.groups) ? normalizedPreset.groups : [];
  const groupsById = (normalizedPreset && normalizedPreset.groupsById) || {};
  const promptGroupMap = (normalizedPreset && normalizedPreset.promptGroupMap) || {};

  const q = normalizeText(opts?.search || '');
  const onlyOn = !!opts?.onlyOn;

  const isGroupOn = grp => {
    if (!grp) return true;
    if (Object.prototype.hasOwnProperty.call(savedGroups, grp.id)) return savedGroups[grp.id] !== false;
    return grp.enabled !== false;
  };

  const isRecorded = id => Object.prototype.hasOwnProperty.call(savedPrompts, id);
  const rawEntryOn = p => (isRecorded(p.id) ? savedPrompts[p.id] === true : !!p.enabled);

  const knownIds = new Set(prompts.map(p => p.id));
  const missingIds = Object.keys(savedPrompts).filter(id => !knownIds.has(id));

  // Build effective rows
  const membersByGroup = {};
  groups.forEach(g => { membersByGroup[g.id] = []; });

  let effectiveOnTotal = 0;
  let powerOffGroupCount = 0;
  groups.forEach(g => { if (!isGroupOn(g)) powerOffGroupCount++; });

  const enrichedPrompts = prompts.map(p => {
    const gid = promptGroupMap[p.id];
    const grp = gid ? groupsById[gid] : null;
    const grpOn = isGroupOn(grp);
    const selfOn = rawEntryOn(p);
    const effectiveOn = selfOn && grpOn;
    if (effectiveOn) effectiveOnTotal++;
    const statusNote = !isRecorded(p.id)
      ? '新增未记录'
      : !selfOn
        ? ''
        : !grpOn
          ? '整组已关'
          : '';
    const item = {
      ...p,
      recorded: isRecorded(p.id),
      selfOn,
      effectiveOn,
      groupId: gid || '',
      statusNote,
    };
    if (gid && membersByGroup[gid]) membersByGroup[gid].push(item);
    return item;
  });

  const emittedGroups = new Set();
  const nodes = [];

  enrichedPrompts.forEach(item => {
    const gid = item.groupId;
    if (gid && groupsById[gid]) {
      if (emittedGroups.has(gid)) return;
      emittedGroups.add(gid);
      const grp = groupsById[gid];
      const grpOn = isGroupOn(grp);
      const allMembers = membersByGroup[gid] || [];
      const effCount = allMembers.filter(m => m.effectiveOn).length;
      const selfOnCount = allMembers.filter(m => m.selfOn).length;
      const groupNameMatched = !!q && normalizeText(grp.name).includes(q);
      const shownMembers = allMembers.filter(m => {
        if (onlyOn && !m.effectiveOn) return false;
        if (!q || groupNameMatched) return true;
        return normalizeText((m.name || '') + ' ' + (m.content || '') + ' ' + (m.id || '')).includes(q);
      });
      if (!shownMembers.length) return;
      nodes.push({
        type: 'group',
        group: { ...grp, enabled: grpOn },
        items: shownMembers,
        totalCount: allMembers.length,
        effectiveOnCount: effCount,
        selfOnCount,
        forceExpand: !!q || onlyOn,
      });
    } else {
      if (onlyOn && !item.effectiveOn) return;
      if (q && !normalizeText((item.name || '') + ' ' + (item.content || '') + ' ' + (item.id || '')).includes(q)) return;
      nodes.push({ type: 'prompt', prompt: item });
    }
  });

  return {
    nodes,
    hasGroups: groups.length > 0,
    groups,
    totalPrompts: prompts.length,
    effectiveOnTotal,
    powerOffGroupCount,
    missingIds,
  };
}

// =========================
// XML / Wrapper Tag Hygiene Inspector
// =========================

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr']);

export function analyzeEntryTags(content) {
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

export function inspectTagHygiene(entries) {
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

// =========================
// Diff, Persona Proliferation, Bindings & Helpers
// =========================

export function computeLineDiff(beforeText, afterText) {
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

export function extractPersonaBaseName(name) {
  let s = String(name || '').trim();
  if (!s) return '';
  s = s.replace(/\s*[\(（\[【][^\)）\]】]{1,20}[\)）\]】]\s*$/g, '');
  s = s.replace(/[\s_\-·・/]+(v?\d+|第?\d+版|[\u4e00-\u9fa5a-zA-Z0-9]{1,8}版|au|日常|现代|古风|校园|战损|黑化|备份|测试)$/i, '');
  s = s.replace(/\d+$/g, '').trim();
  return s || String(name || '').trim();
}

export function detectProliferatedPersonas(personas) {
  const list = (Array.isArray(personas) ? personas : []).filter(p => p && p.avatar_id);
  const groups = new Map();
  const baseByAvatar = new Map();

  // Pass 1: group by base name (strips numeric/edition suffixes like 名字1 / 名字_现代版)
  list.forEach(p => {
    const base = extractPersonaBaseName(p.name);
    const key = base.toLowerCase();
    if (!key) return;
    baseByAvatar.set(p.avatar_id, base);
    if (!groups.has(key)) groups.set(key, { baseName: base, items: [] });
    groups.get(key).items.push(p);
  });

  // Pass 2: detect Chinese given-name surname-swap groups sharing the same trailing 2-char given name
  const suffixMap = new Map();
  list.forEach(p => {
    const base = baseByAvatar.get(p.avatar_id) || '';
    if (/^[\u4e00-\u9fa5]{2,4}$/.test(base)) {
      const tail2 = base.length >= 2 ? base.slice(-2) : '';
      if (tail2) {
        if (!suffixMap.has(tail2)) suffixMap.set(tail2, []);
        suffixMap.get(tail2).push(p);
      }
    }
  });

  const mergedGroups = new Map();
  const claimed = new Set();

  // Prefer multi-item surname-swap groups first when 2+ items share the same 2-char Chinese given name
  suffixMap.forEach((items, tail2) => {
    const distinctFullNames = new Set(items.map(x => baseByAvatar.get(x.avatar_id)));
    if (items.length >= 2 && distinctFullNames.size >= 2) {
      mergedGroups.set('tail:' + tail2, { baseName: tail2, items: [...items] });
      items.forEach(x => claimed.add(x.avatar_id));
    }
  });

  groups.forEach((g, k) => {
    const remaining = g.items.filter(x => !claimed.has(x.avatar_id));
    if (remaining.length >= 2) {
      mergedGroups.set(k, { baseName: g.baseName, items: remaining });
    }
  });

  return Array.from(mergedGroups.values());
}

export function resolveBindingForContext(bindings, chatId, charId) {
  if (!bindings || typeof bindings !== 'object') return null;
  if (chatId && bindings.chats && bindings.chats[chatId]) {
    return { snapshotId: bindings.chats[chatId], source: 'chat' };
  }
  if (charId && bindings.characters && bindings.characters[charId]) {
    return { snapshotId: bindings.characters[charId], source: 'character' };
  }
  return null;
}

export function buildCleanCopyText(entries) {
  return (Array.isArray(entries) ? entries : [])
    .filter(e => e && e.enabled && String(e.content || '').trim())
    .map(e => String(e.content || '').trim())
    .join('\n\n');
}

export function formatTimeShort(ts) {
  const n = Number(ts);
  if (!n) return '';
  const d = new Date(n);
  const pad = v => String(v).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function inferThemeFromTextColor(colorStr, hasIgLight) {
  if (hasIgLight) return 'light';
  const m = String(colorStr || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return 'light';
  const r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum < 140 ? 'light' : 'dark';
}

// Format a single worldbook's display title & optional small subtitle honoring worldbook-organizer modes
export function formatWorldbookDisplay(name, orgSettings, charNameMap) {
  const realName = String(name || '');
  const org = orgSettings && typeof orgSettings === 'object' ? orgSettings : null;
  const aliases = org?.aliases && typeof org.aliases === 'object' ? org.aliases : {};
  const alias = typeof aliases[realName] === 'string' ? aliases[realName].trim() : '';
  const charMode = ['char_with_sub', 'char_only', 'original'].includes(org?.charBookTitleMode)
    ? org.charBookTitleMode
    : 'char_with_sub';
  const aliasMode = ['alias_with_sub', 'alias_only'].includes(org?.aliasTitleMode)
    ? org.aliasTitleMode
    : 'alias_with_sub';

  if (alias) {
    return {
      primary: alias,
      subtitle: aliasMode === 'alias_with_sub' && alias !== realName ? realName : '',
      isCharLabel: false,
    };
  }

  const charNames = charNameMap && charNameMap.get(realName);
  if (Array.isArray(charNames) && charNames.length) {
    const label = charNames.join(' / ');
    if (charMode === 'char_only') return { primary: label, subtitle: '', isCharLabel: true };
    if (charMode === 'char_with_sub') {
      return { primary: label, subtitle: label !== realName ? realName : '', isCharLabel: true };
    }
  }

  return { primary: realName, subtitle: '', isCharLabel: false };
}

// Group worldbooks using optional worldbook_organizer extension settings (read-only, graceful fallback)
export function groupWorldbooksByOrganizer(worldbooks, orgSettings, meta = {}) {
  const list = Array.isArray(worldbooks) ? worldbooks : [];
  const pinnedSet = new Set(Array.isArray(meta.pinned) ? meta.pinned : []);
  const globalSet = new Set(Array.isArray(meta.globals) ? meta.globals : []);
  const charSet = new Set(Array.isArray(meta.charBooks) ? meta.charBooks : []);
  const chatBook = meta.chatBook || '';
  const query = normalizeText(meta.query || '');

  const org = orgSettings && typeof orgSettings === 'object' ? orgSettings : null;
  const orgGroups = Array.isArray(org?.groups) ? org.groups : [];
  const assignments = org?.assignments && typeof org.assignments === 'object' ? org.assignments : {};
  const aliases = org?.aliases && typeof org.aliases === 'object' ? org.aliases : {};
  const cachedCharBindings = org?.cachedCharBindings && typeof org.cachedCharBindings === 'object' ? org.cachedCharBindings : {};
  const excludedIds = new Set([
    ...(Array.isArray(org?.globalHiddenGroupIds) ? org.globalHiddenGroupIds : []),
    ...(Array.isArray(org?.editorHiddenGroupIds) ? org.editorHiddenGroupIds : []),
  ].map(String));

  // Build worldbook -> character display names map from BOTH organizer cache AND live host bindings
  const knownCharBooks = new Set();
  const charNameMap = new Map();
  const addCharBinding = (bookName, charName) => {
    const bk = String(bookName || '').trim();
    const cn = String(charName || '').trim();
    if (!bk) return;
    knownCharBooks.add(bk);
    if (!cn) return;
    if (!charNameMap.has(bk)) charNameMap.set(bk, []);
    const arr = charNameMap.get(bk);
    if (!arr.includes(cn)) arr.push(cn);
  };

  Object.values(cachedCharBindings).forEach(entry => {
    if (!entry || typeof entry !== 'object') return;
    const cn = String(entry.name || '').trim();
    if (entry.primary) addCharBinding(entry.primary, cn);
    if (entry.embedded) addCharBinding(entry.embedded, cn);
    if (Array.isArray(entry.extra)) entry.extra.forEach(x => x && addCharBinding(x, cn));
  });
  if (meta.liveCharBookMap && typeof meta.liveCharBookMap === 'object') {
    Object.keys(meta.liveCharBookMap).forEach(bk => {
      const names = meta.liveCharBookMap[bk];
      if (Array.isArray(names)) names.forEach(cn => addCharBinding(bk, cn));
    });
  }

  const groupMap = new Map();
  orgGroups.forEach(g => {
    if (!g || !g.id) return;
    const gid = String(g.id);
    const isExcluded = excludedIds.has(gid);
    groupMap.set(gid, {
      id: gid,
      name: String(g.name || '未命名分组'),
      color: typeof g.color === 'string' ? g.color : '',
      isExcluded,
      defaultCollapsed: isExcluded,
      items: [],
    });
  });

  const pinnedBucket = { id: '__pinned__', name: '常用与当前启用', color: '', items: [] };
  const charBucket = { id: '__char__', name: '角色书', color: '', items: [], isExcluded: excludedIds.has('__char__'), defaultCollapsed: true };
  const ungroupedBucket = { id: '__ungrouped__', name: orgGroups.length ? '未分组' : '全部世界书', color: '', items: [] };

  const makeItem = name => {
    const alias = typeof aliases[name] === 'string' ? aliases[name].trim() : '';
    const gid = assignments[name] && groupMap.has(String(assignments[name])) ? String(assignments[name]) : '';
    const gName = gid ? groupMap.get(gid).name : (knownCharBooks.has(name) ? '角色书' : '');
    const fmt = formatWorldbookDisplay(name, org, charNameMap);
    const charNames = charNameMap.get(name) || [];
    return {
      name,
      alias,
      displayTitle: fmt.primary,
      subtitle: fmt.subtitle,
      charNames,
      groupId: gid,
      groupName: gName,
      isPinned: pinnedSet.has(name),
      isGlobal: globalSet.has(name),
      isChar: charSet.has(name),
      isChat: chatBook === name,
    };
  };

  const sortItems = arr => arr.sort((a, b) => {
    const pa = (a.isPinned ? 4 : 0) + (a.isGlobal ? 2 : 0) + (a.isChar || a.isChat ? 1 : 0);
    const pb = (b.isPinned ? 4 : 0) + (b.isGlobal ? 2 : 0) + (b.isChar || b.isChat ? 1 : 0);
    if (pa !== pb) return pb - pa;
    return a.displayTitle.localeCompare(b.displayTitle, 'zh-CN');
  });

  list.forEach(name => {
    const item = makeItem(name);
    if (query) {
      const hay = normalizeText(item.name + ' ' + item.alias + ' ' + item.displayTitle + ' ' + item.groupName + ' ' + item.charNames.join(' '));
      if (!hay.includes(query)) return;
    }
    if (item.isPinned || item.isGlobal || item.isChar || item.isChat) {
      pinnedBucket.items.push(item);
    }
    if (item.groupId && groupMap.has(item.groupId)) {
      groupMap.get(item.groupId).items.push(item);
    } else if (knownCharBooks.has(name)) {
      charBucket.items.push(item);
    } else {
      ungroupedBucket.items.push(item);
    }
  });

  const sections = [];
  if (pinnedBucket.items.length) { sortItems(pinnedBucket.items); sections.push(pinnedBucket); }
  const activeGroups = [];
  const excludedGroups = [];
  groupMap.forEach(g => {
    if (!g.items.length) return;
    sortItems(g.items);
    if (g.isExcluded) excludedGroups.push(g);
    else activeGroups.push(g);
  });
  sections.push(...activeGroups);
  if (ungroupedBucket.items.length) { sortItems(ungroupedBucket.items); sections.push(ungroupedBucket); }
  sections.push(...excludedGroups);
  if (charBucket.items.length) { sortItems(charBucket.items); sections.push(charBucket); }

  return { sections, hasOrganizer: orgGroups.length > 0 || knownCharBooks.size > 0, charNameMap };
}

// Keep snapshots, pins, and persona lorebooks synchronized when a worldbook is renamed
export function migrateStoreOnWorldbookRename(store, oldName, newName) {
  const from = String(oldName || '').trim();
  const to = String(newName || '').trim();
  if (!store || !from || !to || from === to) return { changed: false, affectedSnapshots: 0 };

  let changed = false;
  let affectedSnapshots = 0;

  if (Array.isArray(store.settings?.pinnedWorldbooks)) {
    const idx = store.settings.pinnedWorldbooks.indexOf(from);
    if (idx >= 0) {
      store.settings.pinnedWorldbooks[idx] = to;
      store.settings.pinnedWorldbooks = Array.from(new Set(store.settings.pinnedWorldbooks));
      changed = true;
    }
  }

  Object.values(store.personaVersions || {}).forEach(list => {
    if (!Array.isArray(list)) return;
    list.forEach(v => {
      if (v && v.lorebook === from) { v.lorebook = to; changed = true; }
    });
  });

  (store.snapshots || []).forEach(s => {
    if (!s) return;
    let snapHit = false;
    if (s.persona && s.persona.lorebook === from) {
      s.persona.lorebook = to;
      snapHit = true;
    }
    const wb = s.worldbooks;
    if (wb) {
      if (Array.isArray(wb.global)) {
        const gi = wb.global.indexOf(from);
        if (gi >= 0) {
          wb.global[gi] = to;
          wb.global = Array.from(new Set(wb.global));
          snapHit = true;
        }
      }
      if (wb.char) {
        if (wb.char.primary === from) { wb.char.primary = to; snapHit = true; }
        if (Array.isArray(wb.char.additional)) {
          const ai = wb.char.additional.indexOf(from);
          if (ai >= 0) {
            wb.char.additional[ai] = to;
            wb.char.additional = Array.from(new Set(wb.char.additional));
            snapHit = true;
          }
        }
      }
      if (wb.chat === from) { wb.chat = to; snapHit = true; }
      if (wb.entries && Object.prototype.hasOwnProperty.call(wb.entries, from)) {
        wb.entries[to] = wb.entries[from];
        delete wb.entries[from];
        snapHit = true;
      }
      if (Array.isArray(wb.deletedBooks) && wb.deletedBooks.includes(from)) {
        wb.deletedBooks = wb.deletedBooks.filter(n => n !== from);
        snapHit = true;
      }
    }
    if (snapHit) { changed = true; affectedSnapshots++; }
  });

  return { changed, affectedSnapshots };
}

// Mark deleted worldbooks inside snapshots so users see which book is missing instead of silent loss
export function markStoreOnWorldbookDeleted(store, deletedNames) {
  const targets = new Set((Array.isArray(deletedNames) ? deletedNames : []).map(x => String(x || '').trim()).filter(Boolean));
  if (!store || !targets.size) return { changed: false, affectedSnapshots: 0 };

  let changed = false;
  let affectedSnapshots = 0;

  if (Array.isArray(store.settings?.pinnedWorldbooks)) {
    const next = store.settings.pinnedWorldbooks.filter(n => !targets.has(n));
    if (next.length !== store.settings.pinnedWorldbooks.length) {
      store.settings.pinnedWorldbooks = next;
      changed = true;
    }
  }

  (store.snapshots || []).forEach(s => {
    if (!s || !s.worldbooks) return;
    const wb = s.worldbooks;
    const hitBooks = new Set(Array.isArray(wb.deletedBooks) ? wb.deletedBooks : []);
    let snapHit = false;
    targets.forEach(name => {
      const refsBook = (Array.isArray(wb.global) && wb.global.includes(name))
        || wb.char?.primary === name
        || (Array.isArray(wb.char?.additional) && wb.char.additional.includes(name))
        || wb.chat === name
        || (wb.entries && Object.prototype.hasOwnProperty.call(wb.entries, name));
      if (refsBook && !hitBooks.has(name)) {
        hitBooks.add(name);
        snapHit = true;
      }
    });
    if (snapHit) {
      wb.deletedBooks = Array.from(hitBooks);
      changed = true;
      affectedSnapshots++;
    }
  });

  return { changed, affectedSnapshots };
}

// Inspect a snapshot against current live host resources BEFORE applying so missing assets can be repaired without data loss
export function inspectSnapshotHealth(snap, liveEnv = {}) {
  const result = {
    hasBlockingIssues: false,
    missingPersona: null,
    missingWorldbooks: [],
    missingPreset: '',
    presetDrift: { removedPromptCount: 0, newPromptCount: 0 },
  };
  if (!snap || typeof snap !== 'object') return result;

  const livePersonas = Array.isArray(liveEnv.personas) ? liveEnv.personas : [];
  const liveBooks = new Set(Array.isArray(liveEnv.worldbooks) ? liveEnv.worldbooks : []);
  const livePresets = new Set(Array.isArray(liveEnv.presets) ? liveEnv.presets : []);

  if (snap.scope?.persona && snap.persona && (snap.persona.avatarId || snap.persona.name)) {
    const found = livePersonas.find(p => p && p.avatar_id === snap.persona.avatarId)
      || livePersonas.find(p => p && p.name === snap.persona.name);
    if (!found) {
      result.missingPersona = {
        avatarId: String(snap.persona.avatarId || ''),
        name: String(snap.persona.name || snap.persona.avatarId || '未知 User'),
      };
    }
  }

  if (snap.scope?.worldbooks && snap.worldbooks) {
    const missingSet = new Set();
    if (Array.isArray(snap.worldbooks.global)) {
      snap.worldbooks.global.forEach(bk => {
        if (bk && !liveBooks.has(bk)) missingSet.add(bk);
      });
    }
    const entriesMap = snap.worldbooks.entries && typeof snap.worldbooks.entries === 'object'
      ? snap.worldbooks.entries
      : {};
    Object.keys(entriesMap).forEach(bk => {
      if (bk && !liveBooks.has(bk)) missingSet.add(bk);
    });
    result.missingWorldbooks = Array.from(missingSet);
  }

  if (snap.scope?.preset && snap.preset && snap.preset.name) {
    if (!livePresets.has(snap.preset.name)) {
      result.missingPreset = String(snap.preset.name);
    } else if (liveEnv.presetNorm && Array.isArray(liveEnv.presetNorm.prompts)) {
      const savedPrompts = snap.preset.prompts || {};
      const liveIds = new Set(liveEnv.presetNorm.prompts.map(p => p.id));
      result.presetDrift.removedPromptCount = Object.keys(savedPrompts).filter(id => !liveIds.has(id)).length;
      result.presetDrift.newPromptCount = liveEnv.presetNorm.prompts.filter(p => !Object.prototype.hasOwnProperty.call(savedPrompts, p.id)).length;
    }
  }

  result.hasBlockingIssues = !!(result.missingPersona || result.missingWorldbooks.length || result.missingPreset);
  return result;
}


