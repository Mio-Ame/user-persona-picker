import {
  characters,
  chat_metadata,
  eventSource,
  event_types,
  getCurrentChatId,
  getRequestHeaders,
  reloadCurrentChat,
  saveSettingsDebounced,
  setUserName,
  this_chid,
} from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import {
  getWorldInfoSettings,
  loadWorldInfo,
  onWorldInfoChange,
  saveWorldInfo,
  world_names,
} from '../../../world-info.js';
import { getPresetManager } from '../../../preset-manager.js';
import { power_user } from '../../../power-user.js';
import {
  getUserAvatars,
  setPersonaDescription,
  setUserAvatar,
  user_avatar,
} from '../../../personas.js';

import {
  APP_VERSION,
  THEME_MODES,
  analyzePresetMigration,
  applyPresetMigrationToSnapshots,
  buildCleanCopyText,
  buildPresetRenderNodes,
  buildSnapshotPresetInspectModel,
  clampModalRect,
  clampModalSize,
  computeDraggedModalPosition,
  computeLineDiff,
  computeMiniWindowRect,
  computeResizedModalRect,
  computeRestorePillPosition,
  createEmptyStore,
  detectProliferatedPersonas,
  escapeHtml,
  exportStoreJson,
  formatTimeShort,
  formatWorldbookDisplay,
  groupWorldbooksByOrganizer,
  inferThemeFromTextColor,
  inspectSnapshotHealth,
  inspectTagHygiene,
  markStoreOnWorldbookDeleted,
  migrateStoreOnWorldbookRename,
  normalizeNativePreset,
  normalizeText,
  parseImportJson,
  pickActivePromptOrder,
  resolveBindingForContext,
  sanitizeStore,
  suggestSnapshotNames,
  toOpaqueColor,
  uid,
} from './core.js';

const EXT_KEY = 'user_persona_snapshot';
const LEGACY_LOCAL_KEY = 'userPersonaPicker.v6';
const HOST_ID = 'user-persona-picker-host';
const MENU_ENTRY_ID = 'user-persona-picker-menu-entry';
const SETTINGS_BOX_ID = 'user-persona-picker-ext-settings';
const MAX_BOOK_CACHE = 6;
let activeCleanup = null;

function canAutoFocusDesktop() {
  try {
    return typeof window !== 'undefined'
      && window.innerWidth > 640
      && !window.matchMedia?.('(pointer: coarse)')?.matches;
  } catch (_) {
    return false;
  }
}

function emitWindowEvent(name, detail) {
  try {
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent(name, detail !== undefined ? { detail } : undefined));
    }
  } catch (_) {}
}

function ensureStylesheetCacheBust() {
  try {
    const links = document.querySelectorAll('link[rel="stylesheet"]');
    links.forEach(link => {
      const href = link.getAttribute('href') || '';
      if (!href.includes('user-persona-picker/style.css')) return;
      const url = new URL(href, window.location.href);
      if (url.searchParams.get('v') !== APP_VERSION) {
        const base = href.split('?')[0];
        link.setAttribute('href', `${base}?v=${encodeURIComponent(APP_VERSION)}`);
      }
    });
  } catch (_) {}
}

async function runWithConcurrency(items, limit, worker) {
  const arr = Array.isArray(items) ? items : [];
  const cap = Math.max(1, Number(limit) || 1);
  let idx = 0;
  const runners = Array.from({ length: Math.min(cap, arr.length) }, async () => {
    while (idx < arr.length) {
      const cur = idx++;
      await worker(arr[cur], cur);
    }
  });
  await Promise.all(runners);
}

let regexEngine = null;
async function ensureRegexEngine() {
  if (regexEngine !== null) return regexEngine;
  try {
    regexEngine = await import('../../regex/engine.js');
  } catch (_) {
    regexEngine = false;
  }
  return regexEngine;
}

function getContext() {
  try {
    return typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function'
      ? SillyTavern.getContext()
      : null;
  } catch (_) {
    return null;
  }
}

function toast(msg, type = 'info') {
  const t = window.toastr;
  if (t && typeof t[type] === 'function') t[type](String(msg), '快照管家');
  else console.log('[快照管家]', msg);
}

function detectHostTheme() {
  try {
    const rs = window.getComputedStyle(document.documentElement);
    const bodyBg = rs.getPropertyValue('--SmartThemeBlurTintColor').trim()
      || window.getComputedStyle(document.body || document.documentElement).backgroundColor;
    const bodyColor = window.getComputedStyle(document.body || document.documentElement).color;
    const smartColor = rs.getPropertyValue('--SmartThemeBodyColor').trim();
    return inferThemeFromTextColor(bodyColor || smartColor, bodyBg);
  } catch (_) {
    return 'dark';
  }
}

function readHostThemeVars() {
  try {
    const rs = window.getComputedStyle(document.documentElement);
    const getVar = name => rs.getPropertyValue(name).trim();
    const bodyColor = getVar('--SmartThemeBodyColor') || window.getComputedStyle(document.body || document.documentElement).color;
    const blurBg = getVar('--SmartThemeBlurTintColor') || getVar('--color-bg-main')
      || window.getComputedStyle(document.body || document.documentElement).backgroundColor;
    const isLight = inferThemeFromTextColor(bodyColor, blurBg) === 'light';
    const borderCol = getVar('--SmartThemeBorderColor') || getVar('--color-border-main');
    const emCol = getVar('--SmartThemeEmColor') || getVar('--SmartThemeQuoteColor');
    return { isLight, blurBg, bodyColor, borderCol, emCol };
  } catch (_) {
    return { isLight: false, blurBg: '', bodyColor: '', borderCol: '', emCol: '' };
  }
}

function applyThemeToElement(el, mode) {
  if (!el) return;
  const resolvedMode = THEME_MODES.includes(mode) ? mode : 'paper';
  // Clear any previous dynamic host inline vars
  [
    '--bg', '--surface', '--surface-strong', '--border', '--border-strong',
    '--text', '--accent', '--accent-soft', '--accent-border', '--accent-border-strong',
    '--accent-text', '--modal-blur',
  ].forEach(k => {
    el.style.removeProperty(k);
  });
  if (resolvedMode === 'host') {
    const hv = readHostThemeVars();
    el.dataset.theme = hv.isLight ? 'paper' : 'glass-dark';
    const solidBg = hv.blurBg ? toOpaqueColor(hv.blurBg, hv.isLight ? '#f6f6f3' : '#191a1d') : '';
    if (solidBg) el.style.setProperty('--bg', solidBg);
    el.style.setProperty('--modal-blur', '0px');
    if (hv.bodyColor) el.style.setProperty('--text', hv.bodyColor);
    if (hv.borderCol) {
      el.style.setProperty('--border', hv.borderCol);
      el.style.setProperty('--border-strong', hv.borderCol);
    }
    if (hv.emCol && !/^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,?\s*0?\s*\)$/i.test(hv.emCol)) {
      el.style.setProperty('--accent', hv.emCol);
      el.style.setProperty('--accent-soft', `color-mix(in srgb, ${hv.emCol} 14%, transparent)`);
      el.style.setProperty('--accent-border', `color-mix(in srgb, ${hv.emCol} 30%, var(--border))`);
      el.style.setProperty('--accent-border-strong', `color-mix(in srgb, ${hv.emCol} 42%, var(--border))`);
    }
  } else {
    el.dataset.theme = resolvedMode;
  }
}

function getOrganizerSettings() {
  const ctxExt = getContext()?.extensionSettings;
  const raw = ctxExt?.worldbook_organizer || extension_settings?.worldbook_organizer;
  return raw && typeof raw === 'object' ? raw : null;
}

function findPresetGroupsBucket(presetObj) {
  const exts = presetObj && typeof presetObj === 'object' ? presetObj.extensions : null;
  if (!exts || typeof exts !== 'object') return null;
  let fallbackEmpty = null;
  if (exts.presetPromptGroups && typeof exts.presetPromptGroups === 'object' && Array.isArray(exts.presetPromptGroups.groups)) {
    if (exts.presetPromptGroups.groups.length > 0) return { extKey: null, data: exts.presetPromptGroups };
    fallbackEmpty = { extKey: null, data: exts.presetPromptGroups };
  }
  const entries = Object.entries(exts);
  for (let i = 0; i < entries.length; i++) {
    const [k, v] = entries[i];
    const pg = v && typeof v === 'object' ? v.presetPromptGroups : null;
    if (pg && typeof pg === 'object' && Array.isArray(pg.groups)) {
      if (pg.groups.length > 0) return { extKey: k, data: pg };
      if (!fallbackEmpty) fallbackEmpty = { extKey: k, data: pg };
    }
  }
  return fallbackEmpty;
}

function findRuntimeGroupHostObjects() {
  const hosts = [];
  const skipKeys = new Set(['window', 'self', 'top', 'parent', 'frames', 'document', 'location', 'navigator', 'history', 'localStorage', 'sessionStorage']);
  try {
    const keys = Object.keys(globalThis);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (skipKeys.has(k)) continue;
      let val;
      try { val = globalThis[k]; } catch (_) { continue; }
      if (val && typeof val === 'object' && val.presetPromptGroupRuntimeState) {
        hosts.push(val);
      }
    }
  } catch (_) {}
  return hosts;
}

function getRuntimePresetGroups() {
  const hosts = findRuntimeGroupHostObjects();
  for (let i = 0; i < hosts.length; i++) {
    const rt = hosts[i].presetPromptGroupRuntimeState;
    if (rt && Array.isArray(rt.groups) && rt.groups.length) return rt;
  }
  return null;
}

// =========================
// Store Persistence (ST extension_settings + auto-migrate v6)
// =========================

function loadStore() {
  let raw = extension_settings[EXT_KEY];
  if (!raw || typeof raw !== 'object') {
    // One-time seamless migration from v6 script localStorage if present
    try {
      const legacy = window.localStorage.getItem(LEGACY_LOCAL_KEY);
      if (legacy) raw = JSON.parse(legacy);
    } catch (_) {}
  }
  const clean = sanitizeStore(raw || createEmptyStore());
  extension_settings[EXT_KEY] = clean;
  return clean;
}

function persistStore(store) {
  const clean = sanitizeStore(store);
  extension_settings[EXT_KEY] = clean;
  try { saveSettingsDebounced(); } catch (_) {}
  return clean;
}

// =========================
// Native SillyTavern Host Adapter
// =========================

function readCurrentCharInfo() {
  const ch = (this_chid !== undefined && this_chid !== null && Array.isArray(characters))
    ? characters[this_chid]
    : null;
  if (!ch || !ch.name || ch.name === 'SillyTavern System') {
    return { id: '', name: '', avatar: '', raw: null };
  }
  return {
    id: String(ch.avatar || ch.name),
    name: String(ch.name),
    avatar: String(ch.avatar || ''),
    raw: ch,
  };
}

function readCurrentChatId() {
  try {
    const cid = typeof getCurrentChatId === 'function' ? getCurrentChatId() : getContext()?.chatId;
    return cid && String(cid).trim() ? String(cid).trim() : '';
  } catch (_) {
    return '';
  }
}

function getCharaFileNameSafe(ch) {
  if (!ch || !ch.avatar) return '';
  return String(ch.avatar).replace(/\.[^/.]+$/, '');
}

function buildLiveCharBookMap() {
  const map = {};
  const add = (bk, cn) => {
    const b = String(bk || '').trim();
    const c = String(cn || '').trim();
    if (!b || !c) return;
    if (!map[b]) map[b] = [];
    if (!map[b].includes(c)) map[b].push(c);
  };
  const avatarToName = new Map();
  if (Array.isArray(characters)) {
    characters.forEach(ch => {
      if (!ch || !ch.name || ch.name === 'SillyTavern System') return;
      const cName = String(ch.name).trim();
      const fileKey = getCharaFileNameSafe(ch);
      if (fileKey) avatarToName.set(fileKey, cName);
      const primary = ch?.data?.extensions?.world;
      if (primary) add(primary, cName);
    });
  }
  try {
    const charLore = getWorldInfoSettings()?.world_info?.charLore;
    if (Array.isArray(charLore)) {
      charLore.forEach(entry => {
        if (!entry || !entry.name) return;
        const cName = avatarToName.get(String(entry.name)) || '';
        if (!cName) return;
        if (Array.isArray(entry.extraBooks)) {
          entry.extraBooks.forEach(bk => add(bk, cName));
        }
      });
    }
  } catch (_) {}
  return map;
}

function buildCombinedCharNameMap(orgSettings) {
  const charNameMap = new Map();
  const add = (bk, cn) => {
    const b = String(bk || '').trim();
    const c = String(cn || '').trim();
    if (!b || !c) return;
    if (!charNameMap.has(b)) charNameMap.set(b, []);
    const arr = charNameMap.get(b);
    if (!arr.includes(c)) arr.push(c);
  };
  const cached = orgSettings?.cachedCharBindings;
  if (cached && typeof cached === 'object') {
    Object.values(cached).forEach(entry => {
      if (!entry || typeof entry !== 'object') return;
      const cn = String(entry.name || '').trim();
      if (entry.primary) add(entry.primary, cn);
      if (entry.embedded) add(entry.embedded, cn);
      if (Array.isArray(entry.extra)) entry.extra.forEach(x => x && add(x, cn));
    });
  }
  const live = buildLiveCharBookMap();
  Object.keys(live).forEach(bk => {
    live[bk].forEach(cn => add(bk, cn));
  });
  return charNameMap;
}

const Host = {
  // --- Personas ---
  listPersonas() {
    const map = power_user?.personas || {};
    const descs = power_user?.persona_descriptions || {};
    return Object.keys(map).map(avatarId => {
      const d = descs[avatarId] || {};
      return {
        avatar_id: avatarId,
        name: String(map[avatarId] || avatarId),
        description: String(d.description || ''),
        lorebook: String(d.lorebook || ''),
        title: String(d.title || ''),
      };
    });
  },
  getCurrentPersona() {
    const curId = user_avatar || '';
    if (!curId || !power_user?.personas?.[curId]) return null;
    const d = power_user.persona_descriptions?.[curId] || {};
    return {
      avatar_id: curId,
      name: String(power_user.personas[curId] || curId),
      description: String(d.description ?? power_user.persona_description ?? ''),
      lorebook: String(d.lorebook ?? power_user.persona_description_lorebook ?? ''),
      title: String(d.title || ''),
    };
  },
  async switchPersona(avatarId) {
    if (!avatarId || !power_user?.personas?.[avatarId]) return false;
    if (user_avatar === avatarId) return true;
    await setUserAvatar(avatarId, { toastPersonaNameChange: false, navigateToCurrent: true });
    return true;
  },
  async updatePersonaInPlace(avatarId, description, lorebook) {
    const targetId = avatarId || user_avatar;
    if (!targetId || !power_user?.personas?.[targetId]) throw new Error('未找到目标 User');
    if (!power_user.persona_descriptions) power_user.persona_descriptions = {};
    const prev = power_user.persona_descriptions[targetId] || {};
    const nextDesc = String(description ?? '');
    const nextLore = typeof lorebook === 'string' ? lorebook : String(prev.lorebook || '');
    power_user.persona_descriptions[targetId] = {
      ...prev,
      description: nextDesc,
      lorebook: nextLore,
    };
    if (targetId === user_avatar) {
      power_user.persona_description = nextDesc;
      power_user.persona_description_lorebook = nextLore;
      try { setPersonaDescription?.(); } catch (_) {}
      const ta = document.getElementById('persona_description');
      if (ta) ta.value = nextDesc;
    }
    saveSettingsDebounced();
    try { await getUserAvatars(true, targetId); } catch (_) {}
  },
  async renamePersonaInPlace(avatarId, newName) {
    const targetId = avatarId || user_avatar;
    const clean = String(newName || '').trim().slice(0, 60);
    if (!targetId || !power_user?.personas?.[targetId]) throw new Error('未找到目标 User');
    if (!clean) throw new Error('名字不能为空');
    power_user.personas[targetId] = clean;
    if (targetId === user_avatar) {
      try { setUserName(clean, { toastPersonaNameChange: false }); } catch (_) {}
      const nameInput = document.getElementById('your_name');
      if (nameInput && nameInput.value !== clean) nameInput.value = clean;
    }
    saveSettingsDebounced();
    try { await getUserAvatars(true, targetId); } catch (_) {}
    return clean;
  },
  async deletePersonaById(avatarId) {
    if (!avatarId) return false;
    // Delete the avatar file on backend too so it does not reappear unnamed
    const resp = await fetch('/api/avatars/delete', {
      method: 'POST',
      headers: getRequestHeaders(),
      body: JSON.stringify({ avatar: avatarId }),
    });
    if (!resp.ok && resp.status !== 404) {
      throw new Error(`删除旧分身文件失败 (${resp.status})`);
    }
    if (power_user?.personas) delete power_user.personas[avatarId];
    if (power_user?.persona_descriptions) delete power_user.persona_descriptions[avatarId];
    if (power_user?.default_persona === avatarId) power_user.default_persona = null;
    if (chat_metadata && chat_metadata.persona === avatarId) delete chat_metadata.persona;
    saveSettingsDebounced();
    try { await getUserAvatars(true); } catch (_) {}
    return true;
  },
  async listOrphanAvatars() {
    try {
      const avatars = await getUserAvatars(false);
      if (!Array.isArray(avatars)) return [];
      const map = power_user?.personas || {};
      const unnamedFallback = ['[Unnamed', 'Persona]'].join(' ');
      return avatars.filter(id => {
        if (!id || id === user_avatar) return false;
        const name = map[id];
        return !name || !String(name).trim() || String(name).trim() === unnamedFallback;
      });
    } catch (_) {
      return [];
    }
  },
  listAllCharacters() {
    if (!Array.isArray(characters)) return [];
    const seen = new Set();
    return characters
      .filter(ch => ch && ch.name && ch.name !== 'SillyTavern System')
      .map(ch => ({
        id: String(ch.avatar || ch.name),
        name: String(ch.name),
        avatar: String(ch.avatar || ''),
      }))
      .filter(ch => {
        if (seen.has(ch.id)) return false;
        seen.add(ch.id);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  },
  async listCharacterChats(avatarUrl) {
    if (!avatarUrl) return [];
    const resp = await fetch('/api/characters/chats', {
      method: 'POST',
      headers: getRequestHeaders(),
      body: JSON.stringify({ avatar_url: avatarUrl }),
    });
    if (!resp.ok) throw new Error(`扫描聊天记录失败 (${resp.status})`);
    const raw = await resp.json();
    if (!raw || raw.error === true) return [];
    const arr = Array.isArray(raw) ? raw : Object.values(raw);
    return arr
      .filter(item => item && item.file_name)
      .map(item => {
        const fileName = String(item.file_name);
        const chatId = fileName.replace(/\.jsonl$/i, '');
        return {
          chatId,
          fileName,
          lastMes: String(item.last_mes || ''),
          preview: String(item.mes || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          count: Number(item.chat_items || 0),
        };
      })
      .sort((a, b) => b.fileName.localeCompare(a.fileName, 'zh-CN'));
  },

  // --- Worldbooks ---
  listWorldbooks() {
    return Array.isArray(world_names) ? [...world_names] : [];
  },
  getGlobalWorldbooks() {
    try {
      const $ = window.jQuery;
      if ($) {
        const raw = $('#world_info').val();
        const indices = Array.isArray(raw) ? raw : (raw == null ? [] : [raw]);
        return indices.map(Number).map(i => world_names[i]).filter(Boolean);
      }
    } catch (_) {}
    return [];
  },
  async setGlobalWorldbooks(names) {
    const $ = window.jQuery;
    if (!$ || !Array.isArray(world_names)) return;
    const chosen = (names || []).filter(n => world_names.includes(n));
    $('#world_info').val(chosen.map(n => String(world_names.indexOf(n))));
    try { onWorldInfoChange('__notSlashCommand__'); } catch (_) {}
  },
  getCharWorldbooks() {
    const ch = readCurrentCharInfo();
    if (!ch.raw) return { primary: null, additional: [] };
    const primary = ch.raw?.data?.extensions?.world || null;
    const charFile = getCharaFileNameSafe(ch.raw);
    const charLore = getWorldInfoSettings()?.world_info?.charLore || [];
    const entry = charLore.find(item => item.name === charFile);
    const additional = Array.isArray(entry?.extraBooks) ? [...entry.extraBooks] : [];
    return { primary: primary || null, additional };
  },
  getChatWorldbook() {
    return chat_metadata?.world_info ? String(chat_metadata.world_info) : null;
  },
  async fetchWorldInfoUncached(bookName) {
    if (!bookName || !world_names.includes(bookName)) return null;
    try {
      const resp = await fetch('/api/worldinfo/get', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ name: bookName }),
        cache: 'no-cache',
      });
      if (!resp.ok) return null;
      return await resp.json();
    } catch (_) {
      return null;
    }
  },
  async getWorldbookEntries(bookName) {
    const data = await this.fetchWorldInfoUncached(bookName);
    if (!data || !data.entries) return [];
    return Object.values(data.entries).map(e => ({
      uid: e.uid,
      name: String(e.comment || (Array.isArray(e.key) ? e.key.filter(Boolean).join(', ') : '') || `条目 #${e.uid}`),
      enabled: !e.disable,
      content: String(e.content || ''),
      strategyType: e.vectorized ? 'vectorized' : (e.constant ? 'constant' : 'selective'),
      order: Number(e.order ?? 100),
    })).sort((a, b) => a.order - b.order || Number(a.uid) - Number(b.uid));
  },
  async getWorldbookToggleStates(bookName) {
    const data = await this.fetchWorldInfoUncached(bookName);
    if (!data || !data.entries) return null;
    const map = {};
    Object.values(data.entries).forEach(e => {
      if (e && e.uid !== undefined) map[String(e.uid)] = !e.disable;
    });
    return map;
  },
  async toggleWorldbookEntry(bookName, uidNum, enabled) {
    const data = await loadWorldInfo(bookName);
    if (!data?.entries) throw new Error('世界书读取失败');
    const key = String(uidNum);
    const entry = data.entries[key] || Object.values(data.entries).find(e => String(e.uid) === key);
    if (!entry) throw new Error('条目不存在');
    entry.disable = !enabled;
    await saveWorldInfo(bookName, data, true);
  },
  async batchToggleWorldbookEntries(bookName, uidMap) {
    if (!world_names.includes(bookName)) return { changed: 0, skipped: Object.keys(uidMap || {}).length };
    const data = await loadWorldInfo(bookName);
    if (!data?.entries) return { changed: 0, skipped: Object.keys(uidMap || {}).length };
    let changed = 0;
    let skipped = 0;
    const byUid = new Map();
    Object.values(data.entries).forEach(e => { byUid.set(String(e.uid), e); });
    Object.keys(uidMap || {}).forEach(k => {
      const entry = byUid.get(String(k));
      if (!entry) { skipped++; return; }
      const targetEnabled = !!uidMap[k];
      if ((!entry.disable) !== targetEnabled) {
        entry.disable = !targetEnabled;
        changed++;
      }
    });
    if (changed > 0) await saveWorldInfo(bookName, data, true);
    return { changed, skipped };
  },
  async updateWorldbookEntry(bookName, uidNum, name, content, strategyType) {
    const data = await loadWorldInfo(bookName);
    if (!data?.entries) throw new Error('世界书读取失败');
    const key = String(uidNum);
    const entry = data.entries[key] || Object.values(data.entries).find(e => String(e.uid) === key);
    if (!entry) throw new Error('条目不存在');
    entry.comment = name;
    entry.content = content;
    if (strategyType === 'constant') { entry.constant = true; entry.vectorized = false; }
    else if (strategyType === 'selective') { entry.constant = false; entry.vectorized = false; }
    await saveWorldInfo(bookName, data, true);
  },
  async createWorldbookEntry(bookName, { name, content, strategyType }) {
    const data = await loadWorldInfo(bookName);
    if (!data) throw new Error('世界书读取失败');
    if (!data.entries) data.entries = {};
    const maxUid = Object.values(data.entries).reduce((m, e) => Math.max(m, Number(e.uid) || 0), -1);
    const nextUid = maxUid + 1;
    data.entries[String(nextUid)] = {
      uid: nextUid,
      key: [],
      keysecondary: [],
      comment: name || '新条目',
      content: content || '',
      constant: strategyType !== 'selective',
      vectorized: false,
      selective: true,
      selectiveLogic: 0,
      addMemo: true,
      order: 100,
      position: 1,
      disable: false,
      excludeRecursion: false,
      preventRecursion: false,
      delayUntilRecursion: false,
      probability: 100,
      useProbability: true,
      depth: 4,
      group: '',
      groupOverride: false,
      groupWeight: 100,
      scanDepth: null,
      caseSensitive: null,
      matchWholeWords: null,
      useGroupScoring: null,
      automationId: '',
      role: 0,
      sticky: 0,
      cooldown: 0,
      delay: 0,
    };
    await saveWorldInfo(bookName, data, true);
  },

  // --- Presets (Native + on-disk preset + runtime group sync) ---
  listPresets() {
    try {
      const mgr = getPresetManager?.('openai') || getPresetManager?.();
      const list = mgr?.getPresetList?.();
      if (list && Array.isArray(list.preset_names)) return list.preset_names;
      if (list && list.preset_names && typeof list.preset_names === 'object') {
        return Object.keys(list.preset_names);
      }
      const $ = window.jQuery;
      if ($ && mgr?.select) {
        return $(mgr.select).find('option').map((_, el) => String($(el).text())).get().filter(Boolean);
      }
    } catch (_) {}
    return [];
  },
  getLoadedPresetName() {
    try {
      const mgr = getPresetManager?.('openai') || getPresetManager?.();
      return String(mgr?.getSelectedPresetName?.() || '');
    } catch (_) {
      return '';
    }
  },
  async selectPresetByName(presetName) {
    const mgr = getPresetManager?.('openai') || getPresetManager?.();
    const $ = window.jQuery;
    if (!mgr || !$ || !presetName) return false;
    if (mgr.getSelectedPresetName?.() === presetName) return true;
    const opt = $(mgr.select).find('option').filter((_, el) => String($(el).text()) === presetName).first();
    if (!opt.length) return false;
    const loaded = new Promise(resolve => {
      const timer = window.setTimeout(resolve, 1500);
      eventSource.once(event_types.OAI_PRESET_CHANGED_AFTER, () => {
        window.clearTimeout(timer);
        resolve();
      });
    });
    mgr.selectPreset(opt.val());
    await loaded;
    return true;
  },
  getActiveDiskPreset() {
    try {
      const mgr = getPresetManager?.('openai') || getPresetManager?.();
      const name = this.getLoadedPresetName();
      return name ? (mgr?.getCompletionPresetByName?.(name) || null) : null;
    } catch (_) {
      return null;
    }
  },
  getLiveNormalizedPreset() {
    const oai = getContext()?.chatCompletionSettings;
    return normalizeNativePreset(oai, getRuntimePresetGroups(), this.getActiveDiskPreset());
  },
  getPresetByNameNormalized(presetName) {
    const curName = this.getLoadedPresetName();
    if (!presetName || presetName === curName) {
      return this.getLiveNormalizedPreset();
    }
    try {
      const mgr = getPresetManager?.('openai') || getPresetManager?.();
      const raw = mgr?.getCompletionPresetByName?.(presetName);
      if (raw) return normalizeNativePreset(raw, null, null);
    } catch (_) {}
    return null;
  },
  async saveActivePresetToDisk() {
    const mgr = getPresetManager?.('openai') || getPresetManager?.();
    const curName = this.getLoadedPresetName();
    const oai = getContext()?.chatCompletionSettings;
    if (!mgr || !curName || !oai) throw new Error('未能定位当前预设');
    const disk = mgr.getCompletionPresetByName?.(curName);
    const payload = disk ? structuredClone(disk) : {};
    if (Array.isArray(oai.prompts)) payload.prompts = structuredClone(oai.prompts);
    if (Array.isArray(oai.prompt_order)) payload.prompt_order = structuredClone(oai.prompt_order);
    const oaiBucket = findPresetGroupsBucket(oai);
    const diskBucket = findPresetGroupsBucket(disk);
    const canonicalGroups = getRuntimePresetGroups() || oaiBucket?.data || diskBucket?.data;
    const targetExtKey = oaiBucket?.extKey || diskBucket?.extKey;
    const groupPayload = canonicalGroups ? structuredClone({
      version: 1,
      groups: canonicalGroups.groups || [],
      prompts: canonicalGroups.prompts || {},
    }) : null;
    if (groupPayload) {
      if (!payload.extensions || typeof payload.extensions !== 'object') payload.extensions = {};
      if (targetExtKey) {
        if (!payload.extensions[targetExtKey] || typeof payload.extensions[targetExtKey] !== 'object') {
          payload.extensions[targetExtKey] = {};
        }
        payload.extensions[targetExtKey].presetPromptGroups = groupPayload;
      } else {
        payload.extensions.presetPromptGroups = groupPayload;
      }
    }
    if (typeof mgr.savePreset === 'function') {
      await mgr.savePreset(curName, payload, { skipUpdate: true });
    }
    if (disk && groupPayload) {
      if (!disk.extensions || typeof disk.extensions !== 'object') disk.extensions = {};
      if (targetExtKey) {
        if (!disk.extensions[targetExtKey] || typeof disk.extensions[targetExtKey] !== 'object') {
          disk.extensions[targetExtKey] = {};
        }
        disk.extensions[targetExtKey].presetPromptGroups = structuredClone(groupPayload);
      } else {
        disk.extensions.presetPromptGroups = structuredClone(groupPayload);
      }
    }
  },
  applyPresetGroupMapInMemory(groupMap, { syncToDiskCache = true } = {}) {
    const oai = getContext()?.chatCompletionSettings;
    const disk = this.getActiveDiskPreset();
    const rtHosts = findRuntimeGroupHostObjects();
    const runtime = getRuntimePresetGroups();
    const oaiBucket = findPresetGroupsBucket(oai);
    const diskBucket = findPresetGroupsBucket(disk);
    const canonical = runtime || oaiBucket?.data || diskBucket?.data;
    if (!canonical || !Array.isArray(canonical.groups)) {
      return { changed: 0, matched: new Set() };
    }
    const targetExtKey = oaiBucket?.extKey || diskBucket?.extKey;

    // Ensure oai.extensions preserves presetPromptGroups so ST persists it in settings.json
    if (oai) {
      if (!oai.extensions || typeof oai.extensions !== 'object') oai.extensions = {};
      if (targetExtKey) {
        if (!oai.extensions[targetExtKey] || typeof oai.extensions[targetExtKey] !== 'object') {
          oai.extensions[targetExtKey] = {};
        }
        if (!oai.extensions[targetExtKey].presetPromptGroups || !Array.isArray(oai.extensions[targetExtKey].presetPromptGroups.groups)) {
          oai.extensions[targetExtKey].presetPromptGroups = structuredClone({
            version: 1,
            groups: canonical.groups,
            prompts: canonical.prompts || {},
          });
        }
      } else if (!oai.extensions.presetPromptGroups || !Array.isArray(oai.extensions.presetPromptGroups.groups)) {
        oai.extensions.presetPromptGroups = structuredClone({
          version: 1,
          groups: canonical.groups,
          prompts: canonical.prompts || {},
        });
      }
    }

    // Collect every live & cached group array to keep runtime, promptManager, oai, and preset cache synced
    const targets = [];
    if (runtime?.groups) targets.push(runtime.groups);
    const oaiGroups = findPresetGroupsBucket(oai)?.data?.groups;
    if (Array.isArray(oaiGroups)) targets.push(oaiGroups);
    const pmGroups = findPresetGroupsBucket(getContext()?.promptManager?.serviceSettings)?.data?.groups;
    if (Array.isArray(pmGroups)) targets.push(pmGroups);
    const diskGroups = syncToDiskCache ? findPresetGroupsBucket(disk)?.data?.groups : null;
    if (Array.isArray(diskGroups)) targets.push(diskGroups);

    let changed = 0;
    const matched = new Set();
    targets.forEach(arr => {
      arr.forEach(g => {
        const gid = String(g?.id ?? '');
        if (Object.prototype.hasOwnProperty.call(groupMap, gid)) {
          matched.add(gid);
          const wanted = !!groupMap[gid];
          if ((g.enabled !== false) !== wanted) {
            g.enabled = wanted;
            changed++;
          }
        }
      });
    });

    // Also patch live runtime list items if an active group extension exposes them
    rtHosts.forEach(extObj => {
      try { delete extObj.presetPromptGroupExtensionSyncKey; } catch (_) {}
      Object.values(extObj).forEach(val => {
        const items = val?.state?.items;
        if (!Array.isArray(items)) return;
        items.forEach(it => {
          if (it && it.type === 'group' && Object.prototype.hasOwnProperty.call(groupMap, String(it.groupId))) {
            const wanted = !!groupMap[String(it.groupId)];
            it.enabled = wanted;
            if (it.group) it.group.enabled = wanted;
          }
        });
      });
    });

    return { changed, matched };
  },
  async togglePresetPrompt(promptId, enabled) {
    const oai = getContext()?.chatCompletionSettings;
    if (!oai) throw new Error('未能读取 chatCompletionSettings');
    const order = pickActivePromptOrder(oai.prompt_order);
    let hit = false;
    order.forEach(item => {
      if (String(item.identifier) === String(promptId)) {
        item.enabled = !!enabled;
        hit = true;
      }
    });
    if (!hit && Array.isArray(oai.prompt_order)) {
      oai.prompt_order.forEach(b => (b?.order || []).forEach(item => {
        if (String(item.identifier) === String(promptId)) { item.enabled = !!enabled; hit = true; }
      }));
    }
    if (hit) {
      saveSettingsDebounced();
      try { await eventSource.emit(event_types.OAI_PRESET_CHANGED_AFTER); } catch (_) {}
    }
  },
  async togglePresetGroup(groupId, enabled) {
    const oai = getContext()?.chatCompletionSettings;
    if (!oai) throw new Error('未能读取 chatCompletionSettings');
    const { changed, matched } = this.applyPresetGroupMapInMemory({ [String(groupId)]: !!enabled }, { syncToDiskCache: true });
    if (matched.size === 0) throw new Error('未找到对应的预设分组');
    if (changed > 0 || matched.size > 0) {
      saveSettingsDebounced();
      try { await this.saveActivePresetToDisk(); } catch (_) {}
      try { await eventSource.emit(event_types.OAI_PRESET_CHANGED_AFTER); } catch (_) {}
    }
  },
  async updatePresetPrompt(promptId, name, content) {
    const oai = getContext()?.chatCompletionSettings;
    if (!oai || !Array.isArray(oai.prompts)) throw new Error('未能读取预设条目');
    const target = oai.prompts.find(p => String(p.identifier) === String(promptId));
    if (!target) throw new Error('未找到对应提示词');
    target.name = name;
    if (!target.marker) target.content = content;
    saveSettingsDebounced();
    try { await this.saveActivePresetToDisk(); } catch (_) {}
    try { await eventSource.emit(event_types.OAI_PRESET_CHANGED_AFTER); } catch (_) {}
  },
  async batchTogglePresetStates(promptMap, groupMap) {
    const oai = getContext()?.chatCompletionSettings;
    if (!oai) return { changed: 0, skipped: Object.keys(promptMap || {}).length };
    let changed = 0;
    let skipped = 0;
    const wantedPrompts = Object.keys(promptMap || {});
    const matchedPrompts = new Set();
    const wantedGroups = Object.keys(groupMap || {});
    let matchedGroups = new Set();

    if (wantedGroups.length) {
      const grpRes = this.applyPresetGroupMapInMemory(groupMap, { syncToDiskCache: true });
      changed += grpRes.changed;
      matchedGroups = grpRes.matched;
    }

    const order = pickActivePromptOrder(oai.prompt_order);
    order.forEach(item => {
      const pid = String(item.identifier);
      if (Object.prototype.hasOwnProperty.call(promptMap || {}, pid)) {
        matchedPrompts.add(pid);
        const target = !!promptMap[pid];
        if (!!item.enabled !== target) {
          item.enabled = target;
          changed++;
        }
      }
    });

    wantedPrompts.forEach(k => { if (!matchedPrompts.has(k)) skipped++; });
    wantedGroups.forEach(k => { if (!matchedGroups.has(k)) skipped++; });

    if (changed > 0 || wantedGroups.length > 0) {
      saveSettingsDebounced();
      try { await eventSource.emit(event_types.OAI_PRESET_CHANGED_AFTER); } catch (_) {}
    }
    return { changed, skipped };
  },

  // --- Regex (Native ST regex extension via dynamic import) ---
  async getRegexes(scope) {
    const eng = await ensureRegexEngine();
    if (!eng || typeof eng.getScriptsByType !== 'function' || !eng.SCRIPT_TYPES) return [];
    const type = scope === 'character'
      ? eng.SCRIPT_TYPES.SCOPED
      : scope === 'preset'
        ? eng.SCRIPT_TYPES.PRESET
        : eng.SCRIPT_TYPES.GLOBAL;
    if (type === undefined) return [];
    try {
      const list = eng.getScriptsByType(type) || [];
      return list.map(r => ({
        id: String(r.id),
        script_name: String(r.scriptName || r.script_name || r.id),
        enabled: !r.disabled,
        find_regex: String(r.findRegex || r.find_regex || ''),
        replace_string: String(r.replaceString || r.replace_string || ''),
        destination: {
          display: !!r.markdownOnly || !r.promptOnly,
          prompt: !!r.promptOnly || !r.markdownOnly,
        },
      }));
    } catch (_) {
      return [];
    }
  },
  async toggleRegex(scope, id, enabled) {
    const eng = await ensureRegexEngine();
    if (!eng || typeof eng.getScriptsByType !== 'function' || typeof eng.saveScriptsByType !== 'function') {
      throw new Error('未检测到酒馆内置正则模块');
    }
    const type = scope === 'character'
      ? eng.SCRIPT_TYPES.SCOPED
      : scope === 'preset'
        ? eng.SCRIPT_TYPES.PRESET
        : eng.SCRIPT_TYPES.GLOBAL;
    const scripts = eng.getScriptsByType(type) || [];
    let changed = false;
    scripts.forEach(s => {
      if (String(s.id) === String(id)) {
        if ((!s.disabled) !== !!enabled) {
          s.disabled = !enabled;
          changed = true;
        }
      }
    });
    if (changed) {
      await eng.saveScriptsByType(scripts, type);
    }
  },
  async batchToggleRegexes(scope, idMap) {
    const wanted = Object.keys(idMap || {});
    if (!wanted.length) return { changed: 0, skipped: 0 };
    const eng = await ensureRegexEngine();
    if (!eng || typeof eng.getScriptsByType !== 'function' || typeof eng.saveScriptsByType !== 'function') {
      return { changed: 0, skipped: wanted.length };
    }
    const type = scope === 'character'
      ? eng.SCRIPT_TYPES.SCOPED
      : scope === 'preset'
        ? eng.SCRIPT_TYPES.PRESET
        : eng.SCRIPT_TYPES.GLOBAL;
    if (type === undefined) return { changed: 0, skipped: wanted.length };
    let changed = 0;
    let skipped = 0;
    const matched = new Set();
    try {
      const scripts = eng.getScriptsByType(type) || [];
      scripts.forEach(s => {
        const sid = String(s.id);
        if (Object.prototype.hasOwnProperty.call(idMap, sid)) {
          matched.add(sid);
          const target = !!idMap[sid];
          if ((!s.disabled) !== target) {
            s.disabled = !target;
            changed++;
          }
        }
      });
      if (changed > 0) await eng.saveScriptsByType(scripts, type);
    } catch (_) {
      return { changed: 0, skipped: wanted.length };
    }
    wanted.forEach(k => { if (!matched.has(k)) skipped++; });
    return { changed, skipped };
  },

  // --- API / Connection Profiles (zero secrets stored!) ---
  listConnectionProfiles() {
    try {
      const ctx = getContext();
      const cm = ctx?.extensionSettings?.connectionManager || extension_settings?.connectionManager;
      const disabled = Array.isArray(ctx?.extensionSettings?.disabledExtensions)
        && ctx.extensionSettings.disabledExtensions.includes('connection-manager');
      if (disabled || !Array.isArray(cm?.profiles)) return [];
      return cm.profiles
        .filter(p => p && p.id && p.name)
        .map(p => ({
          id: String(p.id),
          name: String(p.name),
          api: String(p.api || ''),
          model: String(p.model || ''),
        }));
    } catch (_) {
      return [];
    }
  },
  getCurrentApiConfig() {
    try {
      const ctx = getContext();
      const cm = ctx?.extensionSettings?.connectionManager || extension_settings?.connectionManager;
      const disabled = Array.isArray(ctx?.extensionSettings?.disabledExtensions)
        && ctx.extensionSettings.disabledExtensions.includes('connection-manager');
      const selectedId = !disabled && cm?.selectedProfile ? String(cm.selectedProfile) : '';
      const profiles = Array.isArray(cm?.profiles) ? cm.profiles : [];
      const activeProfile = selectedId ? profiles.find(p => p && String(p.id) === selectedId) : null;

      const oai = ctx?.chatCompletionSettings || {};
      const source = String(oai.chat_completion_source || activeProfile?.api || '').trim();
      const fieldBySource = {
        claude: 'claude_model',
        openai: 'openai_model',
        makersuite: 'google_model',
        vertexai: 'vertexai_model',
        openrouter: 'openrouter_model',
        mistralai: 'mistralai_model',
        custom: 'custom_model',
        cohere: 'cohere_model',
        groq: 'groq_model',
        siliconflow: 'siliconflow_model',
        minimax: 'minimax_model',
        deepseek: 'deepseek_model',
        xai: 'xai_model',
        moonshot: 'moonshot_model',
        fireworks: 'fireworks_model',
        zai: 'zai_model',
      };
      let model = '';
      try {
        if (typeof ctx?.getChatCompletionModel === 'function') model = String(ctx.getChatCompletionModel(oai) || '').trim();
      } catch (_) {}
      if (!model) {
        const mf = fieldBySource[source.toLowerCase()];
        model = String((mf && oai[mf]) || activeProfile?.model || oai.model || '').trim();
      }
      const customUrl = source.toLowerCase() === 'custom'
        ? String(oai.custom_url || '').trim()
        : String(oai.reverse_proxy || '').trim();

      if (!activeProfile && !source && !model) return null;
      return {
        profileId: activeProfile ? String(activeProfile.id) : '',
        profileName: activeProfile ? String(activeProfile.name) : '',
        source,
        model,
        customUrl: customUrl.slice(0, 240),
      };
    } catch (_) {
      return null;
    }
  },
  async applyApiConfig(apiObj) {
    if (!apiObj || typeof apiObj !== 'object') return { applied: false, skipped: 0, switchedProfile: false };
    const $ = window.jQuery;
    const ctx = getContext();

    // Case A: Built-in Connection Profile
    if (apiObj.profileId || apiObj.profileName) {
      const profiles = this.listConnectionProfiles();
      const target = profiles.find(p => p.id === apiObj.profileId)
        || profiles.find(p => p.name === apiObj.profileName);
      if (!target) return { applied: false, skipped: 1, switchedProfile: false };

      const cm = ctx?.extensionSettings?.connectionManager || extension_settings?.connectionManager;
      if (cm && String(cm.selectedProfile || '') === target.id) {
        return { applied: true, skipped: 0, switchedProfile: false };
      }

      if ($ && $('#connection_profiles').length) {
        const hasOpt = $('#connection_profiles option').filter((_, el) => String($(el).val()) === target.id).length > 0;
        if (hasOpt) {
          $('#connection_profiles').val(target.id).trigger('change');
          return { applied: true, skipped: 0, switchedProfile: true };
        }
      }
      if (typeof ctx?.executeSlashCommandsWithOptions === 'function') {
        await ctx.executeSlashCommandsWithOptions(`/profile ${target.name}`, { handleParserErrors: false });
        return { applied: true, skipped: 0, switchedProfile: true };
      }
      return { applied: false, skipped: 1, switchedProfile: false };
    }

    // Case B: Raw Chat Completion source + model
    const oai = ctx?.chatCompletionSettings;
    if (!oai) return { applied: false, skipped: 1, switchedProfile: false };
    let changed = false;
    if (apiObj.source && oai.chat_completion_source !== apiObj.source) {
      oai.chat_completion_source = apiObj.source;
      if ($ && $('#chat_completion_source').length) {
        $('#chat_completion_source').val(apiObj.source).trigger('change');
      }
      changed = true;
    }
    if (apiObj.model) {
      const srcKey = String(apiObj.source || oai.chat_completion_source || '').toLowerCase();
      const fieldBySource = {
        claude: 'claude_model',
        openai: 'openai_model',
        makersuite: 'google_model',
        vertexai: 'vertexai_model',
        openrouter: 'openrouter_model',
        mistralai: 'mistralai_model',
        custom: 'custom_model',
        cohere: 'cohere_model',
        groq: 'groq_model',
        siliconflow: 'siliconflow_model',
        minimax: 'minimax_model',
        deepseek: 'deepseek_model',
        xai: 'xai_model',
        moonshot: 'moonshot_model',
        fireworks: 'fireworks_model',
        zai: 'zai_model',
      };
      const field = fieldBySource[srcKey];
      if (field && oai[field] !== apiObj.model) {
        oai[field] = apiObj.model;
        if ($ && $(`#model_${srcKey}_select`).length) {
          $(`#model_${srcKey}_select`).val(apiObj.model).trigger('change');
        } else if (srcKey === 'custom' && $ && $('#custom_model_id').length) {
          $('#custom_model_id').val(apiObj.model).trigger('input');
        }
        changed = true;
      }
    }
    if (changed) saveSettingsDebounced();
    return { applied: true, skipped: 0, switchedProfile: false };
  },
};

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

function findMatchingPersonaVersion(store, avatarId, liveDesc, liveName) {
  const list = (store.personaVersions && store.personaVersions[avatarId]) || [];
  const descStr = String(liveDesc || '');
  const nameStr = String(liveName || '').trim();
  const descMatches = list.filter(v => String(v.description || '') === descStr);
  if (!descMatches.length) return null;
  if (nameStr) {
    const exact = descMatches.find(v => v.displayName && v.displayName === nameStr);
    if (exact) return exact;
  }
  return descMatches.find(v => !v.displayName) || descMatches[0];
}

function autoBackupPersonaBeforeOverwrite(store, persona) {
  if (!persona || !persona.avatar_id) return;
  const desc = String(persona.description || '');
  const pName = String(persona.name || '').trim();
  if (!desc.trim() && !pName) return;
  const list = store.personaVersions[persona.avatar_id] || [];
  if (list.some(v => v.description === desc && (!v.displayName || v.displayName === pName))) return;
  const backupName = '切换前备份';
  const next = list.filter(v => v.name !== backupName);
  next.unshift({
    id: uid('pv'),
    name: backupName,
    displayName: pName,
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
    api: !!opts.scope.api,
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
    api: null,
  };

  if (scope.persona) {
    const p = Host.getCurrentPersona();
    if (p) {
      const matched = findMatchingPersonaVersion(store, p.avatar_id, p.description, p.name);
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
    await runWithConcurrency(booksToCapture, 2, async bk => {
      const map = await Host.getWorldbookToggleStates(bk);
      if (map && Object.keys(map).length) entries[bk] = map;
    });
    snap.worldbooks = {
      global: Host.getGlobalWorldbooks(),
      char: readCurrentCharInfo().name ? Host.getCharWorldbooks() : null,
      chat: readCurrentChatId() ? Host.getChatWorldbook() : null,
      entries,
    };
  }

  if (scope.preset) {
    const pName = Host.getLoadedPresetName();
    const norm = Host.getLiveNormalizedPreset();
    if (norm.prompts.length) {
      const map = {};
      const promptNames = {};
      norm.prompts.forEach(p => {
        map[p.id] = !!p.enabled;
        if (p.name) promptNames[p.id] = String(p.name).slice(0, 80);
      });
      const grpMap = {};
      const groupNames = {};
      norm.groups.forEach(g => {
        grpMap[g.id] = g.enabled !== false;
        if (g.name) groupNames[g.id] = String(g.name).slice(0, 60);
      });
      snap.preset = { name: pName, prompts: map, groups: grpMap, promptNames, groupNames };
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
      global: mapList(await Host.getRegexes('global')),
      character: mapList(await Host.getRegexes('character')),
      preset: mapList(await Host.getRegexes('preset')),
    };
  }

  if (scope.api) {
    const apiCfg = Host.getCurrentApiConfig();
    if (apiCfg) snap.api = apiCfg;
    else snap.scope.api = false;
  }

  return snap;
}

let isApplyingSnapshot = false;
async function applySnapshotLive(snap, store, silentPrefix) {
  if (!snap || isApplyingSnapshot) return;
  isApplyingSnapshot = true;
  let totalSkipped = 0;
  let regexChanged = false;

  try {
    if (snap.scope.persona && snap.persona && snap.persona.avatarId) {
      const personas = Host.listPersonas();
      const target = personas.find(p => p.avatar_id === snap.persona.avatarId)
        || personas.find(p => p.name === snap.persona.name);
      if (target) {
        await Host.switchPersona(target.avatar_id);
        let desc = snap.persona.description;
        let lorebook = snap.persona.lorebook;
        let desiredName = String(snap.persona.name || '').trim();
        if (snap.persona.versionId) {
          const verList = (store.personaVersions && store.personaVersions[target.avatar_id]) || [];
          const foundVer = verList.find(v => v.id === snap.persona.versionId);
          if (foundVer) {
            desc = foundVer.description;
            lorebook = foundVer.lorebook;
            if (foundVer.displayName) desiredName = foundVer.displayName;
          }
        }
        const needRename = !!desiredName && target.name !== desiredName;
        const needBody = target.description !== desc || (typeof lorebook === 'string' && target.lorebook !== lorebook);
        if (needRename || needBody) {
          autoBackupPersonaBeforeOverwrite(store, target);
          persistStore(store);
        }
        if (needRename) {
          await Host.renamePersonaInPlace(target.avatar_id, desiredName);
        }
        if (needBody) {
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
      const entriesMap = snap.worldbooks.entries || {};
      for (const bk of Object.keys(entriesMap)) {
        if (!allBooks.has(bk)) { totalSkipped++; continue; }
        const res = await Host.batchToggleWorldbookEntries(bk, entriesMap[bk]);
        totalSkipped += res.skipped;
      }
    }

    if (snap.scope.api && snap.api) {
      const apiRes = await Host.applyApiConfig(snap.api);
      totalSkipped += apiRes.skipped || 0;
      if (apiRes.switchedProfile) {
        // Wait briefly so Connection Profile settles before snapshot's preset overrides cleanly
        await new Promise(r => window.setTimeout(r, 150));
      }
    }

    if (snap.scope.preset && snap.preset) {
      if (snap.preset.name) {
        const wasSame = Host.getLoadedPresetName() === snap.preset.name;
        const ok = await Host.selectPresetByName(snap.preset.name);
        if (ok) {
          // Wait briefly after preset switch so runtime group state settles before overriding
          if (!wasSame) await new Promise(r => window.setTimeout(r, 100));
          const res = await Host.batchTogglePresetStates(snap.preset.prompts || {}, snap.preset.groups || {});
          totalSkipped += res.skipped;
        } else {
          totalSkipped++;
        }
      }
    }

    if (snap.scope.regex && snap.regex) {
      for (const sc of ['global', 'character', 'preset']) {
        if (sc === 'character' && !readCurrentCharInfo().name) continue;
        const res = await Host.batchToggleRegexes(sc, snap.regex[sc] || {});
        if (res.changed > 0) regexChanged = true;
        totalSkipped += res.skipped;
      }
    }

    if (regexChanged && readCurrentChatId()) {
      try { await reloadCurrentChat?.(); } catch (_) {}
    }

    const prefix = silentPrefix || '已应用快照';
    toast(totalSkipped > 0
      ? `${prefix}「${snap.name}」（跳过 ${totalSkipped} 项缺失引用）`
      : `${prefix}「${snap.name}」`, 'success');
  } catch (err) {
    console.error('[快照管家] 应用失败', err);
    toast('应用快照失败：' + (err?.message || err), 'error');
  } finally {
    isApplyingSnapshot = false;
  }
}

// =========================
// Inline SVG Icons
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
  back: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
  play: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"/></svg>',
  save: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
  miniWindow: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><rect x="4" y="12" width="16" height="7" rx="1" fill="currentColor" fill-opacity="0.18"/></svg>',
  restoreSize: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><polyline points="15 10 18 7 15 7"/><line x1="18" y1="7" x2="12" y2="13"/></svg>',
  minimize: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  resizeGrip: '<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="11" y1="5" x2="5" y2="11"/><line x1="11" y1="9" x2="9" y2="11"/></svg>',
};

// =========================
// Shadow DOM Styles
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

/* Unified Theme Palettes: paper (素纸) | ink (青岚) | warm (暖砂) | sakura (淡樱) | glass-dark (深色夜间) */
.upp-backdrop,
.upp-fab-root,
.upp-restore-pill {
  --bg: #f6f6f3;
  --surface: #eeeeea;
  --surface-strong: #fcfcfb;
  --surface-hover: #e7e7e1;
  --border: #e2e2dc;
  --border-strong: #c8c8c0;
  --text: #262626;
  --muted: #70706c;
  --accent: #2c2c2e;
  --accent-soft: rgba(44, 44, 46, 0.09);
  --accent-border: color-mix(in srgb, var(--accent) 30%, var(--border));
  --accent-border-strong: color-mix(in srgb, var(--accent) 42%, var(--border));
  --accent-text: #fcfcfb;
  --ok: #3f7a6d;
  --ok-soft: rgba(63, 122, 109, 0.13);
  --warn: #a66e38;
  --warn-soft: rgba(166, 110, 56, 0.13);
  --danger: #a53c3c;
  --danger-soft: rgba(165, 60, 60, 0.11);
  --switch-off: #d2d2cc;
  --shadow: 0 18px 46px rgba(24, 24, 24, 0.14);
  --modal-blur: 0px;
}

.upp-backdrop[data-theme="ink"],
.upp-fab-root[data-theme="ink"],
.upp-restore-pill[data-theme="ink"] {
  --bg: #f1f4f6;
  --surface: #e7ecef;
  --surface-strong: #fbfcfd;
  --surface-hover: #dce6ec;
  --border: #d4dde3;
  --border-strong: #aebec9;
  --text: #1f2b33;
  --muted: #5d707d;
  --accent: #2c7a7b;
  --accent-soft: rgba(44, 122, 123, 0.12);
  --accent-text: #ffffff;
  --ok: #2c7a7b;
  --ok-soft: rgba(44, 122, 123, 0.13);
  --switch-off: #c3d1da;
}

.upp-backdrop[data-theme="warm"],
.upp-fab-root[data-theme="warm"],
.upp-restore-pill[data-theme="warm"] {
  --bg: #f6f2ea;
  --surface: #ede7dc;
  --surface-strong: #fdfbf7;
  --surface-hover: #e6dfd2;
  --border: #dfd6c8;
  --border-strong: #c5b8a4;
  --text: #2f2820;
  --muted: #7b6f60;
  --accent: #8c6239;
  --accent-soft: rgba(140, 98, 57, 0.12);
  --accent-text: #ffffff;
  --ok: #4d7c66;
  --ok-soft: rgba(77, 124, 102, 0.13);
  --switch-off: #d4cab9;
}

.upp-backdrop[data-theme="sakura"],
.upp-fab-root[data-theme="sakura"],
.upp-restore-pill[data-theme="sakura"] {
  --bg: #faf3f5;
  --surface: #f3e8ec;
  --surface-strong: #fffcfd;
  --surface-hover: #ecdde3;
  --border: #e6d5dc;
  --border-strong: #cfb4bf;
  --text: #34242b;
  --muted: #7f6670;
  --accent: #b85d7a;
  --accent-soft: rgba(184, 93, 122, 0.12);
  --accent-text: #ffffff;
  --ok: #4c8376;
  --ok-soft: rgba(76, 131, 118, 0.13);
  --switch-off: #dec7d0;
}

.upp-backdrop[data-theme="glass-dark"],
.upp-fab-root[data-theme="glass-dark"],
.upp-restore-pill[data-theme="glass-dark"] {
  --bg: #191a1d;
  --surface: #232429;
  --surface-strong: #2c2e34;
  --surface-hover: #35373f;
  --border: #313238;
  --border-strong: #484a52;
  --text: #ecece8;
  --muted: #9a9b9f;
  --accent: #dcdcd8;
  --accent-soft: rgba(220, 220, 216, 0.14);
  --accent-text: #18191c;
  --ok: #56b49c;
  --ok-soft: rgba(86, 180, 156, 0.16);
  --warn: #e5a95c;
  --warn-soft: rgba(229, 169, 92, 0.16);
  --danger: #e06c6c;
  --danger-soft: rgba(224, 108, 108, 0.16);
  --switch-off: rgba(255, 255, 255, 0.2);
  --shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
  --modal-blur: 0px;
}

.upp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  background: transparent;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  color: var(--text);
}
.upp-backdrop.is-minimized {
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
}
.upp-backdrop.is-minimized .upp-modal,
.upp-backdrop.is-minimized .upp-drawer-mask {
  pointer-events: none !important;
}
.upp-fab-root { color: var(--text); }

.upp-modal {
  position: relative;
  pointer-events: auto;
  container-type: inline-size;
  container-name: plugin-win;
  width: min(780px, calc(100vw - 24px));
  height: min(690px, 88dvh);
  background: var(--bg);
  backdrop-filter: blur(var(--modal-blur)) saturate(140%);
  -webkit-backdrop-filter: blur(var(--modal-blur)) saturate(140%);
  border: 1px solid var(--border-strong);
  border-radius: 16px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.upp-modal.is-floating {
  position: fixed;
  margin: 0;
}
.upp-modal.is-mini {
  border-radius: 16px;
  border: 1px solid var(--border-strong);
}
.upp-modal.is-dragging,
.upp-modal.is-resizing {
  user-select: none;
}

.upp-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 16px 9px;
  border-bottom: 1px solid var(--border);
}
.upp-modal.is-draggable .upp-header {
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.upp-modal.is-dragging .upp-header {
  cursor: grabbing;
}
.upp-title-wrap { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.upp-title { font-size: 15px; font-weight: 650; letter-spacing: -0.01em; white-space: nowrap; flex-shrink: 0; }
.upp-ctx-chip {
  font-size: 11px; color: var(--muted); background: var(--surface); border: 1px solid var(--border);
  border-radius: 999px; padding: 2px 8px; max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.upp-head-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
#upp-theme-select { max-width: 96px; }

.upp-tabs {
  flex-shrink: 0; display: flex; align-items: center; gap: 5px;
  padding: 7px 16px; border-bottom: 1px solid var(--border); background: var(--surface);
  overflow-x: auto; scrollbar-width: none;
}
.upp-tabs::-webkit-scrollbar { display: none; }
.upp-tab {
  height: 32px; min-height: 32px; padding: 0 12px; border-radius: 9px; border: 1px solid transparent;
  background: transparent; color: var(--muted); font-size: 12.5px; font-weight: 550; line-height: 1;
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  white-space: nowrap; flex-shrink: 0; vertical-align: middle;
  transition: background 0.14s, color 0.14s, border-color 0.14s;
}
.upp-tab > span { line-height: 1; display: inline-flex; align-items: center; }
.upp-tab:hover { color: var(--text); background: var(--surface-hover); }
.upp-tab.active { color: var(--accent); background: var(--accent-soft); border-color: var(--accent-border); }
.upp-tab-count {
  font-size: 11px; line-height: 1; height: 16px; min-width: 16px; padding: 0 5px;
  border-radius: 999px; background: var(--surface-strong); border: 1px solid var(--border);
  color: var(--muted); display: inline-flex; align-items: center; justify-content: center;
  font-variant-numeric: tabular-nums;
}
.upp-tab.active .upp-tab-count {
  background: var(--accent); border-color: var(--accent); color: var(--accent-text);
}

.upp-toolbar {
  flex-shrink: 0; display: flex; flex-direction: column; gap: 8px;
  padding: 9px 16px; border-bottom: 1px solid var(--border);
  height: 88px; justify-content: center; overflow: hidden;
}
.upp-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.upp-toolbar .upp-row { flex-wrap: nowrap; min-height: 30px; min-width: 0; }
.upp-tb-split, .upp-tb-user-top, .upp-tb-wb-row1, .upp-tb-wb-row2,
.upp-tb-pr-row1, .upp-tb-pr-row2, .upp-tb-rg-row1, .upp-tb-rg-row2 {
  display: flex; align-items: center; gap: 6px; min-width: 0; min-height: 30px; width: 100%;
}
.upp-tb-search { flex: 1; min-width: 110px; }
.upp-tb-actions, .upp-tb-u-primary, .upp-tb-u-secondary,
.upp-tb-wb-p1, .upp-tb-wb-p2, .upp-tb-wb-filters,
.upp-tb-pr-p1, .upp-tb-pr-fold, .upp-tb-rg-scopes {
  display: flex; align-items: center; gap: 6px; flex-shrink: 0; min-width: 0;
}
.upp-tb-u-primary, .upp-tb-wb-p1, .upp-tb-pr-p1 { flex: 1; min-width: 0; }
.upp-tb-row3 { width: 100%; min-height: 30px; align-items: center; }
.upp-row-nowrap { display: flex; align-items: center; gap: 6px; min-width: 0; }
.upp-spacer { flex: 1; min-width: 4px; }
.upp-mobile-only { display: none; }
.upp-snap-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.upp-btn, .upp-select, .upp-input-wrap {
  height: 30px; border-radius: 9px; border: 1px solid var(--border);
  background: var(--surface-strong); color: var(--text); font-size: 12px; font-family: inherit;
}
.upp-btn {
  padding: 0 10px; display: inline-flex; align-items: center; justify-content: center;
  gap: 5px; cursor: pointer; white-space: nowrap; flex-shrink: 0;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.upp-btn:hover { background: var(--surface-hover); border-color: var(--border-strong); }
.upp-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.upp-btn.icon-only { width: 30px; padding: 0; }
.upp-btn.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: 550; }
.upp-btn.primary:hover { filter: brightness(1.06); }
.upp-btn.active { background: var(--accent-soft); color: var(--accent); border-color: var(--accent-border-strong); }
.upp-btn.danger { color: var(--danger); }
.upp-btn.danger:hover { background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 35%, transparent); }
.upp-btn.pinned { color: var(--warn); background: var(--warn-soft); border-color: color-mix(in srgb, var(--warn) 32%, transparent); }

.upp-select { padding: 0 24px 0 9px; cursor: pointer; min-width: 0; max-width: 100%; outline: none; }
#upp-persona-select { max-width: 190px; }
#upp-preset-select { max-width: 220px; }
.upp-select:focus { border-color: var(--accent); }

.upp-input-wrap {
  display: inline-flex; align-items: center; gap: 6px; padding: 0 9px; flex: 1; min-width: 120px;
}
.upp-input-wrap svg { color: var(--muted); flex-shrink: 0; }
.upp-input-wrap input {
  width: 100%; height: 100%; min-height: 0; border: none; background: transparent; color: var(--text); font-size: 12px; font-family: inherit; outline: none;
}
.upp-input-wrap input::placeholder { color: var(--muted); }

.upp-switch {
  position: relative; width: 34px; height: 20px; border-radius: 999px; border: none;
  background: var(--switch-off); cursor: pointer; flex-shrink: 0; padding: 0; transition: background 0.16s ease;
}
.upp-switch::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
  background: #ffffff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.22); transition: transform 0.16s ease;
}
.upp-switch[aria-checked="true"] { background: var(--accent); }
.upp-switch[aria-checked="true"]::after { transform: translateX(14px); }

.upp-switch-label {
  height: 30px; padding: 0 9px; border-radius: 9px; border: 1px solid var(--border);
  background: var(--surface-strong); display: inline-flex; align-items: center; gap: 7px;
  font-size: 12px; color: var(--text); cursor: pointer; white-space: nowrap; flex-shrink: 0; user-select: none;
}

.upp-body {
  flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden;
  padding: 12px 16px 14px; display: flex; flex-direction: column; gap: 8px;
}
.upp-body > * { flex-shrink: 0; }
.upp-body::-webkit-scrollbar,
.upp-drawer-body::-webkit-scrollbar,
.upp-pop-list::-webkit-scrollbar { width: 5px; height: 5px; }
.upp-body::-webkit-scrollbar-thumb,
.upp-drawer-body::-webkit-scrollbar-thumb,
.upp-pop-list::-webkit-scrollbar-thumb { background: rgba(120, 132, 154, 0.35); border-radius: 999px; }

.upp-footer {
  flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 10px 16px; border-top: 1px solid var(--border); background: var(--surface);
}
.upp-modal.is-resizable .upp-footer {
  padding-right: 30px;
}
.upp-foot-status {
  min-width: 0; display: flex; align-items: center; gap: 6px; font-size: 12px;
  color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.upp-foot-status > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.upp-foot-status strong { color: var(--text); font-weight: 600; }
.upp-foot-actions { display: flex; align-items: center; gap: 7px; flex-shrink: 0; }
.upp-foot-actions .upp-btn { height: 32px; padding: 0 12px; }

.upp-pill-strip { display: flex; align-items: center; gap: 6px; overflow-x: auto; padding-bottom: 1px; scrollbar-width: none; }
.upp-pill-strip::-webkit-scrollbar { display: none; }
.upp-pill {
  height: 28px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--border);
  background: var(--surface); color: var(--muted); font-size: 12px; cursor: pointer;
  white-space: nowrap; flex-shrink: 0; display: inline-block; line-height: 26px; vertical-align: middle;
  max-width: 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis;
}
.upp-pill.is-closable {
  display: inline-flex; align-items: center; gap: 4px; line-height: normal;
}
.upp-pill-text {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.upp-pill-x { flex-shrink: 0; }
.upp-pill:hover { color: var(--text); border-color: var(--border-strong); }
.upp-pill.active { color: var(--accent); background: var(--accent-soft); border-color: var(--accent-border-strong); font-weight: 550; }

.upp-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: 13px;
  padding: 11px 13px; display: flex; flex-direction: column; gap: 8px;
  min-width: 0; overflow: hidden;
}
.upp-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.upp-card-head > .upp-row-nowrap:first-child { flex: 1; min-width: 0; }
.upp-card-head > .upp-row-nowrap:last-child:not(:first-child) { flex-shrink: 0; }
.upp-card-head > .upp-card-meta { flex-shrink: 0; }
.upp-card-head .upp-badge { max-width: 150px; }
.upp-card-title { font-size: 13.5px; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.upp-card-meta { font-size: 11.5px; color: var(--muted); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; max-width: 100%; overflow-wrap: anywhere; }

.upp-badge {
  display: inline-block; max-width: 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  padding: 2px 7px; border-radius: 999px; line-height: 1.45; vertical-align: middle;
  font-size: 11px; border: 1px solid var(--border); background: var(--surface-strong); color: var(--muted); white-space: nowrap; flex-shrink: 0;
}
button.upp-badge { display: inline-flex; align-items: center; gap: 4px; }
button.upp-badge > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.upp-badge.accent { color: var(--accent); background: var(--accent-soft); border-color: var(--accent-border); }
.upp-badge.ok { color: var(--ok); background: var(--ok-soft); border-color: color-mix(in srgb, var(--ok) 28%, transparent); }
.upp-badge.warn { color: var(--warn); background: var(--warn-soft); border-color: color-mix(in srgb, var(--warn) 30%, transparent); }

/* Collapsible Group Box (shared by Preset tab and Snapshot Detail Viewer) */
.upp-group-box {
  border: 1px solid var(--border); border-radius: 13px; background: var(--surface); overflow: hidden;
}
.upp-group-box.is-disabled { opacity: 0.72; }
.upp-group-head {
  display: flex; align-items: center; gap: 8px; padding: 8px 11px; background: var(--surface-strong);
}
.upp-group-toggle-btn {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px;
  background: none; border: none; padding: 0; color: var(--text); font: inherit; font-weight: 600;
  cursor: pointer; text-align: left;
}
.upp-group-chev { display: inline-flex; color: var(--muted); transition: transform 0.14s ease; flex-shrink: 0; }
.upp-group-box.is-collapsed .upp-group-chev { transform: rotate(-90deg); }
.upp-group-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.upp-group-items {
  display: flex; flex-direction: column; gap: 5px; padding: 6px 8px 8px; border-top: 1px solid var(--border);
}
.upp-group-items > * { flex-shrink: 0; }
.upp-group-box.is-collapsed .upp-group-items { display: none; }

.upp-entry-list { display: flex; flex-direction: column; gap: 5px; }
.upp-entry-list > * { flex-shrink: 0; }
.upp-entry-row {
  display: flex; align-items: center; gap: 8px; padding: 7px 10px;
  border-radius: 10px; border: 1px solid var(--border); background: var(--surface);
  transition: background 0.12s, border-color 0.12s;
}
.upp-entry-row:hover { background: var(--surface-strong); border-color: var(--border-strong); }
.upp-entry-row.is-on { border-color: var(--accent-border); background: var(--surface-strong); }
.upp-entry-row.is-off { opacity: 0.68; }
.upp-entry-main {
  flex: 1; min-width: 0; overflow: hidden; display: flex; align-items: center; gap: 8px;
  background: none; border: none; padding: 0; text-align: left; color: inherit; cursor: pointer; font: inherit;
}
.upp-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.upp-dot.constant { background: #5a7ea6; }
.upp-dot.selective { background: #4d856b; }
.upp-dot.vectorized { background: #7d6a99; }
.upp-dot.snap-on { background: var(--ok); }
.upp-dot.snap-off { background: transparent; border: 1.5px solid var(--muted); }

.upp-role-tag {
  font-size: 10px; font-weight: 650; padding: 1px 5px; border-radius: 5px;
  background: var(--accent-soft); color: var(--accent); flex-shrink: 0; text-transform: uppercase;
}
.upp-role-tag.placeholder { background: var(--surface); color: var(--muted); border: 1px solid var(--border); }
.upp-entry-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.upp-entry-title-row { display: flex; align-items: center; gap: 5px; min-width: 0; overflow: hidden; }
.upp-entry-title-row .upp-badge { flex: 0 1 auto; min-width: 44px; }
.upp-entry-title-row .upp-badge.upp-keep { flex-shrink: 0; min-width: 0; }
.upp-entry-name { flex: 0 1 auto; font-size: 13px; font-weight: 520; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.upp-entry-preview { font-size: 11.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.upp-entry-wrap { display: flex; flex-direction: column; }
.upp-entry-wrap.is-expanded > .upp-entry-row {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  border-bottom-color: transparent;
}
.upp-entry-chev {
  display: inline-flex; color: var(--muted); flex-shrink: 0; transition: transform 0.14s ease;
}
.upp-entry-wrap.is-expanded .upp-entry-chev { transform: rotate(180deg); }
.upp-inline-panel {
  border: 1px solid var(--border-strong);
  border-top: 1px dashed var(--border);
  border-radius: 0 0 10px 10px;
  background: var(--bg);
  padding: 9px 10px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.upp-inline-meta {
  font-size: 11px; color: var(--muted);
  display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
}
.upp-inline-pre {
  margin: 0; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--surface-strong); color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "PingFang SC", monospace;
  font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word;
  max-height: 280px; overflow-y: auto;
}
.upp-inline-textarea {
  width: 100%; min-height: 150px; max-height: 320px; resize: vertical;
  border-radius: 8px; border: 1px solid var(--border-strong);
  background: var(--surface-strong); color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "PingFang SC", monospace;
  font-size: 12px; line-height: 1.55; padding: 8px 10px; outline: none;
}
.upp-inline-textarea:focus { border-color: var(--accent); }
.upp-inline-foot { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.upp-wb-sub { color: var(--muted); font-size: 11px; margin-left: 4px; font-weight: 400; }

.upp-persona-live-box {
  font-size: 12.5px; line-height: 1.55; color: var(--text); background: var(--surface-strong);
  border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px;
  max-height: 180px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; cursor: pointer;
}
.upp-persona-live-box:hover { border-color: var(--accent); }
.upp-persona-live-box.is-empty { color: var(--muted); }

.upp-book-trigger { flex: 1; min-width: 140px; max-width: 280px; justify-content: space-between; }
.upp-book-trigger span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.upp-bind-strip {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 11px;
  border-radius: 10px; background: var(--accent-soft); border: 1px solid var(--accent-border); font-size: 12px;
  min-width: 0;
}
.upp-bind-strip > span:first-child {
  min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.upp-bind-strip.is-confirm > span:first-child {
  white-space: normal; overflow-wrap: anywhere;
}
.upp-bind-strip > .upp-row-nowrap,
.upp-bind-strip > .upp-btn {
  flex-shrink: 0;
}

.upp-empty {
  text-align: center; color: var(--muted); padding: 36px 16px; font-size: 13px;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
}

/* Drawers — standard dialog + Full-Modal Snapshot Inspector */
.upp-drawer-mask {
  position: absolute; inset: 0; z-index: 20; background: rgba(15, 22, 36, 0.36);
  pointer-events: none;
  display: flex; align-items: center; justify-content: center; padding: 14px;
}
.upp-drawer-mask:not([hidden]) {
  pointer-events: auto;
}
.upp-drawer-mask.is-full { padding: 0; background: var(--bg); }
.upp-resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 24px;
  height: 24px;
  z-index: 15;
  cursor: nwse-resize;
  touch-action: none;
  user-select: none;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 5px;
  color: var(--muted);
  opacity: 0.6;
  transition: opacity 0.12s, color 0.12s;
}
.upp-resize-handle:hover {
  opacity: 1;
  color: var(--accent);
}
.upp-drawer {
  width: min(620px, 100%); max-height: 100%; background: var(--surface-strong);
  border: 1px solid var(--border-strong); border-radius: 15px; box-shadow: var(--shadow);
  display: flex; flex-direction: column; overflow: hidden;
}
.upp-drawer.is-fixed-box {
  height: min(560px, 100%);
}
.upp-drawer.is-fixed-sm {
  width: min(460px, 100%);
  height: min(360px, 100%);
}
.upp-drawer.is-full {
  width: 100%; height: 100%; border: none; border-radius: 0; box-shadow: none; background: var(--bg);
}
.upp-drawer-head {
  flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 11px 14px; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 14px;
}
.upp-drawer-head > span:first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.upp-drawer-head > .upp-row-nowrap:first-child { flex: 1; min-width: 0; }
.upp-drawer-head > .upp-row-nowrap:last-child:not(:first-child) { flex-shrink: 0; }
.upp-drawer-toolbar {
  flex-shrink: 0; display: flex; flex-direction: column; gap: 6px;
  padding: 8px 14px; border-bottom: 1px solid var(--border); background: var(--surface);
  height: 76px; justify-content: center; overflow: hidden;
}
.upp-drawer-toolbar .upp-row { flex-wrap: nowrap; min-width: 0; width: 100%; }
.upp-drawer-toolbar .upp-input-wrap { min-width: 60px; }
#upp-snap-inspect-meta {
  display: flex; align-items: center; gap: 6px; flex-wrap: nowrap;
  min-width: 0; width: 100%; height: 22px; overflow: hidden;
}
#upp-snap-inspect-meta .upp-badge { flex: 0 1 auto; min-width: 48px; }
#upp-snap-inspect-meta .upp-badge.upp-keep { flex-shrink: 0; min-width: 0; }
.upp-drawer-body {
  flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 12px 14px;
  display: flex; flex-direction: column; gap: 8px;
}
.upp-drawer-body > * { flex-shrink: 0; }
.upp-drawer-foot {
  flex-shrink: 0; display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  padding: 10px 14px; border-top: 1px solid var(--border); background: var(--surface);
}

.upp-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.upp-field label { font-size: 12px; color: var(--muted); font-weight: 550; }
.upp-text-input, .upp-textarea {
  width: 100%; border-radius: 9px; border: 1px solid var(--border-strong);
  background: var(--bg); color: var(--text); font-family: inherit; font-size: 12.5px; padding: 7px 10px; outline: none;
}
.upp-text-input:focus, .upp-textarea:focus { border-color: var(--accent); }
.upp-textarea {
  min-height: 220px; resize: vertical; line-height: 1.55;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "PingFang SC", monospace;
}

.upp-check-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.upp-check-item {
  display: flex; align-items: center; gap: 7px; padding: 7px 9px; border-radius: 9px; min-width: 0;
  border: 1px solid var(--border); background: var(--surface); cursor: pointer; font-size: 12px; user-select: none;
}
.upp-check-item input { accent-color: var(--accent); margin: 0; flex-shrink: 0; }
.upp-check-item > span:not(.upp-badge) { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.upp-check-item > .upp-badge { flex-shrink: 0; max-width: 110px; }

.upp-pop-list {
  max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;
  border: 1px solid var(--border); border-radius: 10px; padding: 6px; background: var(--bg);
}
.upp-pop-list > * { flex-shrink: 0; }
.upp-pop-list.is-fill {
  flex: 1; min-height: 0; max-height: none;
}
.upp-merge-row {
  display: flex; flex-direction: column; gap: 5px; padding: 7px 9px; min-width: 0; overflow: hidden;
  border-radius: 9px; border: 1px solid var(--border); background: var(--surface-strong);
}
.upp-merge-row.is-checked { border-color: var(--accent); }
.upp-merge-top {
  display: flex; align-items: center; gap: 7px; min-width: 0;
}
.upp-merge-top label {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; cursor: pointer; user-select: none;
}
.upp-merge-top > .upp-btn { flex-shrink: 0; }
.upp-merge-name {
  font-size: 13px; font-weight: 600; color: var(--text); min-width: 0; flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.upp-merge-snippet {
  font-size: 11.5px; color: var(--muted); line-height: 1.45;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  word-break: break-word; padding-left: 21px;
}
.upp-unsaved-bar {
  flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
  padding: 9px 14px; background: var(--warn-soft); border-bottom: 1px solid rgba(166, 110, 56, 0.35);
  color: var(--text); font-size: 12px;
}

.upp-diff-box {
  border: 1px solid var(--border); border-radius: 10px; background: var(--bg); padding: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5;
  max-height: 320px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere;
}
.upp-diff-line { padding: 1px 6px; border-radius: 4px; }
.upp-diff-line.del { background: var(--danger-soft); color: var(--danger); }
.upp-diff-line.add { background: var(--ok-soft); color: var(--ok); }
.upp-diff-line.same { color: var(--muted); }

.upp-sec-title {
  font-size: 12px; font-weight: 600; color: var(--muted);
  display: flex; align-items: center; justify-content: space-between; margin-top: 2px;
}
.upp-detail-item {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 9px;
  border-radius: 8px; border: 1px solid var(--border); background: var(--bg);
  cursor: pointer; font-size: 12px; color: var(--text); text-align: left; width: 100%; min-width: 0;
}
.upp-detail-item > span:first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.upp-detail-item > *:last-child:not(:first-child) { flex-shrink: 0; }
.upp-row-nowrap > .upp-detail-item { flex: 1; min-width: 0; width: auto; }
.upp-detail-item:hover { border-color: var(--accent); background: var(--surface-hover); }
.upp-ps-inherit-sel { height: 26px; font-size: 11px; max-width: 165px; padding: 0 20px 0 6px; }

.upp-modal.is-compact-h .upp-header { padding: 5px 10px; }
.upp-modal.is-compact-h .upp-tabs { padding: 4px 10px; }
.upp-modal.is-compact-h .upp-tab { height: 26px; min-height: 26px; font-size: 11.5px; }
.upp-modal.is-compact-h .upp-toolbar { padding: 4px 10px; gap: 4px; height: 70px; }
.upp-modal.is-compact-h .upp-toolbar .upp-row,
.upp-modal.is-compact-h .upp-toolbar .upp-tb-row3,
.upp-modal.is-compact-h .upp-tb-split,
.upp-modal.is-compact-h .upp-tb-user-top,
.upp-modal.is-compact-h .upp-tb-wb-row1,
.upp-modal.is-compact-h .upp-tb-wb-row2,
.upp-modal.is-compact-h .upp-tb-pr-row1,
.upp-modal.is-compact-h .upp-tb-pr-row2,
.upp-modal.is-compact-h .upp-tb-rg-row1,
.upp-modal.is-compact-h .upp-tb-rg-row2 { min-height: 26px; }
.upp-modal.is-compact-h .upp-toolbar .upp-pill-strip { padding-bottom: 0; }
.upp-modal.is-compact-h .upp-toolbar .upp-pill { height: 26px; line-height: 24px; font-size: 11.5px; }
.upp-modal.is-compact-h .upp-toolbar .upp-btn,
.upp-modal.is-compact-h .upp-toolbar .upp-select,
.upp-modal.is-compact-h .upp-toolbar .upp-input-wrap,
.upp-modal.is-compact-h .upp-toolbar .upp-switch-label { height: 26px; font-size: 11.5px; }
.upp-modal.is-compact-h .upp-toolbar .upp-btn.icon-only { width: 26px; }
.upp-modal.is-compact-h .upp-footer { flex-direction: row; align-items: center; padding: 5px 10px; gap: 6px; }
.upp-modal.is-compact-h.is-resizable .upp-footer { padding-right: 30px; }
.upp-modal.is-compact-h .upp-foot-actions .upp-btn { height: 28px; font-size: 11.5px; }

@container plugin-win (max-width: 560px) {
  .upp-toolbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-rows: 30px 30px 30px;
    gap: 6px;
    padding: 7px 12px;
    height: 118px;
    align-items: center;
  }
  .upp-toolbar .upp-spacer { display: none; }
  .upp-tb-split, .upp-tb-user-top, .upp-tb-wb-row1, .upp-tb-wb-row2,
  .upp-tb-pr-row1, .upp-tb-pr-row2, .upp-tb-rg-row1, .upp-tb-rg-row2 { display: contents; }
  .upp-tb-actions { grid-column: 1 / -1; grid-row: 1; display: flex; gap: 5px; width: 100%; }
  .upp-tb-actions > * { flex: 1; min-width: 0; justify-content: center; padding: 0 6px; }
  .upp-tb-search { grid-column: 1 / -1; grid-row: 2; width: 100%; min-width: 0; }
  .upp-tb-row3 { grid-column: 1 / -1; grid-row: 3; width: 100%; }
  .upp-tb-u-primary { grid-column: 1 / -1; grid-row: 1; display: flex; gap: 5px; width: 100%; }
  .upp-tb-u-primary .upp-select { flex: 1; max-width: 100%; min-width: 0; }
  .upp-tb-u-secondary { grid-column: 1 / -1; grid-row: 2; display: flex; gap: 5px; width: 100%; }
  .upp-tb-u-secondary .upp-btn { flex: 1; min-width: 0; padding: 0 6px; }
  .upp-tb-u-search-row { grid-column: 1 / -1; grid-row: 3; display: flex; gap: 5px; width: 100%; }
  .upp-tb-wb-p1 { grid-column: 1 / -1; grid-row: 1; display: flex; gap: 5px; width: 100%; }
  .upp-tb-wb-p1 .upp-book-trigger { flex: 1; max-width: none; min-width: 0; }
  .upp-tb-wb-p2 { grid-column: 1; grid-row: 2; display: flex; gap: 5px; width: 100%; }
  .upp-tb-wb-p2 .upp-btn:not(.icon-only) { flex: 1; min-width: 0; padding: 0 6px; }
  .upp-tb-wb-filters { grid-column: 2; grid-row: 2; display: flex; gap: 5px; width: 100%; }
  .upp-tb-wb-filters .upp-btn { flex: 1; min-width: 0; padding: 0 6px; }
  .upp-tb-wb-search { grid-column: 1 / -1; grid-row: 3; width: 100%; min-width: 0; }
  .upp-tb-pr-p1 { grid-column: 1 / -1; grid-row: 1; display: flex; gap: 5px; width: 100%; }
  .upp-tb-pr-p1 .upp-select { flex: 1; max-width: 100%; min-width: 0; }
  .upp-tb-pr-onlyon { grid-column: 1; grid-row: 2; justify-self: start; }
  .upp-tb-pr-fold { grid-column: 2; grid-row: 2; justify-self: end; display: flex; gap: 5px; }
  .upp-tb-pr-search { grid-column: 1 / -1; grid-row: 3; width: 100%; min-width: 0; }
  .upp-tb-rg-scopes { grid-column: 1 / -1; grid-row: 1; display: flex; gap: 5px; width: 100%; }
  .upp-tb-rg-scopes .upp-btn { flex: 1; min-width: 0; padding: 0 6px; }
  .upp-tb-rg-search { grid-column: 1 / -1; grid-row: 2; width: 100%; min-width: 0; }
  .upp-tb-rg-meta { grid-column: 1; grid-row: 3; justify-self: start; }
  .upp-tb-rg-onlyon { grid-column: 2; grid-row: 3; justify-self: end; }
  .upp-footer {
    flex-direction: column; align-items: stretch; gap: 7px;
    padding: 9px 12px;
  }
  .upp-modal.is-resizable .upp-footer {
    padding-right: 30px;
  }
  .upp-foot-status { width: 100%; }
  .upp-foot-actions { display: flex; width: 100%; gap: 7px; }
  .upp-foot-actions .upp-btn { flex: 1; min-width: 0; }
  .upp-drawer-foot { padding: 8px 12px; flex-wrap: wrap; }
  .upp-drawer.is-fixed-box, .upp-drawer.is-fixed-sm { width: 100%; height: min(560px, 100%); }
  .upp-mobile-only { display: inline; }
  .upp-snap-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .upp-snap-actions .upp-spacer { display: none; }
  .upp-snap-actions .upp-btn.icon-only { width: 100%; padding: 0 8px; }
  .upp-bind-strip.is-confirm { flex-wrap: wrap; }
  .upp-bind-strip.is-confirm > span:first-child { flex: 1 1 220px; }
  .upp-bind-strip.is-confirm > .upp-row-nowrap { margin-left: auto; }
  .upp-check-grid { grid-template-columns: minmax(0, 1fr); }
  .upp-ps-inherit-sel { max-width: 115px; }

  .upp-modal.is-compact-h .upp-toolbar {
    grid-template-rows: 26px 26px 26px;
    gap: 4px;
    padding: 3px 10px;
    height: 94px;
  }
  .upp-modal.is-compact-h .upp-foot-status {
    display: none;
  }
}

@container plugin-win (max-width: 420px) {
  .upp-header { padding: 8px 10px; gap: 6px; }
  .upp-title { font-size: 13.5px; }
  .upp-ctx-chip { max-width: 52px; font-size: 10.5px; padding: 1px 6px; }
  .upp-head-actions { gap: 3px; }
  #upp-theme-select { max-width: 62px; height: 26px; padding: 0 14px 0 5px; font-size: 11px; }
  #upp-fab-vis-btn { height: 26px; padding: 0 6px; font-size: 11px; }
  .upp-header .upp-btn.icon-only { width: 25px; height: 25px; }
  .upp-tabs { padding: 7px 12px; gap: 4px; }
  .upp-tab { padding: 0 9px; font-size: 12px; }
  .upp-body { padding: 10px 12px 12px; }
}

@container plugin-win (max-width: 355px) {
  .upp-ctx-chip { display: none; }
  #upp-theme-select { max-width: 56px; font-size: 10.5px; }
  #upp-fab-vis-btn { padding: 0 5px; font-size: 10.5px; }
  .upp-header .upp-btn.icon-only { width: 24px; height: 24px; }
}

@media (max-width: 640px) {
  .upp-backdrop { padding: 0; align-items: flex-end; }
  .upp-modal:not(.is-floating):not(.is-mini) {
    width: 100vw;
    height: 88dvh;
    border-radius: 18px 18px 0 0;
    border-bottom: none;
  }
  .upp-modal:not(.is-floating):not(.is-mini) .upp-footer {
    padding-bottom: calc(9px + env(safe-area-inset-bottom, 0px));
  }
  .upp-modal:not(.is-floating):not(.is-mini) .upp-drawer-foot {
    padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
  }
  .upp-modal:not(.is-floating):not(.is-mini) .upp-drawer.is-full .upp-drawer-head {
    padding-top: calc(11px + env(safe-area-inset-top, 0px));
  }
  .upp-modal:not(.is-floating):not(.is-mini) .upp-resize-handle { display: none; }
  .upp-modal:not(.is-floating):not(.is-mini) .upp-header { cursor: default; touch-action: auto; }
}

/* Floating Quick-Switch Ball & Popover (inherits theme palette from .upp-fab-root) */
.upp-wb-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 5px 6px 3px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--muted);
  min-width: 0;
}
.upp-wb-sec-head > .upp-row-nowrap { flex: 1; min-width: 0; }
.upp-wb-sec-head > .upp-row-nowrap > span:not(.upp-wb-dot):not(.upp-badge) {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.upp-wb-sec-head > .upp-pill { flex-shrink: 0; }
.upp-wb-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.upp-fab {
  position: fixed;
  z-index: 2147482000;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--accent);
  backdrop-filter: blur(18px) saturate(150%);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
  box-shadow: var(--shadow);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  touch-action: none;
  user-select: none;
  transition: transform 0.14s ease, box-shadow 0.14s ease;
}
.upp-fab:hover { transform: scale(1.06); }
.upp-fab.is-dragging { cursor: grabbing; transform: scale(1.08); transition: none; }
.upp-fab-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 0 2px var(--bg);
}
.upp-fab-pop {
  position: fixed;
  z-index: 2147483001;
  width: min(296px, calc(100vw - 24px));
  max-height: min(410px, 72dvh, calc(100dvh - 24px));
  background: var(--bg);
  backdrop-filter: blur(22px) saturate(150%);
  -webkit-backdrop-filter: blur(22px) saturate(150%);
  border: 1px solid var(--border);
  border-radius: 15px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.upp-fab-pop-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 11px;
  border-bottom: 1px solid var(--border);
  font-size: 12.5px;
  font-weight: 600;
}
.upp-fab-pop-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.upp-fab-pop-list::-webkit-scrollbar { width: 4px; }
.upp-fab-pop-list::-webkit-scrollbar-thumb { background: rgba(120, 132, 154, 0.35); border-radius: 999px; }
.upp-fab-snap-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 6px 6px 9px;
  border-radius: 9px;
  border: 1px solid transparent;
  background: var(--surface);
  transition: background 0.12s, border-color 0.12s;
}
.upp-fab-snap-row:hover { background: var(--surface-hover); border-color: var(--border); }
.upp-fab-snap-row.is-bound { border-color: var(--accent); background: var(--accent-soft); }
.upp-fab-snap-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  padding: 1px 0;
  border: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.upp-fab-snap-top {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.upp-fab-snap-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 580; }
.upp-fab-snap-note {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
.upp-fab-apply-btn {
  height: 26px;
  padding: 0 9px;
  border-radius: 7px;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--accent-text);
  font: inherit;
  font-size: 11.5px;
  font-weight: 550;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  white-space: nowrap;
  transition: filter 0.12s;
}
.upp-fab-apply-btn:hover { filter: brightness(1.08); }
.upp-fab-pop-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-top: 1px solid var(--border);
}
.upp-fab-pop-foot .upp-btn { flex: 1; height: 29px; font-size: 11.5px; padding: 0 8px; }
.upp-restore-pill {
  position: fixed;
  z-index: 2147482002;
  height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: var(--bg);
  color: var(--text);
  box-shadow: var(--shadow);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
  white-space: nowrap;
  max-width: calc(100vw - 24px);
  pointer-events: auto;
  transition: border-color 0.14s, background 0.14s;
}
.upp-restore-pill:hover {
  border-color: var(--accent);
  background: var(--surface-strong);
}
`;

// =========================
// Extension Runtime Initialization
// =========================

function initExtension() {
  // Detach all previous listeners, timers, and DOM instances on re-init
  if (typeof activeCleanup === 'function') {
    try { activeCleanup(); } catch (_) {}
    activeCleanup = null;
  }
  document.getElementById(HOST_ID)?.remove();
  document.getElementById(MENU_ENTRY_ID)?.remove();
  document.getElementById(SETTINGS_BOX_ID)?.remove();
  ensureStylesheetCacheBust();

  const ac = new AbortController();
  const state = {
    open: false,
    tab: 'snapshots', // snapshots | user | worldbook | preset | regex
    store: loadStore(),
    charInfo: { id: '', name: '' },
    chatId: '',

    snapGroup: '',
    snapSearch: '',
    snapBatchMode: false,
    snapSelectedIds: new Set(),
    snapBatchConfirm: false,
    snapPendingDeleteId: '',

    personas: [],
    currentPersona: null,
    userSearch: '',

    worldbooks: [],
    globalWorldbooks: [],
    charWorldbooks: { primary: null, additional: [] },
    chatWorldbook: null,
    activeBook: '',
    bookEntriesCache: new Map(),
    wbEntrySearch: '',
    wbOnlyOn: false,
    wbAllOffConfirm: false,
    expandedWbUids: new Set(),
    wbHygieneCursor: 0,

    presets: [],
    loadedPresetName: '',
    livePresetNorm: { prompts: [], groups: [], groupsById: {}, promptGroupMap: {} },
    presetSearch: '',
    presetOnlyOn: false,
    presetFoldState: {},
    expandedPresetIds: new Set(),
    apiProfiles: [],

    regexScope: 'global',
    regexList: [],
    regexSearch: '',
    regexOnlyOn: false,

    lastPresetSyncUndo: null,
    drawer: null,
    minimized: false,
  };

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${STYLE_CSS}</style>
<div class="upp-fab-root" id="upp-fab-root">
  <button type="button" class="upp-fab" id="upp-fab-btn" title="快捷切换快照" aria-label="快捷切换快照">
    ${ICONS.camera}
    <span class="upp-fab-dot" id="upp-fab-dot" hidden></span>
  </button>
  <div class="upp-fab-pop" id="upp-fab-pop" hidden></div>
</div>
<button type="button" class="upp-restore-pill" id="upp-restore-pill" hidden title="恢复快照管家面板">
  ${ICONS.camera}<span>快照管家 · 点击恢复</span>
</button>
<div class="upp-backdrop" hidden>
  <div class="upp-modal" role="dialog" aria-modal="true" aria-label="快照管家">
    <div class="upp-header">
      <div class="upp-title-wrap">
        <span class="upp-title">快照管家</span>
        <span class="upp-ctx-chip" id="upp-ctx-chip" hidden></span>
      </div>
      <div class="upp-head-actions">
        <select class="upp-select" id="upp-theme-select" title="切换面板配色">
          <option value="paper">素纸</option>
          <option value="ink">青岚</option>
          <option value="warm">暖砂</option>
          <option value="sakura">淡樱</option>
          <option value="host">跟随酒馆</option>
          <option value="glass-dark">深色夜间</option>
        </select>
        <button class="upp-btn" id="upp-fab-vis-btn" title="显示或隐藏悬浮球">悬浮球</button>
        <button class="upp-btn icon-only" id="upp-refresh-btn" title="刷新">${ICONS.refresh}</button>
        <button class="upp-btn icon-only" id="upp-mini-btn" title="小窗对照" aria-pressed="false">${ICONS.miniWindow}</button>
        <button class="upp-btn icon-only" id="upp-min-btn" title="收起为角落恢复条">${ICONS.minimize}</button>
        <button class="upp-btn icon-only" id="upp-close-btn" title="关闭">${ICONS.close}</button>
      </div>
    </div>
    <div class="upp-tabs" id="upp-tabs"></div>
    <div class="upp-toolbar" id="upp-toolbar"></div>
    <div class="upp-body" id="upp-body"></div>
    <div class="upp-footer" id="upp-footer"></div>
    <div class="upp-drawer-mask" id="upp-drawer-mask" hidden></div>
    <div class="upp-resize-handle" id="upp-resize-handle" title="拖拽调整大小" aria-hidden="true">${ICONS.resizeGrip}</div>
  </div>
</div>`;

  const elFabRoot = shadow.getElementById('upp-fab-root');
  const elFabBtn = shadow.getElementById('upp-fab-btn');
  const elFabDot = shadow.getElementById('upp-fab-dot');
  const elFabPop = shadow.getElementById('upp-fab-pop');
  const elRestorePill = shadow.getElementById('upp-restore-pill');
  const elFabVisBtn = shadow.getElementById('upp-fab-vis-btn');
  const elThemeSelect = shadow.getElementById('upp-theme-select');
  const elBackdrop = shadow.querySelector('.upp-backdrop');
  const elModal = shadow.querySelector('.upp-modal');
  const elHeader = shadow.querySelector('.upp-header');
  const elMiniBtn = shadow.getElementById('upp-mini-btn');
  const elMinBtn = shadow.getElementById('upp-min-btn');
  const elResizeHandle = shadow.getElementById('upp-resize-handle');
  const elCtxChip = shadow.getElementById('upp-ctx-chip');
  const elTabs = shadow.getElementById('upp-tabs');
  const elToolbar = shadow.getElementById('upp-toolbar');
  const elBody = shadow.getElementById('upp-body');
  const elFooter = shadow.getElementById('upp-footer');
  const elDrawerMask = shadow.getElementById('upp-drawer-mask');

  function getCachedBookEntries(bookName) {
    if (!bookName || !state.bookEntriesCache.has(bookName)) return null;
    const list = state.bookEntriesCache.get(bookName);
    state.bookEntriesCache.delete(bookName);
    state.bookEntriesCache.set(bookName, list);
    return list;
  }

  function setCachedBookEntries(bookName, list) {
    if (!bookName) return;
    if (state.bookEntriesCache.has(bookName)) {
      state.bookEntriesCache.delete(bookName);
    } else if (state.bookEntriesCache.size >= MAX_BOOK_CACHE) {
      const oldestKey = state.bookEntriesCache.keys().next().value;
      if (oldestKey !== undefined) state.bookEntriesCache.delete(oldestKey);
    }
    state.bookEntriesCache.set(bookName, Array.isArray(list) ? list : []);
  }

  async function ensureBookEntries(bookName, force) {
    if (!bookName) return [];
    if (!force) {
      const cached = getCachedBookEntries(bookName);
      if (Array.isArray(cached)) return cached;
    }
    const list = await Host.getWorldbookEntries(bookName);
    setCachedBookEntries(bookName, list);
    return list;
  }

  let backfillScheduled = false;
  let backfillIdleId = null;
  function scheduleBackfillOnce() {
    if (backfillScheduled) return;
    backfillScheduled = true;
    const run = () => {
      backfillIdleId = null;
      try { backfillSnapshotPresetNames(); } catch (_) {}
    };
    if (typeof window.requestIdleCallback === 'function') {
      backfillIdleId = window.requestIdleCallback(run, { timeout: 1500 });
    } else {
      backfillIdleId = window.setTimeout(run, 400);
    }
  }

  async function refreshAll(forceBookReload) {
    state.store = loadStore();
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
    if (forceBookReload && state.tab !== 'worldbook') {
      state.bookEntriesCache.clear();
    } else if (state.activeBook && state.tab === 'worldbook') {
      await ensureBookEntries(state.activeBook, !!forceBookReload);
    }

    state.presets = Host.listPresets();
    state.loadedPresetName = Host.getLoadedPresetName();
    state.livePresetNorm = Host.getLiveNormalizedPreset();
    state.apiProfiles = Host.listConnectionProfiles();
    scheduleBackfillOnce();
    if (state.tab === 'regex') {
      state.regexList = await Host.getRegexes(state.regexScope);
    }

    render();
  }

  // =========================
  // Main Tab Renderers
  // =========================

  function renderHeader() {
    const label = state.charInfo.name || (state.currentPersona ? state.currentPersona.name : '');
    if (label) { elCtxChip.textContent = label; elCtxChip.hidden = false; }
    else { elCtxChip.hidden = true; }
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
      : `<span>${escapeHtml(parts.join(' · ') || '调好状态后随时保存为快照')}</span>`;

    elFooter.innerHTML = `
      <div class="upp-foot-status">${statusHtml}</div>
      <div class="upp-foot-actions">
        ${boundSnap ? `<button class="upp-btn" id="upp-foot-update-btn" data-snap-update="${boundSnap.id}">更新当前快照</button>` : ''}
        <button class="upp-btn primary" id="upp-foot-save-snap-btn">${ICONS.camera}<span>保存快照</span></button>
      </div>
    `;
  }

  function renderSnapshotsToolbar() {
    const snaps = state.store.snapshots;
    const groups = Array.from(new Set(snaps.map(s => s.group).filter(Boolean)));
    if (state.snapGroup && !groups.includes(state.snapGroup)) state.snapGroup = '';
    const autoOn = !!state.store.settings.autoApplyBindings;

    elToolbar.innerHTML = `
      <div class="upp-row upp-tb-split">
        <div class="upp-input-wrap upp-tb-search">
          ${ICONS.search}
          <input type="text" id="upp-snap-search" placeholder="搜索快照名称或分组…" value="${escapeHtml(state.snapSearch)}" />
        </div>
        <div class="upp-tb-actions">
          <label class="upp-switch-label" title="切换聊天或角色时自动切回绑定快照">
            <span>自动切换</span>
            <button type="button" class="upp-switch" id="upp-auto-bind-sw" role="switch" aria-checked="${autoOn}"></button>
          </label>
          <button class="upp-btn ${state.snapBatchMode ? 'active' : ''}" id="upp-snap-batch-btn">${state.snapBatchMode ? '退出批量' : '批量管理'}</button>
          <button class="upp-btn" id="upp-snap-preset-sync-btn" title="同步新增预设条目开关或将旧预设版本快照一键升级迁移到新版本">预设同步</button>
          <button class="upp-btn" id="upp-backup-btn">${ICONS.backup}<span>备份</span></button>
        </div>
      </div>
      <div class="upp-pill-strip upp-tb-row3">
        <button class="upp-pill ${state.snapGroup === '' ? 'active' : ''}" data-snap-group="">全部 (${snaps.length})</button>
        ${groups.map(g => `<button class="upp-pill ${state.snapGroup === g ? 'active' : ''}" data-snap-group="${escapeHtml(g)}">${escapeHtml(g)}</button>`).join('')}
      </div>
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
    if (state.snapBatchMode) {
      const shownIds = filtered.map(s => s.id);
      const allSelected = shownIds.length > 0 && shownIds.every(id => state.snapSelectedIds.has(id));
      const selCount = state.snapSelectedIds.size;
      html += `
        <div class="upp-bind-strip ${state.snapBatchConfirm ? 'is-confirm' : ''}" style="${state.snapBatchConfirm ? 'background:var(--danger-soft);border-color:color-mix(in srgb, var(--danger) 35%, transparent);' : ''}">
          ${state.snapBatchConfirm ? `
            <span>确认永久删除选中的 <strong>${selCount}</strong> 份快照？删除后无法恢复。</span>
            <div class="upp-row-nowrap">
              <button type="button" class="upp-btn danger" id="upp-batch-del-confirm">确认删除</button>
              <button type="button" class="upp-btn" id="upp-batch-del-cancel">取消</button>
            </div>
          ` : `
            <span>批量删除模式 · 已选 <strong>${selCount}</strong> / ${filtered.length}</span>
            <div class="upp-row-nowrap">
              <button type="button" class="upp-btn" id="upp-batch-select-all">${allSelected ? '取消全选' : '全选当前'}</button>
              <button type="button" class="upp-btn danger" id="upp-batch-del-btn" ${selCount ? '' : 'disabled'}>删除已选 (${selCount})</button>
            </div>
          `}
        </div>
      `;
    } else if (boundSnap) {
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
          <span>${snaps.length ? '没有匹配的快照' : '在上方各页调好 User、世界书、预设与正则后，点右下角「保存快照」即可记录'}</span>
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
        if (Array.isArray(s.worldbooks.deletedBooks) && s.worldbooks.deletedBooks.length) {
          scopeBadges.push(`<span class="upp-badge warn">含已删书 ${s.worldbooks.deletedBooks.length}</span>`);
        }
      }
      if (s.scope.preset && s.preset) {
        scopeBadges.push(`<span class="upp-badge">预设: ${escapeHtml(s.preset.name || '当前')}</span>`);
      }
      if (s.scope.api && s.api) {
        const apiLabel = s.api.profileName || s.api.model || s.api.source || 'API';
        scopeBadges.push(`<span class="upp-badge">API: ${escapeHtml(apiLabel)}</span>`);
      }
      if (s.scope.regex && s.regex) {
        scopeBadges.push(`<span class="upp-badge">正则</span>`);
      }
      const isChatBound = state.chatId && state.store.bindings.chats[state.chatId] === s.id;
      const isCharBound = state.charInfo.id && state.store.bindings.characters[state.charInfo.id] === s.id;
      const isChecked = state.snapSelectedIds.has(s.id);
      const isPendingDelete = state.snapPendingDeleteId === s.id;

      return `
        <div class="upp-card" style="${state.snapBatchMode && isChecked ? 'border-color:var(--accent);background:var(--surface-strong);' : ''}">
          <div class="upp-card-head">
            <div class="upp-row-nowrap">
              ${state.snapBatchMode ? `<input type="checkbox" data-snap-batch-check="${s.id}" ${isChecked ? 'checked' : ''} style="accent-color:var(--accent);margin:0;cursor:pointer;" />` : ''}
              <span class="upp-card-title">${escapeHtml(s.name)}</span>
              ${s.group ? `<span class="upp-badge">${escapeHtml(s.group)}</span>` : ''}
              ${isChatBound ? `<span class="upp-badge ok">本聊天</span>` : ''}
              ${isCharBound ? `<span class="upp-badge ok">本角色</span>` : ''}
            </div>
            <span class="upp-card-meta">${formatTimeShort(s.updatedAt)}</span>
          </div>
          <div class="upp-card-meta">${scopeBadges.join('')}</div>
          ${s.note ? `<div class="upp-card-meta">${escapeHtml(s.note)}</div>` : ''}
          ${state.snapBatchMode ? '' : isPendingDelete ? `
            <div class="upp-bind-strip is-confirm" style="background:var(--danger-soft);border-color:color-mix(in srgb, var(--danger) 35%, transparent);">
              <span>确认删除此快照？删除后无法恢复。</span>
              <div class="upp-row-nowrap">
                <button type="button" class="upp-btn danger" data-snap-del-confirm="${s.id}">确认删除</button>
                <button type="button" class="upp-btn" data-snap-del-cancel>取消</button>
              </div>
            </div>
          ` : `
            <div class="upp-snap-actions">
              <button class="upp-btn primary" data-snap-apply="${s.id}">应用</button>
              <button class="upp-btn" data-snap-view="${s.id}">${ICONS.eye}<span>查看</span></button>
              <button class="upp-btn" data-snap-edit="${s.id}">${ICONS.edit}<span>编辑</span></button>
              <button class="upp-btn" data-snap-update="${s.id}">覆盖更新</button>
              <button class="upp-btn" data-snap-bind="${s.id}">${ICONS.link}<span>绑定</span></button>
              <div class="upp-spacer"></div>
              <button class="upp-btn icon-only danger" data-snap-del="${s.id}" title="删除快照">${ICONS.trash}<span class="upp-mobile-only">删除</span></button>
            </div>
          `}
        </div>
      `;
    }).join('');

    elBody.innerHTML = html;
  }

  function renderUserToolbar() {
    const curP = state.currentPersona;
    const pVersions = curP ? (state.store.personaVersions[curP.avatar_id] || []) : [];
    const dupGroups = detectProliferatedPersonas(state.personas);
    const personaOptions = state.personas.map(p =>
      `<option value="${escapeHtml(p.avatar_id)}" ${curP && p.avatar_id === curP.avatar_id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('');

    elToolbar.innerHTML = `
      <div class="upp-row upp-tb-user-top">
        <div class="upp-tb-u-primary">
          <select class="upp-select" id="upp-persona-select" title="切换当前 User">${personaOptions || '<option value="">无可用 User</option>'}</select>
          <button class="upp-btn" id="upp-persona-rename-btn" ${curP ? '' : 'disabled'} title="原地修改当前 User 名字，不新增分身">改名</button>
          <button class="upp-btn" id="upp-persona-edit-btn" ${curP ? '' : 'disabled'}>${ICONS.edit}<span>编辑正文</span></button>
        </div>
        <div class="upp-tb-u-secondary">
          <button class="upp-btn" id="upp-persona-savever-btn" ${curP ? '' : 'disabled'}>${ICONS.plus}<span>存为版本</span></button>
          <button class="upp-btn" id="upp-persona-diff-btn" ${curP && pVersions.length ? '' : 'disabled'}>${ICONS.diff}<span>对比</span></button>
          <button class="upp-btn ${dupGroups.length ? 'active' : ''}" id="upp-persona-merge-btn" title="将同名或换姓分身收回为内部版本">${ICONS.merge}<span>整理分身${dupGroups.length ? ' ' + dupGroups.length : ''}</span></button>
        </div>
      </div>
      <div class="upp-row upp-tb-u-search-row">
        <div class="upp-input-wrap">
          ${ICONS.search}
          <input type="text" id="upp-user-search" placeholder="搜索 User 名称、内部版本名或正文关键词…" value="${escapeHtml(state.userSearch)}" />
        </div>
        <button class="upp-btn" id="upp-user-search-clear-btn" ${state.userSearch ? '' : 'hidden'}>清空</button>
      </div>
    `;
  }

  function makeMatchedSnippet(text, rawQuery) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return '空描述';
    const q = normalizeText(rawQuery);
    if (!q) return clean.slice(0, 72);
    const idx = normalizeText(clean).indexOf(q);
    if (idx < 0) return clean.slice(0, 72);
    const start = Math.max(0, idx - 18);
    const end = Math.min(clean.length, start + 76);
    return (start > 0 ? '…' : '') + clean.slice(start, end) + (end < clean.length ? '…' : '');
  }

  function renderUserBody() {
    const curP = state.currentPersona;
    if (!curP) { elBody.innerHTML = `<div class="upp-empty">未读取到当前 User 人设</div>`; return; }

    const pVersions = state.store.personaVersions[curP.avatar_id] || [];
    const matchedVer = findMatchingPersonaVersion(state.store, curP.avatar_id, curP.description, curP.name);
    const liveDesc = String(curP.description || '');
    const q = normalizeText(state.userSearch);

    let html = '';

    if (q) {
      const matchedPersonas = state.personas.filter(p =>
        normalizeText(`${p.name} ${p.description} ${p.lorebook}`).includes(q)
      );
      const matchedVersions = pVersions.filter(v =>
        normalizeText(`${v.name} ${v.displayName || ''} ${v.description} ${v.lorebook || ''}`).includes(q)
      );

      if (!matchedPersonas.length && !matchedVersions.length) {
        elBody.innerHTML = `<div class="upp-empty">未找到包含「${escapeHtml(state.userSearch)}」的 User 或内部版本</div>`;
        return;
      }

      if (matchedPersonas.length) {
        html += `
          <div class="upp-sec-title" style="padding: 2px 2px;">
            <span>匹配的 User 人设</span>
            <span>${matchedPersonas.length} 个</span>
          </div>
          <div class="upp-entry-list">
            ${matchedPersonas.map(p => {
              const isCurP = p.avatar_id === curP.avatar_id;
              return `
                <div class="upp-entry-row ${isCurP ? 'is-on' : ''}">
                  <button class="upp-entry-main" data-user-switch-id="${escapeHtml(p.avatar_id)}">
                    <div class="upp-entry-text">
                      <div class="upp-entry-title-row">
                        <span class="upp-entry-name">${escapeHtml(p.name)}</span>
                        ${isCurP ? '<span class="upp-badge accent upp-keep">当前 User</span>' : ''}
                      </div>
                      <div class="upp-entry-preview">${escapeHtml(makeMatchedSnippet(p.description, state.userSearch))}</div>
                    </div>
                  </button>
                  <button class="upp-btn ${isCurP ? '' : 'primary'}" data-user-switch-id="${escapeHtml(p.avatar_id)}" ${isCurP ? 'disabled' : ''}>${isCurP ? '当前' : '切换'}</button>
                </div>
              `;
            }).join('')}
          </div>
        `;
      }

      if (matchedVersions.length) {
        html += `
          <div class="upp-sec-title" style="padding: 4px 2px 2px;">
            <span>当前 User 匹配的内部版本</span>
            <span>${matchedVersions.length} 个</span>
          </div>
          <div class="upp-entry-list">
            ${matchedVersions.map(v => {
              const nameMatches = !v.displayName || v.displayName === curP.name;
              const isCur = matchedVer && matchedVer.id === v.id && nameMatches;
              const dnTag = v.displayName ? `<span class="upp-badge">名字: ${escapeHtml(v.displayName)}</span>` : '';
              return `
                <div class="upp-entry-row ${isCur ? 'is-on' : ''}">
                  <button class="upp-entry-main" data-pv-view="${v.id}">
                    <div class="upp-entry-text">
                      <div class="upp-entry-title-row">
                        <span class="upp-entry-name">${escapeHtml(v.name)}</span>
                        ${dnTag}
                        ${isCur ? '<span class="upp-badge accent upp-keep">使用中</span>' : ''}
                      </div>
                      <div class="upp-entry-preview">${escapeHtml(makeMatchedSnippet(v.description, state.userSearch))}</div>
                    </div>
                  </button>
                  <button class="upp-btn ${isCur ? '' : 'primary'}" data-pv-apply="${v.id}" ${isCur ? 'disabled' : ''}>${isCur ? '当前' : '切换'}</button>
                  <button class="upp-btn icon-only danger" data-pv-del-inline="${v.id}" title="删除版本">${ICONS.trash}</button>
                </div>
              `;
            }).join('')}
          </div>
        `;
      }

      elBody.innerHTML = html;
      return;
    }

    html = `
      <div class="upp-card">
        <div class="upp-card-head">
          <div class="upp-row-nowrap">
            <span class="upp-card-title">${escapeHtml(curP.name)}</span>
            ${matchedVer ? `<span class="upp-badge accent">${escapeHtml(matchedVer.name)}</span>` : '<span class="upp-badge">当前实时</span>'}
          </div>
          <span class="upp-card-meta">${liveDesc.length} 字</span>
        </div>
        ${curP.lorebook ? `<div class="upp-card-meta"><span class="upp-badge">绑定世界书: ${escapeHtml(curP.lorebook)}</span></div>` : ''}
        <div class="upp-persona-live-box ${liveDesc.trim() ? '' : 'is-empty'}" id="upp-persona-preview-box">${escapeHtml(liveDesc.trim() ? liveDesc : '暂无描述，点击编辑')}</div>
      </div>
      <div class="upp-sec-title" style="padding: 2px 2px;">
        <span>内部描述版本 · 可绑定不同名字并在切换时原地改名</span>
        <span>${pVersions.length} 个</span>
      </div>
    `;

    if (!pVersions.length) {
      html += `<div class="upp-empty" style="padding: 24px 16px;">还没有保存过「${escapeHtml(curP.name)}」的内部版本，点上方「存为版本」或「整理分身」即可收纳。</div>`;
      elBody.innerHTML = html;
      return;
    }

    html += `<div class="upp-entry-list">` + pVersions.map(v => {
      const nameMatches = !v.displayName || v.displayName === curP.name;
      const isCur = matchedVer && matchedVer.id === v.id && nameMatches;
      const snippet = String(v.description || '').replace(/\s+/g, ' ').trim().slice(0, 72);
      const dnTag = v.displayName ? `<span class="upp-badge">名字: ${escapeHtml(v.displayName)}</span>` : '';
      return `
        <div class="upp-entry-row ${isCur ? 'is-on' : ''}">
          <button class="upp-entry-main" data-pv-view="${v.id}">
            <div class="upp-entry-text">
              <div class="upp-entry-title-row">
                <span class="upp-entry-name">${escapeHtml(v.name)}</span>
                ${dnTag}
                ${isCur ? '<span class="upp-badge accent upp-keep">使用中</span>' : ''}
              </div>
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

  function renderWorldbookToolbar() {
    const activeBook = state.activeBook;
    const isPinned = activeBook && state.store.settings.pinnedWorldbooks.includes(activeBook);
    const isGlobal = activeBook && state.globalWorldbooks.includes(activeBook);
    const org = getOrganizerSettings();
    const hasOrg = !!org;
    const bookFmt = activeBook ? formatWorldbookDisplay(activeBook, org, buildCombinedCharNameMap(org)) : null;
    const bookLabel = bookFmt ? bookFmt.primary : '选择世界书';
    const bookTitle = bookFmt ? (bookFmt.subtitle ? `${bookFmt.primary} (${bookFmt.subtitle})` : bookFmt.primary) : '选择或搜索世界书';

    elToolbar.innerHTML = `
      <div class="upp-row upp-tb-wb-row1">
        <div class="upp-tb-wb-p1">
          <button class="upp-btn upp-book-trigger" id="upp-book-picker-btn" title="${escapeHtml(bookTitle)}">
            <span>${escapeHtml(bookLabel)}</span>
            ${ICONS.chevron}
          </button>
          <button class="upp-btn icon-only ${isPinned ? 'pinned' : ''}" id="upp-pin-book-btn" title="${isPinned ? '取消置顶' : '置顶常用世界书'}" ${activeBook ? '' : 'disabled'}>${isPinned ? ICONS.starFill : ICONS.star}</button>
          <button class="upp-btn ${isGlobal ? 'active' : ''}" id="upp-global-book-btn" title="开启后对所有角色和聊天生效" ${activeBook ? '' : 'disabled'}>${isGlobal ? '已全局启用' : '全局启用'}</button>
          ${hasOrg ? `<button class="upp-btn" id="upp-open-wbo-btn" title="直达世界书整理面板">整理分组</button>` : ''}
        </div>
        <div class="upp-spacer"></div>
        <div class="upp-tb-wb-p2">
          <button class="upp-btn" id="upp-new-wb-entry-btn" ${activeBook ? '' : 'disabled'}>${ICONS.plus}<span>新建条目</span></button>
          <button class="upp-btn icon-only" id="upp-copy-wb-btn" title="复制已开条目纯文本" ${activeBook ? '' : 'disabled'}>${ICONS.copy}</button>
        </div>
      </div>
      <div class="upp-row upp-tb-wb-row2">
        <div class="upp-input-wrap upp-tb-wb-search">
          ${ICONS.search}
          <input type="text" id="upp-wb-search" placeholder="搜索条目标题或正文…" value="${escapeHtml(state.wbEntrySearch)}" />
        </div>
        <div class="upp-tb-wb-filters">
          <button class="upp-btn ${state.wbOnlyOn ? 'active' : ''}" id="upp-wb-only-on-btn">只看已开</button>
          <button class="upp-btn" id="upp-wb-all-off-btn" ${activeBook ? '' : 'disabled'}>全关</button>
        </div>
      </div>
    `;
  }

  function renderWorldbookBody() {
    const activeBook = state.activeBook;
    if (!activeBook) { elBody.innerHTML = `<div class="upp-empty">酒馆中暂无世界书</div>`; return; }

    const entries = getCachedBookEntries(activeBook) || [];
    const onCount = entries.filter(e => e.enabled).length;
    const hygiene = inspectTagHygiene(entries);
    const q = normalizeText(state.wbEntrySearch);
    const filtered = entries.filter(e => {
      if (state.wbOnlyOn && !e.enabled) return false;
      if (q && !normalizeText((e.name || '') + ' ' + (e.content || '')).includes(q)) return false;
      return true;
    });

    let html = '';
    if (state.wbAllOffConfirm) {
      html += `
        <div class="upp-bind-strip is-confirm" style="background:var(--danger-soft);border-color:color-mix(in srgb, var(--danger) 35%, transparent);">
          <span>确认关闭「${escapeHtml(activeBook)}」全部 <strong>${onCount}</strong> 条已开条目？</span>
          <div class="upp-row-nowrap">
            <button type="button" class="upp-btn danger" id="upp-wb-all-off-confirm">确认全关</button>
            <button type="button" class="upp-btn" id="upp-wb-all-off-cancel">取消</button>
          </div>
        </div>
      `;
    }
    if (hygiene.unclosedCount > 0 || hygiene.duplicateTags.length > 0) {
      const notes = [];
      if (hygiene.unclosedCount > 0) notes.push(`${hygiene.unclosedCount} 条存在未闭合标签`);
      if (hygiene.duplicateTags.length > 0) {
        notes.push(`重复包裹标签：${hygiene.duplicateTags.map(d => '<' + d.tag + '>').join('、')}`);
      }
      html += `
        <div class="upp-card-meta" style="padding: 2px 4px;">
          <button type="button" class="upp-badge warn" id="upp-wb-jump-hygiene-btn" style="cursor:pointer;" title="点击直接定位并展开对应条目">
            ${ICONS.warn} <span>${escapeHtml(notes.join(' · '))} · 点击定位</span>
          </button>
        </div>
      `;
    }

    if (!filtered.length) {
      html += `<div class="upp-empty">${entries.length ? '没有匹配的条目' : '当前世界书暂无条目'}</div>`;
      elBody.innerHTML = html;
      return;
    }

    html += `<div class="upp-entry-list">` + filtered.map(e => {
      const uidKey = String(e.uid);
      const h = hygiene.byUid[uidKey];
      const warnList = h ? [
        h.unclosed.length ? '未闭合: ' + h.unclosed.join(', ') : '',
        h.duplicateTags.length ? '重复包裹: ' + h.duplicateTags.join(', ') : '',
      ].filter(Boolean) : [];
      const warnTag = warnList.length
        ? `<span class="upp-badge warn" title="${escapeHtml(warnList.join('；'))}">${ICONS.warn}</span>`
        : '';
      const snippet = String(e.content || '').replace(/\s+/g, ' ').trim().slice(0, 72);
      const isExpanded = state.expandedWbUids.has(uidKey);
      return `
        <div class="upp-entry-wrap ${isExpanded ? 'is-expanded' : ''}" data-wb-wrap="${escapeHtml(uidKey)}">
          <div class="upp-entry-row ${e.enabled ? 'is-on' : ''}" data-wb-row="${escapeHtml(uidKey)}">
            <button class="upp-entry-main" data-wb-open="${escapeHtml(uidKey)}">
              <span class="upp-entry-chev">${ICONS.chevron}</span>
              <span class="upp-dot ${e.strategyType}" title="${e.strategyType === 'constant' ? '蓝灯常驻' : e.strategyType === 'selective' ? '绿灯触发' : '向量'}"></span>
              <div class="upp-entry-text">
                <div class="upp-entry-name">${escapeHtml(e.name)}</div>
                <div class="upp-entry-preview">${escapeHtml(snippet || '空正文')}</div>
              </div>
              ${warnTag}
            </button>
            <button type="button" class="upp-switch" role="switch" aria-checked="${!!e.enabled}" data-wb-toggle="${escapeHtml(uidKey)}"></button>
          </div>
          ${isExpanded ? `
            <div class="upp-inline-panel" data-wb-panel="${escapeHtml(uidKey)}">
              <div class="upp-inline-meta">
                <span>顺序 ${e.order} · ${String(e.content || '').length} 字</span>
                ${warnList.length ? `<span class="upp-badge warn">${ICONS.warn} ${escapeHtml(warnList.join('；'))}</span>` : ''}
              </div>
              <div class="upp-row">
                <input type="text" class="upp-text-input" style="flex:1;min-width:140px;" data-wb-inline-name="${escapeHtml(uidKey)}" value="${escapeHtml(e.name || '')}" placeholder="条目名称" />
                <select class="upp-select" data-wb-inline-strategy="${escapeHtml(uidKey)}" style="max-width:140px;">
                  <option value="constant" ${e.strategyType === 'constant' ? 'selected' : ''}>蓝灯常驻</option>
                  <option value="selective" ${e.strategyType === 'selective' ? 'selected' : ''}>绿灯触发</option>
                </select>
              </div>
              <textarea class="upp-inline-textarea" data-wb-inline-content="${escapeHtml(uidKey)}">${escapeHtml(e.content || '')}</textarea>
              <div class="upp-inline-foot">
                <button type="button" class="upp-btn" data-wb-inline-copy="${escapeHtml(uidKey)}">${ICONS.copy}<span>复制</span></button>
                <button type="button" class="upp-btn" data-wb-inline-close="${escapeHtml(uidKey)}">收起</button>
                <button type="button" class="upp-btn primary" data-wb-inline-save="${escapeHtml(uidKey)}">保存</button>
              </div>
            </div>
          ` : ''}
        </div>
      `;
    }).join('') + `</div>`;

    elBody.innerHTML = html;
  }

  function isPresetGroupCollapsed(group) {
    const key = `${state.loadedPresetName}::${group.id}`;
    if (Object.prototype.hasOwnProperty.call(state.presetFoldState, key)) {
      return !!state.presetFoldState[key];
    }
    if (state.store.settings.presetGroupsDefaultCollapsed !== false) return true;
    return !!group.collapsed;
  }

  function renderPresetToolbar() {
    const presetOpts = state.presets.map(name =>
      `<option value="${escapeHtml(name)}" ${name === state.loadedPresetName ? 'selected' : ''}>${escapeHtml(name)}</option>`
    ).join('');
    const groups = state.livePresetNorm.groups || [];
    const anyExpanded = groups.some(g => !isPresetGroupCollapsed(g));
    const defFoldOn = state.store.settings.presetGroupsDefaultCollapsed !== false;

    elToolbar.innerHTML = `
      <div class="upp-row upp-tb-pr-row1">
        <div class="upp-tb-pr-p1">
          <select class="upp-select" id="upp-preset-select" title="切换预设">${presetOpts || '<option value="">无可用预设</option>'}</select>
          <button class="upp-btn" id="upp-preset-sync-btn" title="把当前预设的新增条目或更新后的开关批量同步或迁移到快照">同步到快照</button>
          <button class="upp-btn" id="upp-preset-save-disk-btn" title="将当前开关与分组状态写入预设文件">保存预设</button>
        </div>
        <div class="upp-spacer"></div>
        <div class="upp-tb-pr-fold">
          ${groups.length ? `<button class="upp-btn" id="upp-preset-fold-all-btn">${anyExpanded ? '全部折叠' : '全部展开'}</button>` : ''}
          ${groups.length ? `
            <label class="upp-switch-label" title="打开预设页或快照详情时，分组是否默认收起">
              <span>默认折叠</span>
              <button type="button" class="upp-switch" id="upp-preset-default-fold-sw" role="switch" aria-checked="${defFoldOn}"></button>
            </label>
          ` : ''}
        </div>
      </div>
      <div class="upp-row upp-tb-pr-row2">
        <div class="upp-input-wrap upp-tb-pr-search">
          ${ICONS.search}
          <input type="text" id="upp-preset-search" placeholder="搜索分组、提示词或正文…" value="${escapeHtml(state.presetSearch)}" />
        </div>
        <div class="upp-tb-pr-onlyon">
          <button class="upp-btn ${state.presetOnlyOn ? 'active' : ''}" id="upp-preset-only-on-btn">只看已开</button>
        </div>
      </div>
    `;
  }

  function renderPresetPromptRowHtml(p) {
    const isPh = p.marker || typeof p.content !== 'string';
    const roleShort = isPh ? '占位' : (p.role === 'user' ? 'USR' : p.role === 'assistant' ? 'AST' : 'SYS');
    const roleLabel = p.role === 'user' ? '用户' : p.role === 'assistant' ? 'AI' : '系统';
    const snippet = isPh ? '酒馆原生占位槽位' : String(p.content || '').replace(/\s+/g, ' ').trim().slice(0, 72);
    const isExpanded = !isPh && state.expandedPresetIds.has(p.id);
    const pid = escapeHtml(p.id);
    return `
      <div class="upp-entry-wrap ${isExpanded ? 'is-expanded' : ''}" data-pr-wrap="${pid}">
        <div class="upp-entry-row ${p.enabled ? 'is-on' : ''}" data-pr-row="${pid}">
          <button class="upp-entry-main" data-pr-open="${pid}" style="${isPh ? 'cursor:default;' : ''}">
            ${!isPh ? `<span class="upp-entry-chev">${ICONS.chevron}</span>` : ''}
            <span class="upp-role-tag ${isPh ? 'placeholder' : ''}">${roleShort}</span>
            <div class="upp-entry-text">
              <div class="upp-entry-name">${escapeHtml(p.name || p.id)}</div>
              <div class="upp-entry-preview">${escapeHtml(snippet || '空正文')}</div>
            </div>
          </button>
          <button type="button" class="upp-switch" role="switch" aria-checked="${!!p.enabled}" data-pr-toggle="${pid}"></button>
        </div>
        ${isExpanded ? `
          <div class="upp-inline-panel" data-pr-panel="${pid}">
            <div class="upp-inline-meta">
              <span>角色：${roleLabel}</span>
              <span>${String(p.content || '').length} 字</span>
            </div>
            <input type="text" class="upp-text-input" data-pr-inline-name="${pid}" value="${escapeHtml(p.name || '')}" placeholder="条目名称" />
            <textarea class="upp-inline-textarea" data-pr-inline-content="${pid}">${escapeHtml(p.content || '')}</textarea>
            <div class="upp-inline-foot">
              <button type="button" class="upp-btn" data-pr-inline-copy="${pid}">${ICONS.copy}<span>复制</span></button>
              <button type="button" class="upp-btn" data-pr-inline-close="${pid}">收起</button>
              <button type="button" class="upp-btn primary" data-pr-inline-save="${pid}">保存</button>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderPresetBody() {
    const { nodes } = buildPresetRenderNodes(state.livePresetNorm, {
      search: state.presetSearch,
      onlyOn: state.presetOnlyOn,
    });

    if (!nodes.length) {
      elBody.innerHTML = `<div class="upp-empty">${state.livePresetNorm.prompts.length ? '没有匹配的提示词' : '未能读取当前预设条目'}</div>`;
      return;
    }

    elBody.innerHTML = `<div class="upp-entry-list">` + nodes.map(node => {
      if (node.type === 'prompt') return renderPresetPromptRowHtml(node.prompt);
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

  function renderRegexToolbar() {
    const list = state.regexList || [];
    const onCount = list.filter(r => r.enabled).length;
    elToolbar.innerHTML = `
      <div class="upp-row upp-tb-rg-row1">
        <div class="upp-tb-rg-scopes">
          <button class="upp-btn ${state.regexScope === 'global' ? 'active' : ''}" data-rg-scope="global">全局</button>
          <button class="upp-btn ${state.regexScope === 'character' ? 'active' : ''}" data-rg-scope="character">当前角色</button>
          <button class="upp-btn ${state.regexScope === 'preset' ? 'active' : ''}" data-rg-scope="preset">当前预设</button>
        </div>
        <div class="upp-spacer"></div>
        <span class="upp-card-meta upp-tb-rg-meta">共 ${list.length} 条 · 已开 ${onCount} 条</span>
      </div>
      <div class="upp-row upp-tb-rg-row2">
        <div class="upp-input-wrap upp-tb-rg-search">
          ${ICONS.search}
          <input type="text" id="upp-rg-search" placeholder="搜索正则名称或规则…" value="${escapeHtml(state.regexSearch)}" />
        </div>
        <div class="upp-tb-rg-onlyon">
          <button class="upp-btn ${state.regexOnlyOn ? 'active' : ''}" id="upp-rg-only-on-btn">只看已开</button>
        </div>
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
              <div class="upp-entry-name">${escapeHtml(r.script_name)}</div>
              <div class="upp-entry-preview">${escapeHtml(r.find_regex)}</div>
            </div>
            ${dest ? `<span class="upp-badge">${dest}</span>` : ''}
          </button>
          <button type="button" class="upp-switch" role="switch" aria-checked="${!!r.enabled}" data-rg-toggle="${escapeHtml(r.id)}"></button>
        </div>
      `;
    }).join('') + `</div>`;
  }

  // =========================
  // Full-Size Grouped Snapshot Detail Viewer
  // =========================

  function renderSnapInspectPresetRow(item, d) {
    const isPh = item.marker || typeof item.content !== 'string';
    const roleShort = isPh ? '占位' : (item.role === 'user' ? 'USR' : item.role === 'assistant' ? 'AST' : 'SYS');
    const roleLabel = item.role === 'user' ? '用户' : item.role === 'assistant' ? 'AI' : '系统';
    const snippet = isPh ? '酒馆原生占位槽位' : String(item.content || '').replace(/\s+/g, ' ').trim().slice(0, 72);
    const isExpanded = !isPh && !!(d && d.expandedIds && d.expandedIds.has(item.id));
    const pid = escapeHtml(item.id);
    return `
      <div class="upp-entry-wrap ${isExpanded ? 'is-expanded' : ''}">
        <div class="upp-entry-row ${item.effectiveOn ? 'is-on' : 'is-off'}">
          <button class="upp-entry-main" data-view-snap-pr="${pid}" style="${isPh ? 'cursor:default;' : ''}">
            ${!isPh ? `<span class="upp-entry-chev">${ICONS.chevron}</span>` : ''}
            <span class="upp-dot ${item.effectiveOn ? 'snap-on' : 'snap-off'}" title="${item.effectiveOn ? '本快照中生效' : '本快照中关闭'}"></span>
            <span class="upp-role-tag ${isPh ? 'placeholder' : ''}">${roleShort}</span>
            <div class="upp-entry-text">
              <div class="upp-entry-title-row">
                <span class="upp-entry-name">${escapeHtml(item.name || item.id)}</span>
                ${item.statusNote ? `<span class="upp-badge warn upp-keep">${escapeHtml(item.statusNote)}</span>` : ''}
              </div>
              <div class="upp-entry-preview">${escapeHtml(snippet || '空正文')}</div>
            </div>
          </button>
          <button type="button" class="upp-switch" role="switch" aria-checked="${!!item.selfOn}" data-sv-pr-toggle="${pid}" title="切换此条目在本快照中的状态"></button>
        </div>
        ${isExpanded ? `
          <div class="upp-inline-panel">
            <div class="upp-inline-meta">
              <span>角色：${roleLabel}</span>
              <span>${String(item.content || '').length} 字</span>
            </div>
            <pre class="upp-inline-pre">${escapeHtml(item.content || '（空正文）')}</pre>
            <div class="upp-inline-foot">
              <button type="button" class="upp-btn" data-sv-pr-copy="${pid}">${ICONS.copy}<span>复制</span></button>
              <button type="button" class="upp-btn" data-sv-pr-close="${pid}">收起</button>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderViewSnapshotBody(d) {
    const bodyEl = shadow.getElementById('upp-snap-inspect-body');
    const metaEl = shadow.getElementById('upp-snap-inspect-meta');
    if (!bodyEl) return;

    const s = d.draft || d.snapshot;
    const sub = d.subTab;

    if (sub === 'preset' && s.scope.preset && s.preset) {
      const norm = d.presetNorm;
      if (!norm || !norm.prompts.length) {
        if (metaEl) metaEl.innerHTML = `<span class="upp-badge warn">预设「${escapeHtml(s.preset.name || '')}」未在酒馆中找到</span>`;
        bodyEl.innerHTML = `<div class="upp-empty">无法读取该预设的条目列表（预设可能已改名或删除）</div>`;
        return;
      }
      const model = buildSnapshotPresetInspectModel(s.preset, norm, {
        search: d.search || '',
        onlyOn: !!d.onlyOn,
      });
      if (metaEl) {
        metaEl.innerHTML = `
          <span class="upp-badge accent">预设：${escapeHtml(s.preset.name || '当前')}</span>
          <span class="upp-badge ok upp-keep">生效 ${model.effectiveOnTotal} / ${model.totalPrompts} 条</span>
          ${model.powerOffGroupCount ? `<span class="upp-badge warn upp-keep">${model.powerOffGroupCount} 组已关</span>` : ''}
          ${model.missingIds.length ? `<span class="upp-badge upp-keep">${model.missingIds.length} 条已从预设删除</span>` : ''}
        `;
      }
      if (!model.nodes.length) {
        bodyEl.innerHTML = `<div class="upp-empty">没有匹配的预设条目</div>`;
        return;
      }
      const defaultFold = state.store.settings.presetGroupsDefaultCollapsed !== false;
      let html = `<div class="upp-entry-list">` + model.nodes.map(node => {
        if (node.type === 'prompt') return renderSnapInspectPresetRow(node.prompt, d);
        const g = node.group;
        const collapsed = node.forceExpand
          ? false
          : (Object.prototype.hasOwnProperty.call(d.foldMap, g.id)
            ? !!d.foldMap[g.id]
            : (defaultFold ? true : node.effectiveOnCount === 0));
        const stateLabel = !g.enabled
          ? '整组已关'
          : node.effectiveOnCount === node.totalCount
            ? `全部开启 (${node.totalCount})`
            : `${node.effectiveOnCount}/${node.totalCount} 开启`;
        return `
          <div class="upp-group-box ${collapsed ? 'is-collapsed' : ''} ${g.enabled ? '' : 'is-disabled'}" data-sv-grp="${escapeHtml(g.id)}">
            <div class="upp-group-head">
              <button type="button" class="upp-group-toggle-btn" data-sv-fold="${escapeHtml(g.id)}">
                <span class="upp-group-chev">${ICONS.chevron}</span>
                <span class="upp-group-name">${escapeHtml(g.name)}</span>
                <span class="upp-badge ${!g.enabled ? 'warn' : (node.effectiveOnCount > 0 ? 'accent' : '')}">${escapeHtml(stateLabel)}</span>
              </button>
              <button type="button" class="upp-switch" role="switch" aria-checked="${!!g.enabled}" data-sv-grp-toggle="${escapeHtml(g.id)}" title="切换整组总开关，点右上角保存生效"></button>
            </div>
            <div class="upp-group-items">
              ${node.items.map(it => renderSnapInspectPresetRow(it, d)).join('')}
            </div>
          </div>
        `;
      }).join('') + `</div>`;
      bodyEl.innerHTML = html;
      return;
    }

    if (sub === 'worldbooks' && s.scope.worldbooks && s.worldbooks) {
      const entriesMap = s.worldbooks.entries || {};
      const bookNames = Object.keys(entriesMap);
      const q = normalizeText(d.search || '');
      if (metaEl) {
        metaEl.innerHTML = `
          <span class="upp-badge accent upp-keep">已录 ${bookNames.length} 本世界书</span>
          ${Array.isArray(s.worldbooks.global) ? `<span class="upp-badge upp-keep">全局绑定 ${s.worldbooks.global.length} 本</span>` : ''}
        `;
      }
      if (!bookNames.length) {
        bodyEl.innerHTML = `<div class="upp-empty">本快照仅记录全局世界书绑定，未录具体条目开关</div>`;
        return;
      }
      const liveBookSet = new Set(Host.listWorldbooks());
      const deletedSet = new Set(Array.isArray(s.worldbooks.deletedBooks) ? s.worldbooks.deletedBooks : []);
      const org = getOrganizerSettings();
      const charNameMap = buildCombinedCharNameMap(org);
      const blocks = bookNames.map(bk => {
        const fmt = formatWorldbookDisplay(bk, org, charNameMap);
        const map = entriesMap[bk] || {};
        const isMissingBook = deletedSet.has(bk) || !liveBookSet.has(bk);
        const liveList = d.wbDetails[bk] || [];
        const byUid = new Map(liveList.map(e => [String(e.uid), e]));
        const allUids = Object.keys(map);
        const onCount = allUids.filter(u => map[u]).length;
        const rows = allUids.filter(u => {
          if (d.onlyOn && !map[u]) return false;
          if (!q) return true;
          const live = byUid.get(u);
          return normalizeText(bk + ' ' + fmt.primary + ' ' + (live ? (live.name + ' ' + live.content) : u)).includes(q);
        });
        if (!rows.length) return '';
        const collapsed = !!q || d.onlyOn ? false : !!d.foldMap['wb::' + bk];
        const subHtml = fmt.subtitle ? `<span class="upp-wb-sub">${escapeHtml(fmt.subtitle)}</span>` : '';
        return `
          <div class="upp-group-box ${collapsed ? 'is-collapsed' : ''}" data-sv-grp="wb::${escapeHtml(bk)}">
            <div class="upp-group-head">
              <button type="button" class="upp-group-toggle-btn" data-sv-fold="wb::${escapeHtml(bk)}">
                <span class="upp-group-chev">${ICONS.chevron}</span>
                <span class="upp-group-name">${escapeHtml(fmt.primary)}${subHtml}</span>
                ${isMissingBook ? `<span class="upp-badge warn">已从酒馆删除</span>` : ''}
                <span class="upp-badge accent">${onCount}/${allUids.length} 开启</span>
              </button>
            </div>
            <div class="upp-group-items">
              ${rows.map(u => {
                const live = byUid.get(u);
                const on = !!map[u];
                const expKey = `wb::${bk}::${u}`;
                const canExpand = !!live && !!String(live.content || '').trim();
                const isExpanded = canExpand && !!(d.expandedIds && d.expandedIds.has(expKey));
                const snippet = live ? String(live.content || '').replace(/\s+/g, ' ').trim().slice(0, 72) : '该条目已从世界书删除';
                return `
                  <div class="upp-entry-wrap ${isExpanded ? 'is-expanded' : ''}">
                    <div class="upp-entry-row ${on ? 'is-on' : 'is-off'}">
                      <button class="upp-entry-main" data-view-snap-wb="${escapeHtml(bk)}" data-view-snap-uid="${escapeHtml(u)}" style="${canExpand ? '' : 'cursor:default;'}">
                        ${canExpand ? `<span class="upp-entry-chev">${ICONS.chevron}</span>` : ''}
                        <span class="upp-dot ${on ? 'snap-on' : 'snap-off'}"></span>
                        <div class="upp-entry-text">
                          <div class="upp-entry-name">${escapeHtml(live ? live.name : '已删除条目')}</div>
                          <div class="upp-entry-preview">${escapeHtml(snippet || '空正文')}</div>
                        </div>
                      </button>
                      <button type="button" class="upp-switch" role="switch" aria-checked="${on}" data-sv-wb-toggle="${escapeHtml(bk)}" data-sv-wb-uid="${escapeHtml(u)}"></button>
                    </div>
                    ${isExpanded ? `
                      <div class="upp-inline-panel">
                        <div class="upp-inline-meta">
                          <span>顺序 ${live.order} · ${String(live.content || '').length} 字</span>
                        </div>
                        <pre class="upp-inline-pre">${escapeHtml(live.content || '')}</pre>
                        <div class="upp-inline-foot">
                          <button type="button" class="upp-btn" data-sv-wb-copy="${escapeHtml(bk)}" data-sv-wb-copy-uid="${escapeHtml(u)}">${ICONS.copy}<span>复制</span></button>
                          <button type="button" class="upp-btn" data-sv-wb-close="${escapeHtml(expKey)}">收起</button>
                        </div>
                      </div>
                    ` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }).filter(Boolean).join('');
      bodyEl.innerHTML = blocks ? `<div class="upp-entry-list">${blocks}</div>` : `<div class="upp-empty">没有匹配的世界书条目</div>`;
      return;
    }

    if (sub === 'persona' && s.scope.persona && s.persona) {
      if (metaEl) {
        metaEl.innerHTML = `
          <span class="upp-badge accent">User：${escapeHtml(s.persona.name)}</span>
          ${s.persona.versionName ? `<span class="upp-badge">版本：${escapeHtml(s.persona.versionName)}</span>` : ''}
          ${s.persona.lorebook ? `<span class="upp-badge">绑定世界书：${escapeHtml(s.persona.lorebook)}</span>` : ''}
        `;
      }
      bodyEl.innerHTML = `
        <div class="upp-persona-live-box" style="max-height:none;cursor:default;">${escapeHtml(s.persona.description || '空描述')}</div>
      `;
      return;
    }

    if (sub === 'api' && s.scope.api && s.api) {
      const profiles = state.apiProfiles || Host.listConnectionProfiles();
      if (metaEl) {
        metaEl.innerHTML = `
          ${s.api.profileName ? `<span class="upp-badge accent">连接配置：${escapeHtml(s.api.profileName)}</span>` : ''}
          ${s.api.source ? `<span class="upp-badge">来源：${escapeHtml(s.api.source)}</span>` : ''}
          ${s.api.model ? `<span class="upp-badge">模型：${escapeHtml(s.api.model)}</span>` : ''}
        `;
      }
      bodyEl.innerHTML = `
        <div class="upp-card">
          <div class="upp-card-head"><span class="upp-card-title">当前快照记录的 API 连接</span></div>
          <div class="upp-card-meta">仅保存连接配置名、来源与模型标识，绝不保存任何 API 密钥。</div>
          ${profiles.length ? `
            <div class="upp-field">
              <label>切换此快照使用的连接配置，点右上角保存修改生效</label>
              <select class="upp-select" id="upp-sv-api-profile-sel" style="width:100%;">
                <option value="">不使用连接配置，沿用原始来源与模型</option>
                ${profiles.map(pr => `<option value="${escapeHtml(pr.id)}" ${s.api.profileId === pr.id ? 'selected' : ''}>${escapeHtml(pr.name)}${pr.model ? ` · ${escapeHtml(pr.model)}` : ''}</option>`).join('')}
              </select>
            </div>
          ` : ''}
          <div class="upp-card-meta">来源：${escapeHtml(s.api.source || '未记录')} · 模型：${escapeHtml(s.api.model || '未记录')}</div>
          ${s.api.customUrl ? `<div class="upp-card-meta">接口地址：${escapeHtml(s.api.customUrl)}</div>` : ''}
        </div>
      `;
      return;
    }

    if (sub === 'regex' && s.scope.regex && s.regex) {
      const scopes = [
        { key: 'global', label: '全局正则' },
        { key: 'character', label: '当前角色正则' },
        { key: 'preset', label: '当前预设正则' },
      ];
      const q = normalizeText(d.search || '');
      if (metaEl) {
        const cnt = k => Object.values(s.regex[k] || {}).filter(Boolean).length;
        metaEl.innerHTML = `
          <span class="upp-badge upp-keep">全局开 ${cnt('global')}</span>
          <span class="upp-badge upp-keep">角色开 ${cnt('character')}</span>
          <span class="upp-badge upp-keep">预设开 ${cnt('preset')}</span>
        `;
      }
      const blocks = scopes.map(sc => {
        const map = s.regex[sc.key] || {};
        const ids = Object.keys(map);
        if (!ids.length) return '';
        const liveList = d.regexDetails[sc.key] || [];
        const byId = new Map(liveList.map(r => [String(r.id), r]));
        const shown = ids.filter(id => {
          if (d.onlyOn && !map[id]) return false;
          if (!q) return true;
          const live = byId.get(id);
          return normalizeText(sc.label + ' ' + (live ? (live.script_name + ' ' + live.find_regex) : id)).includes(q);
        });
        if (!shown.length) return '';
        const onCount = ids.filter(id => map[id]).length;
        return `
          <div class="upp-group-box">
            <div class="upp-group-head">
              <span class="upp-group-name" style="font-weight:600;">${sc.label}</span>
              <span class="upp-badge accent" style="margin-left:auto;">${onCount}/${ids.length} 开启</span>
            </div>
            <div class="upp-group-items">
              ${shown.map(id => {
                const live = byId.get(id);
                const on = !!map[id];
                return `
                  <div class="upp-entry-row ${on ? 'is-on' : 'is-off'}">
                    <button class="upp-entry-main" data-view-snap-rg="${sc.key}" data-view-snap-rgid="${escapeHtml(id)}">
                      <span class="upp-dot ${on ? 'snap-on' : 'snap-off'}"></span>
                      <div class="upp-entry-text">
                        <div class="upp-entry-name">${escapeHtml(live ? live.script_name : `正则 #${id.slice(0, 8)}`)}</div>
                        <div class="upp-entry-preview">${escapeHtml(live ? live.find_regex : '未在当前范围找到')}</div>
                      </div>
                    </button>
                    <button type="button" class="upp-switch" role="switch" aria-checked="${on}" data-sv-rg-toggle="${sc.key}" data-sv-rg-id="${escapeHtml(id)}"></button>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }).filter(Boolean).join('');
      bodyEl.innerHTML = blocks ? `<div class="upp-entry-list">${blocks}</div>` : `<div class="upp-empty">没有匹配的正则条目</div>`;
    }
  }

  function renderMergeCandidateList(d) {
    const listEl = shadow.getElementById('upp-merge-candidate-list');
    if (!listEl) return;
    const keepId = d.keepId || (state.currentPersona?.avatar_id || state.personas[0]?.avatar_id || '');
    const keep = state.personas.find(p => p.avatar_id === keepId);
    const dupGroups = detectProliferatedPersonas(state.personas);
    const absorbSet = new Set(d.absorbIds || []);
    const previewSet = d.previewIds || new Set();
    const q = normalizeText(d.query || '');

    // Identify personas overlapping/similar with `keep` so they ALWAYS appear at the very top!
    const overlapIds = new Set();
    dupGroups.forEach(g => {
      if (g.items.some(x => x.avatar_id === keepId)) {
        g.items.forEach(x => { if (x.avatar_id !== keepId) overlapIds.add(x.avatar_id); });
      }
    });
    if (keep) {
      const keepName = String(keep.name || '').trim();
      const keepTail2 = /^[\u4e00-\u9fa5]{2,4}$/.test(keepName) ? keepName.slice(-2) : '';
      state.personas.forEach(p => {
        if (p.avatar_id === keepId) return;
        const pn = String(p.name || '').trim();
        if (pn === keepName || (keepTail2 && /^[\u4e00-\u9fa5]{2,4}$/.test(pn) && pn.endsWith(keepTail2))) {
          overlapIds.add(p.avatar_id);
        }
      });
    }

    const others = state.personas.filter(p => {
      if (p.avatar_id === keepId) return false;
      if (q && !normalizeText(`${p.name} ${p.description || ''}`).includes(q)) return false;
      return true;
    });

    const topItems = others.filter(p => overlapIds.has(p.avatar_id) || absorbSet.has(p.avatar_id));
    const restItems = others.filter(p => !overlapIds.has(p.avatar_id) && !absorbSet.has(p.avatar_id));

    if (!others.length) {
      listEl.innerHTML = `<div class="upp-card-meta" style="padding:12px;text-align:center;">${q ? '没有匹配该关键词的 User' : '没有其他可合并的 User'}</div>`;
      return;
    }

    const renderRow = (p, isOverlap) => {
      const checked = absorbSet.has(p.avatar_id);
      const expanded = previewSet.has(p.avatar_id);
      const desc = String(p.description || '');
      const snippet = desc.replace(/\s+/g, ' ').trim();
      const aid = escapeHtml(p.avatar_id);
      return `
        <div class="upp-merge-row ${checked ? 'is-checked' : ''}">
          <div class="upp-merge-top">
            <label>
              <input type="checkbox" data-merge-absorb="${aid}" ${checked ? 'checked' : ''} style="accent-color:var(--accent);margin:0;flex-shrink:0;" />
              <span class="upp-merge-name">${escapeHtml(p.name)}</span>
              ${isOverlap ? '<span class="upp-badge accent">相似分身</span>' : ''}
              <span class="upp-card-meta">${desc.length} 字</span>
            </label>
            <button type="button" class="upp-btn" style="height:24px;padding:0 8px;font-size:11px;" data-merge-preview="${aid}">${expanded ? '收起正文' : '查看正文'}</button>
          </div>
          ${!expanded ? `<div class="upp-merge-snippet">${escapeHtml(snippet || '（空描述）')}</div>` : `
            <pre class="upp-inline-pre" style="max-height:180px;">${escapeHtml(desc || '（空描述）')}</pre>
          `}
        </div>
      `;
    };

    let html = '';
    if (topItems.length) {
      html += `<div class="upp-wb-sec-head"><span>推荐合并 · 重合与已选分身（${topItems.length}）</span></div>`;
      html += topItems.map(p => renderRow(p, overlapIds.has(p.avatar_id))).join('');
    }
    if (restItems.length) {
      html += `<div class="upp-wb-sec-head"><span>其他 User（${restItems.length}）</span></div>`;
      html += restItems.map(p => renderRow(p, false)).join('');
    }
    listEl.innerHTML = html;
  }

  function renderBindCharList(d) {
    const listEl = shadow.getElementById('upp-bind-char-list');
    if (!listEl) return;
    const s = d.snapshot;
    const allChars = d.allChars || [];
    const q = normalizeText(d.charQuery || '');
    const snapNameById = new Map(state.store.snapshots.map(x => [x.id, x.name]));

    const filtered = allChars
      .filter(ch => !q || normalizeText(ch.name + ' ' + ch.id).includes(q))
      .sort((a, b) => {
        const aThis = state.store.bindings.characters[a.id] === s.id ? 2 : (a.id === state.charInfo.id ? 1 : 0);
        const bThis = state.store.bindings.characters[b.id] === s.id ? 2 : (b.id === state.charInfo.id ? 1 : 0);
        if (aThis !== bThis) return bThis - aThis;
        return a.name.localeCompare(b.name, 'zh-CN');
      });

    if (!filtered.length) {
      listEl.innerHTML = `<div class="upp-empty" style="padding:18px;">${allChars.length ? '没有匹配的角色' : '酒馆中暂无角色卡'}</div>`;
      return;
    }

    listEl.innerHTML = filtered.map(ch => {
      const boundId = state.store.bindings.characters[ch.id] || '';
      const isThis = boundId === s.id;
      const otherName = boundId && !isThis ? (snapNameById.get(boundId) || '其他快照') : '';
      const isActive = ch.id === state.charInfo.id;
      return `
        <div class="upp-entry-row ${isThis ? 'is-on' : ''}">
          <div class="upp-entry-text">
            <div class="upp-entry-title-row">
              <span class="upp-entry-name">${escapeHtml(ch.name)}</span>
              ${isActive ? '<span class="upp-badge upp-keep">当前角色</span>' : ''}
              ${isThis ? '<span class="upp-badge ok upp-keep">已绑此快照</span>' : ''}
              ${otherName ? `<span class="upp-badge warn">已绑: ${escapeHtml(otherName)}</span>` : ''}
            </div>
          </div>
          ${ch.avatar ? `<button type="button" class="upp-btn" data-bind-scan-char="${escapeHtml(ch.avatar)}" title="扫描该角色的聊天记录">扫聊天档</button>` : ''}
          <button type="button" class="upp-btn ${isThis ? 'danger' : 'primary'}" data-bind-toggle-char="${escapeHtml(ch.id)}">${isThis ? '解绑' : '绑定'}</button>
        </div>
      `;
    }).join('');
  }

  function renderBindChatList(d) {
    const listEl = shadow.getElementById('upp-bind-chat-list');
    if (!listEl) return;
    if (d.chatsLoading) {
      listEl.innerHTML = '<div class="upp-empty" style="padding:20px;">正在扫描该角色的聊天档…</div>';
      return;
    }
    if (d.chatsError) {
      listEl.innerHTML = `<div class="upp-empty" style="padding:20px;">${escapeHtml(d.chatsError)}</div>`;
      return;
    }
    const s = d.snapshot;
    const chats = Array.isArray(d.scannedChats) ? d.scannedChats : [];
    if (!d.scanCharAvatar) {
      listEl.innerHTML = '<div class="upp-empty" style="padding:20px;">请在上方选择一个角色，自动扫描其全部聊天档</div>';
      return;
    }
    const q = normalizeText(d.chatQuery || '');
    const snapNameById = new Map(state.store.snapshots.map(x => [x.id, x.name]));
    const filtered = chats.filter(c => !q || normalizeText(`${c.chatId} ${c.preview} ${c.lastMes}`).includes(q));

    if (!filtered.length) {
      listEl.innerHTML = `<div class="upp-empty" style="padding:20px;">${chats.length ? '没有匹配的聊天档' : '该角色暂无已保存的聊天记录'}</div>`;
      return;
    }

    listEl.innerHTML = filtered.map(c => {
      const boundId = state.store.bindings.chats[c.chatId] || '';
      const isThis = boundId === s.id;
      const otherName = boundId && !isThis ? (snapNameById.get(boundId) || '其他快照') : '';
      const isCur = c.chatId === state.chatId;
      const metaParts = [];
      if (c.count) metaParts.push(`${c.count} 条消息`);
      if (c.lastMes) metaParts.push(c.lastMes);
      if (c.preview) metaParts.push(c.preview);
      return `
        <div class="upp-entry-row ${isThis ? 'is-on' : ''}">
          <div class="upp-entry-text">
            <div class="upp-entry-title-row">
              <span class="upp-entry-name">${escapeHtml(c.chatId)}</span>
              ${isCur ? '<span class="upp-badge upp-keep">当前聊天</span>' : ''}
              ${isThis ? '<span class="upp-badge ok upp-keep">已绑此快照</span>' : ''}
              ${otherName ? `<span class="upp-badge warn">已绑: ${escapeHtml(otherName)}</span>` : ''}
            </div>
            <div class="upp-entry-preview">${escapeHtml(metaParts.join(' · ') || '聊天记录')}</div>
          </div>
          <button type="button" class="upp-btn ${isThis ? 'danger' : 'primary'}" data-bind-toggle-chat="${escapeHtml(c.chatId)}">${isThis ? '解绑' : '绑定'}</button>
        </div>
      `;
    }).join('');
  }

  function renderBookPickerList(d) {
    const listEl = shadow.getElementById('upp-book-picker-list');
    if (!listEl) return;
    const { sections } = groupWorldbooksByOrganizer(state.worldbooks, getOrganizerSettings(), {
      pinned: state.store.settings.pinnedWorldbooks,
      globals: state.globalWorldbooks,
      charBooks: [state.charWorldbooks.primary, ...(state.charWorldbooks.additional || [])].filter(Boolean),
      chatBook: state.chatWorldbook,
      liveCharBookMap: buildLiveCharBookMap(),
      query: d.query || '',
    });
    if (!sections.length) {
      listEl.innerHTML = '<div class="upp-empty" style="padding:18px;">未找到匹配世界书</div>';
      return;
    }
    const hasQuery = !!normalizeText(d.query || '');
    listEl.innerHTML = sections.map(sec => {
      const folded = hasQuery ? false : (Object.prototype.hasOwnProperty.call(d.foldMap || {}, sec.id) ? !!d.foldMap[sec.id] : !!sec.defaultCollapsed);
      const dotHtml = sec.color ? `<span class="upp-wb-dot" style="background:${escapeHtml(sec.color)};"></span>` : '';
      return `
        <div class="upp-group-box ${folded ? 'is-collapsed' : ''}" style="margin-bottom:4px;">
          <div class="upp-group-head" style="padding:6px 9px;">
            <button type="button" class="upp-group-toggle-btn" data-bp-fold="${escapeHtml(sec.id)}" style="font-size:12px;">
              <span class="upp-group-chev">${ICONS.chevron}</span>
              ${dotHtml}
              <span class="upp-group-name">${escapeHtml(sec.name)}</span>
              ${sec.isExcluded ? '<span class="upp-badge">已排除</span>' : ''}
              <span class="upp-badge">${sec.items.length}</span>
            </button>
          </div>
          <div class="upp-group-items" style="padding:5px 6px;">
            ${sec.items.map(item => {
              const tags = [];
              if (item.isPinned) tags.push('<span class="upp-badge warn">置顶</span>');
              if (item.isGlobal) tags.push('<span class="upp-badge accent">全局</span>');
              if (item.isChar) tags.push('<span class="upp-badge ok">角色</span>');
              if (item.isChat) tags.push('<span class="upp-badge ok">聊天</span>');
              const sub = item.subtitle ? `<span class="upp-wb-sub">${escapeHtml(item.subtitle)}</span>` : '';
              return `
                <button class="upp-detail-item" data-pick-book="${escapeHtml(item.name)}" style="${item.name === state.activeBook ? 'border-color:var(--accent);' : ''}">
                  <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(item.displayTitle)}${sub}</span>
                  <span class="upp-row-nowrap">${tags.join('')}</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderPresetSyncOverrideList(d) {
    const listEl = shadow.getElementById('upp-ps-ov-list');
    const badgeEl = shadow.getElementById('upp-ps-ov-count-badge');
    const ovPromptCount = Object.keys(d.forceOverridePrompts || {}).length;
    const ovGroupCount = Object.keys(d.forceOverrideGroups || {}).length;
    const ovTotal = ovPromptCount + ovGroupCount;
    if (badgeEl) {
      badgeEl.hidden = ovTotal === 0;
      badgeEl.textContent = `已选 ${ovTotal}`;
    }
    if (!listEl) return;
    const ana = d.analysis || { newPrompts: [] };
    const tgtNorm = d.targetPresetNorm || { prompts: [], groups: [] };
    const ovQ = normalizeText(d.overrideSearch || '');
    const existingTargetPrompts = (tgtNorm.prompts || []).filter(p => {
      if ((ana.newPrompts || []).some(np => np.id === p.id)) return false;
      if (ovQ && !normalizeText((p.name || '') + ' ' + p.id).includes(ovQ)) return false;
      return true;
    });
    const existingTargetGroups = (tgtNorm.groups || []).filter(g => {
      if (ovQ && !normalizeText(g.name || '').includes(ovQ)) return false;
      return true;
    });
    let html = '';
    if (existingTargetGroups.length) {
      html += `<div class="upp-wb-sec-head"><span>分组总开关 · 勾选后强制同步当前状态</span></div>`;
      html += existingTargetGroups.map(g => {
        const checked = Object.prototype.hasOwnProperty.call(d.forceOverrideGroups, g.id);
        return `
          <label class="upp-check-item" style="border:none;background:transparent;padding:3px 6px;">
            <input type="checkbox" data-ps-ov-grp="${escapeHtml(g.id)}" ${checked ? 'checked' : ''} />
            <span>[分组] ${escapeHtml(g.name)}</span>
            <span class="upp-badge ${g.enabled ? 'ok' : ''}" style="margin-left:auto;">${g.enabled ? '当前: 开' : '当前: 关'}</span>
          </label>
        `;
      }).join('');
    }
    if (existingTargetPrompts.length) {
      html += `<div class="upp-wb-sec-head"><span>已有提示词 · 仅勾选的条目会被统一覆盖</span></div>`;
      html += existingTargetPrompts.map(p => {
        const checked = Object.prototype.hasOwnProperty.call(d.forceOverridePrompts, p.id);
        return `
          <label class="upp-check-item" style="border:none;background:transparent;padding:3px 6px;">
            <input type="checkbox" data-ps-ov-pr="${escapeHtml(p.id)}" ${checked ? 'checked' : ''} />
            <span>${escapeHtml(p.name || p.id)}</span>
            <span class="upp-badge ${p.enabled ? 'ok' : ''}" style="margin-left:auto;">${p.enabled ? '当前: 开' : '当前: 关'}</span>
          </label>
        `;
      }).join('');
    }
    if (!html) {
      html = `<div class="upp-card-meta" style="padding:8px 6px;">没有匹配的分组或提示词</div>`;
    }
    listEl.innerHTML = html;
  }

  function renderDrawer() {
    const d = state.drawer;
    if (!d) {
      elDrawerMask.hidden = true;
      elDrawerMask.classList.remove('is-full');
      elDrawerMask.innerHTML = '';
      return;
    }
    elDrawerMask.hidden = false;
    const isFull = d.type === 'viewSnapshot' || (d.type === 'entryEditor' && d.fullView);
    elDrawerMask.classList.toggle('is-full', isFull);

    if (d.type === 'viewSnapshot') {
      const s = d.draft || d.snapshot;
      const availTabs = [];
      if (s.scope.preset && s.preset) availTabs.push({ id: 'preset', label: '预设' });
      if (s.scope.worldbooks && s.worldbooks) availTabs.push({ id: 'worldbooks', label: '世界书' });
      if (s.scope.persona && s.persona) availTabs.push({ id: 'persona', label: 'User' });
      if (s.scope.api && s.api) availTabs.push({ id: 'api', label: 'API' });
      if (s.scope.regex && s.regex) availTabs.push({ id: 'regex', label: '正则' });
      if (!availTabs.some(t => t.id === d.subTab)) d.subTab = availTabs[0]?.id || 'preset';

      const showFilter = d.subTab === 'preset' || d.subTab === 'worldbooks' || d.subTab === 'regex';
      const showFoldAll = d.subTab === 'preset' && (d.presetNorm?.groups?.length > 0);

      elDrawerMask.innerHTML = `
        <div class="upp-drawer is-full">
          <div class="upp-drawer-head">
            <div class="upp-row-nowrap" style="min-width:0;">
              <button class="upp-btn icon-only" data-sv-back title="返回">${ICONS.back}</button>
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">快照详情 · ${escapeHtml(s.name)}</span>
              ${d.dirty ? '<span class="upp-badge warn">未保存</span>' : ''}
            </div>
            <div class="upp-row-nowrap">
              <button class="upp-btn" id="upp-sv-edit-meta-btn" title="编辑名称、分组或说明">${ICONS.edit}<span>编辑</span></button>
              <button class="upp-btn ${d.dirty ? 'primary' : ''}" id="upp-sv-save-btn" ${d.dirty ? '' : 'disabled'}>${ICONS.save}<span>${d.dirty ? '保存修改' : '已保存'}</span></button>
              <button class="upp-btn ${d.dirty ? '' : 'primary'}" id="upp-sv-apply-btn">应用此快照</button>
            </div>
          </div>
          ${d.pendingAction ? `
            <div class="upp-unsaved-bar">
              <span>${d.pendingAction === 'apply' ? '当前快照有未保存的开关修改，应用前要先保存吗？' : '当前快照有未保存的开关修改，离开前要先保存吗？'}</span>
              <div class="upp-row-nowrap">
                <button type="button" class="upp-btn primary" id="upp-sv-unsaved-save">${d.pendingAction === 'apply' ? '保存并应用' : '保存并返回'}</button>
                <button type="button" class="upp-btn danger" id="upp-sv-unsaved-discard">${d.pendingAction === 'apply' ? '不保存直接应用' : '放弃修改'}</button>
                <button type="button" class="upp-btn" id="upp-sv-unsaved-cancel">继续编辑</button>
              </div>
            </div>
          ` : ''}
          <div class="upp-tabs" style="padding:7px 14px;">
            ${availTabs.map(t => `<button class="upp-tab ${d.subTab === t.id ? 'active' : ''}" data-sv-tab="${t.id}"><span>${t.label}</span></button>`).join('')}
          </div>
          <div class="upp-drawer-toolbar">
            ${showFilter ? `
              <div class="upp-row">
                <div class="upp-input-wrap">
                  ${ICONS.search}
                  <input type="text" id="upp-sv-search" placeholder="搜索分组、名称或正文…" value="${escapeHtml(d.search || '')}" />
                </div>
                <button class="upp-btn ${d.onlyOn ? 'active' : ''}" id="upp-sv-only-on">只看已开</button>
                ${showFoldAll ? `<button class="upp-btn" id="upp-sv-fold-all">${d.allExpanded ? '全部折叠' : '全部展开'}</button>` : ''}
              </div>
            ` : ''}
            <div class="upp-card-meta" id="upp-snap-inspect-meta"></div>
          </div>
          <div class="upp-drawer-body" id="upp-snap-inspect-body"></div>
        </div>
      `;
      renderViewSnapshotBody(d);
      return;
    }

    if (d.type === 'editSnapshotMeta') {
      const existingGroups = Array.from(new Set(state.store.snapshots.map(x => x.group).filter(Boolean)));
      const sc = d.scope || { persona: true, worldbooks: true, preset: true, regex: true, api: false };
      elDrawerMask.innerHTML = `
        <div class="upp-drawer is-fixed-box" style="width:min(500px,100%);">
          <div class="upp-drawer-head">
            <span>编辑快照信息与包含模块</span>
            <button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            <div class="upp-field">
              <label>快照名称</label>
              <div class="upp-row-nowrap">
                <input class="upp-text-input" id="upp-em-name" value="${escapeHtml(d.name || '')}" placeholder="输入快照名称" />
                <button type="button" class="upp-btn" id="upp-em-name-clear">清空</button>
              </div>
            </div>
            <div class="upp-field">
              <label>分组</label>
              <input class="upp-text-input" id="upp-em-group" value="${escapeHtml(d.group || '')}" placeholder="可选，例如：日常 / 现代 / 角色名" />
              ${existingGroups.length ? `<div class="upp-pill-strip" style="margin-top:4px;">${existingGroups.map(g => `<button type="button" class="upp-pill" data-em-fill-group="${escapeHtml(g)}">${escapeHtml(g)}</button>`).join('')}</div>` : ''}
            </div>
            <div class="upp-field">
              <label>说明备注</label>
              <textarea class="upp-inline-textarea" id="upp-em-note" style="min-height:80px;" placeholder="可选简短说明，最多 120 字">${escapeHtml(d.note || '')}</textarea>
            </div>
            <div class="upp-field">
              <label>包含模块 · 新勾上的模块会自动采录当前状态</label>
              <div class="upp-check-grid">
                <label class="upp-check-item"><input type="checkbox" id="upp-em-sc-persona" ${sc.persona ? 'checked' : ''} /><span>User 人设</span></label>
                <label class="upp-check-item"><input type="checkbox" id="upp-em-sc-wb" ${sc.worldbooks ? 'checked' : ''} /><span>世界书</span></label>
                <label class="upp-check-item"><input type="checkbox" id="upp-em-sc-preset" ${sc.preset ? 'checked' : ''} /><span>预设与分组</span></label>
                <label class="upp-check-item"><input type="checkbox" id="upp-em-sc-api" ${sc.api ? 'checked' : ''} /><span>API / 连接配置</span></label>
                <label class="upp-check-item"><input type="checkbox" id="upp-em-sc-regex" ${sc.regex ? 'checked' : ''} /><span>正则开关</span></label>
              </div>
            </div>
          </div>
          <div class="upp-drawer-foot">
            <button class="upp-btn" data-drawer-close>取消</button>
            <button class="upp-btn primary" id="upp-em-save-btn">保存修改</button>
          </div>
        </div>
      `;
      if (canAutoFocusDesktop()) window.setTimeout(() => shadow.getElementById('upp-em-name')?.focus(), 10);
      return;
    }

    if (d.type === 'missingAudit') {
      const snap = d.snapshot;
      const health = d.health;
      const hasRepairChoice = !!(
        d.personaRemap
        || d.presetRemap
        || d.apiProfileRemap
        || Object.values(d.bookRemap || {}).some(v => v && v !== '__keep__')
      );
      const hasOrg = !!getOrganizerSettings();
      const org = getOrganizerSettings();
      const charNameMap = buildCombinedCharNameMap(org);

      elDrawerMask.innerHTML = `
        <div class="upp-drawer is-fixed-box">
          <div class="upp-drawer-head">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">快照存在缺失项 · ${escapeHtml(snap.name)}</span>
            <button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            <div class="upp-card-meta">快照本身已完整保留，不会被删除。你可以直接选择替代项修复，或先前往对应模块处理，也可以跳过缺失项继续应用其余正常部分。</div>
            ${health.missingPersona ? `
              <div class="upp-card">
                <div class="upp-card-head" style="flex-wrap:wrap;">
                  <span class="upp-card-title">缺失 User 人设：${escapeHtml(health.missingPersona.name)}</span>
                  <button type="button" class="upp-btn" data-ma-goto="user">前往 User 页</button>
                </div>
                <div class="upp-field">
                  <label>替换为现有 User（可选）</label>
                  <select class="upp-select" id="upp-ma-persona-sel" style="width:100%;">
                    <option value="">暂不替换（应用时跳过 User）</option>
                    ${state.personas.map(p => `<option value="${escapeHtml(p.avatar_id)}" ${d.personaRemap === p.avatar_id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                  </select>
                </div>
              </div>
            ` : ''}
            ${health.missingWorldbooks.length ? `
              <div class="upp-card">
                <div class="upp-card-head" style="flex-wrap:wrap;">
                  <span class="upp-card-title">缺失世界书（${health.missingWorldbooks.length} 本）</span>
                  <div class="upp-row-nowrap">
                    ${hasOrg ? `<button type="button" class="upp-btn" id="upp-ma-open-wbo">打开整理面板</button>` : ''}
                    <button type="button" class="upp-btn" data-ma-goto="worldbook">前往世界书页</button>
                  </div>
                </div>
                ${health.missingWorldbooks.map(bk => {
                  const chosen = (d.bookRemap && d.bookRemap[bk]) || '__keep__';
                  return `
                    <div class="upp-field">
                      <label>原世界书：<strong>${escapeHtml(bk)}</strong></label>
                      <select class="upp-select" data-ma-book-sel="${escapeHtml(bk)}" style="width:100%;">
                        <option value="__keep__" ${chosen === '__keep__' ? 'selected' : ''}>暂不处理（应用时跳过此书）</option>
                        <option value="__remove__" ${chosen === '__remove__' ? 'selected' : ''}>从本快照移除此书引用</option>
                        ${state.worldbooks.map(liveBk => {
                          const fmt = formatWorldbookDisplay(liveBk, org, charNameMap);
                          const lbl = fmt.subtitle ? `${fmt.primary} (${fmt.subtitle})` : fmt.primary;
                          return `<option value="${escapeHtml(liveBk)}" ${chosen === liveBk ? 'selected' : ''}>替换为：${escapeHtml(lbl)}</option>`;
                        }).join('')}
                      </select>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : ''}
            ${health.missingPreset ? `
              <div class="upp-card">
                <div class="upp-card-head" style="flex-wrap:wrap;">
                  <span class="upp-card-title">缺失预设：${escapeHtml(health.missingPreset)}</span>
                  <div class="upp-row-nowrap">
                    <button type="button" class="upp-btn primary" id="upp-ma-migrate-preset">批量迁移旧预设快照</button>
                    <button type="button" class="upp-btn" data-ma-goto="preset">前往预设页</button>
                  </div>
                </div>
                <div class="upp-field">
                  <label>替换为现有预设（可选）</label>
                  <select class="upp-select" id="upp-ma-preset-sel" style="width:100%;">
                    <option value="">暂不替换（应用时跳过预设）</option>
                    ${state.presets.map(pr => `<option value="${escapeHtml(pr)}" ${d.presetRemap === pr ? 'selected' : ''}>${escapeHtml(pr)}</option>`).join('')}
                  </select>
                </div>
              </div>
            ` : ''}
            ${health.missingApiProfile ? `
              <div class="upp-card">
                <div class="upp-card-head" style="flex-wrap:wrap;">
                  <span class="upp-card-title">缺失 API 连接配置：${escapeHtml(health.missingApiProfile.profileName)}</span>
                </div>
                <div class="upp-field">
                  <label>替换为现有连接配置（可选）</label>
                  <select class="upp-select" id="upp-ma-api-sel" style="width:100%;">
                    <option value="">暂不替换（应用时跳过 API）</option>
                    ${(state.apiProfiles || []).map(pr => `<option value="${escapeHtml(pr.id)}" ${d.apiProfileRemap === pr.id ? 'selected' : ''}>${escapeHtml(pr.name)}${pr.model ? ` (${escapeHtml(pr.model)})` : ''}</option>`).join('')}
                  </select>
                </div>
              </div>
            ` : ''}
          </div>
          <div class="upp-drawer-foot">
            <button class="upp-btn" data-drawer-close>取消</button>
            <button class="upp-btn ${hasRepairChoice ? '' : 'primary'}" id="upp-ma-skip-apply">跳过缺失项继续应用</button>
            ${hasRepairChoice ? `<button class="upp-btn primary" id="upp-ma-repair-apply">保存弥补并应用</button>` : ''}
          </div>
        </div>
      `;
      return;
    }

    if (d.type === 'bookPicker') {
      const hasOrg = !!getOrganizerSettings();
      elDrawerMask.innerHTML = `
        <div class="upp-drawer is-fixed-box">
          <div class="upp-drawer-head">
            <span>选择世界书</span>
            <div class="upp-row-nowrap">
              ${hasOrg ? `<button class="upp-btn" id="upp-open-wbo-in-drawer">整理分组</button>` : ''}
              <button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
            </div>
          </div>
          <div class="upp-drawer-body">
            <div class="upp-input-wrap" style="width:100%;flex:0 0 auto;">
              ${ICONS.search}
              <input type="text" id="upp-book-search-input" placeholder="输入世界书名称、角色名、别名或分组名筛选…" value="${escapeHtml(d.query || '')}" />
            </div>
            <div class="upp-pop-list is-fill" id="upp-book-picker-list"></div>
          </div>
        </div>
      `;
      renderBookPickerList(d);
      if (canAutoFocusDesktop()) window.setTimeout(() => shadow.getElementById('upp-book-search-input')?.focus(), 10);
      return;
    }

    if (d.type === 'renamePersona') {
      elDrawerMask.innerHTML = `
        <div class="upp-drawer is-fixed-sm" style="width:min(420px,100%);">
          <div class="upp-drawer-head">
            <span>修改当前 User 名字</span>
            <button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            <div class="upp-field">
              <label>新名字</label>
              <div class="upp-row-nowrap">
                <input class="upp-text-input" id="upp-rename-input" value="${escapeHtml(d.name || '')}" placeholder="输入新的 User 名字" />
                <button type="button" class="upp-btn" id="upp-rename-clear-btn">清空</button>
              </div>
            </div>
            <div class="upp-card-meta">直接在当前 User 槽位原地改名，聊天中的主角称呼会同步生效，不会多出新分身。</div>
          </div>
          <div class="upp-drawer-foot">
            <button class="upp-btn" data-drawer-close>取消</button>
            <button class="upp-btn primary" id="upp-rename-confirm-btn">确认改名</button>
          </div>
        </div>
      `;
      if (canAutoFocusDesktop()) window.setTimeout(() => shadow.getElementById('upp-rename-input')?.focus(), 10);
      return;
    }

    if (d.type === 'entryEditor') {
      const readOnly = !!d.readOnly;
      elDrawerMask.innerHTML = `
        <div class="upp-drawer ${d.fullView ? 'is-full' : 'is-fixed-box'}">
          <div class="upp-drawer-head">
            <div class="upp-row-nowrap">
              ${d.returnTo ? `<button class="upp-btn icon-only" data-drawer-close title="返回">${ICONS.back}</button>` : ''}
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(d.heading || '条目详情')}</span>
            </div>
            ${!d.returnTo ? `<button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>` : ''}
          </div>
          <div class="upp-drawer-body">
            ${d.meta ? `<div class="upp-card-meta">${escapeHtml(d.meta)}</div>` : ''}
            ${d.allowNameEdit ? `
              <div class="upp-field">
                <label>标题</label>
                <input class="upp-text-input" id="upp-ed-name" value="${escapeHtml(d.name || '')}" ${readOnly ? 'readonly' : ''} />
              </div>
            ` : ''}
            ${d.allowDisplayName ? `
              <div class="upp-field">
                <label>切换时使用的 User 名字 · 留空沿用当前名字</label>
                <div class="upp-row-nowrap">
                  <input class="upp-text-input" id="upp-ed-display-name" value="${escapeHtml(d.displayName || '')}" placeholder="例如按剧情换姓后的全名" />
                  <button type="button" class="upp-btn" id="upp-ed-dn-clear-btn">清空</button>
                </div>
              </div>
            ` : ''}
            ${d.showStrategy ? `
              <div class="upp-field">
                <label>激活方式</label>
                <select class="upp-select" id="upp-ed-strategy" style="width:100%;">
                  <option value="constant" ${d.strategyType === 'constant' ? 'selected' : ''}>蓝灯常驻</option>
                  <option value="selective" ${d.strategyType === 'selective' ? 'selected' : ''}>绿灯关键字触发</option>
                </select>
              </div>
            ` : ''}
            <div class="upp-field" style="flex:1;display:flex;flex-direction:column;">
              <label>正文</label>
              <textarea class="upp-textarea" id="upp-ed-content" style="flex:1;min-height:120px;" ${readOnly ? 'readonly' : ''}>${escapeHtml(d.content || '')}</textarea>
            </div>
          </div>
          <div class="upp-drawer-foot">
            <button class="upp-btn" data-drawer-close>${d.returnTo ? '返回' : '关闭'}</button>
            ${!readOnly ? `<button class="upp-btn primary" id="upp-ed-save-btn">保存</button>` : ''}
          </div>
        </div>
      `;
      return;
    }

    if (d.type === 'saveSnapshot') {
      const existingGroups = Array.from(new Set(state.store.snapshots.map(s => s.group).filter(Boolean)));
      const selectedSet = new Set(d.selectedBooks || []);
      const curApi = Host.getCurrentApiConfig();
      const apiHint = curApi ? (curApi.profileName || curApi.model || curApi.source || '当前连接') : '未检测到连接';
      const nameSuggestions = Array.isArray(d.nameSuggestions) ? d.nameSuggestions : [];
      elDrawerMask.innerHTML = `
        <div class="upp-drawer is-fixed-box">
          <div class="upp-drawer-head">
            <span>保存快照</span>
            <button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            <div class="upp-field">
              <label>快照名称</label>
              <div class="upp-row-nowrap">
                <input class="upp-text-input" id="upp-ss-name" placeholder="例如：角色名 · 日常线" value="${escapeHtml(d.name || '')}" />
                <button type="button" class="upp-btn" id="upp-ss-name-clear">清空</button>
              </div>
              ${nameSuggestions.length ? `<div class="upp-pill-strip" style="margin-top:4px;">${nameSuggestions.map(nm => `<button type="button" class="upp-pill" data-ss-fill-name="${escapeHtml(nm)}">${escapeHtml(nm)}</button>`).join('')}</div>` : ''}
            </div>
            <div class="upp-field">
              <label>分组</label>
              <input class="upp-text-input" id="upp-ss-group" placeholder="可选，例如：日常 / 现代 / 角色名" value="${escapeHtml(d.group || '')}" />
              ${(existingGroups.length || state.charInfo.name) ? `
                <div class="upp-pill-strip" style="margin-top:4px;">
                  ${state.charInfo.name && !existingGroups.includes(state.charInfo.name) ? `<button type="button" class="upp-pill" data-ss-fill-group="${escapeHtml(state.charInfo.name)}">角色：${escapeHtml(state.charInfo.name)}</button>` : ''}
                  ${existingGroups.map(g => `<button type="button" class="upp-pill" data-ss-fill-group="${escapeHtml(g)}">${escapeHtml(g)}</button>`).join('')}
                </div>
              ` : ''}
            </div>
            <div class="upp-field">
              <label>备注</label>
              <input class="upp-text-input" id="upp-ss-note" placeholder="可选简短说明，悬浮球中会直接展示" value="${escapeHtml(d.note || '')}" />
            </div>
            <div class="upp-field">
              <label>包含内容 · 勾选习惯会自动记住</label>
              <div class="upp-check-grid">
                <label class="upp-check-item"><input type="checkbox" id="upp-sc-persona" ${d.scope.persona ? 'checked' : ''} /><span>User 人设</span></label>
                <label class="upp-check-item"><input type="checkbox" id="upp-sc-wb" ${d.scope.worldbooks ? 'checked' : ''} /><span>世界书与条目开关</span></label>
                <label class="upp-check-item"><input type="checkbox" id="upp-sc-preset" ${d.scope.preset ? 'checked' : ''} /><span>预设、分组与提示词</span></label>
                <label class="upp-check-item"><input type="checkbox" id="upp-sc-api" ${d.scope.api ? 'checked' : ''} /><span>API：${escapeHtml(apiHint)}</span></label>
                <label class="upp-check-item"><input type="checkbox" id="upp-sc-regex" ${d.scope.regex ? 'checked' : ''} /><span>正则开关</span></label>
              </div>
            </div>
            <div class="upp-field" id="upp-ss-books-wrap" ${d.scope.worldbooks ? '' : 'hidden'}>
              <label>记录条目开关的世界书 · 已选 ${selectedSet.size} 本</label>
              <div class="upp-pop-list">
                ${(() => {
                  const { sections } = groupWorldbooksByOrganizer(state.worldbooks, getOrganizerSettings(), {
                    pinned: state.store.settings.pinnedWorldbooks,
                    globals: state.globalWorldbooks,
                    charBooks: [state.charWorldbooks.primary, ...(state.charWorldbooks.additional || [])].filter(Boolean),
                    chatBook: state.chatWorldbook,
                    liveCharBookMap: buildLiveCharBookMap(),
                  });
                  return sections.map(sec => {
                    const names = sec.items.map(it => it.name);
                    const allChecked = names.length > 0 && names.every(n => selectedSet.has(n));
                    const dotHtml = sec.color ? `<span class="upp-wb-dot" style="background:${escapeHtml(sec.color)};"></span>` : '';
                    return `
                      <div class="upp-wb-sec-head">
                        <span class="upp-row-nowrap">${dotHtml}<span>${escapeHtml(sec.name)}（${sec.items.length}）</span>${sec.isExcluded ? '<span class="upp-badge">已排除</span>' : ''}</span>
                        <button type="button" class="upp-pill" style="height:22px;font-size:11px;padding:0 8px;" data-ss-toggle-group="${escapeHtml(sec.id)}">${allChecked ? '取消全选' : '全选本组'}</button>
                      </div>
                      ${sec.items.map(it => {
                        const sub = it.subtitle ? `<span class="upp-wb-sub">${escapeHtml(it.subtitle)}</span>` : '';
                        return `
                          <label class="upp-check-item" style="border:none;background:transparent;padding:4px 6px;">
                            <input type="checkbox" data-ss-book="${escapeHtml(it.name)}" ${selectedSet.has(it.name) ? 'checked' : ''} />
                            <span>${escapeHtml(it.displayTitle)}${sub}</span>
                            ${it.isPinned ? '<span class="upp-badge warn" style="margin-left:auto;">置顶</span>' : ''}
                          </label>
                        `;
                      }).join('')}
                    `;
                  }).join('');
                })()}
              </div>
            </div>
          </div>
          <div class="upp-drawer-foot">
            <button class="upp-btn" data-drawer-close>取消</button>
            <button class="upp-btn primary" id="upp-ss-confirm-btn">保存快照</button>
          </div>
        </div>
      `;
      if (canAutoFocusDesktop()) window.setTimeout(() => shadow.getElementById('upp-ss-name')?.focus(), 10);
      return;
    }

    if (d.type === 'confirmOverwrite') {
      const s = d.snapshot;
      const scopes = [];
      if (s.scope.persona) scopes.push(`User：${state.currentPersona?.name || '无'}`);
      if (s.scope.worldbooks) {
        const bkCount = s.worldbooks?.entries ? Object.keys(s.worldbooks.entries).length : getDefaultSnapshotBooks(state.store).length;
        scopes.push(`世界书 · ${bkCount} 本及全局绑定`);
      }
      if (s.scope.preset) scopes.push(`预设：${state.loadedPresetName || '无'}`);
      if (s.scope.api) {
        const curApi = Host.getCurrentApiConfig();
        scopes.push(`API：${curApi ? (curApi.profileName || curApi.model || curApi.source) : '无'}`);
      }
      if (s.scope.regex) scopes.push('正则开关');

      elDrawerMask.innerHTML = `
        <div class="upp-drawer is-fixed-sm" style="width:min(440px,100%);">
          <div class="upp-drawer-head">
            <span>确认覆盖更新</span>
            <button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            <div class="upp-card">
              <div class="upp-card-head">
                <span class="upp-card-title">将用当前酒馆状态覆盖「${escapeHtml(s.name)}」</span>
              </div>
              <div class="upp-card-meta">本次覆盖范围：</div>
              <div class="upp-card-meta">${scopes.map(x => `<span class="upp-badge accent">${escapeHtml(x)}</span>`).join('')}</div>
            </div>
            <div class="upp-card-meta">覆盖后该快照内原有记录的开关状态将被替换为当前最新状态，请确认。</div>
          </div>
          <div class="upp-drawer-foot">
            <button class="upp-btn" data-drawer-close>取消</button>
            <button class="upp-btn primary" id="upp-confirm-overwrite-btn">确认覆盖更新</button>
          </div>
        </div>
      `;
      return;
    }

    if (d.type === 'bindSnapshot') {
      const s = d.snapshot;
      const boundChats = Object.keys(state.store.bindings.chats || {}).filter(k => state.store.bindings.chats[k] === s.id);
      const boundChars = Object.keys(state.store.bindings.characters || {}).filter(k => state.store.bindings.characters[k] === s.id);
      const charNameById = new Map((d.allChars || []).map(c => [c.id, c.name]));
      const isCurChat = state.chatId && state.store.bindings.chats[state.chatId] === s.id;
      const isCurChar = state.charInfo.id && state.store.bindings.characters[state.charInfo.id] === s.id;
      const tab = d.bindTab || 'char';

      elDrawerMask.innerHTML = `
        <div class="upp-drawer is-fixed-box">
          <div class="upp-drawer-head">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">绑定快照 · ${escapeHtml(s.name)}</span>
            <button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-tabs" style="padding:7px 14px;">
            <button class="upp-tab ${tab === 'char' ? 'active' : ''}" data-bind-tab="char"><span>按角色绑定</span></button>
            <button class="upp-tab ${tab === 'chat' ? 'active' : ''}" data-bind-tab="chat"><span>按角色扫描聊天档</span></button>
          </div>
          <div class="upp-drawer-body">
            ${(boundChats.length || boundChars.length) ? `
              <div class="upp-card" style="padding:8px 10px;gap:6px;">
                <div class="upp-sec-title" style="margin:0;"><span>此快照已绑定（点 × 快速解绑）</span><span>${boundChars.length + boundChats.length} 项</span></div>
                <div class="upp-row">
                  ${boundChars.map(cid => `<button type="button" class="upp-pill active is-closable" data-bind-toggle-char="${escapeHtml(cid)}" title="点击解绑该角色"><span class="upp-pill-text">角色: ${escapeHtml(charNameById.get(cid) || cid)}</span><span class="upp-pill-x">×</span></button>`).join('')}
                  ${boundChats.map(chatId => `<button type="button" class="upp-pill active is-closable" data-bind-toggle-chat="${escapeHtml(chatId)}" title="点击解绑该聊天档"><span class="upp-pill-text">聊天: ${escapeHtml(chatId)}</span><span class="upp-pill-x">×</span></button>`).join('')}
                </div>
              </div>
            ` : ''}
            ${(state.chatId || state.charInfo.id) ? `
              <div class="upp-row">
                ${state.chatId ? `<button type="button" class="upp-btn ${isCurChat ? 'danger' : ''}" data-bind-toggle-chat="${escapeHtml(state.chatId)}">${isCurChat ? '解绑当前聊天' : '快捷绑定当前聊天'}</button>` : ''}
                ${state.charInfo.id ? `<button type="button" class="upp-btn ${isCurChar ? 'danger' : ''}" data-bind-toggle-char="${escapeHtml(state.charInfo.id)}">${isCurChar ? '解绑当前角色' : '快捷绑定当前角色'}</button>` : ''}
              </div>
            ` : ''}
            ${tab === 'char' ? `
              <div class="upp-input-wrap" style="width:100%;flex:0 0 auto;">
                ${ICONS.search}
                <input type="text" id="upp-bind-char-search" placeholder="搜索角色名称，可绑定角色默认或点击扫聊天档…" value="${escapeHtml(d.charQuery || '')}" />
              </div>
              <div class="upp-pop-list is-fill" id="upp-bind-char-list"></div>
            ` : `
              <div class="upp-row">
                <select class="upp-select" id="upp-bind-chat-char-sel" style="flex:1;min-width:0;max-width:100%;">
                  <option value="">选择角色扫描其聊天档…</option>
                  ${(d.allChars || []).filter(c => c.avatar).map(c => `<option value="${escapeHtml(c.avatar)}" ${d.scanCharAvatar === c.avatar ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
                </select>
                <button type="button" class="upp-btn" id="upp-bind-rescan-btn" ${d.scanCharAvatar ? '' : 'disabled'}>${ICONS.refresh}<span>扫描</span></button>
              </div>
              <div class="upp-input-wrap" style="width:100%;flex:0 0 auto;">
                ${ICONS.search}
                <input type="text" id="upp-bind-chat-search" placeholder="筛选聊天档名称或消息片段…" value="${escapeHtml(d.chatQuery || '')}" />
              </div>
              <div class="upp-pop-list is-fill" id="upp-bind-chat-list"></div>
            `}
          </div>
          <div class="upp-drawer-foot">
            <button class="upp-btn primary" data-drawer-close>完成</button>
          </div>
        </div>
      `;
      if (tab === 'char') renderBindCharList(d);
      else renderBindChatList(d);
      return;
    }

    if (d.type === 'savePersonaVersion') {
      const p = state.currentPersona;
      const existing = p ? (state.store.personaVersions[p.avatar_id] || []) : [];
      elDrawerMask.innerHTML = `
        <div class="upp-drawer is-fixed-box" style="width:min(480px,100%);">
          <div class="upp-drawer-head">
            <span>存为内部描述版本 · ${escapeHtml(p?.name || '')}</span>
            <button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            <div class="upp-field">
              <label>版本名称</label>
              <input class="upp-text-input" id="upp-pv-name" placeholder="例如：默认 / 现代日常 / 古风线" value="${escapeHtml(d.name || '')}" />
            </div>
            <div class="upp-field">
              <label>切换时使用的 User 名字 · 剧情换姓直接填全名</label>
              <div class="upp-row-nowrap">
                <input class="upp-text-input" id="upp-pv-display-name" placeholder="留空则切换时不改当前名字" value="${escapeHtml(d.displayName !== undefined ? d.displayName : (p?.name || ''))}" />
                <button type="button" class="upp-btn" id="upp-pv-dn-clear-btn">清空</button>
              </div>
            </div>
            ${existing.length ? `
              <div class="upp-field" style="flex:1;min-height:0;display:flex;flex-direction:column;">
                <label>已有版本 · 点选同名可覆盖</label>
                <div class="upp-pop-list is-fill">
                  ${existing.map(v => `
                    <div class="upp-row-nowrap" style="padding:3px 4px;">
                      <button type="button" class="upp-detail-item" data-pv-fill-name="${escapeHtml(v.name)}" data-pv-fill-dn="${escapeHtml(v.displayName || '')}">
                        <span>${escapeHtml(v.name)}${v.displayName ? ` <span class="upp-wb-sub">${escapeHtml(v.displayName)}</span>` : ''}</span>
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
      if (canAutoFocusDesktop()) window.setTimeout(() => shadow.getElementById('upp-pv-name')?.focus(), 10);
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
        <div class="upp-drawer is-fixed-box">
          <div class="upp-drawer-head">
            <span>版本差异对比 · ${escapeHtml(p?.name || '')}</span>
            <button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            <div class="upp-row">
              <select class="upp-select" id="upp-diff-left" style="flex:1;min-width:0;max-width:100%;">
                ${choices.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === leftId ? 'selected' : ''}>旧：${escapeHtml(c.name)}</option>`).join('')}
              </select>
              <select class="upp-select" id="upp-diff-right" style="flex:1;min-width:0;max-width:100%;">
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
      const keepObj = state.personas.find(p => p.avatar_id === keepId);
      const absorbSet = new Set(d.absorbIds || []);
      const orphans = Array.isArray(d.orphanAvatars) ? d.orphanAvatars : [];
      elDrawerMask.innerHTML = `
        <div class="upp-drawer is-fixed-box">
          <div class="upp-drawer-head">
            <span>整理同名与换姓分身</span>
            <button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            ${orphans.length ? `
              <div class="upp-bind-strip">
                <span>检测到 ${orphans.length} 个未命名残留头像文件</span>
                <button type="button" class="upp-btn danger" id="upp-clean-orphans-btn">一键清理</button>
              </div>
            ` : ''}
            ${dupGroups.length ? `
              <div class="upp-field">
                <label>快速切到相似分身组</label>
                <div class="upp-pill-strip">
                  ${dupGroups.map((g, idx) => `<button type="button" class="upp-pill" data-merge-preset-group="${idx}">${escapeHtml(g.baseName)}（${g.items.length}）</button>`).join('')}
                </div>
              </div>
            ` : ''}
            <div class="upp-field">
              <div class="upp-sec-title" style="margin:0;">
                <span>保留的主 User · 勾选项会收进它的内部版本</span>
                ${keepObj ? `<button type="button" class="upp-pill" style="height:22px;font-size:11px;padding:0 8px;" id="upp-merge-keep-preview-btn">${d.showKeepPreview ? '收起主正文' : '查看主正文'}</button>` : ''}
              </div>
              <select class="upp-select" id="upp-merge-keep" style="width:100%;">
                ${state.personas.map(p => `<option value="${escapeHtml(p.avatar_id)}" ${p.avatar_id === keepId ? 'selected' : ''}>${escapeHtml(p.name)}（${String(p.description || '').length} 字）</option>`).join('')}
              </select>
              ${keepObj && d.showKeepPreview ? `<pre class="upp-inline-pre" style="max-height:150px;">${escapeHtml(keepObj.description || '（主 User 暂无描述）')}</pre>` : ''}
            </div>
            <div class="upp-input-wrap" style="width:100%;flex:0 0 auto;">
              ${ICONS.search}
              <input type="text" id="upp-merge-search" placeholder="筛选分身名称或正文关键词…" value="${escapeHtml(d.query || '')}" />
            </div>
            <div class="upp-pop-list is-fill" id="upp-merge-candidate-list" style="min-height:140px;"></div>
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
      renderMergeCandidateList(d);
      return;
    }

    if (d.type === 'presetSync') {
      const snapPresetNames = Array.from(new Set(
        (state.store.snapshots || [])
          .filter(s => s.scope?.preset && s.preset?.name)
          .map(s => s.preset.name)
      ));
      const livePresetSet = new Set(state.presets);
      const matchingSnaps = (state.store.snapshots || []).filter(s => s.scope?.preset && s.preset?.name === d.sourcePreset);
      const selSet = new Set(d.selectedSnapIds || []);
      const isUpgrade = d.sourcePreset !== d.targetPreset;
      const ana = d.analysis || {
        matchedById: [], matchedByName: [], newPrompts: [], unmatchedOldPrompts: [], matchedGroups: [], newGroups: [],
      };
      const allSnapsSelected = matchingSnaps.length > 0 && matchingSnaps.every(s => selSet.has(s.id));
      const ovPromptCount = Object.keys(d.forceOverridePrompts || {}).length;
      const ovGroupCount = Object.keys(d.forceOverrideGroups || {}).length;

      elDrawerMask.innerHTML = `
        <div class="upp-drawer is-fixed-box">
          <div class="upp-drawer-head">
            <div class="upp-row-nowrap" style="min-width:0;">
              <span>预设升级与批量同步</span>
              <span class="upp-badge ${isUpgrade ? 'accent' : 'ok'}">${isUpgrade ? '跨版本迁移' : '同预设同步'}</span>
            </div>
            <button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            ${state.lastPresetSyncUndo ? `
              <div class="upp-bind-strip">
                <span>上次同步：${escapeHtml(state.lastPresetSyncUndo.label)}</span>
                <button type="button" class="upp-btn" id="upp-ps-undo-btn">撤销上次同步</button>
              </div>
            ` : ''}
            <div class="upp-check-grid">
              <div class="upp-field">
                <label>源预设 · 旧快照记录的预设</label>
                <select class="upp-select" id="upp-ps-source-sel" style="width:100%;">
                  ${snapPresetNames.map(n => `<option value="${escapeHtml(n)}" ${n === d.sourcePreset ? 'selected' : ''}>${escapeHtml(n)}${livePresetSet.has(n) ? '' : '（已不在酒馆中）'}</option>`).join('')}
                </select>
              </div>
              <div class="upp-field">
                <label>目标预设 · 同步或升级到的新预设</label>
                <select class="upp-select" id="upp-ps-target-sel" style="width:100%;">
                  ${state.presets.map(n => `<option value="${escapeHtml(n)}" ${n === d.targetPreset ? 'selected' : ''}>${escapeHtml(n)}${n === state.loadedPresetName ? '（当前激活）' : ''}</option>`).join('')}
                </select>
              </div>
            </div>

            <div class="upp-field">
              <div class="upp-sec-title">
                <span>要同步的快照 · 已选 ${selSet.size} / ${matchingSnaps.length}</span>
                <button type="button" class="upp-pill" style="height:22px;font-size:11px;padding:0 8px;" id="upp-ps-toggle-all-snaps">${allSnapsSelected ? '取消全选' : '全选'}</button>
              </div>
              <div class="upp-pop-list" style="max-height:110px;">
                ${matchingSnaps.map(s => `
                  <label class="upp-check-item" style="border:none;background:transparent;padding:3px 6px;">
                    <input type="checkbox" data-ps-snap="${escapeHtml(s.id)}" ${selSet.has(s.id) ? 'checked' : ''} />
                    <span style="font-weight:550;">${escapeHtml(s.name)}</span>
                    ${s.group ? `<span class="upp-badge" style="margin-left:auto;">${escapeHtml(s.group)}</span>` : ''}
                  </label>
                `).join('')}
              </div>
            </div>

            <div class="upp-card-meta">
              <span class="upp-badge ok">精准对应 ${ana.matchedById.length} 条</span>
              ${ana.matchedByName.length ? `<span class="upp-badge accent">按名称匹配 ${ana.matchedByName.length} 条</span>` : ''}
              <span class="upp-badge ${ana.newPrompts.length ? 'accent' : ''}">新增条目 ${ana.newPrompts.length} 条</span>
              ${ana.unmatchedOldPrompts.length ? `<span class="upp-badge warn">旧预设独有或已删 ${ana.unmatchedOldPrompts.length} 条</span>` : ''}
            </div>

            ${ana.newPrompts.length ? `
              <div class="upp-card">
                <div class="upp-card-head">
                  <span class="upp-card-title">新预设新增条目 · 默认跟随当前原生开关</span>
                </div>
                <div class="upp-entry-list">
                  ${ana.newPrompts.map(np => {
                    const dec = d.newPromptDecisions[np.id] || { include: true, enabled: !!np.enabled, inheritFromOldId: '' };
                    const isPh = np.marker;
                    const roleShort = isPh ? '占位' : (np.role === 'user' ? 'USR' : np.role === 'assistant' ? 'AST' : 'SYS');
                    const pairingHtml = ana.unmatchedOldPrompts.length ? `
                      <select class="upp-select upp-ps-inherit-sel" data-ps-new-inherit="${escapeHtml(np.id)}" title="若新旧条目名称不同，可手动指定沿用哪个旧条目的开关">
                        <option value="">按右侧开关写入</option>
                        ${ana.unmatchedOldPrompts.map(op => `<option value="${escapeHtml(op.id)}" ${dec.inheritFromOldId === op.id ? 'selected' : ''}>继承：${escapeHtml(op.name)}</option>`).join('')}
                      </select>
                    ` : '';
                    return `
                      <div class="upp-entry-row ${dec.include || dec.inheritFromOldId ? 'is-on' : 'is-off'}" style="padding:6px 8px;">
                        <input type="checkbox" data-ps-new-inc="${escapeHtml(np.id)}" ${dec.include || dec.inheritFromOldId ? 'checked' : ''} style="accent-color:var(--accent);margin:0;flex-shrink:0;" title="是否同步此新增条目" />
                        <span class="upp-role-tag ${isPh ? 'placeholder' : ''}">${roleShort}</span>
                        <div class="upp-entry-text">
                          <div class="upp-entry-name">${escapeHtml(np.name || np.id)}</div>
                          <div class="upp-entry-preview">${dec.inheritFromOldId ? '将按每份快照原本的旧条目开关各自继承' : `当前原生预设：${np.enabled ? '开启' : '关闭'}`}</div>
                        </div>
                        ${pairingHtml}
                        ${!dec.inheritFromOldId ? `<button type="button" class="upp-switch" role="switch" aria-checked="${!!dec.enabled}" data-ps-new-en="${escapeHtml(np.id)}" title="本次批量写入状态"></button>` : ''}
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            ` : `
              <div class="upp-card-meta">目标预设中暂无未记录的新增条目；${isUpgrade ? '老条目开关将自动无损继承。' : '如需把某些已有开关统一推给多份快照，请展开下方定向覆盖。'}</div>
            `}

            <div class="upp-group-box ${d.overrideExpanded ? '' : 'is-collapsed'}">
              <div class="upp-group-head">
                <button type="button" class="upp-group-toggle-btn" id="upp-ps-ov-toggle">
                  <span class="upp-group-chev">${ICONS.chevron}</span>
                  <span class="upp-group-name">可选：把目标预设的指定已有开关批量覆盖到选中快照</span>
                  <span class="upp-badge accent" id="upp-ps-ov-count-badge" ${ovPromptCount + ovGroupCount ? '' : 'hidden'}>已选 ${ovPromptCount + ovGroupCount}</span>
                </button>
              </div>
              <div class="upp-group-items">
                <div class="upp-input-wrap" style="width:100%;">
                  ${ICONS.search}
                  <input type="text" id="upp-ps-ov-search" placeholder="筛选要批量覆盖的已有分组或条目…" value="${escapeHtml(d.overrideSearch || '')}" />
                </div>
                <div id="upp-ps-ov-list"></div>
              </div>
            </div>

            <div class="upp-check-grid">
              <label class="upp-check-item">
                <input type="checkbox" id="upp-ps-clean-removed" ${d.cleanRemovedIds ? 'checked' : ''} />
                <span>清理新预设已删除的旧条目残留</span>
              </label>
              <label class="upp-check-item">
                <input type="checkbox" id="upp-ps-sync-groups" ${d.syncNewGroups ? 'checked' : ''} />
                <span>同步新预设的新增分组总开关</span>
              </label>
            </div>
          </div>
          <div class="upp-drawer-foot">
            <button class="upp-btn" data-drawer-close>取消</button>
            <button class="upp-btn primary" id="upp-ps-run-btn" ${selSet.size ? '' : 'disabled'}>${isUpgrade ? `迁移并同步 ${selSet.size} 份快照` : `同步到 ${selSet.size} 份快照`}</button>
          </div>
        </div>
      `;
      renderPresetSyncOverrideList(d);
      return;
    }

    if (d.type === 'backup') {
      elDrawerMask.innerHTML = `
        <div class="upp-drawer is-fixed-sm" style="width:min(460px,100%);">
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
    if (typeof syncModalLayoutClasses === 'function') syncModalLayoutClasses();
  }

  function backfillSnapshotPresetNames() {
    let changed = false;
    const cache = new Map();
    (state.store.snapshots || []).forEach(s => {
      if (!s || !s.scope?.preset || !s.preset?.name) return;
      const hasNames = s.preset.promptNames && Object.keys(s.preset.promptNames).length > 0;
      if (hasNames) return;
      const pName = s.preset.name;
      let norm = cache.get(pName);
      if (norm === undefined) {
        norm = Host.getPresetByNameNormalized(pName) || null;
        cache.set(pName, norm);
      }
      if (!norm || !norm.prompts.length) return;
      const pNames = {};
      norm.prompts.forEach(p => { if (p && p.id && p.name) pNames[p.id] = String(p.name).slice(0, 80); });
      const gNames = {};
      (norm.groups || []).forEach(g => { if (g && g.id && g.name) gNames[g.id] = String(g.name).slice(0, 60); });
      s.preset.promptNames = pNames;
      s.preset.groupNames = gNames;
      changed = true;
    });
    if (changed) persistStore(state.store);
  }

  function recomputePresetSyncAnalysis(d) {
    const sourceSnaps = (state.store.snapshots || []).filter(s => s.scope?.preset && s.preset?.name === d.sourcePreset);
    const validIds = new Set(sourceSnaps.map(s => s.id));
    if (!Array.isArray(d.selectedSnapIds) || !d.selectedSnapIds.some(id => validIds.has(id))) {
      d.selectedSnapIds = sourceSnaps.map(s => s.id);
    } else {
      d.selectedSnapIds = d.selectedSnapIds.filter(id => validIds.has(id));
    }
    const chosenSnaps = sourceSnaps.filter(s => d.selectedSnapIds.includes(s.id));
    const srcNorm = d.sourcePreset && state.presets.includes(d.sourcePreset)
      ? Host.getPresetByNameNormalized(d.sourcePreset)
      : null;
    const tgtNorm = d.targetPreset
      ? Host.getPresetByNameNormalized(d.targetPreset)
      : null;
    d.targetPresetNorm = tgtNorm;
    d.analysis = analyzePresetMigration(chosenSnaps, srcNorm, tgtNorm);

    // Preserve prior decisions where possible; default every new prompt to follow Target Preset's live native switch!
    const prevDec = d.newPromptDecisions || {};
    const nextDec = {};
    (d.analysis.newPrompts || []).forEach(np => {
      if (prevDec[np.id]) nextDec[np.id] = prevDec[np.id];
      else nextDec[np.id] = { include: true, enabled: !!np.enabled, inheritFromOldId: '' };
    });
    d.newPromptDecisions = nextDec;
    d.forceOverridePrompts = {};
    d.forceOverrideGroups = {};
  }

  function openPresetSyncDrawer(opts = {}) {
    state.presets = Host.listPresets();
    state.loadedPresetName = Host.getLoadedPresetName();
    backfillSnapshotPresetNames();

    const snapPresetNames = Array.from(new Set(
      (state.store.snapshots || [])
        .filter(s => s.scope?.preset && s.preset?.name)
        .map(s => s.preset.name)
    ));
    if (!snapPresetNames.length) {
      toast('还没有保存过包含预设的快照，请先保存至少一份快照', 'warning');
      return;
    }
    if (!state.presets.length) {
      toast('未检测到酒馆中的可用预设', 'warning');
      return;
    }
    const targetPreset = (opts.targetPreset && state.presets.includes(opts.targetPreset))
      ? opts.targetPreset
      : (state.loadedPresetName || state.presets[0]);
    const sourcePreset = (opts.sourcePreset && snapPresetNames.includes(opts.sourcePreset))
      ? opts.sourcePreset
      : (snapPresetNames.includes(targetPreset) ? targetPreset : snapPresetNames[0]);

    const d = {
      type: 'presetSync',
      sourcePreset,
      targetPreset,
      selectedSnapIds: null,
      targetPresetNorm: null,
      analysis: null,
      newPromptDecisions: {},
      forceOverridePrompts: {},
      forceOverrideGroups: {},
      overrideExpanded: false,
      overrideSearch: '',
      cleanRemovedIds: true,
      syncNewGroups: true,
    };
    recomputePresetSyncAnalysis(d);
    state.drawer = d;
    renderDrawer();
  }

  function openSaveSnapshotDrawer() {
    const defSc = state.store.settings.defaultSnapshotScope || {};
    const named = suggestSnapshotNames({
      charName: state.charInfo.name,
      personaName: state.currentPersona?.name,
      presetName: state.loadedPresetName,
      existingNames: state.store.snapshots.map(s => s.name),
    });
    state.drawer = {
      type: 'saveSnapshot',
      name: named.primary,
      nameSuggestions: named.suggestions,
      group: state.snapGroup || state.charInfo.name || '',
      note: '',
      scope: {
        persona: defSc.persona !== false,
        worldbooks: defSc.worldbooks !== false,
        preset: defSc.preset !== false,
        regex: defSc.regex !== false,
        api: defSc.api !== false,
      },
      selectedBooks: getDefaultSnapshotBooks(state.store),
    };
    renderDrawer();
  }

  async function openSnapshotDetail(snap) {
    if (!snap) return;
    const wbDetails = {};
    if (snap.scope.worldbooks && snap.worldbooks?.entries) {
      await runWithConcurrency(Object.keys(snap.worldbooks.entries), 2, async bk => {
        wbDetails[bk] = await ensureBookEntries(bk, false);
      });
    }
    const presetNorm = (snap.scope.preset && snap.preset)
      ? Host.getPresetByNameNormalized(snap.preset.name)
      : null;
    const regexDetails = (snap.scope.regex && snap.regex)
      ? {
          global: await Host.getRegexes('global'),
          character: await Host.getRegexes('character'),
          preset: await Host.getRegexes('preset'),
        }
      : {};
    state.drawer = {
      type: 'viewSnapshot',
      snapshot: snap,
      draft: structuredClone(snap),
      dirty: false,
      pendingAction: null,
      subTab: snap.scope.preset ? 'preset' : snap.scope.worldbooks ? 'worldbooks' : snap.scope.persona ? 'persona' : 'regex',
      search: '',
      onlyOn: false,
      allExpanded: false,
      foldMap: {},
      expandedIds: new Set(),
      presetNorm,
      wbDetails,
      regexDetails,
    };
    renderDrawer();
  }

  function saveViewSnapshotDraft(d) {
    if (!d || d.type !== 'viewSnapshot' || !d.draft) return;
    const idx = state.store.snapshots.findIndex(x => x.id === d.snapshot.id);
    const saved = structuredClone(d.draft);
    saved.updatedAt = Date.now();
    if (idx >= 0) state.store.snapshots[idx] = saved;
    d.snapshot = saved;
    d.draft = structuredClone(saved);
    d.dirty = false;
    d.pendingAction = null;
    persistStore(state.store);
    if (state.tab === 'snapshots') renderSnapshotsBody();
    renderFooter();
    toast(`已保存快照「${saved.name}」的修改`, 'success');
  }

  async function requestApplySnapshot(snap, { fromFab = false } = {}) {
    if (!snap) return;
    const personas = Host.listPersonas();
    const worldbooks = Host.listWorldbooks();
    const presets = Host.listPresets();
    const apiProfiles = Host.listConnectionProfiles();
    const presetNorm = (snap.scope?.preset && snap.preset?.name && presets.includes(snap.preset.name))
      ? Host.getPresetByNameNormalized(snap.preset.name)
      : null;
    const health = inspectSnapshotHealth(snap, { personas, worldbooks, presets, presetNorm, apiProfiles });
    if (health.hasBlockingIssues) {
      state.personas = personas;
      state.worldbooks = worldbooks;
      state.presets = presets;
      state.apiProfiles = apiProfiles;
      if (fromFab) {
        if (state.open && state.minimized) {
          restoreModal();
        } else if (!state.open) {
          state.store = loadStore();
          applyThemeAll();
          state.minimized = false;
          elBackdrop.classList.remove('is-minimized');
          elBackdrop.removeAttribute('aria-hidden');
          elRestorePill.hidden = true;
          resetModalGeometry();
          state.open = true;
          elBackdrop.hidden = false;
          syncModalLayoutClasses();
          syncFabVisBtn();
          render();
        }
      }
      state.drawer = {
        type: 'missingAudit',
        snapshot: snap,
        health,
        personaRemap: '',
        presetRemap: '',
        apiProfileRemap: '',
        bookRemap: {},
      };
      renderDrawer();
      return;
    }
    await applySnapshotLive(snap, state.store);
    syncFabUi();
    if (state.open) await refreshAll(true);
  }

  function openConfirmOverwriteDrawer(sid) {
    const snap = state.store.snapshots.find(x => x.id === sid);
    if (!snap) return;
    state.drawer = { type: 'confirmOverwrite', snapshot: snap };
    renderDrawer();
  }

  async function scanChatsIntoBindDrawer(d, avatar) {
    d.scanCharAvatar = avatar || '';
    d.scannedChats = [];
    d.chatsError = '';
    if (!d.scanCharAvatar) {
      d.chatsLoading = false;
      renderBindChatList(d);
      return;
    }
    d.chatsLoading = true;
    renderBindChatList(d);
    try {
      const list = await Host.listCharacterChats(d.scanCharAvatar);
      if (state.drawer === d) {
        d.scannedChats = list;
        d.chatsLoading = false;
        renderBindChatList(d);
      }
    } catch (err) {
      if (state.drawer === d) {
        d.chatsLoading = false;
        d.chatsError = err?.message || '扫描聊天记录失败';
        renderBindChatList(d);
      }
    }
  }

  function openBindSnapshotDrawer(snap) {
    if (!snap) return;
    const allChars = Host.listAllCharacters();
    const d = {
      type: 'bindSnapshot',
      snapshot: snap,
      bindTab: 'char',
      allChars,
      charQuery: '',
      scanCharAvatar: state.charInfo.avatar || '',
      chatQuery: '',
      scannedChats: [],
      chatsLoading: false,
      chatsError: '',
    };
    state.drawer = d;
    renderDrawer();
  }

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
  // Events
  // =========================

  shadow.getElementById('upp-close-btn').addEventListener('click', closeModal);
  shadow.getElementById('upp-refresh-btn').addEventListener('click', () => { void refreshAll(true); });
  elMiniBtn.addEventListener('click', toggleMiniWindow);
  elMinBtn.addEventListener('click', minimizeModal);
  elRestorePill.addEventListener('click', restoreModal);

  elFooter.addEventListener('click', async ev => {
    const t = ev.target;
    if (t.closest('#upp-foot-save-snap-btn')) { openSaveSnapshotDrawer(); return; }
    const updBtn = t.closest('#upp-foot-update-btn');
    if (updBtn) openConfirmOverwriteDrawer(updBtn.getAttribute('data-snap-update'));
  });

  elTabs.addEventListener('click', async ev => {
    const btn = ev.target.closest('[data-tab]');
    if (!btn) return;
    const next = btn.getAttribute('data-tab');
    if (next === state.tab) return;
    state.tab = next;
    state.drawer = null;
    state.snapPendingDeleteId = '';
    state.wbAllOffConfirm = false;
    if (next === 'worldbook' && state.activeBook) await ensureBookEntries(state.activeBook, false);
    else if (next === 'regex') state.regexList = await Host.getRegexes(state.regexScope);
    else if (next === 'preset') {
      state.loadedPresetName = Host.getLoadedPresetName();
      state.livePresetNorm = Host.getLiveNormalizedPreset();
    } else if (next === 'user') {
      state.personas = Host.listPersonas();
      state.currentPersona = Host.getCurrentPersona();
    }
    render();
  });

  elToolbar.addEventListener('click', async ev => {
    const target = ev.target;

    if (target.closest('#upp-auto-bind-sw')) {
      state.store.settings.autoApplyBindings = !state.store.settings.autoApplyBindings;
      persistStore(state.store);
      const sw = shadow.getElementById('upp-auto-bind-sw');
      if (sw) sw.setAttribute('aria-checked', String(state.store.settings.autoApplyBindings));
      syncExtSettingsCheckbox();
      toast(state.store.settings.autoApplyBindings ? '已开启切换聊天自动切回快照' : '已暂停自动切换快照');
      return;
    }
    if (target.closest('#upp-snap-batch-btn')) {
      state.snapBatchMode = !state.snapBatchMode;
      state.snapSelectedIds.clear();
      state.snapBatchConfirm = false;
      state.snapPendingDeleteId = '';
      renderSnapshotsToolbar(); renderSnapshotsBody(); return;
    }
    if (target.closest('#upp-snap-preset-sync-btn')) { openPresetSyncDrawer(); return; }
    if (target.closest('#upp-backup-btn')) { state.drawer = { type: 'backup' }; renderDrawer(); return; }
    const gBtn = target.closest('[data-snap-group]');
    if (gBtn) { state.snapGroup = gBtn.getAttribute('data-snap-group') || ''; renderSnapshotsToolbar(); renderSnapshotsBody(); return; }

    if (target.closest('#upp-user-search-clear-btn')) {
      state.userSearch = '';
      renderUserToolbar(); renderUserBody(); return;
    }
    if (target.closest('#upp-persona-rename-btn') && state.currentPersona) {
      state.drawer = { type: 'renamePersona', avatarId: state.currentPersona.avatar_id, name: state.currentPersona.name || '' };
      renderDrawer(); return;
    }
    if (target.closest('#upp-persona-edit-btn') && state.currentPersona) {
      state.drawer = { type: 'entryEditor', mode: 'editPersona', heading: `编辑 User 正文 · ${state.currentPersona.name}`, content: state.currentPersona.description || '' };
      renderDrawer(); return;
    }
    if (target.closest('#upp-persona-savever-btn') && state.currentPersona) { state.drawer = { type: 'savePersonaVersion', name: '', displayName: state.currentPersona.name || '' }; renderDrawer(); return; }
    if (target.closest('#upp-persona-diff-btn') && state.currentPersona) { state.drawer = { type: 'personaDiff' }; renderDrawer(); return; }
    if (target.closest('#upp-persona-merge-btn')) {
      const dupGroups = detectProliferatedPersonas(state.personas);
      let keepId = state.currentPersona?.avatar_id || state.personas[0]?.avatar_id || '';
      let absorbIds = [];
      if (dupGroups.length) {
        const g = dupGroups[0];
        const main = g.items.find(x => x.avatar_id === keepId) || g.items[0];
        keepId = main.avatar_id;
        absorbIds = g.items.filter(x => x.avatar_id !== keepId).map(x => x.avatar_id);
      }
      const orphanAvatars = await Host.listOrphanAvatars();
      state.drawer = { type: 'mergePersonas', keepId, absorbIds, deleteOld: false, orphanAvatars, query: '', previewIds: new Set(), showKeepPreview: false };
      renderDrawer(); return;
    }

    if (target.closest('#upp-book-picker-btn')) { state.drawer = { type: 'bookPicker', query: '', foldMap: {} }; renderDrawer(); return; }
    if (target.closest('#upp-open-wbo-btn')) {
      closeModal();
      emitWindowEvent('wbo:open-panel');
      return;
    }
    if (target.closest('#upp-pin-book-btn') && state.activeBook) {
      const list = state.store.settings.pinnedWorldbooks;
      const idx = list.indexOf(state.activeBook);
      if (idx >= 0) list.splice(idx, 1); else list.unshift(state.activeBook);
      persistStore(state.store); renderWorldbookToolbar(); return;
    }
    if (target.closest('#upp-global-book-btn') && state.activeBook) {
      const next = new Set(state.globalWorldbooks);
      const turningOn = !next.has(state.activeBook);
      if (turningOn) next.add(state.activeBook); else next.delete(state.activeBook);
      await Host.setGlobalWorldbooks(Array.from(next));
      state.globalWorldbooks = Host.getGlobalWorldbooks();
      renderWorldbookToolbar();
      toast(turningOn ? `已将「${state.activeBook}」设为全局启用，所有聊天共用` : `已取消「${state.activeBook}」的全局启用`);
      return;
    }
    if (target.closest('#upp-new-wb-entry-btn') && state.activeBook) {
      state.drawer = { type: 'entryEditor', mode: 'createWb', heading: `新建条目 · ${state.activeBook}`, bookName: state.activeBook, allowNameEdit: true, showStrategy: true, strategyType: 'constant', name: '', content: '' };
      renderDrawer(); return;
    }
    if (target.closest('#upp-copy-wb-btn') && state.activeBook) {
      const text = buildCleanCopyText(getCachedBookEntries(state.activeBook) || []);
      if (!text) { toast('本世界书暂无已开启的非空条目', 'warning'); return; }
      try { await navigator.clipboard.writeText(text); toast('已复制当前已开条目纯文本', 'success'); }
      catch (_) { state.drawer = { type: 'entryEditor', heading: '复制纯文本', content: text, readOnly: true }; renderDrawer(); }
      return;
    }
    if (target.closest('#upp-wb-only-on-btn')) { state.wbOnlyOn = !state.wbOnlyOn; renderWorldbookToolbar(); renderWorldbookBody(); return; }
    if (target.closest('#upp-wb-all-off-btn') && state.activeBook) {
      const entries = getCachedBookEntries(state.activeBook) || [];
      const onCount = entries.filter(e => e.enabled).length;
      if (!onCount) { toast('本世界书已全部关闭'); return; }
      state.wbAllOffConfirm = true;
      renderWorldbookBody();
      return;
    }

    if (target.closest('#upp-preset-only-on-btn')) { state.presetOnlyOn = !state.presetOnlyOn; renderPresetToolbar(); renderPresetBody(); return; }
    if (target.closest('#upp-preset-fold-all-btn')) {
      const groups = state.livePresetNorm.groups || [];
      const anyExpanded = groups.some(g => !isPresetGroupCollapsed(g));
      groups.forEach(g => { state.presetFoldState[`${state.loadedPresetName}::${g.id}`] = anyExpanded; });
      renderPresetToolbar(); renderPresetBody(); return;
    }
    if (target.closest('#upp-preset-default-fold-sw')) {
      const next = !(state.store.settings.presetGroupsDefaultCollapsed !== false);
      state.store.settings.presetGroupsDefaultCollapsed = next;
      persistStore(state.store);
      state.presetFoldState = {};
      syncExtSettingsCheckbox();
      renderPresetToolbar(); renderPresetBody();
      toast(next ? '已设为预设分组默认折叠' : '已改为按预设自身展开状态显示');
      return;
    }
    if (target.closest('#upp-preset-sync-btn')) {
      openPresetSyncDrawer({ targetPreset: state.loadedPresetName });
      return;
    }
    if (target.closest('#upp-preset-save-disk-btn')) {
      try {
        await Host.saveActivePresetToDisk();
        toast(`已将开关与分组保存到预设「${state.loadedPresetName}」`, 'success');
      } catch (err) {
        toast('保存预设失败：' + (err?.message || err), 'error');
      }
      return;
    }

    const rgSc = target.closest('[data-rg-scope]');
    if (rgSc) {
      state.regexScope = rgSc.getAttribute('data-rg-scope') || 'global';
      state.regexList = await Host.getRegexes(state.regexScope);
      renderRegexToolbar(); renderRegexBody(); return;
    }
    if (target.closest('#upp-rg-only-on-btn')) { state.regexOnlyOn = !state.regexOnlyOn; renderRegexToolbar(); renderRegexBody(); }
  });

  function handleToolbarSearchInput(targetEl) {
    if (!targetEl) return;
    const id = targetEl.id;
    if (id === 'upp-snap-search') { state.snapSearch = targetEl.value; renderSnapshotsBody(); }
    else if (id === 'upp-user-search') {
      state.userSearch = targetEl.value;
      const clr = shadow.getElementById('upp-user-search-clear-btn');
      if (clr) clr.hidden = !state.userSearch;
      renderUserBody();
    }
    else if (id === 'upp-wb-search') { state.wbEntrySearch = targetEl.value; renderWorldbookBody(); }
    else if (id === 'upp-preset-search') { state.presetSearch = targetEl.value; renderPresetBody(); }
    else if (id === 'upp-rg-search') { state.regexSearch = targetEl.value; renderRegexBody(); }
  }
  elToolbar.addEventListener('compositionstart', ev => {
    if (ev.target) ev.target._uppComposing = true;
  });
  elToolbar.addEventListener('compositionend', ev => {
    if (ev.target) {
      ev.target._uppComposing = false;
      handleToolbarSearchInput(ev.target);
    }
  });
  elToolbar.addEventListener('input', ev => {
    if (ev.isComposing || ev.target?._uppComposing) return;
    handleToolbarSearchInput(ev.target);
  });

  elToolbar.addEventListener('change', async ev => {
    if (ev.target.id === 'upp-persona-select') {
      const targetId = ev.target.value;
      if (targetId) {
        await Host.switchPersona(targetId);
        state.currentPersona = Host.getCurrentPersona();
        renderHeader(); renderUserToolbar(); renderUserBody(); renderFooter();
      }
      return;
    }
    if (ev.target.id === 'upp-preset-select') {
      const targetPreset = ev.target.value;
      if (targetPreset && targetPreset !== state.loadedPresetName) {
        await Host.selectPresetByName(targetPreset);
        state.loadedPresetName = Host.getLoadedPresetName();
        state.livePresetNorm = Host.getLiveNormalizedPreset();
        state.expandedPresetIds.clear();
        renderPresetToolbar(); renderPresetBody(); renderFooter();
        toast('已切换预设：' + targetPreset, 'success');
      }
    }
  });

  elBody.addEventListener('click', async ev => {
    const t = ev.target;
    if (t.closest('[data-open-save-snap]')) { openSaveSnapshotDrawer(); return; }

    // Batch snapshot delete controls
    const batchCheck = t.closest('[data-snap-batch-check]');
    if (batchCheck) {
      const sid = batchCheck.getAttribute('data-snap-batch-check');
      if (sid) {
        if (batchCheck.checked) state.snapSelectedIds.add(sid);
        else state.snapSelectedIds.delete(sid);
        state.snapBatchConfirm = false;
        renderSnapshotsBody();
      }
      return;
    }
    if (t.closest('#upp-batch-select-all')) {
      const q = normalizeText(state.snapSearch);
      const visibleIds = state.store.snapshots
        .filter(s => (!state.snapGroup || s.group === state.snapGroup) && (!q || normalizeText(s.name + ' ' + s.group + ' ' + s.note).includes(q)))
        .map(s => s.id);
      const allOn = visibleIds.length > 0 && visibleIds.every(id => state.snapSelectedIds.has(id));
      visibleIds.forEach(id => { if (allOn) state.snapSelectedIds.delete(id); else state.snapSelectedIds.add(id); });
      state.snapBatchConfirm = false;
      renderSnapshotsBody(); return;
    }
    if (t.closest('#upp-batch-del-btn')) {
      if (state.snapSelectedIds.size) { state.snapBatchConfirm = true; renderSnapshotsBody(); }
      return;
    }
    if (t.closest('#upp-batch-del-cancel')) {
      state.snapBatchConfirm = false; renderSnapshotsBody(); return;
    }
    if (t.closest('#upp-batch-del-confirm')) {
      const delSet = new Set(state.snapSelectedIds);
      const delCount = delSet.size;
      state.store.snapshots = state.store.snapshots.filter(x => !delSet.has(x.id));
      Object.keys(state.store.bindings.chats).forEach(k => { if (delSet.has(state.store.bindings.chats[k])) delete state.store.bindings.chats[k]; });
      Object.keys(state.store.bindings.characters).forEach(k => { if (delSet.has(state.store.bindings.characters[k])) delete state.store.bindings.characters[k]; });
      state.snapSelectedIds.clear();
      state.snapBatchConfirm = false;
      state.snapBatchMode = false;
      persistStore(state.store);
      render();
      toast(`已批量删除 ${delCount} 份快照`, 'success');
      return;
    }

    const applyBtn = t.closest('[data-snap-apply]');
    if (applyBtn) {
      const snap = state.store.snapshots.find(x => x.id === applyBtn.getAttribute('data-snap-apply'));
      if (snap) await requestApplySnapshot(snap);
      return;
    }
    const viewBtn = t.closest('[data-snap-view]');
    if (viewBtn) {
      const snap = state.store.snapshots.find(x => x.id === viewBtn.getAttribute('data-snap-view'));
      if (snap) await openSnapshotDetail(snap);
      return;
    }
    const editSnapBtn = t.closest('[data-snap-edit]');
    if (editSnapBtn) {
      const snap = state.store.snapshots.find(x => x.id === editSnapBtn.getAttribute('data-snap-edit'));
      if (snap) {
        state.drawer = {
          type: 'editSnapshotMeta',
          snapshotId: snap.id,
          name: snap.name || '',
          group: snap.group || '',
          note: snap.note || '',
          scope: {
            persona: !!snap.scope.persona,
            worldbooks: !!snap.scope.worldbooks,
            preset: !!snap.scope.preset,
            regex: !!snap.scope.regex,
            api: !!snap.scope.api,
          },
        };
        renderDrawer();
      }
      return;
    }
    const updBtn = t.closest('[data-snap-update]');
    if (updBtn) { openConfirmOverwriteDrawer(updBtn.getAttribute('data-snap-update')); return; }
    const bindBtn = t.closest('[data-snap-bind]');
    if (bindBtn) {
      const snap = state.store.snapshots.find(x => x.id === bindBtn.getAttribute('data-snap-bind'));
      if (snap) openBindSnapshotDrawer(snap);
      return;
    }
    const delBtn = t.closest('[data-snap-del]');
    if (delBtn) {
      state.snapPendingDeleteId = delBtn.getAttribute('data-snap-del') || '';
      renderSnapshotsBody();
      return;
    }
    if (t.closest('[data-snap-del-cancel]')) {
      state.snapPendingDeleteId = '';
      renderSnapshotsBody();
      return;
    }
    const delConfirmBtn = t.closest('[data-snap-del-confirm]');
    if (delConfirmBtn) {
      const sid = delConfirmBtn.getAttribute('data-snap-del-confirm');
      state.snapPendingDeleteId = '';
      state.store.snapshots = state.store.snapshots.filter(x => x.id !== sid);
      Object.keys(state.store.bindings.chats).forEach(k => { if (state.store.bindings.chats[k] === sid) delete state.store.bindings.chats[k]; });
      Object.keys(state.store.bindings.characters).forEach(k => { if (state.store.bindings.characters[k] === sid) delete state.store.bindings.characters[k]; });
      persistStore(state.store); render(); toast('已删除快照'); return;
    }
    const unbindBtn = t.closest('[data-unbind-src]');
    if (unbindBtn) {
      const src = unbindBtn.getAttribute('data-unbind-src');
      if (src === 'chat' && state.chatId) delete state.store.bindings.chats[state.chatId];
      if (src === 'character' && state.charInfo.id) delete state.store.bindings.characters[state.charInfo.id];
      persistStore(state.store); renderSnapshotsBody(); renderFooter(); toast('已解除绑定'); return;
    }

    const userSwitchBtn = t.closest('[data-user-switch-id]');
    if (userSwitchBtn) {
      const targetId = userSwitchBtn.getAttribute('data-user-switch-id');
      if (targetId && targetId !== state.currentPersona?.avatar_id) {
        await Host.switchPersona(targetId);
        state.personas = Host.listPersonas();
        state.currentPersona = Host.getCurrentPersona();
        renderHeader(); renderUserToolbar(); renderUserBody(); renderFooter();
        toast(`已切换 User：${state.currentPersona?.name || ''}`, 'success');
      }
      return;
    }
    if (t.closest('#upp-persona-preview-box') && state.currentPersona) {
      state.drawer = { type: 'entryEditor', mode: 'editPersona', heading: `编辑 User 正文 · ${state.currentPersona.name}`, content: state.currentPersona.description || '' };
      renderDrawer(); return;
    }
    const pvView = t.closest('[data-pv-view]');
    if (pvView && state.currentPersona) {
      const list = state.store.personaVersions[state.currentPersona.avatar_id] || [];
      const ver = list.find(v => v.id === pvView.getAttribute('data-pv-view'));
      if (ver) {
        state.drawer = {
          type: 'entryEditor',
          mode: 'editPersonaVersion',
          versionId: ver.id,
          heading: `编辑内部版本 · ${state.currentPersona.name}`,
          allowNameEdit: true,
          allowDisplayName: true,
          name: ver.name,
          displayName: ver.displayName || '',
          content: ver.description || '',
        };
        renderDrawer();
      }
      return;
    }
    const pvApply = t.closest('[data-pv-apply]');
    if (pvApply && state.currentPersona) {
      const list = state.store.personaVersions[state.currentPersona.avatar_id] || [];
      const ver = list.find(v => v.id === pvApply.getAttribute('data-pv-apply'));
      if (ver) {
        autoBackupPersonaBeforeOverwrite(state.store, state.currentPersona);
        persistStore(state.store);
        const targetId = state.currentPersona.avatar_id;
        if (ver.displayName && ver.displayName !== state.currentPersona.name) {
          await Host.renamePersonaInPlace(targetId, ver.displayName);
        }
        await Host.updatePersonaInPlace(targetId, ver.description, ver.lorebook || undefined);
        state.personas = Host.listPersonas();
        state.currentPersona = Host.getCurrentPersona();
        renderHeader(); renderUserToolbar(); renderUserBody(); renderFooter();
        toast(ver.displayName ? `已切换至「${ver.name}」（名字：${ver.displayName}）` : `已切换至「${ver.name}」`, 'success');
      }
      return;
    }
    const pvDelInline = t.closest('[data-pv-del-inline]');
    if (pvDelInline && state.currentPersona) {
      const aid = state.currentPersona.avatar_id;
      state.store.personaVersions[aid] = (state.store.personaVersions[aid] || []).filter(v => v.id !== pvDelInline.getAttribute('data-pv-del-inline'));
      persistStore(state.store); renderUserToolbar(); renderUserBody(); toast('已删除内部版本'); return;
    }

    if (t.closest('#upp-wb-all-off-cancel') && state.activeBook) {
      state.wbAllOffConfirm = false;
      renderWorldbookBody();
      return;
    }
    if (t.closest('#upp-wb-all-off-confirm') && state.activeBook) {
      const entries = getCachedBookEntries(state.activeBook) || [];
      const offMap = {};
      entries.forEach(e => { if (e.enabled) offMap[String(e.uid)] = false; });
      state.wbAllOffConfirm = false;
      if (!Object.keys(offMap).length) { renderWorldbookBody(); toast('本世界书已全部关闭'); return; }
      await Host.batchToggleWorldbookEntries(state.activeBook, offMap);
      await ensureBookEntries(state.activeBook, true);
      renderWorldbookBody();
      toast('已关闭本世界书全部条目');
      return;
    }

    const wbSw = t.closest('[data-wb-toggle]');
    if (wbSw && state.activeBook) {
      const u = wbSw.getAttribute('data-wb-toggle');
      const entry = (getCachedBookEntries(state.activeBook) || []).find(e => String(e.uid) === String(u));
      if (!entry) return;
      const next = !entry.enabled;
      entry.enabled = next;
      wbSw.setAttribute('aria-checked', String(next));
      wbSw.closest('.upp-entry-row')?.classList.toggle('is-on', next);
      try {
        await Host.toggleWorldbookEntry(state.activeBook, u, next);
        if (state.wbOnlyOn && !next) renderWorldbookBody();
      } catch (err) {
        entry.enabled = !next; wbSw.setAttribute('aria-checked', String(!next));
        wbSw.closest('.upp-entry-row')?.classList.toggle('is-on', !next);
        toast('切换失败：' + (err?.message || err), 'error');
      }
      return;
    }
    if (t.closest('#upp-wb-jump-hygiene-btn') && state.activeBook) {
      const entries = getCachedBookEntries(state.activeBook) || [];
      const hygiene = inspectTagHygiene(entries);
      const problemEntries = entries.filter(e => {
        const h = hygiene.byUid[String(e.uid)];
        return h && (h.unclosed.length > 0 || h.duplicateTags.length > 0);
      });
      if (!problemEntries.length) return;
      const idx = state.wbHygieneCursor % problemEntries.length;
      state.wbHygieneCursor = (idx + 1) % problemEntries.length;
      const target = problemEntries[idx];
      const uidKey = String(target.uid);
      if (state.wbEntrySearch) {
        state.wbEntrySearch = '';
        renderWorldbookToolbar();
      }
      state.expandedWbUids.add(uidKey);
      renderWorldbookBody();
      const rowEl = elBody.querySelector(`[data-wb-wrap="${CSS.escape(uidKey)}"]`);
      if (rowEl) rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const h = hygiene.byUid[uidKey];
      const detail = [
        h.unclosed.length ? '未闭合: ' + h.unclosed.join(', ') : '',
        h.duplicateTags.length ? '重复包裹: ' + h.duplicateTags.join(', ') : '',
      ].filter(Boolean).join('；');
      toast(`已定位到「${target.name}」（${detail}）`, 'warning');
      return;
    }
    const wbOpen = t.closest('[data-wb-open]');
    if (wbOpen && state.activeBook) {
      const uidKey = wbOpen.getAttribute('data-wb-open');
      if (uidKey) {
        const scrollTop = elBody.scrollTop;
        if (state.expandedWbUids.has(uidKey)) state.expandedWbUids.delete(uidKey);
        else state.expandedWbUids.add(uidKey);
        renderWorldbookBody();
        elBody.scrollTop = scrollTop;
      }
      return;
    }
    const wbInlineClose = t.closest('[data-wb-inline-close]');
    if (wbInlineClose) {
      const uidKey = wbInlineClose.getAttribute('data-wb-inline-close');
      if (uidKey) {
        const scrollTop = elBody.scrollTop;
        state.expandedWbUids.delete(uidKey);
        renderWorldbookBody();
        elBody.scrollTop = scrollTop;
      }
      return;
    }
    const wbInlineCopy = t.closest('[data-wb-inline-copy]');
    if (wbInlineCopy) {
      const panel = wbInlineCopy.closest('.upp-inline-panel');
      const content = panel?.querySelector('[data-wb-inline-content]')?.value ?? '';
      try { await navigator.clipboard.writeText(content); toast('已复制世界书条目正文', 'success'); }
      catch (_) { toast('当前环境不支持自动复制', 'warning'); }
      return;
    }
    const wbInlineSave = t.closest('[data-wb-inline-save]');
    if (wbInlineSave && state.activeBook) {
      const uidKey = wbInlineSave.getAttribute('data-wb-inline-save');
      const panel = wbInlineSave.closest('.upp-inline-panel');
      const name = (panel?.querySelector('[data-wb-inline-name]')?.value || '').trim();
      const strategyType = panel?.querySelector('[data-wb-inline-strategy]')?.value;
      const content = panel?.querySelector('[data-wb-inline-content]')?.value ?? '';
      try {
        await Host.updateWorldbookEntry(state.activeBook, uidKey, name || '未命名条目', content, strategyType);
        await ensureBookEntries(state.activeBook, true);
        const scrollTop = elBody.scrollTop;
        renderWorldbookBody();
        elBody.scrollTop = scrollTop;
        toast('已保存世界书条目', 'success');
      } catch (err) {
        toast('保存失败：' + (err?.message || err), 'error');
      }
      return;
    }

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
    if (prgSw) {
      const gid = prgSw.getAttribute('data-prg-toggle');
      const grp = (state.livePresetNorm.groups || []).find(g => String(g.id) === String(gid));
      if (!grp) return;
      const next = !grp.enabled;
      grp.enabled = next;
      prgSw.setAttribute('aria-checked', String(next));
      prgSw.closest('.upp-group-box')?.classList.toggle('is-disabled', !next);
      try {
        await Host.togglePresetGroup(gid, next);
        if (state.presetOnlyOn && !next) renderPresetBody();
      } catch (err) {
        grp.enabled = !next; prgSw.setAttribute('aria-checked', String(!next));
        prgSw.closest('.upp-group-box')?.classList.toggle('is-disabled', next);
        toast('切换分组失败：' + (err?.message || err), 'error');
      }
      return;
    }
    const prSw = t.closest('[data-pr-toggle]');
    if (prSw) {
      const pid = prSw.getAttribute('data-pr-toggle');
      const item = (state.livePresetNorm.prompts || []).find(p => p.id === pid);
      if (!item) return;
      const next = !item.enabled;
      item.enabled = next;
      prSw.setAttribute('aria-checked', String(next));
      prSw.closest('.upp-entry-row')?.classList.toggle('is-on', next);
      try {
        await Host.togglePresetPrompt(pid, next);
        if (state.presetOnlyOn && !next) renderPresetBody();
      } catch (err) {
        item.enabled = !next; prSw.setAttribute('aria-checked', String(!next));
        prSw.closest('.upp-entry-row')?.classList.toggle('is-on', !next);
        toast('切换预设条目失败：' + (err?.message || err), 'error');
      }
      return;
    }
    const prOpen = t.closest('[data-pr-open]');
    if (prOpen) {
      const pid = prOpen.getAttribute('data-pr-open');
      const item = (state.livePresetNorm.prompts || []).find(p => p.id === pid);
      if (pid && item && !item.marker && typeof item.content === 'string') {
        const scrollTop = elBody.scrollTop;
        if (state.expandedPresetIds.has(pid)) state.expandedPresetIds.delete(pid);
        else state.expandedPresetIds.add(pid);
        renderPresetBody();
        elBody.scrollTop = scrollTop;
      }
      return;
    }
    const prInlineClose = t.closest('[data-pr-inline-close]');
    if (prInlineClose) {
      const pid = prInlineClose.getAttribute('data-pr-inline-close');
      if (pid) {
        const scrollTop = elBody.scrollTop;
        state.expandedPresetIds.delete(pid);
        renderPresetBody();
        elBody.scrollTop = scrollTop;
      }
      return;
    }
    const prInlineCopy = t.closest('[data-pr-inline-copy]');
    if (prInlineCopy) {
      const panel = prInlineCopy.closest('.upp-inline-panel');
      const content = panel?.querySelector('[data-pr-inline-content]')?.value ?? '';
      try { await navigator.clipboard.writeText(content); toast('已复制提示词正文', 'success'); }
      catch (_) { toast('当前环境不支持自动复制，请手动全选复制', 'warning'); }
      return;
    }
    const prInlineSave = t.closest('[data-pr-inline-save]');
    if (prInlineSave) {
      const pid = prInlineSave.getAttribute('data-pr-inline-save');
      const panel = prInlineSave.closest('.upp-inline-panel');
      const name = (panel?.querySelector('[data-pr-inline-name]')?.value || '').trim();
      const content = panel?.querySelector('[data-pr-inline-content]')?.value ?? '';
      try {
        await Host.updatePresetPrompt(pid, name || pid, content);
        state.livePresetNorm = Host.getLiveNormalizedPreset();
        const scrollTop = elBody.scrollTop;
        renderPresetBody();
        elBody.scrollTop = scrollTop;
        toast('已保存预设提示词', 'success');
      } catch (err) {
        toast('保存失败：' + (err?.message || err), 'error');
      }
      return;
    }

    const rgSw = t.closest('[data-rg-toggle]');
    if (rgSw) {
      const rid = rgSw.getAttribute('data-rg-toggle');
      const item = (state.regexList || []).find(r => r.id === rid);
      if (!item) return;
      const next = !item.enabled;
      item.enabled = next;
      rgSw.setAttribute('aria-checked', String(next));
      rgSw.closest('.upp-entry-row')?.classList.toggle('is-on', next);
      try {
        await Host.toggleRegex(state.regexScope, rid, next);
        if (state.regexOnlyOn && !next) renderRegexBody();
      } catch (err) {
        item.enabled = !next; rgSw.setAttribute('aria-checked', String(!next));
        rgSw.closest('.upp-entry-row')?.classList.toggle('is-on', !next);
        toast('切换正则失败：' + (err?.message || err), 'error');
      }
      return;
    }
    const rgOpen = t.closest('[data-rg-open]');
    if (rgOpen) {
      const item = (state.regexList || []).find(r => r.id === rgOpen.getAttribute('data-rg-open'));
      if (item) {
        const scopeLabel = state.regexScope === 'character' ? '当前角色' : state.regexScope === 'preset' ? '当前预设' : '全局';
        state.drawer = { type: 'entryEditor', heading: `正则详情 · ${item.script_name}`, content: `【查找正则】\n${item.find_regex}\n\n【替换为】\n${item.replace_string}`, readOnly: true, meta: `范围：${scopeLabel} · 状态：${item.enabled ? '开启' : '关闭'}` };
        renderDrawer();
      }
    }
  });

  // Drawer input/change/click
  function handleDrawerSearchInput(targetEl) {
    const d = state.drawer;
    if (!d || !targetEl) return;
    if (d.type === 'viewSnapshot' && targetEl.id === 'upp-sv-search') {
      d.search = targetEl.value;
      renderViewSnapshotBody(d);
      return;
    }
    if (d.type === 'bookPicker' && targetEl.id === 'upp-book-search-input') {
      d.query = targetEl.value;
      renderBookPickerList(d);
      return;
    }
    if (d.type === 'mergePersonas' && targetEl.id === 'upp-merge-search') {
      d.query = targetEl.value;
      renderMergeCandidateList(d);
      return;
    }
    if (d.type === 'bindSnapshot') {
      if (targetEl.id === 'upp-bind-char-search') { d.charQuery = targetEl.value; renderBindCharList(d); return; }
      if (targetEl.id === 'upp-bind-chat-search') { d.chatQuery = targetEl.value; renderBindChatList(d); return; }
    }
    if (d.type === 'presetSync' && targetEl.id === 'upp-ps-ov-search') {
      d.overrideSearch = targetEl.value;
      renderPresetSyncOverrideList(d);
    }
  }
  elDrawerMask.addEventListener('compositionstart', ev => {
    if (ev.target) ev.target._uppComposing = true;
  });
  elDrawerMask.addEventListener('compositionend', ev => {
    if (ev.target) {
      ev.target._uppComposing = false;
      handleDrawerSearchInput(ev.target);
    }
  });
  elDrawerMask.addEventListener('input', ev => {
    if (ev.isComposing || ev.target?._uppComposing) return;
    handleDrawerSearchInput(ev.target);
  });

  elDrawerMask.addEventListener('change', ev => {
    const d = state.drawer;
    if (!d) return;
    if (d.type === 'presetSync') {
      if (ev.target.id === 'upp-ps-source-sel') {
        d.sourcePreset = ev.target.value;
        d.selectedSnapIds = null;
        d.newPromptDecisions = {};
        recomputePresetSyncAnalysis(d);
        renderDrawer();
        return;
      }
      if (ev.target.id === 'upp-ps-target-sel') {
        d.targetPreset = ev.target.value;
        d.newPromptDecisions = {};
        recomputePresetSyncAnalysis(d);
        renderDrawer();
        return;
      }
      if (ev.target.hasAttribute('data-ps-snap')) {
        const sid = ev.target.getAttribute('data-ps-snap');
        const set = new Set(d.selectedSnapIds || []);
        if (ev.target.checked) set.add(sid); else set.delete(sid);
        d.selectedSnapIds = Array.from(set);
        recomputePresetSyncAnalysis(d);
        renderDrawer();
        return;
      }
      if (ev.target.hasAttribute('data-ps-new-inc')) {
        const pid = ev.target.getAttribute('data-ps-new-inc');
        const cur = d.newPromptDecisions[pid] || { include: true, enabled: true, inheritFromOldId: '' };
        cur.include = !!ev.target.checked;
        if (!cur.include) cur.inheritFromOldId = '';
        d.newPromptDecisions[pid] = cur;
        renderDrawer();
        return;
      }
      if (ev.target.hasAttribute('data-ps-new-inherit')) {
        const pid = ev.target.getAttribute('data-ps-new-inherit');
        const cur = d.newPromptDecisions[pid] || { include: true, enabled: true, inheritFromOldId: '' };
        cur.inheritFromOldId = ev.target.value || '';
        if (cur.inheritFromOldId) cur.include = true;
        d.newPromptDecisions[pid] = cur;
        renderDrawer();
        return;
      }
      if (ev.target.hasAttribute('data-ps-ov-grp')) {
        const gid = ev.target.getAttribute('data-ps-ov-grp');
        const g = (d.targetPresetNorm?.groups || []).find(x => x.id === gid);
        if (ev.target.checked && g) d.forceOverrideGroups[gid] = g.enabled !== false;
        else delete d.forceOverrideGroups[gid];
        renderPresetSyncOverrideList(d);
        return;
      }
      if (ev.target.hasAttribute('data-ps-ov-pr')) {
        const pid = ev.target.getAttribute('data-ps-ov-pr');
        const p = (d.targetPresetNorm?.prompts || []).find(x => x.id === pid);
        if (ev.target.checked && p) d.forceOverridePrompts[pid] = !!p.enabled;
        else delete d.forceOverridePrompts[pid];
        renderPresetSyncOverrideList(d);
        return;
      }
      if (ev.target.id === 'upp-ps-clean-removed') { d.cleanRemovedIds = !!ev.target.checked; return; }
      if (ev.target.id === 'upp-ps-sync-groups') { d.syncNewGroups = !!ev.target.checked; return; }
      return;
    }
    if (d.type === 'viewSnapshot' && ev.target.id === 'upp-sv-api-profile-sel' && d.draft?.api) {
      const pid = ev.target.value || '';
      const prof = (state.apiProfiles || Host.listConnectionProfiles()).find(x => x.id === pid);
      d.draft.api.profileId = prof ? prof.id : '';
      d.draft.api.profileName = prof ? prof.name : '';
      if (prof?.api) d.draft.api.source = prof.api;
      if (prof?.model) d.draft.api.model = prof.model;
      d.dirty = true;
      d.pendingAction = null;
      renderDrawer();
      return;
    }
    if (d.type === 'editSnapshotMeta') {
      if (!d.scope) d.scope = {};
      if (ev.target.id === 'upp-em-sc-persona') d.scope.persona = !!ev.target.checked;
      else if (ev.target.id === 'upp-em-sc-wb') d.scope.worldbooks = !!ev.target.checked;
      else if (ev.target.id === 'upp-em-sc-preset') d.scope.preset = !!ev.target.checked;
      else if (ev.target.id === 'upp-em-sc-api') d.scope.api = !!ev.target.checked;
      else if (ev.target.id === 'upp-em-sc-regex') d.scope.regex = !!ev.target.checked;
      return;
    }
    if (d.type === 'missingAudit') {
      if (ev.target.id === 'upp-ma-persona-sel') { d.personaRemap = ev.target.value; renderDrawer(); }
      else if (ev.target.id === 'upp-ma-preset-sel') { d.presetRemap = ev.target.value; renderDrawer(); }
      else if (ev.target.id === 'upp-ma-api-sel') { d.apiProfileRemap = ev.target.value; renderDrawer(); }
      else if (ev.target.hasAttribute('data-ma-book-sel')) {
        const bk = ev.target.getAttribute('data-ma-book-sel');
        if (!d.bookRemap) d.bookRemap = {};
        d.bookRemap[bk] = ev.target.value;
        renderDrawer();
      }
      return;
    }
    if (d.type === 'saveSnapshot') {
      let scopeTouched = false;
      if (ev.target.id === 'upp-sc-persona') { d.scope.persona = ev.target.checked; scopeTouched = true; }
      else if (ev.target.id === 'upp-sc-wb') {
        d.scope.worldbooks = ev.target.checked;
        scopeTouched = true;
        const wrap = shadow.getElementById('upp-ss-books-wrap');
        if (wrap) wrap.hidden = !d.scope.worldbooks;
      }
      else if (ev.target.id === 'upp-sc-preset') { d.scope.preset = ev.target.checked; scopeTouched = true; }
      else if (ev.target.id === 'upp-sc-api') { d.scope.api = ev.target.checked; scopeTouched = true; }
      else if (ev.target.id === 'upp-sc-regex') { d.scope.regex = ev.target.checked; scopeTouched = true; }
      else if (ev.target.hasAttribute('data-ss-book')) {
        const bk = ev.target.getAttribute('data-ss-book');
        const set = new Set(d.selectedBooks || []);
        if (ev.target.checked) set.add(bk); else set.delete(bk);
        d.selectedBooks = Array.from(set);
        const lbl = shadow.querySelector('#upp-ss-books-wrap > label');
        if (lbl) lbl.textContent = `记录条目开关的世界书 · 已选 ${set.size} 本`;
      }
      if (scopeTouched) {
        state.store.settings.defaultSnapshotScope = { ...d.scope };
        persistStore(state.store);
      }
      return;
    }
    if (d.type === 'personaDiff') {
      if (ev.target.id === 'upp-diff-left') { d.leftId = ev.target.value; renderDrawer(); }
      else if (ev.target.id === 'upp-diff-right') { d.rightId = ev.target.value; renderDrawer(); }
      return;
    }
    if (d.type === 'bindSnapshot' && ev.target.id === 'upp-bind-chat-char-sel') {
      const avatar = ev.target.value || '';
      const rescanBtn = shadow.getElementById('upp-bind-rescan-btn');
      if (rescanBtn) rescanBtn.disabled = !avatar;
      void scanChatsIntoBindDrawer(d, avatar);
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
        ev.target.closest('.upp-merge-row')?.classList.toggle('is-checked', ev.target.checked);
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

  elDrawerMask.addEventListener('click', async ev => {
    const t = ev.target;
    const d = state.drawer;
    if (!d) return;

    if (t.closest('[data-drawer-close]')) {
      state.drawer = d.returnTo || null;
      renderDrawer();
      return;
    }

    if (d.type === 'viewSnapshot') {
      const markDraftDirty = () => {
        const wasDirty = d.dirty;
        d.dirty = true;
        d.pendingAction = null;
        if (!wasDirty) {
          const saveBtn = shadow.getElementById('upp-sv-save-btn');
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.classList.add('primary');
            saveBtn.innerHTML = `${ICONS.save}<span>保存修改</span>`;
          }
          const applyBtn = shadow.getElementById('upp-sv-apply-btn');
          if (applyBtn) applyBtn.classList.remove('primary');
          const titleWrap = shadow.querySelector('.upp-drawer-head .upp-row-nowrap');
          if (titleWrap && !titleWrap.querySelector('.upp-badge.warn')) {
            const b = document.createElement('span');
            b.className = 'upp-badge warn';
            b.textContent = '未保存';
            titleWrap.appendChild(b);
          }
        }
      };

      if (t.closest('[data-sv-back]')) {
        if (d.dirty) { d.pendingAction = 'close'; renderDrawer(); }
        else { state.drawer = null; renderDrawer(); }
        return;
      }
      if (t.closest('#upp-sv-save-btn')) {
        saveViewSnapshotDraft(d);
        renderDrawer();
        return;
      }
      if (t.closest('#upp-sv-edit-meta-btn')) {
        const cur = d.draft || d.snapshot;
        state.drawer = {
          type: 'editSnapshotMeta',
          snapshotId: d.snapshot.id,
          name: cur.name || '',
          group: cur.group || '',
          note: cur.note || '',
          scope: {
            persona: !!cur.scope.persona,
            worldbooks: !!cur.scope.worldbooks,
            preset: !!cur.scope.preset,
            regex: !!cur.scope.regex,
            api: !!cur.scope.api,
          },
          returnTo: d,
        };
        renderDrawer();
        return;
      }
      if (t.closest('#upp-sv-apply-btn')) {
        if (d.dirty) { d.pendingAction = 'apply'; renderDrawer(); return; }
        const targetSnap = d.snapshot;
        state.drawer = null;
        renderDrawer();
        await requestApplySnapshot(targetSnap);
        return;
      }
      if (t.closest('#upp-sv-unsaved-save')) {
        const act = d.pendingAction;
        saveViewSnapshotDraft(d);
        const targetSnap = d.snapshot;
        state.drawer = null;
        renderDrawer();
        if (act === 'apply') await requestApplySnapshot(targetSnap);
        return;
      }
      if (t.closest('#upp-sv-unsaved-discard')) {
        const act = d.pendingAction;
        const origSnap = d.snapshot;
        d.dirty = false;
        d.pendingAction = null;
        state.drawer = null;
        renderDrawer();
        if (act === 'apply') await requestApplySnapshot(origSnap);
        return;
      }
      if (t.closest('#upp-sv-unsaved-cancel')) {
        d.pendingAction = null;
        renderDrawer();
        return;
      }

      const tabBtn = t.closest('[data-sv-tab]');
      if (tabBtn) { d.subTab = tabBtn.getAttribute('data-sv-tab'); d.search = ''; d.expandedIds?.clear(); renderDrawer(); return; }
      if (t.closest('#upp-sv-only-on')) { d.onlyOn = !d.onlyOn; renderDrawer(); return; }
      if (t.closest('#upp-sv-fold-all')) {
        d.allExpanded = !d.allExpanded;
        (d.presetNorm?.groups || []).forEach(g => { d.foldMap[g.id] = !d.allExpanded; });
        renderDrawer(); return;
      }
      const svGrpToggle = t.closest('[data-sv-grp-toggle]');
      if (svGrpToggle && d.draft?.preset) {
        const gid = svGrpToggle.getAttribute('data-sv-grp-toggle');
        if (!d.draft.preset.groups) d.draft.preset.groups = {};
        const fallback = d.presetNorm?.groupsById?.[gid]?.enabled !== false;
        const cur = Object.prototype.hasOwnProperty.call(d.draft.preset.groups, gid)
          ? d.draft.preset.groups[gid] !== false
          : fallback;
        d.draft.preset.groups[gid] = !cur;
        markDraftDirty();
        const bodyEl = shadow.getElementById('upp-snap-inspect-body');
        const st = bodyEl ? bodyEl.scrollTop : 0;
        renderViewSnapshotBody(d);
        if (bodyEl) bodyEl.scrollTop = st;
        return;
      }
      const svPrToggle = t.closest('[data-sv-pr-toggle]');
      if (svPrToggle && d.draft?.preset) {
        const pid = svPrToggle.getAttribute('data-sv-pr-toggle');
        if (!d.draft.preset.prompts) d.draft.preset.prompts = {};
        const liveDef = (d.presetNorm?.prompts || []).find(p => p.id === pid);
        const cur = Object.prototype.hasOwnProperty.call(d.draft.preset.prompts, pid)
          ? d.draft.preset.prompts[pid] === true
          : !!liveDef?.enabled;
        d.draft.preset.prompts[pid] = !cur;
        markDraftDirty();
        const bodyEl = shadow.getElementById('upp-snap-inspect-body');
        const st = bodyEl ? bodyEl.scrollTop : 0;
        renderViewSnapshotBody(d);
        if (bodyEl) bodyEl.scrollTop = st;
        return;
      }
      const svWbToggle = t.closest('[data-sv-wb-toggle]');
      if (svWbToggle && d.draft?.worldbooks?.entries) {
        const bk = svWbToggle.getAttribute('data-sv-wb-toggle');
        const u = svWbToggle.getAttribute('data-sv-wb-uid');
        if (d.draft.worldbooks.entries[bk]) {
          d.draft.worldbooks.entries[bk][u] = !d.draft.worldbooks.entries[bk][u];
          markDraftDirty();
          const bodyEl = shadow.getElementById('upp-snap-inspect-body');
          const st = bodyEl ? bodyEl.scrollTop : 0;
          renderViewSnapshotBody(d);
          if (bodyEl) bodyEl.scrollTop = st;
        }
        return;
      }
      const svRgToggle = t.closest('[data-sv-rg-toggle]');
      if (svRgToggle && d.draft?.regex) {
        const sc = svRgToggle.getAttribute('data-sv-rg-toggle');
        const rid = svRgToggle.getAttribute('data-sv-rg-id');
        if (d.draft.regex[sc]) {
          d.draft.regex[sc][rid] = !d.draft.regex[sc][rid];
          markDraftDirty();
          const bodyEl = shadow.getElementById('upp-snap-inspect-body');
          const st = bodyEl ? bodyEl.scrollTop : 0;
          renderViewSnapshotBody(d);
          if (bodyEl) bodyEl.scrollTop = st;
        }
        return;
      }
      const foldBtn = t.closest('[data-sv-fold]');
      if (foldBtn) {
        const gid = foldBtn.getAttribute('data-sv-fold');
        const box = foldBtn.closest('.upp-group-box');
        if (box && gid) {
          const next = !box.classList.contains('is-collapsed');
          box.classList.toggle('is-collapsed', next);
          d.foldMap[gid] = next;
        }
        return;
      }
      const prItem = t.closest('[data-view-snap-pr]');
      if (prItem) {
        const pid = prItem.getAttribute('data-view-snap-pr');
        const live = (d.presetNorm?.prompts || []).find(p => p.id === pid);
        if (pid && live && !live.marker && typeof live.content === 'string') {
          if (!d.expandedIds) d.expandedIds = new Set();
          const bodyEl = shadow.getElementById('upp-snap-inspect-body');
          const scrollTop = bodyEl ? bodyEl.scrollTop : 0;
          if (d.expandedIds.has(pid)) d.expandedIds.delete(pid);
          else d.expandedIds.add(pid);
          renderViewSnapshotBody(d);
          if (bodyEl) bodyEl.scrollTop = scrollTop;
        }
        return;
      }
      const svPrClose = t.closest('[data-sv-pr-close]');
      if (svPrClose) {
        const pid = svPrClose.getAttribute('data-sv-pr-close');
        if (pid && d.expandedIds) {
          const bodyEl = shadow.getElementById('upp-snap-inspect-body');
          const scrollTop = bodyEl ? bodyEl.scrollTop : 0;
          d.expandedIds.delete(pid);
          renderViewSnapshotBody(d);
          if (bodyEl) bodyEl.scrollTop = scrollTop;
        }
        return;
      }
      const svPrCopy = t.closest('[data-sv-pr-copy]');
      if (svPrCopy) {
        const pid = svPrCopy.getAttribute('data-sv-pr-copy');
        const live = (d.presetNorm?.prompts || []).find(p => p.id === pid);
        if (live && typeof live.content === 'string') {
          try { await navigator.clipboard.writeText(live.content); toast('已复制提示词正文', 'success'); }
          catch (_) { toast('当前环境不支持自动复制', 'warning'); }
        }
        return;
      }
      const wbItem = t.closest('[data-view-snap-wb]');
      if (wbItem) {
        const bk = wbItem.getAttribute('data-view-snap-wb');
        const u = wbItem.getAttribute('data-view-snap-uid');
        const live = bk && u ? (d.wbDetails[bk] || []).find(e => String(e.uid) === String(u)) : null;
        if (bk && u && live && String(live.content || '').trim()) {
          const expKey = `wb::${bk}::${u}`;
          if (!d.expandedIds) d.expandedIds = new Set();
          const bodyEl = shadow.getElementById('upp-snap-inspect-body');
          const scrollTop = bodyEl ? bodyEl.scrollTop : 0;
          if (d.expandedIds.has(expKey)) d.expandedIds.delete(expKey);
          else d.expandedIds.add(expKey);
          renderViewSnapshotBody(d);
          if (bodyEl) bodyEl.scrollTop = scrollTop;
        }
        return;
      }
      const svWbClose = t.closest('[data-sv-wb-close]');
      if (svWbClose) {
        const expKey = svWbClose.getAttribute('data-sv-wb-close');
        if (expKey && d.expandedIds) {
          const bodyEl = shadow.getElementById('upp-snap-inspect-body');
          const scrollTop = bodyEl ? bodyEl.scrollTop : 0;
          d.expandedIds.delete(expKey);
          renderViewSnapshotBody(d);
          if (bodyEl) bodyEl.scrollTop = scrollTop;
        }
        return;
      }
      const svWbCopy = t.closest('[data-sv-wb-copy]');
      if (svWbCopy) {
        const bk = svWbCopy.getAttribute('data-sv-wb-copy');
        const u = svWbCopy.getAttribute('data-sv-wb-copy-uid');
        const live = (d.wbDetails[bk] || []).find(e => String(e.uid) === String(u));
        if (live) {
          try { await navigator.clipboard.writeText(live.content || ''); toast('已复制世界书条目正文', 'success'); }
          catch (_) { toast('当前环境不支持自动复制', 'warning'); }
        }
        return;
      }
      const rgItem = t.closest('[data-view-snap-rg]');
      if (rgItem) {
        const sc = rgItem.getAttribute('data-view-snap-rg');
        const rid = rgItem.getAttribute('data-view-snap-rgid');
        const live = (d.regexDetails[sc] || []).find(r => String(r.id) === String(rid));
        if (live) {
          state.drawer = {
            type: 'entryEditor',
            fullView: true,
            heading: `正则 · ${live.script_name}`,
            content: `【查找正则】\n${live.find_regex}\n\n【替换为】\n${live.replace_string}`,
            readOnly: true,
            returnTo: d,
          };
          renderDrawer();
        }
        return;
      }
      return;
    }

    if (d.type === 'editSnapshotMeta') {
      if (t.closest('#upp-em-name-clear')) {
        const inp = shadow.getElementById('upp-em-name');
        if (inp) { inp.value = ''; if (canAutoFocusDesktop()) inp.focus(); }
        return;
      }
      const fillEmGrp = t.closest('[data-em-fill-group]');
      if (fillEmGrp) {
        const inp = shadow.getElementById('upp-em-group');
        if (inp) inp.value = fillEmGrp.getAttribute('data-em-fill-group') || '';
        return;
      }
      if (t.closest('#upp-em-save-btn')) {
        const nextName = (shadow.getElementById('upp-em-name')?.value || '').trim().slice(0, 60);
        if (!nextName) { toast('请填写快照名称', 'warning'); return; }
        const nextGroup = (shadow.getElementById('upp-em-group')?.value || '').trim().slice(0, 30);
        const nextNote = (shadow.getElementById('upp-em-note')?.value || '').trim().slice(0, 120);
        const wantedScope = d.scope || {};
        if (!wantedScope.persona && !wantedScope.worldbooks && !wantedScope.preset && !wantedScope.regex && !wantedScope.api) {
          toast('请至少保留一项包含模块', 'warning'); return;
        }
        const target = state.store.snapshots.find(s => s.id === d.snapshotId);
        if (target) {
          // Capture live data for any module newly turned ON that wasn't recorded before
          const needCapture = {
            persona: !!wantedScope.persona && !target.persona,
            worldbooks: !!wantedScope.worldbooks && !target.worldbooks,
            preset: !!wantedScope.preset && !target.preset,
            regex: !!wantedScope.regex && !target.regex,
            api: !!wantedScope.api && !target.api,
          };
          const fresh = (needCapture.persona || needCapture.worldbooks || needCapture.preset || needCapture.regex || needCapture.api)
            ? await captureLiveSnapshot({ name: nextName, group: nextGroup, note: nextNote, scope: needCapture }, state.store)
            : null;
          target.name = nextName;
          target.group = nextGroup;
          target.note = nextNote;
          ['persona', 'worldbooks', 'preset', 'regex', 'api'].forEach(k => {
            if (wantedScope[k]) {
              if (!target[k] && fresh && fresh[k]) target[k] = fresh[k];
              target.scope[k] = !!target[k];
            } else {
              target.scope[k] = false;
              target[k] = null;
            }
          });
          target.updatedAt = Date.now();
        }
        if (d.returnTo && d.returnTo.type === 'viewSnapshot' && target) {
          d.returnTo.snapshot = target;
          if (d.returnTo.draft) {
            d.returnTo.draft.name = target.name;
            d.returnTo.draft.group = target.group;
            d.returnTo.draft.note = target.note;
            d.returnTo.draft.scope = structuredClone(target.scope);
            ['persona', 'worldbooks', 'preset', 'regex', 'api'].forEach(k => {
              if (!target.scope[k]) d.returnTo.draft[k] = null;
              else if (!d.returnTo.draft[k] && target[k]) d.returnTo.draft[k] = structuredClone(target[k]);
            });
          }
        }
        persistStore(state.store);
        state.drawer = d.returnTo || null;
        render();
        toast('已更新快照信息与包含模块', 'success');
        return;
      }
      return;
    }

    if (d.type === 'missingAudit') {
      if (t.closest('#upp-ma-migrate-preset')) {
        openPresetSyncDrawer({ sourcePreset: d.health?.missingPreset, targetPreset: state.loadedPresetName });
        return;
      }
      const gotoBtn = t.closest('[data-ma-goto]');
      if (gotoBtn) {
        const nextTab = gotoBtn.getAttribute('data-ma-goto');
        state.drawer = null;
        if (nextTab) state.tab = nextTab;
        await refreshAll(false);
        return;
      }
      if (t.closest('#upp-ma-open-wbo')) {
        closeModal();
        emitWindowEvent('wbo:open-panel');
        return;
      }
      if (t.closest('#upp-ma-skip-apply')) {
        const snap = d.snapshot;
        state.drawer = null;
        renderDrawer();
        await applySnapshotLive(snap, state.store);
        syncFabUi();
        if (state.open) await refreshAll(true);
        return;
      }
      if (t.closest('#upp-ma-repair-apply')) {
        const snap = state.store.snapshots.find(s => s.id === d.snapshot.id) || d.snapshot;
        let repaired = false;
        if (d.personaRemap && snap.persona) {
          const p = state.personas.find(x => x.avatar_id === d.personaRemap);
          if (p) {
            snap.persona.avatarId = p.avatar_id;
            snap.persona.name = p.name;
            snap.persona.versionId = '';
            snap.persona.versionName = '';
            repaired = true;
          }
        }
        if (d.presetRemap && snap.preset) {
          snap.preset.name = d.presetRemap;
          repaired = true;
        }
        if (d.apiProfileRemap && snap.api) {
          const pr = (state.apiProfiles || Host.listConnectionProfiles()).find(x => x.id === d.apiProfileRemap);
          if (pr) {
            snap.api.profileId = pr.id;
            snap.api.profileName = pr.name;
            if (pr.api) snap.api.source = pr.api;
            if (pr.model) snap.api.model = pr.model;
            repaired = true;
          }
        }
        if (d.bookRemap && snap.worldbooks) {
          Object.keys(d.bookRemap).forEach(oldBk => {
            const action = d.bookRemap[oldBk];
            if (!action || action === '__keep__') return;
            if (action === '__remove__') {
              if (Array.isArray(snap.worldbooks.global)) {
                snap.worldbooks.global = snap.worldbooks.global.filter(x => x !== oldBk);
              }
              if (snap.worldbooks.char) {
                if (snap.worldbooks.char.primary === oldBk) snap.worldbooks.char.primary = null;
                if (Array.isArray(snap.worldbooks.char.additional)) {
                  snap.worldbooks.char.additional = snap.worldbooks.char.additional.filter(x => x !== oldBk);
                }
              }
              if (snap.worldbooks.chat === oldBk) snap.worldbooks.chat = null;
              if (snap.worldbooks.entries && Object.prototype.hasOwnProperty.call(snap.worldbooks.entries, oldBk)) {
                delete snap.worldbooks.entries[oldBk];
              }
              if (Array.isArray(snap.worldbooks.deletedBooks)) {
                snap.worldbooks.deletedBooks = snap.worldbooks.deletedBooks.filter(x => x !== oldBk);
              }
              repaired = true;
            } else {
              if (Array.isArray(snap.worldbooks.global)) {
                snap.worldbooks.global = Array.from(new Set(snap.worldbooks.global.map(x => (x === oldBk ? action : x))));
              }
              if (snap.worldbooks.char) {
                if (snap.worldbooks.char.primary === oldBk) snap.worldbooks.char.primary = action;
                if (Array.isArray(snap.worldbooks.char.additional)) {
                  snap.worldbooks.char.additional = Array.from(new Set(snap.worldbooks.char.additional.map(x => (x === oldBk ? action : x))));
                }
              }
              if (snap.worldbooks.chat === oldBk) snap.worldbooks.chat = action;
              if (snap.worldbooks.entries && Object.prototype.hasOwnProperty.call(snap.worldbooks.entries, oldBk)) {
                snap.worldbooks.entries[action] = snap.worldbooks.entries[oldBk];
                delete snap.worldbooks.entries[oldBk];
              }
              if (Array.isArray(snap.worldbooks.deletedBooks)) {
                snap.worldbooks.deletedBooks = snap.worldbooks.deletedBooks.filter(x => x !== oldBk);
              }
              repaired = true;
            }
          });
        }
        if (repaired) {
          snap.updatedAt = Date.now();
          persistStore(state.store);
        }
        state.drawer = null;
        renderDrawer();
        await applySnapshotLive(snap, state.store);
        syncFabUi();
        if (state.open) await refreshAll(true);
        return;
      }
      return;
    }

    if (t.closest('#upp-open-wbo-in-drawer')) {
      closeModal();
      emitWindowEvent('wbo:open-panel');
      return;
    }

    const bpFold = t.closest('[data-bp-fold]');
    if (bpFold && d.type === 'bookPicker') {
      const sid = bpFold.getAttribute('data-bp-fold');
      const box = bpFold.closest('.upp-group-box');
      if (box && sid) {
        const next = !box.classList.contains('is-collapsed');
        box.classList.toggle('is-collapsed', next);
        if (!d.foldMap) d.foldMap = {};
        d.foldMap[sid] = next;
      }
      return;
    }

    const pickBk = t.closest('[data-pick-book]');
    if (pickBk) {
      state.activeBook = pickBk.getAttribute('data-pick-book') || '';
      state.expandedWbUids.clear();
      state.wbHygieneCursor = 0;
      state.wbAllOffConfirm = false;
      state.drawer = null;
      await ensureBookEntries(state.activeBook, true);
      render(); return;
    }

    if (d.type === 'renamePersona') {
      if (t.closest('#upp-rename-clear-btn')) {
        const inp = shadow.getElementById('upp-rename-input');
        if (inp) { inp.value = ''; if (canAutoFocusDesktop()) inp.focus(); }
        return;
      }
      if (t.closest('#upp-rename-confirm-btn')) {
        const nextName = (shadow.getElementById('upp-rename-input')?.value || '').trim();
        if (!nextName) { toast('请输入新的 User 名字', 'warning'); return; }
        try {
          await Host.renamePersonaInPlace(d.avatarId, nextName);
          state.personas = Host.listPersonas();
          state.currentPersona = Host.getCurrentPersona();
          state.drawer = null;
          render();
          toast(`已将当前 User 改名为「${nextName}」`, 'success');
        } catch (err) {
          toast('改名失败：' + (err?.message || err), 'error');
        }
        return;
      }
    }

    if (d.type === 'entryEditor' && t.closest('#upp-ed-dn-clear-btn')) {
      const inp = shadow.getElementById('upp-ed-display-name');
      if (inp) { inp.value = ''; if (canAutoFocusDesktop()) inp.focus(); }
      return;
    }

    if (t.closest('#upp-ed-save-btn') && d.type === 'entryEditor') {
      const content = shadow.getElementById('upp-ed-content')?.value ?? '';
      const name = shadow.getElementById('upp-ed-name')?.value?.trim() ?? d.name ?? '';
      const displayName = shadow.getElementById('upp-ed-display-name')?.value?.trim() ?? '';
      const strategyType = shadow.getElementById('upp-ed-strategy')?.value;
      try {
        if (d.mode === 'editPersona' && state.currentPersona) {
          await Host.updatePersonaInPlace(state.currentPersona.avatar_id, content);
          state.currentPersona = Host.getCurrentPersona();
          toast('已保存 User 正文', 'success');
        } else if (d.mode === 'editPersonaVersion' && state.currentPersona) {
          const aid = state.currentPersona.avatar_id;
          const ver = (state.store.personaVersions[aid] || []).find(v => v.id === d.versionId);
          if (ver) {
            ver.name = name || ver.name;
            ver.displayName = displayName.slice(0, 60);
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
          state.livePresetNorm = Host.getLiveNormalizedPreset();
          toast('已保存预设提示词', 'success');
        }
        state.drawer = d.returnTo || null;
        render();
      } catch (err) {
        toast('保存失败：' + (err?.message || err), 'error');
      }
      return;
    }

    const ssToggleGrp = t.closest('[data-ss-toggle-group]');
    if (ssToggleGrp && d.type === 'saveSnapshot') {
      const sid = ssToggleGrp.getAttribute('data-ss-toggle-group');
      const { sections } = groupWorldbooksByOrganizer(state.worldbooks, getOrganizerSettings(), {
        pinned: state.store.settings.pinnedWorldbooks,
        globals: state.globalWorldbooks,
        charBooks: [state.charWorldbooks.primary, ...(state.charWorldbooks.additional || [])].filter(Boolean),
        chatBook: state.chatWorldbook,
        liveCharBookMap: buildLiveCharBookMap(),
      });
      const sec = sections.find(x => x.id === sid);
      if (sec) {
        const set = new Set(d.selectedBooks || []);
        const allOn = sec.items.every(it => set.has(it.name));
        sec.items.forEach(it => { if (allOn) set.delete(it.name); else set.add(it.name); });
        d.selectedBooks = Array.from(set);
        // Preserve text inputs before re-render
        d.name = shadow.getElementById('upp-ss-name')?.value ?? d.name;
        d.group = shadow.getElementById('upp-ss-group')?.value ?? d.group;
        d.note = shadow.getElementById('upp-ss-note')?.value ?? d.note;
        renderDrawer();
      }
      return;
    }

    if (d.type === 'saveSnapshot' && t.closest('#upp-ss-name-clear')) {
      const inp = shadow.getElementById('upp-ss-name');
      if (inp) { inp.value = ''; if (canAutoFocusDesktop()) inp.focus(); }
      return;
    }
    const fillName = t.closest('[data-ss-fill-name]');
    if (fillName && d.type === 'saveSnapshot') {
      const inp = shadow.getElementById('upp-ss-name');
      if (inp) inp.value = fillName.getAttribute('data-ss-fill-name') || '';
      return;
    }
    const fillGrp = t.closest('[data-ss-fill-group]');
    if (fillGrp) { const inp = shadow.getElementById('upp-ss-group'); if (inp) inp.value = fillGrp.getAttribute('data-ss-fill-group') || ''; return; }
    if (t.closest('#upp-ss-confirm-btn') && d.type === 'saveSnapshot') {
      const name = (shadow.getElementById('upp-ss-name')?.value || '').trim();
      if (!name) { toast('请填写快照名称', 'warning'); return; }
      const group = (shadow.getElementById('upp-ss-group')?.value || '').trim();
      const note = (shadow.getElementById('upp-ss-note')?.value || '').trim();
      if (!d.scope.persona && !d.scope.worldbooks && !d.scope.preset && !d.scope.regex && !d.scope.api) {
        toast('请至少勾选一项保存范围', 'warning'); return;
      }
      state.store.settings.defaultSnapshotScope = { ...d.scope };
      const snap = await captureLiveSnapshot({ name, group, note, scope: d.scope, selectedBooks: d.selectedBooks }, state.store);
      state.store.snapshots.unshift(snap);
      persistStore(state.store);
      state.drawer = null;
      state.tab = 'snapshots';
      render();
      toast(`已保存快照「${snap.name}」`, 'success');
      return;
    }

    if (d.type === 'confirmOverwrite') {
      if (t.closest('#upp-confirm-overwrite-btn')) {
        const sid = d.snapshot.id;
        state.drawer = null;
        await overwriteSnapshotById(sid);
        return;
      }
      return;
    }

    if (d.type === 'bindSnapshot') {
      const sid = d.snapshot.id;
      const tabBtn = t.closest('[data-bind-tab]');
      if (tabBtn) {
        d.bindTab = tabBtn.getAttribute('data-bind-tab') || 'char';
        renderDrawer();
        if (d.bindTab === 'chat' && d.scanCharAvatar && !d.scannedChats.length && !d.chatsLoading) {
          void scanChatsIntoBindDrawer(d, d.scanCharAvatar);
        }
        return;
      }
      const scanBtn = t.closest('[data-bind-scan-char]');
      if (scanBtn) {
        const avatar = scanBtn.getAttribute('data-bind-scan-char') || '';
        d.bindTab = 'chat';
        d.scanCharAvatar = avatar;
        d.chatQuery = '';
        renderDrawer();
        void scanChatsIntoBindDrawer(d, avatar);
        return;
      }
      if (t.closest('#upp-bind-rescan-btn') && d.scanCharAvatar) {
        void scanChatsIntoBindDrawer(d, d.scanCharAvatar);
        return;
      }
      const toggleCharBtn = t.closest('[data-bind-toggle-char]');
      if (toggleCharBtn) {
        const cid = toggleCharBtn.getAttribute('data-bind-toggle-char');
        if (cid) {
          if (state.store.bindings.characters[cid] === sid) delete state.store.bindings.characters[cid];
          else state.store.bindings.characters[cid] = sid;
          persistStore(state.store);
          render();
        }
        return;
      }
      const toggleChatBtn = t.closest('[data-bind-toggle-chat]');
      if (toggleChatBtn) {
        const chatId = toggleChatBtn.getAttribute('data-bind-toggle-chat');
        if (chatId) {
          if (state.store.bindings.chats[chatId] === sid) delete state.store.bindings.chats[chatId];
          else state.store.bindings.chats[chatId] = sid;
          persistStore(state.store);
          render();
        }
        return;
      }
      return;
    }

    if (d.type === 'savePersonaVersion' && state.currentPersona) {
      if (t.closest('#upp-pv-dn-clear-btn')) {
        const inp = shadow.getElementById('upp-pv-display-name');
        if (inp) { inp.value = ''; if (canAutoFocusDesktop()) inp.focus(); }
        return;
      }
      const fillPv = t.closest('[data-pv-fill-name]');
      if (fillPv) {
        const inp = shadow.getElementById('upp-pv-name');
        if (inp) inp.value = fillPv.getAttribute('data-pv-fill-name') || '';
        const dnInp = shadow.getElementById('upp-pv-display-name');
        const fillDn = fillPv.getAttribute('data-pv-fill-dn');
        if (dnInp && fillDn) dnInp.value = fillDn;
        return;
      }
      const delPv = t.closest('[data-pv-del]');
      if (delPv) {
        const aid = state.currentPersona.avatar_id;
        state.store.personaVersions[aid] = (state.store.personaVersions[aid] || []).filter(v => v.id !== delPv.getAttribute('data-pv-del'));
        persistStore(state.store); render(); return;
      }
      if (t.closest('#upp-pv-save-btn')) {
        const vName = (shadow.getElementById('upp-pv-name')?.value || '').trim();
        if (!vName) { toast('请填写版本名称', 'warning'); return; }
        const vDisplayName = (shadow.getElementById('upp-pv-display-name')?.value || '').trim();
        const aid = state.currentPersona.avatar_id;
        const list = state.store.personaVersions[aid] || [];
        const existingIdx = list.findIndex(v => v.name === vName);
        const item = {
          id: existingIdx >= 0 ? list[existingIdx].id : uid('pv'),
          name: vName.slice(0, 60),
          displayName: vDisplayName.slice(0, 60),
          description: state.currentPersona.description || '',
          lorebook: state.currentPersona.lorebook || '',
          updatedAt: Date.now(),
        };
        if (existingIdx >= 0) list[existingIdx] = item; else list.unshift(item);
        state.store.personaVersions[aid] = list;
        persistStore(state.store);
        state.drawer = null;
        render();
        toast(`已保存内部版本「${item.name}」`, 'success');
        return;
      }
    }

    if (d.type === 'mergePersonas') {
      if (t.closest('#upp-merge-keep-preview-btn')) {
        d.showKeepPreview = !d.showKeepPreview;
        renderDrawer();
        return;
      }
      const prevBtn = t.closest('[data-merge-preview]');
      if (prevBtn) {
        const aid = prevBtn.getAttribute('data-merge-preview');
        if (aid) {
          if (!d.previewIds) d.previewIds = new Set();
          const listEl = shadow.getElementById('upp-merge-candidate-list');
          const st = listEl ? listEl.scrollTop : 0;
          if (d.previewIds.has(aid)) d.previewIds.delete(aid);
          else d.previewIds.add(aid);
          renderMergeCandidateList(d);
          if (listEl) listEl.scrollTop = st;
        }
        return;
      }
      if (t.closest('#upp-clean-orphans-btn')) {
        const list = Array.isArray(d.orphanAvatars) ? [...d.orphanAvatars] : [];
        let cleaned = 0;
        for (const aid of list) {
          try { if (await Host.deletePersonaById(aid)) cleaned++; } catch (_) {}
        }
        d.orphanAvatars = await Host.listOrphanAvatars();
        await refreshAll(false);
        toast(`已彻底清理 ${cleaned} 个未命名残留头像`, 'success');
        return;
      }
      const grpBtn = t.closest('[data-merge-preset-group]');
      if (grpBtn) {
        const g = detectProliferatedPersonas(state.personas)[Number(grpBtn.getAttribute('data-merge-preset-group'))];
        if (g) { d.keepId = g.items[0].avatar_id; d.absorbIds = g.items.slice(1).map(x => x.avatar_id); renderDrawer(); }
        return;
      }
      if (t.closest('#upp-merge-run-btn')) {
        const keep = state.personas.find(p => p.avatar_id === d.keepId);
        if (!keep) return;
        const list = state.store.personaVersions[keep.avatar_id] || [];
        if ((keep.description || '').trim() && !list.some(v => v.description === keep.description && (!v.displayName || v.displayName === keep.name))) {
          list.unshift({ id: uid('pv'), name: '原主描述', displayName: keep.name, description: keep.description, lorebook: keep.lorebook || '', updatedAt: Date.now() });
        }
        let absorbed = 0; let deleted = 0;
        for (const aid of (d.absorbIds || [])) {
          const oldP = state.personas.find(p => p.avatar_id === aid);
          if (!oldP) continue;
          let label = oldP.name;
          if (label.startsWith(keep.name) && label.length > keep.name.length) {
            label = label.slice(keep.name.length).replace(/^[\s_\-·・/()（）【】\[\]]+/, '').replace(/[)）】\]]+$/, '') || oldP.name;
          }
          if (list.some(v => v.name === label)) label = `${label} (${absorbed + 1})`;
          list.push({ id: uid('pv'), name: label.slice(0, 60), displayName: oldP.name, description: oldP.description || '', lorebook: oldP.lorebook || '', updatedAt: Date.now() });
          absorbed++;
          if (d.deleteOld) { try { if (await Host.deletePersonaById(oldP.avatar_id)) deleted++; } catch (_) {} }
        }
        state.store.personaVersions[keep.avatar_id] = list;
        persistStore(state.store);
        state.drawer = null;
        await refreshAll(false);
        toast(deleted > 0 ? `已收回 ${absorbed} 个分身并删除 ${deleted} 个旧 User` : `已收回 ${absorbed} 个分身为「${keep.name}」的内部版本`, 'success');
        return;
      }
    }

    if (d.type === 'presetSync') {
      if (t.closest('#upp-ps-undo-btn') && state.lastPresetSyncUndo) {
        const undo = state.lastPresetSyncUndo;
        const backupById = new Map(undo.snapshotsBackup.map(s => [s.id, s]));
        state.store.snapshots = state.store.snapshots.map(s => backupById.get(s.id) || s);
        state.lastPresetSyncUndo = null;
        persistStore(state.store);
        state.drawer = null;
        render();
        toast(`已撤销上次同步（恢复 ${backupById.size} 份快照）`, 'success');
        return;
      }
      if (t.closest('#upp-ps-toggle-all-snaps')) {
        const allIds = (state.store.snapshots || [])
          .filter(s => s.scope?.preset && s.preset?.name === d.sourcePreset)
          .map(s => s.id);
        const allOn = allIds.length > 0 && allIds.every(id => (d.selectedSnapIds || []).includes(id));
        d.selectedSnapIds = allOn ? [] : allIds;
        recomputePresetSyncAnalysis(d);
        renderDrawer();
        return;
      }
      const newEnSw = t.closest('[data-ps-new-en]');
      if (newEnSw) {
        const pid = newEnSw.getAttribute('data-ps-new-en');
        const cur = d.newPromptDecisions[pid] || { include: true, enabled: false, inheritFromOldId: '' };
        cur.enabled = !cur.enabled;
        cur.include = true;
        d.newPromptDecisions[pid] = cur;
        renderDrawer();
        return;
      }
      if (t.closest('#upp-ps-ov-toggle')) {
        d.overrideExpanded = !d.overrideExpanded;
        renderDrawer();
        return;
      }
      if (t.closest('#upp-ps-run-btn')) {
        const selSet = new Set(d.selectedSnapIds || []);
        if (!selSet.size) return;
        const targets = state.store.snapshots.filter(s => selSet.has(s.id));
        state.lastPresetSyncUndo = {
          label: d.sourcePreset === d.targetPreset
            ? `${d.targetPreset}（${targets.length} 份快照）`
            : `${d.sourcePreset} → ${d.targetPreset}（${targets.length} 份快照）`,
          snapshotsBackup: structuredClone(targets),
        };
        const migrated = applyPresetMigrationToSnapshots(targets, {
          targetPresetName: d.targetPreset,
          targetPresetNorm: d.targetPresetNorm,
          analysis: d.analysis,
          newPromptDecisions: d.newPromptDecisions,
          forceOverridePrompts: d.forceOverridePrompts,
          forceOverrideGroups: d.forceOverrideGroups,
          syncNewGroups: d.syncNewGroups,
          cleanRemovedIds: d.cleanRemovedIds,
        });
        const migratedMap = new Map(migrated.map(s => [s.id, s]));
        state.store.snapshots = state.store.snapshots.map(s => migratedMap.get(s.id) || s);
        persistStore(state.store);
        state.drawer = null;
        render();
        toast(
          d.sourcePreset === d.targetPreset
            ? `已同步新开关到 ${migrated.length} 份快照（可在「预设同步」内一键撤销）`
            : `已将 ${migrated.length} 份快照从「${d.sourcePreset}」升级迁移到「${d.targetPreset}」`,
          'success',
        );
        return;
      }
      return;
    }

    if (d.type === 'backup') {
      if (t.closest('#upp-export-json-btn')) {
        const blob = new Blob([exportStoreJson(state.store)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `user-snapshots-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('已导出备份文件', 'success');
        return;
      }
      if (t.closest('#upp-import-json-btn')) shadow.getElementById('upp-import-file')?.click();
    }
  });

  function applyThemeAll() {
    const mode = state.store.settings.themeMode || 'paper';
    applyThemeToElement(elBackdrop, mode);
    applyThemeToElement(elFabRoot, mode);
    applyThemeToElement(elRestorePill, mode);
    if (elThemeSelect) elThemeSelect.value = mode;
    const extSel = document.getElementById('upp-ext-theme-sel');
    if (extSel) extSel.value = mode;
  }

  elThemeSelect.addEventListener('change', () => {
    state.store = loadStore();
    state.store.settings.themeMode = elThemeSelect.value;
    persistStore(state.store);
    applyThemeAll();
  });

  // =========================
  // Floating Window Geometry, Drag, Resize & Minimize
  // =========================

  const modalGeo = {
    floating: false,
    mini: false,
    resized: false,
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    normalRect: null,
  };
  let dragState = null;
  let resizeState = null;
  const savedScroll = { body: 0, snapInspect: 0, drawerBody: 0, popList: 0 };

  function getViewportSize() {
    const vv = window.visualViewport;
    const vw = Math.round(window.innerWidth || document.documentElement.clientWidth || 390);
    const vh = Math.round((vv && vv.height) ? Math.min(window.innerHeight || vv.height, vv.height) : (window.innerHeight || document.documentElement.clientHeight || 780));
    return { vw, vh };
  }

  function isMobileViewport() {
    return getViewportSize().vw <= 640;
  }

  function isMobileFullscreen() {
    return isMobileViewport() && !modalGeo.mini;
  }

  function syncMiniBtnUi() {
    if (!elMiniBtn) return;
    elMiniBtn.innerHTML = modalGeo.mini ? ICONS.restoreSize : ICONS.miniWindow;
    elMiniBtn.title = modalGeo.mini ? '还原尺寸' : '小窗对照';
    elMiniBtn.setAttribute('aria-pressed', String(!!modalGeo.mini));
  }

  function syncModalLayoutClasses() {
    if (!elModal) return;
    const mobileFs = isMobileFullscreen();
    elModal.classList.toggle('is-floating', !!modalGeo.floating);
    elModal.classList.toggle('is-mini', !!modalGeo.mini);
    elModal.classList.toggle('is-draggable', !mobileFs);
    elModal.classList.toggle('is-resizable', !mobileFs);
    let h = modalGeo.floating && modalGeo.height ? modalGeo.height : (elModal.getBoundingClientRect().height || 0);
    if (!h && state.open) h = getViewportSize().vh;
    elModal.classList.toggle('is-compact-h', h > 0 && h <= 330);
    syncMiniBtnUi();
  }

  function applyModalRect(rect) {
    if (!rect || !elModal) return;
    modalGeo.left = rect.left;
    modalGeo.top = rect.top;
    modalGeo.width = rect.width;
    modalGeo.height = rect.height;
    elModal.style.left = rect.left + 'px';
    elModal.style.top = rect.top + 'px';
    elModal.style.width = rect.width + 'px';
    elModal.style.height = rect.height + 'px';
    syncModalLayoutClasses();
  }

  function resetModalGeometry() {
    modalGeo.floating = false;
    modalGeo.mini = false;
    modalGeo.resized = false;
    modalGeo.left = 0;
    modalGeo.top = 0;
    modalGeo.width = 0;
    modalGeo.height = 0;
    modalGeo.normalRect = null;
    if (elModal) {
      elModal.style.removeProperty('left');
      elModal.style.removeProperty('top');
      elModal.style.removeProperty('width');
      elModal.style.removeProperty('height');
    }
    syncModalLayoutClasses();
  }

  function reclampModalGeometry() {
    if (!state.open || state.minimized) return;
    const { vw, vh } = getViewportSize();
    if (isMobileFullscreen()) {
      if (modalGeo.floating) {
        modalGeo.floating = false;
        modalGeo.resized = false;
        if (elModal) {
          elModal.style.removeProperty('left');
          elModal.style.removeProperty('top');
          elModal.style.removeProperty('width');
          elModal.style.removeProperty('height');
        }
      }
      syncModalLayoutClasses();
      return;
    }
    if (modalGeo.floating) {
      if (modalGeo.mini && !modalGeo.resized) {
        applyModalRect(computeMiniWindowRect({ viewportWidth: vw, viewportHeight: vh }));
      } else {
        applyModalRect(clampModalRect({
          left: modalGeo.left,
          top: modalGeo.top,
          width: modalGeo.width,
          height: modalGeo.height,
          viewportWidth: vw,
          viewportHeight: vh,
        }));
      }
    } else {
      syncModalLayoutClasses();
    }
  }

  function toggleMiniWindow() {
    if (!state.open || state.minimized) return;
    const { vw, vh } = getViewportSize();
    if (!modalGeo.mini) {
      modalGeo.normalRect = modalGeo.floating
        ? { left: modalGeo.left, top: modalGeo.top, width: modalGeo.width, height: modalGeo.height, resized: modalGeo.resized }
        : null;
      const miniRect = computeMiniWindowRect({ viewportWidth: vw, viewportHeight: vh });
      modalGeo.mini = true;
      modalGeo.floating = true;
      modalGeo.resized = false;
      applyModalRect(miniRect);
      return;
    }
    if (modalGeo.normalRect && vw > 640) {
      const prev = modalGeo.normalRect;
      modalGeo.normalRect = null;
      modalGeo.mini = false;
      modalGeo.floating = true;
      modalGeo.resized = !!prev.resized;
      applyModalRect(clampModalRect({
        left: prev.left,
        top: prev.top,
        width: prev.width,
        height: prev.height,
        viewportWidth: vw,
        viewportHeight: vh,
      }));
      return;
    }
    resetModalGeometry();
  }

  function positionRestorePill() {
    if (!elRestorePill || elRestorePill.hidden) return;
    const { vw, vh } = getViewportSize();
    const pillW = elRestorePill.offsetWidth || 148;
    const pillH = elRestorePill.offsetHeight || 34;
    const pos = computeRestorePillPosition({
      pillWidth: pillW,
      pillHeight: pillH,
      viewportWidth: vw,
      viewportHeight: vh,
      fabSide: state.store.settings.fabSide === 'left' ? 'left' : 'right',
      fabY: typeof state.store.settings.fabY === 'number' ? state.store.settings.fabY : 0.68,
      fabVisible: state.store.settings.showFloatingBall !== false,
    });
    elRestorePill.style.left = pos.left + 'px';
    elRestorePill.style.top = pos.top + 'px';
  }

  function minimizeModal() {
    if (!state.open || state.minimized) return;
    closeFabPop();
    dragState = null;
    resizeState = null;
    elModal.classList.remove('is-dragging', 'is-resizing');
    savedScroll.body = elBody?.scrollTop || 0;
    savedScroll.snapInspect = shadow.getElementById('upp-snap-inspect-body')?.scrollTop || 0;
    savedScroll.drawerBody = elDrawerMask.querySelector('.upp-drawer-body')?.scrollTop || 0;
    savedScroll.popList = elDrawerMask.querySelector('.upp-pop-list')?.scrollTop || 0;
    state.minimized = true;
    elBackdrop.classList.add('is-minimized');
    elBackdrop.setAttribute('aria-hidden', 'true');
    applyThemeAll();
    elRestorePill.hidden = false;
    positionRestorePill();
  }

  function restoreModal() {
    if (!state.open) { openModal(); return; }
    if (!state.minimized) return;
    state.minimized = false;
    elRestorePill.hidden = true;
    elBackdrop.classList.remove('is-minimized');
    elBackdrop.removeAttribute('aria-hidden');
    reclampModalGeometry();
    const applySavedScroll = () => {
      if (elBody) elBody.scrollTop = savedScroll.body;
      const sib = shadow.getElementById('upp-snap-inspect-body');
      if (sib) sib.scrollTop = savedScroll.snapInspect;
      const db = elDrawerMask.querySelector('.upp-drawer-body');
      if (db) db.scrollTop = savedScroll.drawerBody;
      const pl = elDrawerMask.querySelector('.upp-pop-list');
      if (pl) pl.scrollTop = savedScroll.popList;
    };
    applySavedScroll();
    window.requestAnimationFrame(applySavedScroll);
  }

  function openModal() {
    closeFabPop();
    state.store = loadStore();
    applyThemeAll();
    if (state.open && state.minimized) {
      restoreModal();
      syncFabVisBtn();
      return;
    }
    state.minimized = false;
    elBackdrop.classList.remove('is-minimized');
    elBackdrop.removeAttribute('aria-hidden');
    elRestorePill.hidden = true;
    resetModalGeometry();
    state.open = true;
    state.drawer = null;
    elBackdrop.hidden = false;
    syncModalLayoutClasses();
    syncFabVisBtn();
    void refreshAll(false);
  }

  function closeModal() {
    state.open = false;
    state.minimized = false;
    state.drawer = null;
    state.snapPendingDeleteId = '';
    state.wbAllOffConfirm = false;
    state.bookEntriesCache.clear();
    dragState = null;
    resizeState = null;
    elModal.classList.remove('is-dragging', 'is-resizing');
    elBackdrop.classList.remove('is-minimized');
    elBackdrop.removeAttribute('aria-hidden');
    elBackdrop.hidden = true;
    elRestorePill.hidden = true;
    resetModalGeometry();
    syncFabUi();
  }

  // Unified PointerEvent Drag on .upp-header
  elHeader.addEventListener('pointerdown', ev => {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    if (!state.open || state.minimized || isMobileFullscreen()) return;
    if (ev.target && ev.target.closest('button, select, input, textarea, a, label, [role="button"], option')) return;
    const rect = elModal.getBoundingClientRect();
    dragState = {
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      origLeft: rect.left,
      origTop: rect.top,
      width: rect.width,
      height: rect.height,
      moved: false,
    };
    try { elHeader.setPointerCapture(ev.pointerId); } catch (_) {}
  }, { signal: ac.signal });

  elHeader.addEventListener('pointermove', ev => {
    if (!dragState || ev.pointerId !== dragState.pointerId) return;
    const dx = ev.clientX - dragState.startX;
    const dy = ev.clientY - dragState.startY;
    const { vw, vh } = getViewportSize();
    if (!dragState.moved && Math.hypot(dx, dy) >= 3) {
      dragState.moved = true;
      elModal.classList.add('is-dragging');
      if (!modalGeo.floating) {
        modalGeo.floating = true;
        applyModalRect(clampModalRect({
          left: dragState.origLeft,
          top: dragState.origTop,
          width: dragState.width,
          height: dragState.height,
          viewportWidth: vw,
          viewportHeight: vh,
        }));
        dragState.origLeft = modalGeo.left;
        dragState.origTop = modalGeo.top;
      }
    }
    if (!dragState.moved) return;
    const pos = computeDraggedModalPosition({
      origLeft: dragState.origLeft,
      origTop: dragState.origTop,
      dx,
      dy,
      width: modalGeo.width,
      height: modalGeo.height,
      viewportWidth: vw,
      viewportHeight: vh,
    });
    modalGeo.left = pos.left;
    modalGeo.top = pos.top;
    elModal.style.left = pos.left + 'px';
    elModal.style.top = pos.top + 'px';
  }, { signal: ac.signal });

  function finishModalDrag(ev) {
    if (!dragState || ev.pointerId !== dragState.pointerId) return;
    dragState = null;
    elModal.classList.remove('is-dragging');
    try { elHeader.releasePointerCapture(ev.pointerId); } catch (_) {}
  }
  elHeader.addEventListener('pointerup', finishModalDrag, { signal: ac.signal });
  elHeader.addEventListener('pointercancel', finishModalDrag, { signal: ac.signal });

  // Unified PointerEvent Corner Resize on #upp-resize-handle
  elResizeHandle.addEventListener('pointerdown', ev => {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    if (!state.open || state.minimized || isMobileFullscreen()) return;
    ev.preventDefault();
    ev.stopPropagation();
    const { vw, vh } = getViewportSize();
    const rect = elModal.getBoundingClientRect();
    modalGeo.floating = true;
    modalGeo.resized = true;
    applyModalRect(clampModalRect({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      viewportWidth: vw,
      viewportHeight: vh,
    }));
    resizeState = {
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      origLeft: modalGeo.left,
      origTop: modalGeo.top,
      origWidth: modalGeo.width,
      origHeight: modalGeo.height,
    };
    elModal.classList.add('is-resizing');
    try { elResizeHandle.setPointerCapture(ev.pointerId); } catch (_) {}
  }, { signal: ac.signal });

  elResizeHandle.addEventListener('pointermove', ev => {
    if (!resizeState || ev.pointerId !== resizeState.pointerId) return;
    const { vw, vh } = getViewportSize();
    const nextRect = computeResizedModalRect({
      origLeft: resizeState.origLeft,
      origTop: resizeState.origTop,
      origWidth: resizeState.origWidth,
      origHeight: resizeState.origHeight,
      dx: ev.clientX - resizeState.startX,
      dy: ev.clientY - resizeState.startY,
      handle: 'se',
      viewportWidth: vw,
      viewportHeight: vh,
    });
    applyModalRect(nextRect);
  }, { signal: ac.signal });

  function finishModalResize(ev) {
    if (!resizeState || ev.pointerId !== resizeState.pointerId) return;
    resizeState = null;
    elModal.classList.remove('is-resizing');
    try { elResizeHandle.releasePointerCapture(ev.pointerId); } catch (_) {}
  }
  elResizeHandle.addEventListener('pointerup', finishModalResize, { signal: ac.signal });
  elResizeHandle.addEventListener('pointercancel', finishModalResize, { signal: ac.signal });

  // Bubble-phase isolation on EVERY floating root (prevent collapsing ST .openDrawer)
  function stopBubbleToHost(el) {
    if (!el) return;
    const stop = ev => { ev.stopPropagation(); };
    el.addEventListener('mousedown', stop, { signal: ac.signal });
    el.addEventListener('touchstart', stop, { signal: ac.signal, passive: true });
    el.addEventListener('click', stop, { signal: ac.signal });
  }
  [host, elModal, elDrawerMask, elRestorePill, elFabBtn, elFabPop].forEach(stopBubbleToHost);

  elModal.addEventListener('pointerdown', () => { if (fabPopOpen) closeFabPop(); }, { signal: ac.signal });
  elRestorePill.addEventListener('pointerdown', () => { if (fabPopOpen) closeFabPop(); }, { signal: ac.signal });

  // =========================
  // Draggable Floating Ball & Quick Snapshot Popover
  // =========================

  let fabPopOpen = false;
  let fabDragging = false;
  let fabMoved = false;
  let fabStartX = 0;
  let fabStartY = 0;
  let fabOrigLeft = 0;
  let fabOrigTop = 0;

  function syncFabVisBtn() {
    const show = state.store.settings.showFloatingBall !== false;
    if (elFabVisBtn) elFabVisBtn.classList.toggle('active', show);
  }

  function positionFab() {
    const vw = window.innerWidth || 390;
    const vh = window.innerHeight || 780;
    const size = 42;
    const margin = 10;
    const side = state.store.settings.fabSide === 'left' ? 'left' : 'right';
    const yRatio = typeof state.store.settings.fabY === 'number' ? state.store.settings.fabY : 0.68;
    const top = Math.round(Math.min(vh - size - 16, Math.max(54, vh * yRatio - size / 2)));
    const left = side === 'left' ? margin : Math.max(margin, vw - size - margin);
    elFabBtn.style.left = left + 'px';
    elFabBtn.style.top = top + 'px';
  }

  function positionFabPop() {
    const vw = window.innerWidth || 390;
    const vh = window.innerHeight || 780;
    const margin = 12;
    const rect = elFabBtn.getBoundingClientRect();
    const popW = Math.min(elFabPop.offsetWidth || 296, vw - margin * 2);
    const popH = Math.min(elFabPop.offsetHeight || Math.min(410, Math.round(vh * 0.72)), vh - margin * 2);
    let left = (rect.left + rect.width / 2) > vw / 2 ? (rect.left - popW - 8) : (rect.right + 8);
    left = Math.min(vw - popW - margin, Math.max(margin, left));
    let top = (rect.top + popH + margin > vh) ? (rect.bottom - popH) : (rect.top - 24);
    top = Math.min(vh - popH - margin, Math.max(margin, top));
    elFabPop.style.left = Math.round(left) + 'px';
    elFabPop.style.top = Math.round(top) + 'px';
  }

  function renderFabPop() {
    state.store = loadStore();
    state.charInfo = readCurrentCharInfo();
    state.chatId = readCurrentChatId();
    const snaps = state.store.snapshots || [];
    const bound = resolveBindingForContext(state.store.bindings, state.chatId, state.charInfo.id);
    const autoOn = !!state.store.settings.autoApplyBindings;

    elFabPop.innerHTML = `
      <div class="upp-fab-pop-head">
        <span>快捷切换快照</span>
        <button type="button" class="upp-switch" id="upp-fab-auto-sw" role="switch" aria-checked="${autoOn}" title="切聊天自动切回"></button>
      </div>
      <div class="upp-fab-pop-list">
        ${snaps.length ? snaps.map(s => {
          const isBound = bound && bound.snapshotId === s.id;
          return `
            <div class="upp-fab-snap-row ${isBound ? 'is-bound' : ''}">
              <button type="button" class="upp-fab-snap-main" data-fab-inspect="${s.id}" title="${escapeHtml(s.note ? `${s.name}：${s.note}` : '点击查看快照详情')}">
                <div class="upp-fab-snap-top">
                  <span class="upp-fab-snap-name">${escapeHtml(s.name)}</span>
                  ${isBound ? `<span class="upp-badge ok">${bound.source === 'chat' ? '本聊天' : '本角色'}</span>` : (s.group ? `<span class="upp-badge">${escapeHtml(s.group)}</span>` : '')}
                </div>
                ${s.note ? `<div class="upp-fab-snap-note">${escapeHtml(s.note)}</div>` : ''}
              </button>
              <button type="button" class="upp-fab-apply-btn" data-fab-apply="${s.id}">应用</button>
            </div>
          `;
        }).join('') : `<div class="upp-empty" style="padding:18px 10px;font-size:12px;">暂无快照，先保存一套吧</div>`}
      </div>
      <div class="upp-fab-pop-foot">
        <button type="button" class="upp-btn primary" id="upp-fab-save-btn">${ICONS.plus}<span>保存快照</span></button>
        <button type="button" class="upp-btn" id="upp-fab-open-btn">完整面板</button>
      </div>
    `;
  }

  function openFabPop() {
    state.store = loadStore();
    applyThemeAll();
    renderFabPop();
    elFabPop.hidden = false;
    fabPopOpen = true;
    positionFabPop();
  }

  function closeFabPop() {
    if (!fabPopOpen) return;
    fabPopOpen = false;
    elFabPop.hidden = true;
  }

  function syncFabUi() {
    state.store = loadStore();
    const show = state.store.settings.showFloatingBall !== false;
    applyThemeAll();
    elFabRoot.hidden = !show;
    syncFabVisBtn();
    if (!show) {
      closeFabPop();
      return;
    }
    positionFab();
    const bound = resolveBindingForContext(state.store.bindings, readCurrentChatId(), readCurrentCharInfo().id);
    elFabDot.hidden = !bound;
  }

  elFabBtn.addEventListener('pointerdown', ev => {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    fabDragging = true;
    fabMoved = false;
    fabStartX = ev.clientX;
    fabStartY = ev.clientY;
    const rect = elFabBtn.getBoundingClientRect();
    fabOrigLeft = rect.left;
    fabOrigTop = rect.top;
    try { elFabBtn.setPointerCapture(ev.pointerId); } catch (_) {}
  });

  elFabBtn.addEventListener('pointermove', ev => {
    if (!fabDragging) return;
    const dx = ev.clientX - fabStartX;
    const dy = ev.clientY - fabStartY;
    if (!fabMoved && Math.hypot(dx, dy) >= 6) {
      fabMoved = true;
      elFabBtn.classList.add('is-dragging');
      closeFabPop();
    }
    if (!fabMoved) return;
    const vw = window.innerWidth || 390;
    const vh = window.innerHeight || 780;
    const size = 42;
    const left = Math.min(vw - size - 6, Math.max(6, fabOrigLeft + dx));
    const top = Math.min(vh - size - 12, Math.max(46, fabOrigTop + dy));
    elFabBtn.style.left = Math.round(left) + 'px';
    elFabBtn.style.top = Math.round(top) + 'px';
  });

  function finishFabPointer(ev) {
    if (!fabDragging) return;
    fabDragging = false;
    elFabBtn.classList.remove('is-dragging');
    try { elFabBtn.releasePointerCapture(ev.pointerId); } catch (_) {}
    if (fabMoved) {
      const vw = window.innerWidth || 390;
      const vh = window.innerHeight || 780;
      const rect = elFabBtn.getBoundingClientRect();
      state.store = loadStore();
      state.store.settings.fabSide = (rect.left + rect.width / 2) < vw / 2 ? 'left' : 'right';
      state.store.settings.fabY = Math.min(0.92, Math.max(0.08, (rect.top + rect.height / 2) / vh));
      persistStore(state.store);
      positionFab();
    } else {
      if (fabPopOpen) closeFabPop();
      else openFabPop();
    }
  }
  elFabBtn.addEventListener('pointerup', finishFabPointer);
  elFabBtn.addEventListener('pointercancel', finishFabPointer);

  elFabPop.addEventListener('click', async ev => {
    const t = ev.target;
    if (t.closest('#upp-fab-auto-sw')) {
      state.store = loadStore();
      state.store.settings.autoApplyBindings = !state.store.settings.autoApplyBindings;
      persistStore(state.store);
      syncExtSettingsCheckbox();
      renderFabPop();
      toast(state.store.settings.autoApplyBindings ? '已开启自动切回快照' : '已暂停自动切换');
      return;
    }
    if (t.closest('#upp-fab-open-btn')) {
      closeFabPop();
      openModal();
      return;
    }
    if (t.closest('#upp-fab-save-btn')) {
      closeFabPop();
      openModal();
      window.setTimeout(() => openSaveSnapshotDrawer(), 60);
      return;
    }
    const inspectItem = t.closest('[data-fab-inspect]');
    if (inspectItem) {
      const sid = inspectItem.getAttribute('data-fab-inspect');
      const snap = state.store.snapshots.find(s => s.id === sid);
      closeFabPop();
      if (snap) {
        openModal();
        window.setTimeout(() => { void openSnapshotDetail(snap); }, 60);
      }
      return;
    }
    const applyItem = t.closest('[data-fab-apply]');
    if (applyItem) {
      const sid = applyItem.getAttribute('data-fab-apply');
      const snap = state.store.snapshots.find(s => s.id === sid);
      closeFabPop();
      if (snap) {
        await requestApplySnapshot(snap, { fromFab: true });
      }
    }
  });

  elFabVisBtn.addEventListener('click', () => {
    state.store = loadStore();
    state.store.settings.showFloatingBall = !(state.store.settings.showFloatingBall !== false);
    persistStore(state.store);
    syncFabUi();
    syncExtSettingsCheckbox();
    if (state.open && state.minimized) positionRestorePill();
    toast(state.store.settings.showFloatingBall ? '已显示悬浮球' : '已隐藏悬浮球');
  });

  document.addEventListener('pointerdown', ev => {
    if (!fabPopOpen) return;
    const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [];
    if (path.includes(elFabPop) || path.includes(elFabBtn)) return;
    closeFabPop();
  }, { signal: ac.signal });

  function handleViewportChange() {
    if (state.store.settings.showFloatingBall !== false) {
      positionFab();
      if (fabPopOpen) positionFabPop();
    }
    if (state.open && state.minimized) {
      positionRestorePill();
    } else if (state.open && !state.minimized) {
      reclampModalGeometry();
    }
  }
  window.addEventListener('resize', handleViewportChange, { signal: ac.signal });
  window.addEventListener('orientationchange', handleViewportChange, { signal: ac.signal });
  window.visualViewport?.addEventListener('resize', handleViewportChange, { signal: ac.signal });

  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      if (fabPopOpen) { closeFabPop(); return; }
      if (state.open && !state.minimized) {
        if (state.drawer) {
          if (state.drawer.type === 'viewSnapshot' && state.drawer.dirty) {
            state.drawer.pendingAction = 'close';
            renderDrawer();
            return;
          }
          state.drawer = state.drawer.returnTo || null;
          renderDrawer();
        } else {
          closeModal();
        }
      }
    }
  }, { signal: ac.signal });

  // Auto-apply bound snapshot on chat switch
  let lastAutoKey = '';
  let autoTimer = null;
  function scheduleAutoApply() {
    if (autoTimer) window.clearTimeout(autoTimer);
    autoTimer = window.setTimeout(async () => {
      autoTimer = null;
      syncFabUi();
      if (isApplyingSnapshot) return;
      state.store = loadStore();
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
      syncFabUi();
      if (state.open) await refreshAll(true);
    }, 350);
  }

  eventSource.on(event_types.CHAT_CHANGED, scheduleAutoApply);

  // Decoupled CustomEvent bridge with worldbook-organizer (rename / delete / live group refresh)
  window.addEventListener('wbo:worldbook-renamed', ev => {
    const { oldName, newName } = ev?.detail || {};
    if (!oldName || !newName || oldName === newName) return;
    state.store = loadStore();
    const res = migrateStoreOnWorldbookRename(state.store, oldName, newName);
    if (res.changed) persistStore(state.store);
    if (state.activeBook === oldName) state.activeBook = newName;
    if (state.bookEntriesCache.has(oldName)) {
      const cached = state.bookEntriesCache.get(oldName);
      state.bookEntriesCache.delete(oldName);
      setCachedBookEntries(newName, cached);
    }
    if (state.drawer?.type === 'viewSnapshot') {
      const d = state.drawer;
      const latest = state.store.snapshots.find(s => s.id === d.snapshot?.id);
      if (latest) d.snapshot = latest;
      if (d.draft) migrateStoreOnWorldbookRename({ snapshots: [d.draft] }, oldName, newName);
      if (d.wbDetails && Object.prototype.hasOwnProperty.call(d.wbDetails, oldName)) {
        d.wbDetails[newName] = d.wbDetails[oldName];
        delete d.wbDetails[oldName];
      }
      const oldFoldKey = `wb::${oldName}`;
      const newFoldKey = `wb::${newName}`;
      if (d.foldMap && Object.prototype.hasOwnProperty.call(d.foldMap, oldFoldKey)) {
        d.foldMap[newFoldKey] = d.foldMap[oldFoldKey];
        delete d.foldMap[oldFoldKey];
      }
      if (d.expandedIds) {
        const nextExp = new Set();
        d.expandedIds.forEach(k => {
          nextExp.add(k.startsWith(`wb::${oldName}::`) ? `wb::${newName}::${k.slice(`wb::${oldName}::`.length)}` : k);
        });
        d.expandedIds = nextExp;
      }
      if (d.subTab === 'worldbooks') renderViewSnapshotBody(d);
    } else if (state.drawer?.type === 'saveSnapshot') {
      const d = state.drawer;
      d.name = shadow.getElementById('upp-ss-name')?.value ?? d.name;
      d.group = shadow.getElementById('upp-ss-group')?.value ?? d.group;
      d.note = shadow.getElementById('upp-ss-note')?.value ?? d.note;
      if (Array.isArray(d.selectedBooks)) {
        d.selectedBooks = Array.from(new Set(d.selectedBooks.map(bk => (bk === oldName ? newName : bk))));
      }
    }
    if (res.affectedSnapshots > 0) {
      toast(`已同步更名世界书「${oldName} → ${newName}」（更新 ${res.affectedSnapshots} 个快照）`, 'info');
    }
    if (state.open) void refreshAll(false);
  }, { signal: ac.signal });

  window.addEventListener('wbo:worldbook-deleted', ev => {
    const names = Array.isArray(ev?.detail?.names) ? ev.detail.names : [];
    if (!names.length) return;
    const delSet = new Set(names);
    state.store = loadStore();
    const res = markStoreOnWorldbookDeleted(state.store, names);
    if (res.changed) persistStore(state.store);
    names.forEach(n => { state.bookEntriesCache.delete(n); });
    if (names.includes(state.activeBook)) {
      state.activeBook = '';
      state.wbAllOffConfirm = false;
    }
    if (state.drawer?.type === 'viewSnapshot') {
      const d = state.drawer;
      const latest = state.store.snapshots.find(s => s.id === d.snapshot?.id);
      if (latest) d.snapshot = latest;
      if (d.draft) markStoreOnWorldbookDeleted({ snapshots: [d.draft] }, names);
      if (d.wbDetails) {
        names.forEach(n => { delete d.wbDetails[n]; });
      }
      if (d.subTab === 'worldbooks') renderViewSnapshotBody(d);
    } else if (state.drawer?.type === 'saveSnapshot') {
      const d = state.drawer;
      d.name = shadow.getElementById('upp-ss-name')?.value ?? d.name;
      d.group = shadow.getElementById('upp-ss-group')?.value ?? d.group;
      d.note = shadow.getElementById('upp-ss-note')?.value ?? d.note;
      if (Array.isArray(d.selectedBooks)) {
        d.selectedBooks = d.selectedBooks.filter(bk => !delSet.has(bk));
      }
    }
    if (res.affectedSnapshots > 0) {
      toast(`检测到世界书删除，已在 ${res.affectedSnapshots} 个快照中标记`, 'warning');
    }
    if (state.open) void refreshAll(false);
  }, { signal: ac.signal });

  window.addEventListener('wbo:settings-updated', () => {
    if (!state.open) return;
    if (state.drawer?.type === 'bookPicker') {
      renderBookPickerList(state.drawer);
    } else if (state.drawer?.type === 'viewSnapshot' && state.drawer.subTab === 'worldbooks') {
      renderViewSnapshotBody(state.drawer);
    } else if (state.drawer?.type === 'saveSnapshot') {
      state.drawer.name = shadow.getElementById('upp-ss-name')?.value ?? state.drawer.name;
      state.drawer.group = shadow.getElementById('upp-ss-group')?.value ?? state.drawer.group;
      state.drawer.note = shadow.getElementById('upp-ss-note')?.value ?? state.drawer.note;
      renderDrawer();
    } else if (state.tab === 'worldbook') {
      renderWorldbookToolbar();
    }
  }, { signal: ac.signal });

  // Mount into #extensionsMenu (Magic Wand menu)
  function mountWandMenu() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById(MENU_ENTRY_ID)) return;
    const item = document.createElement('div');
    item.id = MENU_ENTRY_ID;
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.innerHTML =
      '<i class="fa-solid fa-camera-retro extensionsMenuExtensionButton"></i>' +
      '<span>快照管家</span>';
    item.addEventListener('click', ev => {
      ev.preventDefault();
      if (state.open && state.minimized) restoreModal();
      else if (state.open) closeModal();
      else openModal();
    });
    item.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        if (state.open && state.minimized) restoreModal();
        else if (state.open) closeModal();
        else openModal();
      }
    });
    menu.appendChild(item);
  }

  // Mount compact drawer inside Extensions Settings
  function syncExtSettingsCheckbox() {
    const st = loadStore().settings;
    const cb = document.getElementById('upp-ext-auto-apply-cb');
    if (cb) cb.checked = !!st.autoApplyBindings;
    const fabCb = document.getElementById('upp-ext-fab-cb');
    if (fabCb) fabCb.checked = st.showFloatingBall !== false;
    const foldCb = document.getElementById('upp-ext-fold-cb');
    if (foldCb) foldCb.checked = st.presetGroupsDefaultCollapsed !== false;
  }

  function mountExtSettings() {
    const container = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!container || document.getElementById(SETTINGS_BOX_ID)) return;
    const box = document.createElement('div');
    box.id = SETTINGS_BOX_ID;
    box.className = 'inline-drawer';
    box.innerHTML = `
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>快照管家 v${APP_VERSION}</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <div class="upp-ext-settings-row">
          <label class="checkbox_label" for="upp-ext-auto-apply-cb">
            <input id="upp-ext-auto-apply-cb" type="checkbox" ${state.store.settings.autoApplyBindings ? 'checked' : ''} />
            <span>切换聊天/角色时自动切回绑定快照</span>
          </label>
        </div>
        <div class="upp-ext-settings-row">
          <label class="checkbox_label" for="upp-ext-fab-cb">
            <input id="upp-ext-fab-cb" type="checkbox" ${state.store.settings.showFloatingBall !== false ? 'checked' : ''} />
            <span>显示快捷切换悬浮球</span>
          </label>
        </div>
        <div class="upp-ext-settings-row">
          <label class="checkbox_label" for="upp-ext-fold-cb">
            <input id="upp-ext-fold-cb" type="checkbox" ${state.store.settings.presetGroupsDefaultCollapsed !== false ? 'checked' : ''} />
            <span>预设分组默认折叠</span>
          </label>
        </div>
        <div class="upp-ext-settings-row">
          <span>面板配色</span>
          <select id="upp-ext-theme-sel" class="text_pole" style="width:auto;min-width:110px;">
            <option value="paper" ${state.store.settings.themeMode === 'paper' ? 'selected' : ''}>素纸</option>
            <option value="ink" ${state.store.settings.themeMode === 'ink' ? 'selected' : ''}>青岚</option>
            <option value="warm" ${state.store.settings.themeMode === 'warm' ? 'selected' : ''}>暖砂</option>
            <option value="sakura" ${state.store.settings.themeMode === 'sakura' ? 'selected' : ''}>淡樱</option>
            <option value="host" ${state.store.settings.themeMode === 'host' ? 'selected' : ''}>跟随酒馆</option>
            <option value="glass-dark" ${state.store.settings.themeMode === 'glass-dark' ? 'selected' : ''}>深色夜间</option>
          </select>
        </div>
        <div class="upp-ext-settings-row">
          <div class="menu_button" id="upp-ext-open-btn"><i class="fa-solid fa-camera-retro"></i><span>打开面板</span></div>
        </div>
      </div>
    `;
    container.appendChild(box);
    box.querySelector('#upp-ext-open-btn')?.addEventListener('click', openModal);
    box.querySelector('#upp-ext-auto-apply-cb')?.addEventListener('change', ev => {
      state.store = loadStore();
      state.store.settings.autoApplyBindings = !!ev.target.checked;
      persistStore(state.store);
      if (state.open && state.tab === 'snapshots') renderSnapshotsToolbar();
    });
    box.querySelector('#upp-ext-fab-cb')?.addEventListener('change', ev => {
      state.store = loadStore();
      state.store.settings.showFloatingBall = !!ev.target.checked;
      persistStore(state.store);
      syncFabUi();
    });
    box.querySelector('#upp-ext-fold-cb')?.addEventListener('change', ev => {
      state.store = loadStore();
      state.store.settings.presetGroupsDefaultCollapsed = !!ev.target.checked;
      persistStore(state.store);
      state.presetFoldState = {};
      if (state.open && state.tab === 'preset') { renderPresetToolbar(); renderPresetBody(); }
    });
    box.querySelector('#upp-ext-theme-sel')?.addEventListener('change', ev => {
      state.store = loadStore();
      state.store.settings.themeMode = ev.target.value;
      persistStore(state.store);
      applyThemeAll();
    });
  }

  document.body.appendChild(host);
  syncFabUi();
  mountWandMenu();
  mountExtSettings();
  function onAppReady() {
    mountWandMenu();
    mountExtSettings();
    syncFabUi();
  }
  eventSource.on(event_types.APP_READY, onAppReady);

  activeCleanup = () => {
    ac.abort();
    dragState = null;
    resizeState = null;
    fabDragging = false;
    if (autoTimer) { window.clearTimeout(autoTimer); autoTimer = null; }
    if (backfillIdleId !== null) {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(backfillIdleId);
      else window.clearTimeout(backfillIdleId);
      backfillIdleId = null;
    }
    try {
      eventSource.removeListener?.(event_types.CHAT_CHANGED, scheduleAutoApply);
      eventSource.removeListener?.(event_types.APP_READY, onAppReady);
      eventSource.off?.(event_types.CHAT_CHANGED, scheduleAutoApply);
      eventSource.off?.(event_types.APP_READY, onAppReady);
    } catch (_) {}
    state.bookEntriesCache.clear();
  };
  window.addEventListener('pagehide', () => activeCleanup?.(), { signal: ac.signal });
}

if (typeof window !== 'undefined' && typeof window.jQuery === 'function') {
  window.jQuery(() => {
    initExtension();
  });
} else if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initExtension);
  else initExtension();
}
