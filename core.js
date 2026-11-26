// Pure core logic for 快照管家 (Native SillyTavern Extension v7.9.2)
// Zero DOM / host dependencies — 100% unit-testable in Node ESM.

export const APP_VERSION = '7.9.2';
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
      defaultSnapshotScope: {
        persona: true,
        worldbooks: true,
        preset: true,
        regex: true,
        api: true,
      },
      themeMode: 'paper',
      fabSide: 'right',
      fabY: 0.68,
      modalWidth: 0,
      modalHeight: 0,
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

export function sanitizeStringMap(obj, maxLen = 80) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  Object.keys(obj).forEach(k => {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
    if (typeof obj[k] === 'string') {
      const v = obj[k].trim().slice(0, maxLen);
      if (v) out[k] = v;
    }
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
  const ds = st.defaultSnapshotScope && typeof st.defaultSnapshotScope === 'object' ? st.defaultSnapshotScope : {};
  base.settings.defaultSnapshotScope = {
    persona: ds.persona !== false,
    worldbooks: ds.worldbooks !== false,
    preset: ds.preset !== false,
    regex: ds.regex !== false,
    api: ds.api !== false,
  };
  base.settings.themeMode = THEME_MODES.includes(st.themeMode) ? st.themeMode : 'paper';
  base.settings.fabSide = st.fabSide === 'left' ? 'left' : 'right';
  const yNum = Number(st.fabY);
  base.settings.fabY = Number.isFinite(yNum) ? Math.min(0.92, Math.max(0.08, yNum)) : 0.68;
  if (Array.isArray(st.fabPosition) && st.fabPosition.length === 2
    && st.fabPosition.every(n => Number.isFinite(n) && n >= 0 && n <= 1)) {
    base.settings.fabPosition = st.fabPosition.slice();
  }
  const mwNum = Math.round(Number(st.modalWidth));
  const mhNum = Math.round(Number(st.modalHeight));
  base.settings.modalWidth = Number.isFinite(mwNum) && mwNum >= 310 && mwNum <= 2400 ? mwNum : 0;
  base.settings.modalHeight = Number.isFinite(mhNum) && mhNum >= 250 && mhNum <= 2000 ? mhNum : 0;
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
          const normBookList = arr => Array.from(new Set(arr.map(x => String(x || '').trim()).filter(Boolean)));
          cleanWb = {
            global: Array.isArray(wbRaw.global) ? normBookList(wbRaw.global) : null,
            char: wbRaw.char && typeof wbRaw.char === 'object'
              ? {
                  primary: wbRaw.char.primary ? String(wbRaw.char.primary) : null,
                  additional: Array.isArray(wbRaw.char.additional) ? normBookList(wbRaw.char.additional) : [],
                }
              : null,
            chat: typeof wbRaw.chat === 'string' ? wbRaw.chat : null,
            entries: entriesOut,
            deletedBooks: Array.isArray(wbRaw.deletedBooks)
              ? normBookList(wbRaw.deletedBooks)
              : [],
          };
        }
        const prRaw = s.preset && typeof s.preset === 'object' ? s.preset : null;
        const rgRaw = s.regex && typeof s.regex === 'object' ? s.regex : null;
        const psRaw = s.persona && typeof s.persona === 'object' ? s.persona : null;
        const apiRaw = s.api && typeof s.api === 'object' ? s.api : null;
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
            api: sc.api !== false && !!apiRaw,
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
                promptNames: sanitizeStringMap(prRaw.promptNames, 80),
                groupNames: sanitizeStringMap(prRaw.groupNames, 60),
              }
            : null,
          regex: rgRaw
            ? {
                global: sanitizeBoolMap(rgRaw.global),
                character: sanitizeBoolMap(rgRaw.character),
                preset: sanitizeBoolMap(rgRaw.preset),
              }
            : null,
          api: apiRaw
            ? {
                profileId: String(apiRaw.profileId || '').trim().slice(0, 120),
                profileName: String(apiRaw.profileName || '').trim().slice(0, 80),
                source: String(apiRaw.source || '').trim().slice(0, 60),
                model: String(apiRaw.model || '').trim().slice(0, 120),
                customUrl: String(apiRaw.customUrl || '').trim().slice(0, 240),
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
// Native SillyTavern Preset & Prompt Group Normalization
// =========================

export function pickActivePromptOrder(promptOrderArr) {
  if (!Array.isArray(promptOrderArr) || !promptOrderArr.length) return [];
  // Prefer SillyTavern's default chat-completion order block (character_id === 100001)
  const block = promptOrderArr.find(b => b && b.character_id === 100001 && Array.isArray(b.order))
    || promptOrderArr.find(b => b && Array.isArray(b.order));
  return block ? block.order : [];
}

function findPresetPromptGroups(presetObj) {
  const exts = presetObj && typeof presetObj === 'object' ? presetObj.extensions : null;
  if (!exts || typeof exts !== 'object') return null;
  let fallbackEmpty = null;
  if (exts.presetPromptGroups && typeof exts.presetPromptGroups === 'object' && Array.isArray(exts.presetPromptGroups.groups)) {
    if (exts.presetPromptGroups.groups.length > 0) return exts.presetPromptGroups;
    fallbackEmpty = exts.presetPromptGroups;
  }
  const vals = Object.values(exts);
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    const pg = v && typeof v === 'object' ? v.presetPromptGroups : null;
    if (pg && typeof pg === 'object' && Array.isArray(pg.groups)) {
      if (pg.groups.length > 0) return pg;
      if (!fallbackEmpty) fallbackEmpty = pg;
    }
  }
  return fallbackEmpty;
}

export function extractPresetGroups(rawPreset, runtimeState, fallbackPreset) {
  const candidates = [
    runtimeState,
    findPresetPromptGroups(rawPreset),
    findPresetPromptGroups(fallbackPreset),
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
  groups.forEach(g => {
    if (g.id === '__proto__') {
      Object.defineProperty(groupsById, '__proto__', { value: g, enumerable: true, writable: true, configurable: true });
    } else {
      groupsById[g.id] = g;
    }
  });

  const promptGroupMap = {};
  const rawPrompts = sanitizePlainMap(src.prompts);
  Object.keys(rawPrompts).forEach(pid => {
    const meta = rawPrompts[pid];
    const gid = meta && meta.groupId != null ? String(meta.groupId) : '';
    if (gid && Object.prototype.hasOwnProperty.call(groupsById, gid)) {
      promptGroupMap[pid] = gid;
    }
  });

  return { groups, groupsById, promptGroupMap };
}

// Convert native SillyTavern oai_settings / completion preset JSON into unified model
export function normalizeNativePreset(rawPreset, runtimeGroupState, fallbackDiskPreset) {
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

  const { groups, groupsById, promptGroupMap } = extractPresetGroups(rawPreset, runtimeGroupState, fallbackDiskPreset);
  return { prompts, groups, groupsById, promptGroupMap };
}

// Render each preset group once at its first member's real order; ungrouped prompts stay inline
export function buildPresetRenderNodes(normalizedPreset, opts) {
  const prompts = normalizedPreset && Array.isArray(normalizedPreset.prompts) ? normalizedPreset.prompts : [];
  const groups = normalizedPreset && Array.isArray(normalizedPreset.groups) ? normalizedPreset.groups : [];
  const groupsById = normalizedPreset && normalizedPreset.groupsById && typeof normalizedPreset.groupsById === 'object' && !Array.isArray(normalizedPreset.groupsById)
    ? normalizedPreset.groupsById
    : {};
  const promptGroupMap = normalizedPreset && normalizedPreset.promptGroupMap && typeof normalizedPreset.promptGroupMap === 'object' && !Array.isArray(normalizedPreset.promptGroupMap)
    ? normalizedPreset.promptGroupMap
    : {};
  const safeOpts = opts && typeof opts === 'object' && !Array.isArray(opts) && !(opts instanceof String) ? opts : {};
  const q = normalizeText(typeof safeOpts.search === 'string' ? safeOpts.search : '');
  const onlyOn = !!safeOpts.onlyOn;

  const membersByGroup = new Map();
  groups.forEach(g => { if (g && g.id) membersByGroup.set(g.id, []); });
  prompts.forEach(p => {
    if (!p || !p.id) return;
    const gid = Object.prototype.hasOwnProperty.call(promptGroupMap, p.id) ? promptGroupMap[p.id] : '';
    if (gid && membersByGroup.has(gid)) membersByGroup.get(gid).push(p);
  });

  const emittedGroups = new Set();
  const nodes = [];

  prompts.forEach(p => {
    if (!p || !p.id) return;
    const gid = Object.prototype.hasOwnProperty.call(promptGroupMap, p.id) ? promptGroupMap[p.id] : '';
    const rawGrp = gid && Object.prototype.hasOwnProperty.call(groupsById, gid) ? groupsById[gid] : null;
    const grp = rawGrp && typeof rawGrp === 'object' && !Array.isArray(rawGrp) ? rawGrp : null;
    if (gid && grp) {
      if (emittedGroups.has(gid)) return;
      emittedGroups.add(gid);
      const allMembers = membersByGroup.get(gid) || [];
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
  const groupsById = normalizedPreset && normalizedPreset.groupsById && typeof normalizedPreset.groupsById === 'object' && !Array.isArray(normalizedPreset.groupsById)
    ? normalizedPreset.groupsById
    : {};
  const promptGroupMap = normalizedPreset && normalizedPreset.promptGroupMap && typeof normalizedPreset.promptGroupMap === 'object' && !Array.isArray(normalizedPreset.promptGroupMap)
    ? normalizedPreset.promptGroupMap
    : {};

  const safeOpts = opts && typeof opts === 'object' && !Array.isArray(opts) && !(opts instanceof String) ? opts : {};
  const q = normalizeText(typeof safeOpts.search === 'string' ? safeOpts.search : '');
  const onlyOn = !!safeOpts.onlyOn;

  const isGroupOn = grp => {
    if (!grp || typeof grp !== 'object' || Array.isArray(grp)) return true;
    if (Object.prototype.hasOwnProperty.call(savedGroups, grp.id)) return savedGroups[grp.id] !== false;
    return grp.enabled !== false;
  };

  const isRecorded = id => Object.prototype.hasOwnProperty.call(savedPrompts, id);
  const rawEntryOn = p => (isRecorded(p.id) ? savedPrompts[p.id] === true : !!p.enabled);

  const knownIds = new Set(prompts.map(p => p.id));
  const missingIds = Object.keys(savedPrompts).filter(id => !knownIds.has(id));

  // Build effective rows
  const membersByGroup = new Map();
  groups.forEach(g => { if (g && g.id) membersByGroup.set(g.id, []); });

  let effectiveOnTotal = 0;
  let powerOffGroupCount = 0;
  groups.forEach(g => { if (!isGroupOn(g)) powerOffGroupCount++; });

  const enrichedPrompts = prompts.map(p => {
    const gid = Object.prototype.hasOwnProperty.call(promptGroupMap, p.id) ? promptGroupMap[p.id] : '';
    const rawGrp = gid && Object.prototype.hasOwnProperty.call(groupsById, gid) ? groupsById[gid] : null;
    const grp = rawGrp && typeof rawGrp === 'object' && !Array.isArray(rawGrp) ? rawGrp : null;
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
    if (gid && membersByGroup.has(gid)) membersByGroup.get(gid).push(item);
    return item;
  });

  const emittedGroups = new Set();
  const nodes = [];

  enrichedPrompts.forEach(item => {
    const gid = item.groupId;
    const rawGrp = gid && Object.prototype.hasOwnProperty.call(groupsById, gid) ? groupsById[gid] : null;
    const grp = rawGrp && typeof rawGrp === 'object' && !Array.isArray(rawGrp) ? rawGrp : null;
    if (gid && grp) {
      if (emittedGroups.has(gid)) return;
      emittedGroups.add(gid);
      const grpOn = isGroupOn(grp);
      const allMembers = membersByGroup.get(gid) || [];
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

// Build grouped override tree for Preset Sync ("existing prompt/group switches") in true preset order, excluding newPromptIds
export function buildPresetSyncOverrideTree(targetPresetNorm, newPromptIds, opts = {}) {
  const prompts = targetPresetNorm && Array.isArray(targetPresetNorm.prompts) ? targetPresetNorm.prompts : [];
  const groups = targetPresetNorm && Array.isArray(targetPresetNorm.groups) ? targetPresetNorm.groups : [];
  const rawGroupsById = targetPresetNorm && targetPresetNorm.groupsById && typeof targetPresetNorm.groupsById === 'object' && !Array.isArray(targetPresetNorm.groupsById)
    ? targetPresetNorm.groupsById
    : null;
  const groupsByIdMap = new Map();
  if (rawGroupsById) {
    Object.keys(rawGroupsById).forEach(gid => {
      const g = rawGroupsById[gid];
      if (gid && g && typeof g === 'object' && !Array.isArray(g)) groupsByIdMap.set(gid, g);
    });
  } else {
    groups.forEach(g => {
      if (g && g.id) groupsByIdMap.set(String(g.id), g);
    });
  }
  const promptGroupMap = targetPresetNorm && targetPresetNorm.promptGroupMap && typeof targetPresetNorm.promptGroupMap === 'object' && !Array.isArray(targetPresetNorm.promptGroupMap)
    ? targetPresetNorm.promptGroupMap
    : {};

  const excludeSet = new Set();
  if (newPromptIds instanceof Set || Array.isArray(newPromptIds)) {
    newPromptIds.forEach(entry => {
      const id = entry && typeof entry === 'object' ? entry.id : entry;
      if (id != null && String(id)) excludeSet.add(String(id));
    });
  }

  const safeOpts = opts && typeof opts === 'object' && !Array.isArray(opts) && !(opts instanceof String) ? opts : {};
  const q = normalizeText(typeof safeOpts.search === 'string' ? safeOpts.search : '');
  const forceAllExpand = !!safeOpts.forceExpand;

  const existingPrompts = prompts.filter(p => p && p.id && !excludeSet.has(String(p.id)));
  const membersByGroup = new Map();
  groups.forEach(g => {
    if (g && g.id) membersByGroup.set(String(g.id), []);
  });
  existingPrompts.forEach(p => {
    const gid = Object.prototype.hasOwnProperty.call(promptGroupMap, p.id) ? promptGroupMap[p.id] : '';
    if (gid && membersByGroup.has(gid)) membersByGroup.get(gid).push(p);
  });

  const emittedGroups = new Set();
  const nodes = [];

  existingPrompts.forEach(p => {
    const gid = Object.prototype.hasOwnProperty.call(promptGroupMap, p.id) ? promptGroupMap[p.id] : '';
    if (gid && groupsByIdMap.has(gid)) {
      if (emittedGroups.has(gid)) return;
      emittedGroups.add(gid);
      const grp = groupsByIdMap.get(gid);
      const allMembers = membersByGroup.get(gid) || [];
      const groupNameMatched = !!q && normalizeText(grp.name).includes(q);
      const shownMembers = allMembers.filter(m => {
        if (!q || groupNameMatched) return true;
        return normalizeText((m.name || '') + ' ' + (m.content || '') + ' ' + (m.id || '')).includes(q);
      });
      if (!shownMembers.length) return;
      const enabledCount = allMembers.filter(m => !!m.enabled).length;
      nodes.push({
        type: 'group',
        group: grp,
        items: shownMembers,
        totalCount: allMembers.length,
        enabledCount,
        forceExpand: !!q || forceAllExpand,
      });
    } else {
      if (q && !normalizeText((p.name || '') + ' ' + (p.content || '') + ' ' + (p.id || '')).includes(q)) return;
      nodes.push({ type: 'prompt', prompt: p });
    }
  });

  const matchedCount = nodes.reduce((sum, n) => sum + (n.type === 'group' ? n.items.length : 1), 0);
  return {
    nodes,
    hasGroups: groups.length > 0,
    matchedCount,
  };
}

// =========================
// XML / Wrapper Tag Hygiene Inspector
// =========================

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr']);

export function analyzeEntryTags(content) {
  const raw = String(content || '');
  const cleaned = raw.replace(/<%[\s\S]*?%>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const re = /<(\/?)([a-zA-Z\u4e00-\u9fa5][a-zA-Z0-9_\-\u4e00-\u9fa5]*)(?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*?)?(\/?)\s*>/g;
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

function parseColorRgb(colorStr) {
  const s = String(colorStr || '').trim();
  if (!s || /^transparent$/i.test(s)) return null;
  const rgbMatch = s.match(/^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
  if (rgbMatch) {
    const r = Math.min(255, Math.max(0, Number(rgbMatch[1])));
    const g = Math.min(255, Math.max(0, Number(rgbMatch[2])));
    const b = Math.min(255, Math.max(0, Number(rgbMatch[3])));
    let a = 1;
    if (rgbMatch[4] !== undefined) {
      const rawA = rgbMatch[4];
      a = rawA.endsWith('%') ? Number(rawA.slice(0, -1)) / 100 : Number(rawA);
      if (!Number.isFinite(a)) a = 1;
      a = Math.min(1, Math.max(0, a));
    }
    return { r, g, b, a };
  }
  const hexMatch = s.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hexMatch) {
    let h = hexMatch[1];
    if (h.length === 3 || h.length === 4) {
      h = h.split('').map(c => c + c).join('');
    }
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  return null;
}

export function toOpaqueColor(colorStr, fallbackHex = '#191a1d') {
  const base = parseColorRgb(fallbackHex) || { r: 25, g: 26, b: 29, a: 1 };
  const parsed = parseColorRgb(colorStr);
  if (!parsed || parsed.a <= 0) {
    return `rgb(${Math.round(base.r)}, ${Math.round(base.g)}, ${Math.round(base.b)})`;
  }
  if (parsed.a >= 0.999) {
    return `rgb(${Math.round(parsed.r)}, ${Math.round(parsed.g)}, ${Math.round(parsed.b)})`;
  }
  const a = parsed.a;
  const r = Math.round(parsed.r * a + base.r * (1 - a));
  const g = Math.round(parsed.g * a + base.g * (1 - a));
  const b = Math.round(parsed.b * a + base.b * (1 - a));
  return `rgb(${r}, ${g}, ${b})`;
}

export function inferThemeFromTextColor(colorStr, bgColorOrLightHint) {
  if (bgColorOrLightHint === true) return 'light';
  if (typeof bgColorOrLightHint === 'string' && bgColorOrLightHint.trim()) {
    const bg = parseColorRgb(bgColorOrLightHint);
    if (bg && bg.a >= 0.35) {
      const bgLum = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b;
      return bgLum >= 150 ? 'light' : 'dark';
    }
  }
  const fg = parseColorRgb(colorStr);
  if (!fg) return 'light';
  const lum = 0.299 * fg.r + 0.587 * fg.g + 0.114 * fg.b;
  return lum < 140 ? 'light' : 'dark';
}

// Format a single worldbook's display title & optional small subtitle honoring external organizer modes
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

// Group worldbooks using optional external organizer extension settings (read-only, graceful fallback)
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

  if (Array.isArray(store.settings?.pinnedWorldbooks) && store.settings.pinnedWorldbooks.includes(from)) {
    store.settings.pinnedWorldbooks = Array.from(new Set(store.settings.pinnedWorldbooks.map(n => (n === from ? to : n))));
    changed = true;
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
      if (Array.isArray(wb.global) && wb.global.includes(from)) {
        wb.global = Array.from(new Set(wb.global.map(n => (n === from ? to : n))));
        snapHit = true;
      }
      if (wb.char) {
        if (wb.char.primary === from) { wb.char.primary = to; snapHit = true; }
        if (Array.isArray(wb.char.additional) && wb.char.additional.includes(from)) {
          wb.char.additional = Array.from(new Set(wb.char.additional.map(n => (n === from ? to : n))));
          snapHit = true;
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
    missingApiProfile: null,
    presetDrift: { removedPromptCount: 0, newPromptCount: 0 },
  };
  if (!snap || typeof snap !== 'object') return result;

  const livePersonas = Array.isArray(liveEnv.personas) ? liveEnv.personas : [];
  const liveBooks = new Set(Array.isArray(liveEnv.worldbooks) ? liveEnv.worldbooks : []);
  const livePresets = new Set(Array.isArray(liveEnv.presets) ? liveEnv.presets : []);
  const liveProfiles = Array.isArray(liveEnv.apiProfiles) ? liveEnv.apiProfiles : [];

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
    if (snap.worldbooks.char?.primary && !liveBooks.has(snap.worldbooks.char.primary)) {
      missingSet.add(snap.worldbooks.char.primary);
    }
    if (Array.isArray(snap.worldbooks.char?.additional)) {
      snap.worldbooks.char.additional.forEach(bk => {
        if (bk && !liveBooks.has(bk)) missingSet.add(bk);
      });
    }
    if (snap.worldbooks.chat && !liveBooks.has(snap.worldbooks.chat)) {
      missingSet.add(snap.worldbooks.chat);
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

  if (snap.scope?.api && snap.api && (snap.api.profileId || snap.api.profileName)) {
    const foundProfile = liveProfiles.find(pr => pr && pr.id === snap.api.profileId)
      || liveProfiles.find(pr => pr && pr.name === snap.api.profileName);
    if (!foundProfile) {
      result.missingApiProfile = {
        profileId: String(snap.api.profileId || ''),
        profileName: String(snap.api.profileName || snap.api.profileId || '未知连接配置'),
      };
    }
  }

  result.hasBlockingIssues = !!(
    result.missingPersona
    || result.missingWorldbooks.length
    || result.missingPreset
    || result.missingApiProfile
  );
  return result;
}

// Suggest clean, human-readable snapshot names from active character / persona / preset context
export function suggestSnapshotNames(ctx = {}) {
  const character = String(ctx.charName || '').trim();
  const charName = normalizeText(character) === normalizeText(ctx.group) ? '' : character;
  const personaName = String(ctx.personaName || '').trim();
  const presetName = String(ctx.presetName || '').trim();
  const shortPreset = presetName.length > 18 ? presetName.slice(0, 18) : presetName;
  const existing = new Set((Array.isArray(ctx.existingNames) ? ctx.existingNames : []).map(x => String(x || '').trim()));

  const rawCandidates = [];
  if (charName && personaName) rawCandidates.push(`${charName} · ${personaName}`);
  if (charName) rawCandidates.push(charName);
  if (charName && shortPreset) rawCandidates.push(`${charName} · ${shortPreset}`);
  if (personaName && shortPreset) rawCandidates.push(`${personaName} · ${shortPreset}`);
  if (personaName) rawCandidates.push(personaName);
  if (shortPreset) rawCandidates.push(shortPreset);

  const unique = Array.from(new Set(rawCandidates.map(s => s.trim().slice(0, 60)).filter(Boolean)));
  const dedupName = base => {
    if (!existing.has(base)) return base;
    for (let i = 2; i <= 99; i++) {
      const suffix = ` #${i}`;
      const next = base.slice(0, 60 - suffix.length) + suffix;
      if (!existing.has(next)) return next;
    }
    return base;
  };

  const primary = unique.length ? dedupName(unique[0]) : dedupName(`快照 ${formatTimeShort(Date.now())}`);
  return {
    primary,
    suggestions: unique.slice(0, 4).map(dedupName),
  };
}

export const SNAPSHOT_ROUTES = Object.freeze([
  '现代版', '古代版', '骨科线', '穿越线', '高中线', 'if线', '结婚线', '分手线', '爱豆线', '网恋线',
]);

export function splitSnapshotRoute(name) {
  const title = String(name ?? '').trim();
  const route = SNAPSHOT_ROUTES.find(item => (
    title.toLowerCase() === item || title.toLowerCase().endsWith(`·${item}`)
    || title.toLowerCase().endsWith(`· ${item}`)
  )) || '';
  const base = route ? title.slice(0, -route.length).replace(/\s*·\s*$/, '').trimEnd() : title;
  return { base, route };
}

export function nameWithSnapshotRoute(base, route) {
  const separator = base && route ? ' · ' : '';
  return base.slice(0, 60 - separator.length - route.length) + separator + route;
}

// =========================
// Preset Version Migration & Batch Sync Engine
// =========================

export function normalizePresetLabel(label) {
  return normalizeText(label)
    .replace(/[\(（\[【][^\)）\]】]{1,24}[\)）\]】]/g, '')
    .replace(/v?\d+(?:\.\d+)+/gi, '')
    .replace(/[\s_\-·・/\\:：,，.。!！?？~～]+/g, '')
    .trim();
}

// Analyze how a set of snapshots maps onto a target normalized preset (supports same-preset sync and cross-version preset upgrades, even if old preset was deleted)
export function analyzePresetMigration(snapshots, sourcePresetNorm, targetPresetNorm) {
  const snaps = (Array.isArray(snapshots) ? snapshots : []).filter(s => s && s.scope?.preset && s.preset);
  const targetPrompts = Array.isArray(targetPresetNorm?.prompts) ? targetPresetNorm.prompts : [];
  const targetGroups = Array.isArray(targetPresetNorm?.groups) ? targetPresetNorm.groups : [];
  const srcPrompts = Array.isArray(sourcePresetNorm?.prompts) ? sourcePresetNorm.prompts : [];
  const srcGroups = Array.isArray(sourcePresetNorm?.groups) ? sourcePresetNorm.groups : [];

  const isPlainObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

  // Collect best-known old prompt/group names from live source preset + snapshot saved promptNames/groupNames
  const oldPromptNameById = new Map();
  srcPrompts.forEach(p => { if (p && p.id) oldPromptNameById.set(String(p.id), String(p.name || p.id)); });
  const oldGroupNameById = new Map();
  srcGroups.forEach(g => { if (g && g.id) oldGroupNameById.set(String(g.id), String(g.name || g.id)); });

  const allOldPromptIds = new Set();
  const allOldGroupIds = new Set();
  snaps.forEach(s => {
    const pm = isPlainObj(s.preset?.prompts) ? s.preset.prompts : {};
    const pn = isPlainObj(s.preset?.promptNames) ? s.preset.promptNames : {};
    Object.keys(pm).forEach(id => {
      allOldPromptIds.add(id);
      if (!oldPromptNameById.has(id) && Object.prototype.hasOwnProperty.call(pn, id) && pn[id]) {
        oldPromptNameById.set(id, String(pn[id]));
      }
    });
    const gm = isPlainObj(s.preset?.groups) ? s.preset.groups : {};
    const gn = isPlainObj(s.preset?.groupNames) ? s.preset.groupNames : {};
    Object.keys(gm).forEach(gid => {
      allOldGroupIds.add(gid);
      if (!oldGroupNameById.has(gid) && Object.prototype.hasOwnProperty.call(gn, gid) && gn[gid]) {
        oldGroupNameById.set(gid, String(gn[gid]));
      }
    });
  });

  // Build unique normalized-title index for unmatched old prompts & groups
  const targetPromptIds = new Set(targetPrompts.map(p => p.id));
  const targetGroupIds = new Set(targetGroups.map(g => g.id));

  const oldIdsByNormTitle = new Map();
  allOldPromptIds.forEach(oldId => {
    if (targetPromptIds.has(oldId)) return; // Already matched directly by ID
    const rawName = oldPromptNameById.get(oldId) || '';
    const norm = normalizePresetLabel(rawName);
    if (!norm) return;
    if (!oldIdsByNormTitle.has(norm)) oldIdsByNormTitle.set(norm, []);
    oldIdsByNormTitle.get(norm).push(oldId);
  });

  const oldGroupIdsByNormTitle = new Map();
  allOldGroupIds.forEach(oldGid => {
    if (targetGroupIds.has(oldGid)) return;
    const rawName = oldGroupNameById.get(oldGid) || '';
    const norm = normalizePresetLabel(rawName);
    if (!norm) return;
    if (!oldGroupIdsByNormTitle.has(norm)) oldGroupIdsByNormTitle.set(norm, []);
    oldGroupIdsByNormTitle.get(norm).push(oldGid);
  });

  const matchedById = [];
  const matchedByName = [];
  const newPrompts = [];
  const usedOldPromptIds = new Set();

  targetPrompts.forEach(tp => {
    if (allOldPromptIds.has(tp.id)) {
      usedOldPromptIds.add(tp.id);
      matchedById.push({ targetId: tp.id, oldId: tp.id, name: tp.name, enabled: !!tp.enabled, role: tp.role, marker: !!tp.marker });
      return;
    }
    const norm = normalizePresetLabel(tp.name);
    const candidates = norm ? (oldIdsByNormTitle.get(norm) || []).filter(id => !usedOldPromptIds.has(id)) : [];
    if (candidates.length === 1) {
      const oldId = candidates[0];
      usedOldPromptIds.add(oldId);
      matchedByName.push({
        targetId: tp.id,
        oldId,
        oldName: oldPromptNameById.get(oldId) || oldId,
        name: tp.name,
        enabled: !!tp.enabled,
        role: tp.role,
        marker: !!tp.marker,
      });
      return;
    }
    newPrompts.push({
      id: tp.id,
      name: tp.name,
      enabled: !!tp.enabled,
      role: tp.role,
      marker: !!tp.marker,
    });
  });

  const unmatchedOldPrompts = Array.from(allOldPromptIds)
    .filter(id => !usedOldPromptIds.has(id))
    .map(id => ({ id, name: oldPromptNameById.get(id) || '未命名旧条目' }));

  const matchedGroups = [];
  const newGroups = [];
  const usedOldGroupIds = new Set();

  targetGroups.forEach(tg => {
    if (allOldGroupIds.has(tg.id)) {
      usedOldGroupIds.add(tg.id);
      matchedGroups.push({ targetId: tg.id, oldId: tg.id, matchType: 'id', name: tg.name, enabled: tg.enabled !== false });
      return;
    }
    const norm = normalizePresetLabel(tg.name);
    const candidates = norm ? (oldGroupIdsByNormTitle.get(norm) || []).filter(id => !usedOldGroupIds.has(id)) : [];
    if (candidates.length === 1) {
      const oldId = candidates[0];
      usedOldGroupIds.add(oldId);
      matchedGroups.push({ targetId: tg.id, oldId, matchType: 'name', oldName: oldGroupNameById.get(oldId) || oldId, name: tg.name, enabled: tg.enabled !== false });
      return;
    }
    newGroups.push({ id: tg.id, name: tg.name, enabled: tg.enabled !== false });
  });

  const unmatchedOldGroups = Array.from(allOldGroupIds)
    .filter(id => !usedOldGroupIds.has(id))
    .map(id => ({ id, name: oldGroupNameById.get(id) || '未命名旧分组' }));

  return {
    matchedById,
    matchedByName,
    newPrompts,
    unmatchedOldPrompts,
    matchedGroups,
    newGroups,
    unmatchedOldGroups,
  };
}

// Apply a planned preset migration / batch sync cleanly onto a list of snapshots (returns new cloned snapshots)
export function applyPresetMigrationToSnapshots(snapshots, opts = {}) {
  const isPlainObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const setOwnProp = (obj, key, val) => {
    if (key === '__proto__') {
      Object.defineProperty(obj, '__proto__', { value: val, enumerable: true, writable: true, configurable: true });
    } else {
      obj[key] = val;
    }
  };

  const safeOpts = isPlainObj(opts) ? opts : {};
  const {
    targetPresetName,
    targetPresetNorm,
    analysis,
    newPromptDecisions,   // { [newId]: { include: bool, enabled: bool, inheritFromOldId?: string } }
    forceOverridePrompts, // { [promptId]: bool } — optional explicit override for existing prompts
    forceOverrideGroups,  // { [groupId]: bool } — optional explicit override for groups
    syncNewGroups = true,
    cleanRemovedIds = true,
  } = safeOpts;

  const safeNewDecisions = isPlainObj(newPromptDecisions) ? newPromptDecisions : {};
  const safeForcePrompts = isPlainObj(forceOverridePrompts) ? forceOverridePrompts : {};
  const safeForceGroups = isPlainObj(forceOverrideGroups) ? forceOverrideGroups : {};

  const targetPrompts = Array.isArray(targetPresetNorm?.prompts) ? targetPresetNorm.prompts : [];
  const targetGroups = Array.isArray(targetPresetNorm?.groups) ? targetPresetNorm.groups : [];
  const targetPromptNameMap = {};
  targetPrompts.forEach(p => { if (p && p.id) setOwnProp(targetPromptNameMap, p.id, String(p.name || p.id).slice(0, 80)); });
  const targetGroupNameMap = {};
  targetGroups.forEach(g => { if (g && g.id) setOwnProp(targetGroupNameMap, g.id, String(g.name || g.id).slice(0, 60)); });

  const idMapByTarget = new Map();
  (analysis?.matchedById || []).forEach(m => idMapByTarget.set(m.targetId, m.oldId));
  (analysis?.matchedByName || []).forEach(m => idMapByTarget.set(m.targetId, m.oldId));

  const grpMapByTarget = new Map();
  (analysis?.matchedGroups || []).forEach(m => grpMapByTarget.set(m.targetId, m.oldId));

  const now = Date.now();
  return (Array.isArray(snapshots) ? snapshots : []).map(rawSnap => {
    const snap = structuredClone(rawSnap);
    if (!snap || typeof snap !== 'object' || !snap.scope?.preset || !snap.preset) return snap;

    const oldPrompts = isPlainObj(snap.preset.prompts) ? snap.preset.prompts : {};
    const oldGroups = isPlainObj(snap.preset.groups) ? snap.preset.groups : {};
    const nextPrompts = cleanRemovedIds ? {} : { ...oldPrompts };
    const nextGroups = cleanRemovedIds ? {} : { ...oldGroups };

    // 1. Carry over matched prompts (ID first, normalized-title fallback), with optional force override
    targetPrompts.forEach(tp => {
      if (!tp || !tp.id) return;
      if (Object.prototype.hasOwnProperty.call(safeForcePrompts, tp.id)) {
        setOwnProp(nextPrompts, tp.id, !!safeForcePrompts[tp.id]);
        return;
      }
      const mappedOldId = idMapByTarget.get(tp.id);
      if (mappedOldId && Object.prototype.hasOwnProperty.call(oldPrompts, mappedOldId)) {
        setOwnProp(nextPrompts, tp.id, !!oldPrompts[mappedOldId]);
        return;
      }
      // 2. Handle new prompt decision (manual old-entry pairing OR sync from target preset live switch!)
      const dec = Object.prototype.hasOwnProperty.call(safeNewDecisions, tp.id) ? safeNewDecisions[tp.id] : null;
      if (dec && typeof dec === 'object' && dec.inheritFromOldId && Object.prototype.hasOwnProperty.call(oldPrompts, dec.inheritFromOldId)) {
        setOwnProp(nextPrompts, tp.id, !!oldPrompts[dec.inheritFromOldId]);
      } else if (dec && typeof dec === 'object' && dec.include) {
        setOwnProp(nextPrompts, tp.id, !!dec.enabled);
      } else if (!dec && Object.prototype.hasOwnProperty.call(oldPrompts, tp.id)) {
        setOwnProp(nextPrompts, tp.id, !!oldPrompts[tp.id]);
      }
    });

    // 3. Carry over matched groups + optionally sync new groups / force overrides
    targetGroups.forEach(tg => {
      if (!tg || !tg.id) return;
      if (Object.prototype.hasOwnProperty.call(safeForceGroups, tg.id)) {
        setOwnProp(nextGroups, tg.id, !!safeForceGroups[tg.id]);
        return;
      }
      const mappedOldGid = grpMapByTarget.get(tg.id);
      if (mappedOldGid && Object.prototype.hasOwnProperty.call(oldGroups, mappedOldGid)) {
        setOwnProp(nextGroups, tg.id, oldGroups[mappedOldGid] !== false);
        return;
      }
      if (Object.prototype.hasOwnProperty.call(oldGroups, tg.id)) {
        setOwnProp(nextGroups, tg.id, oldGroups[tg.id] !== false);
      } else if (syncNewGroups) {
        setOwnProp(nextGroups, tg.id, tg.enabled !== false);
      }
    });

    const oldPromptNames = isPlainObj(snap.preset.promptNames) ? snap.preset.promptNames : {};
    const oldGroupNames = isPlainObj(snap.preset.groupNames) ? snap.preset.groupNames : {};
    snap.preset = {
      name: targetPresetName || snap.preset.name,
      prompts: nextPrompts,
      groups: nextGroups,
      promptNames: cleanRemovedIds ? { ...targetPromptNameMap } : { ...oldPromptNames, ...targetPromptNameMap },
      groupNames: cleanRemovedIds ? { ...targetGroupNameMap } : { ...oldGroupNames, ...targetGroupNameMap },
    };
    snap.updatedAt = now;
    return snap;
  });
}

// =========================
// Window Geometry Clamping Helpers (Zero-DOM)
// =========================

function toFiniteNumber(val, fallback) {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

function toPositiveViewport(val, fallback) {
  return typeof val === 'number' && Number.isFinite(val) && val > 0 ? Math.max(1, Math.round(val)) : fallback;
}

function toNonNegNumber(val, fallback) {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0 ? val : fallback;
}

function clampBetween(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

export function clampModalSize(rectOrOpts = {}, viewport) {
  const rect = rectOrOpts && typeof rectOrOpts === 'object' ? rectOrOpts : {};
  const vp = viewport && typeof viewport === 'object' ? viewport : null;
  const vw = vp
    ? toPositiveViewport(vp.viewportWidth ?? vp.vw ?? vp.width, 390)
    : toPositiveViewport(rect.viewportWidth ?? rect.vw, 390);
  const vh = vp
    ? toPositiveViewport(vp.viewportHeight ?? vp.vh ?? vp.height, 780)
    : toPositiveViewport(rect.viewportHeight ?? rect.vh, 780);
  const isMobile = vw <= 680;

  const maxWidth = Math.max(1, Math.floor(0.96 * vw));
  const maxHeight = Math.max(1, Math.floor(vh));

  const rawMinW = isMobile ? Math.min(310, Math.max(1, vw - 16)) : 340;
  const rawMinH = isMobile ? 250 : 280;

  const minWidth = Math.min(rawMinW, maxWidth);
  const minHeight = Math.min(rawMinH, maxHeight);

  const rawW = Math.round(toFiniteNumber(rect.width, minWidth));
  const rawH = Math.round(toFiniteNumber(rect.height, minHeight));

  return {
    width: clampBetween(rawW, minWidth, maxWidth),
    height: clampBetween(rawH, minHeight, maxHeight),
    minWidth,
    maxWidth,
    minHeight,
    maxHeight,
    isMobile,
  };
}

export function clampModalRect({
  left,
  top,
  width,
  height,
  viewportWidth,
  viewportHeight,
  marginX = 8,
  marginTop = 8,
  marginBottom = 8,
} = {}) {
  const vw = toPositiveViewport(viewportWidth, 390);
  const vh = toPositiveViewport(viewportHeight, 780);
  const mX = toNonNegNumber(marginX, 8);
  const mTop = toNonNegNumber(marginTop, 8);
  const mBottom = toNonNegNumber(marginBottom, 8);

  const sized = clampModalSize({ width, height, viewportWidth: vw, viewportHeight: vh });
  const w = sized.width;
  const h = sized.height;

  const effMX = Math.min(mX, Math.max(0, Math.floor((vw - w) / 2)));
  const maxLeft = Math.max(effMX, vw - w - effMX);
  const defaultLeft = Math.round((vw - w) / 2);
  const clampedLeft = Math.round(clampBetween(toFiniteNumber(left, defaultLeft), effMX, maxLeft));

  const availTopRoom = Math.max(0, vh - h);
  const effMTop = Math.min(mTop, availTopRoom);
  const effMBottom = Math.min(mBottom, Math.max(0, availTopRoom - effMTop));
  const maxTop = Math.max(effMTop, vh - h - effMBottom);
  const defaultTop = Math.round((vh - h) / 2);
  const clampedTop = Math.round(clampBetween(toFiniteNumber(top, defaultTop), effMTop, maxTop));

  return {
    left: clampedLeft,
    top: clampedTop,
    width: w,
    height: h,
  };
}

export function computeDraggedModalPosition({
  origLeft,
  origTop,
  dx = 0,
  dy = 0,
  width,
  height,
  viewportWidth,
  viewportHeight,
  marginX = 8,
  marginTop = 8,
  marginBottom = 8,
} = {}) {
  const rawLeft = toFiniteNumber(origLeft, 0) + toFiniteNumber(dx, 0);
  const rawTop = toFiniteNumber(origTop, 0) + toFiniteNumber(dy, 0);
  const rect = clampModalRect({
    left: rawLeft,
    top: rawTop,
    width,
    height,
    viewportWidth,
    viewportHeight,
    marginX,
    marginTop,
    marginBottom,
  });
  return { left: rect.left, top: rect.top };
}

export function computeResizedModalRect({
  origLeft,
  origTop,
  origWidth,
  origHeight,
  dx = 0,
  dy = 0,
  handle = 'se',
  viewportWidth,
  viewportHeight,
  marginX = 8,
  marginTop = 8,
  marginBottom = 8,
} = {}) {
  const vw = toPositiveViewport(viewportWidth, 390);
  const vh = toPositiveViewport(viewportHeight, 780);
  const mX = toNonNegNumber(marginX, 8);
  const mTop = toNonNegNumber(marginTop, 8);
  const mBottom = toNonNegNumber(marginBottom, 8);

  const bounds = clampModalSize({
    width: origWidth,
    height: origHeight,
    viewportWidth: vw,
    viewportHeight: vh,
  });

  const oLeft = toFiniteNumber(origLeft, 0);
  const oTop = toFiniteNumber(origTop, 0);
  const oW = toFiniteNumber(origWidth, bounds.width);
  const oH = toFiniteNumber(origHeight, bounds.height);
  const deltaX = toFiniteNumber(dx, 0);
  const deltaY = toFiniteNumber(dy, 0);

  let nextLeft = oLeft;
  let nextTop = oTop;
  let nextW = oW;
  let nextH = oH;

  const hasW = handle === 'w' || handle === 'nw' || handle === 'sw';
  const hasE = handle === 'e' || handle === 'ne' || handle === 'se';
  const hasN = handle === 'n' || handle === 'nw' || handle === 'ne';
  const hasS = handle === 's' || handle === 'sw' || handle === 'se';

  if (hasW) {
    const origRight = oLeft + oW;
    const availW = Math.min(bounds.maxWidth, Math.max(bounds.minWidth, origRight - mX));
    nextW = clampBetween(Math.round(oW - deltaX), bounds.minWidth, availW);
    nextLeft = origRight - nextW;
  } else if (hasE) {
    const availW = Math.min(bounds.maxWidth, Math.max(bounds.minWidth, vw - mX - oLeft));
    nextW = clampBetween(Math.round(oW + deltaX), bounds.minWidth, availW);
  }

  if (hasN) {
    const origBottom = oTop + oH;
    const availH = Math.min(bounds.maxHeight, Math.max(bounds.minHeight, origBottom - mTop));
    nextH = clampBetween(Math.round(oH - deltaY), bounds.minHeight, availH);
    nextTop = origBottom - nextH;
  } else if (hasS) {
    const availH = Math.min(bounds.maxHeight, Math.max(bounds.minHeight, vh - mBottom - oTop));
    nextH = clampBetween(Math.round(oH + deltaY), bounds.minHeight, availH);
  }

  // Explicitly anchor top/left during bottom/right resize so window never jumps back to top/center
  const finalW = clampBetween(nextW, bounds.minWidth, bounds.maxWidth);
  const finalH = clampBetween(nextH, bounds.minHeight, bounds.maxHeight);
  const effMX = Math.min(mX, Math.max(0, Math.floor((vw - finalW) / 2)));
  const finalLeft = Math.round(clampBetween(nextLeft, effMX, Math.max(effMX, vw - finalW - effMX)));
  const availTopRoom = Math.max(0, vh - finalH);
  const effMTop = Math.min(mTop, availTopRoom);
  const effMBottom = Math.min(mBottom, Math.max(0, availTopRoom - effMTop));
  const finalTop = Math.round(clampBetween(nextTop, effMTop, Math.max(effMTop, vh - finalH - effMBottom)));

  return {
    left: finalLeft,
    top: finalTop,
    width: finalW,
    height: finalH,
  };
}

export function computeMiniWindowRect({
  viewportWidth,
  viewportHeight,
  heightRatio,
  marginX = 8,
  marginTop = 8,
  marginBottom = 10,
} = {}) {
  const vw = toPositiveViewport(viewportWidth, 390);
  const vh = toPositiveViewport(viewportHeight, 780);
  const mX = toNonNegNumber(marginX, 8);
  const mTop = toNonNegNumber(marginTop, 8);
  const mBottom = toNonNegNumber(marginBottom, 10);
  const isMobile = vw <= 680;

  const defaultRatio = isMobile ? 0.46 : 0.49;
  const ratio = clampBetween(toFiniteNumber(heightRatio, defaultRatio), 0.46, 0.52);

  const targetW = isMobile ? Math.max(1, vw - mX * 2) : Math.min(640, Math.floor(vw * 0.92));
  const targetH = Math.round(vh * ratio);

  const sized = clampModalSize({
    width: targetW,
    height: targetH,
    viewportWidth: vw,
    viewportHeight: vh,
  });

  const left = Math.round((vw - sized.width) / 2);
  const top = Math.max(mTop, vh - sized.height - mBottom);

  return clampModalRect({
    left,
    top,
    width: sized.width,
    height: sized.height,
    viewportWidth: vw,
    viewportHeight: vh,
    marginX: mX,
    marginTop: mTop,
    marginBottom: mBottom,
  });
}

export function computeRestorePillPosition({
  pillWidth = 148,
  pillHeight = 34,
  viewportWidth,
  viewportHeight,
  fabSide = 'right',
  fabY = 0.68,
  fabVisible = true,
  margin = 12,
  safeTop = 0,
  safeBottom = 0,
} = {}) {
  const vw = toPositiveViewport(viewportWidth, 390);
  const vh = toPositiveViewport(viewportHeight, 780);
  const pw = Math.max(40, Math.round(toFiniteNumber(pillWidth, 148)));
  const ph = Math.max(24, Math.round(toFiniteNumber(pillHeight, 34)));
  const m = toNonNegNumber(margin, 12);
  const sTop = toNonNegNumber(safeTop, 0);
  const sBottom = toNonNegNumber(safeBottom, 0);

  const minLeft = Math.min(m, Math.max(0, Math.floor((vw - pw) / 2)));
  const maxLeft = Math.max(minLeft, vw - pw - minLeft);
  const minTop = Math.min(sTop + m, Math.max(0, vh - ph));
  const maxTop = Math.max(minTop, vh - sBottom - ph - m);

  let left = minLeft;
  let top = maxTop;

  if (fabVisible) {
    const fabSize = 42;
    const fabMargin = 10;
    const fSide = fabSide === 'left' ? 'left' : 'right';
    const fRatio = clampBetween(toFiniteNumber(fabY, 0.68), 0.08, 0.92);
    const fabLeft = fSide === 'left' ? fabMargin : Math.max(fabMargin, vw - fabSize - fabMargin);
    const fabTop = Math.round(Math.min(vh - fabSize - 16, Math.max(54, vh * fRatio - fabSize / 2)));
    const gap = 8;

    const overlaps = (candLeft, candTop) => !(
      candLeft + pw + gap <= fabLeft ||
      candLeft >= fabLeft + fabSize + gap ||
      candTop + ph + gap <= fabTop ||
      candTop >= fabTop + fabSize + gap
    );

    if (overlaps(left, top)) {
      const rightCand = maxLeft;
      if (!overlaps(rightCand, top)) {
        left = rightCand;
      } else {
        const aboveFabTop = Math.max(minTop, fabTop - ph - gap);
        if (!overlaps(left, aboveFabTop)) top = aboveFabTop;
      }
    }
  }

  return {
    left: Math.round(clampBetween(left, minLeft, maxLeft)),
    top: Math.round(clampBetween(top, minTop, maxTop)),
  };
}

// =========================
// Persona Merge / Undo / Release Helpers (Zero-DOM, Pure)
// =========================

function allocateUniqueLabel(rawBase, usedSet, fallback = '未命名版本', maxLen = 60) {
  const base = String(rawBase == null ? '' : rawBase).trim().slice(0, maxLen) || String(fallback || '未命名版本').slice(0, maxLen);
  if (!usedSet.has(base)) {
    usedSet.add(base);
    return base;
  }
  for (let i = 2; i <= 999; i++) {
    const suffix = ` (${i})`;
    const limit = Math.max(1, maxLen - suffix.length);
    const head = base.slice(0, limit).trimEnd() || base.slice(0, limit);
    const cand = `${head}${suffix}`;
    if (!usedSet.has(cand)) {
      usedSet.add(cand);
      return cand;
    }
  }
  const fallbackUnique = `${base.slice(0, Math.max(1, maxLen - 6))}_${Math.random().toString(36).slice(2, 7)}`;
  usedSet.add(fallbackUnique);
  return fallbackUnique;
}

function cloneCleanVersionEntry(v) {
  const rawName = String(v.name == null ? '' : v.name).trim().slice(0, 60);
  return {
    id: String(v.id || uid('pv')),
    name: rawName || '未命名版本',
    displayName: typeof v.displayName === 'string' ? v.displayName.trim().slice(0, 60) : '',
    description: String(v.description || ''),
    lorebook: typeof v.lorebook === 'string' ? v.lorebook : '',
    updatedAt: Number(v.updatedAt) || Date.now(),
  };
}

function cloneCleanVersions(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(v => v && typeof v === 'object')
    .map(cloneCleanVersionEntry);
}

export function buildPersonaMergePlan(personas, keepAvatarId, candidateAvatarIds, existingVersions = []) {
  const cleanPersonas = (Array.isArray(personas) ? personas : [])
    .filter(p => p && typeof p === 'object' && String(p.avatar_id || '').trim());

  const keepId = String(keepAvatarId == null ? '' : keepAvatarId).trim();
  const keepRaw = keepId ? cleanPersonas.find(p => String(p.avatar_id).trim() === keepId) : null;
  const cleanExisting = cloneCleanVersions(existingVersions);
  const planId = uid('merge');

  if (!keepRaw) {
    return {
      keepPersona: null,
      candidates: [],
      previewVersions: cleanExisting,
      planId,
    };
  }

  const keepRawName = String(keepRaw.name == null ? '' : keepRaw.name).trim().slice(0, 60);
  const keepAvatarCleanId = String(keepRaw.avatar_id).trim();
  const keepPersona = {
    avatar_id: keepAvatarCleanId,
    name: keepRawName || keepAvatarCleanId,
    description: String(keepRaw.description || ''),
    lorebook: typeof keepRaw.lorebook === 'string' ? keepRaw.lorebook : '',
    title: typeof keepRaw.title === 'string' ? keepRaw.title : '',
  };

  const personaById = new Map();
  cleanPersonas.forEach(p => {
    const id = String(p.avatar_id).trim();
    if (id && !personaById.has(id)) personaById.set(id, p);
  });

  const rawCandIds = candidateAvatarIds instanceof Set
    ? Array.from(candidateAvatarIds)
    : (Array.isArray(candidateAvatarIds) ? candidateAvatarIds : []);
  const seenCand = new Set();
  const uniqueCandIds = [];
  rawCandIds.forEach(cid => {
    const id = String(cid == null ? '' : cid).trim();
    if (!id || id === keepPersona.avatar_id || seenCand.has(id)) return;
    if (!personaById.has(id)) return;
    seenCand.add(id);
    uniqueCandIds.push(id);
  });

  const usedNames = new Set(cleanExisting.map(v => v.name));
  const keepDesc = keepPersona.description;
  const needsBackup = Boolean(
    keepDesc.trim()
    && !cleanExisting.some(v => v.description === keepDesc && (!v.displayName || v.displayName === keepPersona.name)),
  );
  if (needsBackup) {
    allocateUniqueLabel('原主描述', usedNames, '原主描述', 60);
  }

  const candidates = uniqueCandIds.map(id => {
    const oldP = personaById.get(id);
    const oldAvatarId = String(oldP.avatar_id).trim();
    const rawName = String(oldP.name == null ? '' : oldP.name).trim().slice(0, 60);
    const displayName = rawName;
    let stripped = rawName;
    if (keepRawName && rawName.startsWith(keepRawName) && rawName.length > keepRawName.length) {
      const tail = rawName
        .slice(keepRawName.length)
        .replace(/^[\s_\-·・/()（）【】\[\]]+/, '')
        .replace(/[)）】\]]+$/, '')
        .trim();
      if (tail) stripped = tail;
    }
    const labelBase = stripped || rawName || oldAvatarId || '分身版本';
    const versionName = allocateUniqueLabel(labelBase, usedNames, '分身版本', 60);
    return {
      avatar_id: oldAvatarId,
      name: rawName || oldAvatarId,
      versionName,
      displayName,
      description: String(oldP.description || ''),
      lorebook: typeof oldP.lorebook === 'string' ? oldP.lorebook : '',
    };
  });

  const previewVersions = applyPersonaMergeToVersions(cleanExisting, candidates, {
    keepPersona,
    includeKeepBackup: true,
  });

  return {
    keepPersona,
    candidates,
    previewVersions,
    planId,
  };
}

export function applyPersonaMergeToVersions(currentVersions, candidates, opts = {}) {
  const cfg = opts && typeof opts === 'object' ? opts : {};
  const next = cloneCleanVersions(currentVersions);
  const usedNames = new Set(next.map(v => v.name));
  const now = Number.isFinite(Number(cfg.now)) ? Number(cfg.now) : Date.now();

  if (cfg.keepPersona && typeof cfg.keepPersona === 'object' && cfg.includeKeepBackup !== false) {
    const keepDesc = String(cfg.keepPersona.description || '');
    const keepName = String(cfg.keepPersona.name == null ? '' : cfg.keepPersona.name).trim().slice(0, 60);
    const alreadyHasKeep = next.some(v => v.description === keepDesc && (!v.displayName || v.displayName === keepName));
    if (keepDesc.trim() && !alreadyHasKeep) {
      next.unshift({
        id: uid('pv'),
        name: allocateUniqueLabel('原主描述', usedNames, '原主描述', 60),
        displayName: keepName,
        description: keepDesc,
        lorebook: typeof cfg.keepPersona.lorebook === 'string' ? cfg.keepPersona.lorebook : '',
        updatedAt: now,
      });
    }
  }

  const candList = Array.isArray(candidates) ? candidates : [];
  for (let i = 0; i < candList.length; i++) {
    const c = candList[i];
    if (!c || typeof c !== 'object') continue;
    const rawLabel = String(c.versionName || c.name || c.avatar_id || '').trim() || '分身版本';
    const name = allocateUniqueLabel(rawLabel, usedNames, '分身版本', 60);
    const displayName = typeof c.displayName === 'string'
      ? c.displayName.trim().slice(0, 60)
      : String(c.name == null ? '' : c.name).trim().slice(0, 60);
    next.push({
      id: uid('pv'),
      name,
      displayName,
      description: String(c.description || ''),
      lorebook: typeof c.lorebook === 'string' ? c.lorebook : '',
      updatedAt: now,
    });
  }

  return next;
}

export function restorePersonaMergeVersions(undoSnapshot) {
  const rawList = Array.isArray(undoSnapshot)
    ? undoSnapshot
    : (undoSnapshot && typeof undoSnapshot === 'object'
        ? (undoSnapshot.versionsBackup ?? undoSnapshot.previousVersions ?? undoSnapshot.versions ?? [])
        : []);
  return cloneCleanVersions(rawList);
}

export function buildReleaseVersionToNativePayload(versionEntry, existingPersonas = []) {
  const v = versionEntry && typeof versionEntry === 'object' ? versionEntry : {};
  const personas = Array.isArray(existingPersonas)
    ? existingPersonas.filter(p => p && typeof p === 'object')
    : [];
  const existingNames = new Set(personas.map(p => String(p.name == null ? '' : p.name).trim()).filter(Boolean));
  const existingAvatarIds = new Set(personas.map(p => String(p.avatar_id == null ? '' : p.avatar_id).trim()).filter(Boolean));

  const baseName = String(v.displayName == null ? '' : v.displayName).trim()
    || String(v.name == null ? '' : v.name).trim()
    || '恢复的 User';
  const name = allocateUniqueLabel(baseName, existingNames, '恢复的 User', 60);

  const fileBase = name
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'persona';
  let suggestedAvatarId = `${fileBase}.png`;
  let idx = 2;
  while (existingAvatarIds.has(suggestedAvatarId)) {
    suggestedAvatarId = `${fileBase}_${idx}.png`;
    idx++;
  }

  return {
    name,
    description: String(v.description || ''),
    lorebook: typeof v.lorebook === 'string' ? v.lorebook : '',
    overwriteName: false,
    suggestedAvatarId,
  };
}

// =========================
// Extension & Built-in Module Availability Helpers (Zero-DOM, Pure)
// =========================

function normalizeExtKey(val) {
  return String(val == null ? '' : val)
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
}

function getExtLeafCanonical(normKey) {
  if (!normKey) return '';
  const idx = normKey.lastIndexOf('/');
  const leaf = idx >= 0 ? normKey.slice(idx + 1) : normKey;
  return leaf.replace(/_/g, '-');
}

export function isExtensionEnabled(disabledList, extKey) {
  const normKey = normalizeExtKey(extKey);
  if (!normKey) return false;
  const keyLeaf = getExtLeafCanonical(normKey);

  let items = [];
  if (Array.isArray(disabledList)) {
    items = disabledList;
  } else if (
    !(disabledList instanceof String)
    && (
      disabledList instanceof Set
      || (disabledList && typeof disabledList === 'object' && typeof disabledList[Symbol.iterator] === 'function')
    )
  ) {
    items = Array.from(disabledList);
  }

  for (let i = 0; i < items.length; i++) {
    if (typeof items[i] !== 'string') continue;
    const normItem = normalizeExtKey(items[i]);
    if (!normItem) continue;
    if (normItem === normKey) return false;
    if (getExtLeafCanonical(normItem) === keyLeaf) return false;
  }
  return true;
}

export function canUseExternalOrganizer(opts = {}) {
  const cfg = opts && typeof opts === 'object' ? opts : {};
  const { orgSettings, disabledExtensions, hasActiveRuntime } = cfg;
  if (!orgSettings || typeof orgSettings !== 'object' || Array.isArray(orgSettings)) {
    return false;
  }
  if (!isExtensionEnabled(disabledExtensions, 'worldbook-organizer')) {
    return false;
  }
  return Boolean(hasActiveRuntime);
}

export function isBuiltinModuleEnabled(disabledExtensions, moduleName) {
  const key = String(moduleName == null ? '' : moduleName).trim();
  if (!key) return false;
  return isExtensionEnabled(disabledExtensions, key);
}
