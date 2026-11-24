// Pure core logic for User 组装与快照 (Native SillyTavern Extension v7.0.0)
// Zero DOM / host dependencies — 100% unit-testable in Node ESM.

export const APP_VERSION = '7.1.0';

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

// Xiaotian-grade Snapshot Preset Inspector model:
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
      ? '未记录'
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
