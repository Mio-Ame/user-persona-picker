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
  applyPersonaMergeToVersions,
  applyPresetMigrationToSnapshots,
  buildCleanCopyText,
  buildPersonaMergePlan,
  buildPresetRenderNodes,
  buildPresetSyncOverrideTree,
  buildReleaseVersionToNativePayload,
  buildSnapshotPresetInspectModel,
  canUseExternalOrganizer,
  clampModalRect,
  clampModalSize,
  computeDraggedModalPosition,
  computeLineDiff,
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
  isBuiltinModuleEnabled,
  markStoreOnWorldbookDeleted,
  migrateStoreOnWorldbookRename,
  normalizeNativePreset,
  normalizeText,
  parseImportJson,
  pickActivePromptOrder,
  resolveBindingForContext,
  restorePersonaMergeVersions,
  sanitizeStore,
  suggestSnapshotNames,
  SNAPSHOT_ROUTES,
  splitSnapshotRoute,
  nameWithSnapshotRoute,
  toOpaqueColor,
  uid,
} from './core.js';

const EXT_KEY = 'user_persona_snapshot';
const LEGACY_LOCAL_KEY = 'userPersonaPicker.v6';
const HOST_ID = 'user-persona-picker-host';
const MENU_ENTRY_ID = 'user-persona-picker-menu-entry';
const SETTINGS_BOX_ID = 'user-persona-picker-ext-settings';
const NATIVE_PERSONA_BAR_ID = 'upp-native-persona-bar';
const MAX_BOOK_CACHE = 6;
const FALLBACK_1PX_PNG_BYTES = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196,
  137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0,
  5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174,
  66, 96, 130,
]);
let activeCleanup = null;

function canAutoFocusDesktop() {
  try {
    return typeof window !== 'undefined'
      && window.innerWidth > 680
      && !window.matchMedia?.('(pointer: coarse)')?.matches;
  } catch (_) {
    return false;
  }
}

function focusDesktopSafe(el) {
  if (!el || !canAutoFocusDesktop()) return;
  try { el.focus({ preventScroll: true }); } catch (_) {}
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

function getToastLayer() {
  try {
    const hostEl = document.getElementById(HOST_ID);
    const sr = hostEl && hostEl.shadowRoot;
    if (!sr) return null;
    let layer = sr.getElementById('upp-toast-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'upp-toast-layer';
      layer.className = 'upp-toast-layer';
      layer.setAttribute('aria-live', 'polite');
      sr.appendChild(layer);
    }
    // 提示层不在面板的配色作用域里，补一次当前配色，避免深色面板弹出浅色提示条
    if (!layer.dataset || !layer.dataset.theme) {
      const themed = sr.querySelector('.upp-backdrop[data-theme], .upp-fab-root[data-theme]');
      if (themed && themed.dataset && themed.dataset.theme) layer.dataset.theme = themed.dataset.theme;
    }
    return layer;
  } catch (_) {
    return null;
  }
}

function toast(msg, type = 'info') {
  const text = String(msg);
  const layer = getToastLayer();
  if (!layer) { console.log('[快照管家]', text); return; }
  const el = document.createElement('div');
  el.className = `upp-toast is-${type}`;
  el.setAttribute('role', 'status');
  el.textContent = text;
  layer.appendChild(el);
  // 只保留最近 4 条；用一次性快照 + 计数，避免在无移除能力的宿主/假 DOM 上死循环
  const kids = [...layer.children];
  for (let i = 0; i < kids.length - 4; i++) { try { kids[i].remove(); } catch (_) {} }
  window.setTimeout(() => {
    el.classList.add('is-out');
    window.setTimeout(() => el.remove(), 240);
  }, 3600);
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

const PANEL_BACKGROUNDS = Object.freeze({
  paper: '#f1f1ec', ink: '#ebf0f3', warm: '#f1ece2', sakura: '#f6edf0', 'glass-dark': '#17181c',
});

function applyThemeToElement(el, mode) {
  if (!el) return;
  const resolvedMode = THEME_MODES.includes(mode) ? mode : 'paper';
  // Clear any previous dynamic host inline vars
  [
    '--bg', '--chrome', '--surface', '--surface-strong', '--border', '--border-strong',
    '--text', '--accent', '--accent-soft', '--accent-border', '--accent-border-strong',
    '--accent-text',
  ].forEach(k => {
    el.style.removeProperty(k);
  });
  if (resolvedMode === 'host') {
    const hv = readHostThemeVars();
    el.dataset.theme = hv.isLight ? 'paper' : 'glass-dark';
    const solidBg = toOpaqueColor(hv.blurBg, PANEL_BACKGROUNDS[el.dataset.theme]);
    el.style.setProperty('--bg', solidBg);
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
    return solidBg;
  }
  el.dataset.theme = resolvedMode;
  return PANEL_BACKGROUNDS[resolvedMode];
}

function getDisabledExtensions() {
  return getContext()?.extensionSettings?.disabledExtensions ?? extension_settings?.disabledExtensions ?? [];
}

function isConnectionManagerEnabled() {
  return isBuiltinModuleEnabled(getDisabledExtensions(), 'connection-manager');
}

function isRegexModuleEnabled() {
  return isBuiltinModuleEnabled(getDisabledExtensions(), 'regex');
}

function getRawOrganizerSettings() {
  const ctxExt = getContext()?.extensionSettings;
  const raw = ctxExt?.worldbook_organizer || extension_settings?.worldbook_organizer;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
}

function hasActiveOrganizerRuntime() {
  if (typeof document === 'undefined') return false;
  return Boolean(
    document.getElementById('wbo-wand-entry')
    || document.getElementById('wbo-wi-quick-actions')
    || document.getElementById('wbo-hdr-show-char')
    || document.getElementById('wbo-manager-overlay')
    || document.querySelector('[id^="wbo-"]'),
  );
}

function hasActiveOrganizer() {
  return canUseExternalOrganizer({
    orgSettings: getRawOrganizerSettings(),
    disabledExtensions: getDisabledExtensions(),
    hasActiveRuntime: hasActiveOrganizerRuntime(),
  });
}

function getOrganizerSettings() {
  return hasActiveOrganizer() ? getRawOrganizerSettings() : null;
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

function isNativePersonaBarEnabled() {
  const raw = extension_settings?.[EXT_KEY];
  if (raw && typeof raw.showNativePersonaBar === 'boolean') return raw.showNativePersonaBar;
  return true;
}

function loadStore() {
  let raw = extension_settings[EXT_KEY];
  if (!raw || typeof raw !== 'object') {
    // One-time seamless migration from v6 script localStorage if present
    try {
      const legacy = window.localStorage.getItem(LEGACY_LOCAL_KEY);
      if (legacy) raw = JSON.parse(legacy);
    } catch (_) {}
  }
  const showNativePersonaBar = typeof raw?.showNativePersonaBar === 'boolean' ? raw.showNativePersonaBar : true;
  const clean = sanitizeStore(raw || createEmptyStore());
  clean.showNativePersonaBar = showNativePersonaBar;
  if (raw && typeof raw === 'object' && extension_settings[EXT_KEY] === raw) {
    raw.version = clean.version;
    raw.settings = clean.settings;
    raw.snapshots = clean.snapshots;
    raw.personaVersions = clean.personaVersions;
    raw.bindings = clean.bindings;
    raw.showNativePersonaBar = showNativePersonaBar;
    return raw;
  }
  extension_settings[EXT_KEY] = clean;
  return clean;
}

function persistStore(store) {
  const prevBar = extension_settings?.[EXT_KEY]?.showNativePersonaBar;
  const showNativePersonaBar = typeof store?.showNativePersonaBar === 'boolean'
    ? store.showNativePersonaBar
    : (typeof prevBar === 'boolean' ? prevBar : true);
  const clean = sanitizeStore(store);
  clean.showNativePersonaBar = showNativePersonaBar;
  if (store && typeof store === 'object' && extension_settings[EXT_KEY] === store) {
    store.version = clean.version;
    store.settings = clean.settings;
    store.snapshots = clean.snapshots;
    store.personaVersions = clean.personaVersions;
    store.bindings = clean.bindings;
    store.showNativePersonaBar = showNativePersonaBar;
    try { saveSettingsDebounced(); } catch (_) {}
    return store;
  }
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
    await setUserAvatar(avatarId, { toastPersonaNameChange: false, navigateToCurrent: false });
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
  async fetchPersonaAvatarBlob(avatarId) {
    const aid = String(avatarId || '').trim();
    if (!aid) return null;
    try {
      const resp = await fetch(`/User Avatars/${encodeURIComponent(aid)}`, { cache: 'no-cache' });
      if (!resp || !resp.ok) return null;
      return await resp.blob();
    } catch (_) {
      return null;
    }
  },
  async createNativePersona({ name, description, lorebook, avatarBlob, overwriteName, suggestedAvatarId } = {}) {
    const cleanName = String(name || '').trim().slice(0, 60) || '恢复的 User';
    const fallbackBlob = new Blob([FALLBACK_1PX_PNG_BYTES], { type: 'image/png' });
    const blob = (avatarBlob && typeof avatarBlob.size === 'number' && avatarBlob.size > 0) ? avatarBlob : fallbackBlob;
    const fd = new FormData();
    const uploadFilename = (typeof overwriteName === 'string' && overwriteName.trim())
      ? overwriteName.trim()
      : (String(suggestedAvatarId || '').trim() || 'persona.png');
    fd.append('avatar', blob, uploadFilename);
    if (typeof overwriteName === 'string' && overwriteName.trim()) {
      fd.append('overwrite_name', overwriteName.trim());
    }
    const headers = { ...(getRequestHeaders() || {}) };
    delete headers['Content-Type'];
    delete headers['content-type'];
    const resp = await fetch('/api/avatars/upload', {
      method: 'POST',
      headers,
      body: fd,
    });
    if (!resp || !resp.ok) {
      throw new Error(`创建原生 User 头像失败 (${resp?.status || 'network'})`);
    }
    let data = null;
    try { data = await resp.json(); } catch (_) { data = null; }
    const newId = String(data?.path || uploadFilename).trim();
    if (!newId) throw new Error('未能获取新建原生 User 头像标识');
    if (!power_user.personas) power_user.personas = {};
    if (!power_user.persona_descriptions) power_user.persona_descriptions = {};
    power_user.personas[newId] = cleanName;
    power_user.persona_descriptions[newId] = {
      description: String(description || ''),
      lorebook: typeof lorebook === 'string' ? lorebook : '',
    };
    saveSettingsDebounced();
    try { await getUserAvatars(true, newId); } catch (_) {}
    return newId;
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
      keys: Array.isArray(e.key) ? e.key.map(String) : [],
      position: Number(e.position ?? 1),
      depth: Number(e.depth ?? 4),
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
  async updateWorldbookEntry(bookName, uidNum, name, content, strategyType, metadata = {}) {
    const data = await loadWorldInfo(bookName);
    if (!data?.entries) throw new Error('世界书读取失败');
    const key = String(uidNum);
    const entry = data.entries[key] || Object.values(data.entries).find(e => String(e.uid) === key);
    if (!entry) throw new Error('条目不存在');
    entry.comment = name;
    entry.content = content;
    if (strategyType === 'constant') { entry.constant = true; entry.vectorized = false; }
    else if (strategyType === 'selective') { entry.constant = false; entry.vectorized = false; }
    else if (strategyType === 'vectorized') { entry.constant = false; entry.vectorized = true; }
    if (Array.isArray(metadata.keys)) entry.key = metadata.keys;
    if (Number.isInteger(metadata.position) && metadata.position >= 0) entry.position = metadata.position;
    if (Number.isInteger(metadata.depth) && metadata.depth >= 0) entry.depth = metadata.depth;
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
    return String(nextUid);
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
    if (!isRegexModuleEnabled()) return [];
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
    if (!isRegexModuleEnabled()) {
      throw new Error('酒馆内置正则模块已禁用');
    }
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
    if (!isRegexModuleEnabled()) return { changed: 0, skipped: wanted.length };
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
      const disabled = !isConnectionManagerEnabled();
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
      const disabled = !isConnectionManagerEnabled();
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
    if ((apiObj.profileId || apiObj.profileName) && isConnectionManagerEnabled()) {
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

    if ((apiObj.profileId || apiObj.profileName) && !isConnectionManagerEnabled() && !apiObj.source && !apiObj.model) {
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
    const rgEng = isRegexModuleEnabled() ? await ensureRegexEngine() : false;
    if (!rgEng || typeof rgEng.getScriptsByType !== 'function') {
      snap.scope.regex = false;
      snap.regex = null;
    } else {
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
  }

  if (scope.api) {
    const apiCfg = Host.getCurrentApiConfig();
    if (apiCfg) snap.api = apiCfg;
    else snap.scope.api = false;
  }

  return snap;
}

let isApplyingSnapshot = false;

// 由 initExtension 注入：把「全局书怎么处理」这个决定交给面板里的确认条
let confirmGlobalBooksHook = null;

// 应用快照时全局世界书的处理：快照里的书要开；用户后来自己挂上的书是否要关，交给策略或用户决定
function diffSnapshotGlobalBooks(snap) {
  const allBooks = new Set(Host.listWorldbooks());
  const rawSnap = Array.isArray(snap?.worldbooks?.global) ? snap.worldbooks.global : [];
  const target = rawSnap.filter(b => allBooks.has(b));
  const current = (Host.getGlobalWorldbooks() || []).filter(b => allBooks.has(b));
  return {
    target,
    current,
    missing: target.filter(b => !current.includes(b)),      // 快照有、现在没开 → 会补开
    stray: current.filter(b => !target.includes(b)),        // 现在开着、快照没有 → 覆盖会关掉
    invalid: rawSnap.length - target.length,
  };
}

function resolveGlobalBooksMode(store) {
  const mode = store?.settings?.globalBooksMode;
  return ['ask', 'replace', 'merge'].includes(mode) ? mode : 'ask';
}

async function applySnapshotLive(snap, store, silentPrefix, opts = {}) {
  if (!snap || isApplyingSnapshot) return;
  isApplyingSnapshot = true;
  let totalSkipped = 0;
  let regexChanged = false;

  try {
    // 全局书冲突必须先问：否则先切了人设/预设，用户再取消就成半套状态
    let globalDecision = 'replace';
    let globalDiff = null;
    if (snap.scope?.worldbooks && snap.worldbooks && Array.isArray(snap.worldbooks.global)) {
      globalDiff = diffSnapshotGlobalBooks(snap);
      const mode = resolveGlobalBooksMode(store);
      if (!globalDiff.stray.length) {
        globalDecision = 'replace';
      } else if (opts.globalBooksDecision === 'replace' || opts.globalBooksDecision === 'merge') {
        globalDecision = opts.globalBooksDecision;
      } else if (mode === 'replace' || mode === 'merge') {
        globalDecision = mode;
      } else if (opts.interactive && confirmGlobalBooksHook) {
        const decision = await confirmGlobalBooksHook(snap, globalDiff, silentPrefix || '');
        if (!decision) return;   // 用户取消：一个字都不改
        globalDecision = decision;
      } else {
        // 自动应用：绝不静默关掉用户自己后来挂上的书
        globalDecision = 'merge';
      }
    }

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
        const diff = globalDiff || diffSnapshotGlobalBooks(snap);
        totalSkipped += diff.invalid;
        const finalGlobals = globalDecision === 'merge'
          ? Array.from(new Set([...diff.target, ...diff.current]))
          : diff.target;
        await Host.setGlobalWorldbooks(finalGlobals);
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
  minimize: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  resizeGrip: '<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="11" y1="5" x2="5" y2="11"/><line x1="11" y1="9" x2="9" y2="11"/></svg>',
};

// =========================
// Shadow DOM Styles
// =========================

const STYLE_CSS = `
:host {
  all: initial;
  /* 统一字号阶梯：全插件只允许这四档（手机端输入框由 16px 反缩放规则另行覆盖） */
  --upp-fs-xs: 11px;
  --upp-fs-sm: 12px;
  --upp-fs-md: 13px;
  --upp-fs-lg: 15px;
  position: fixed;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  pointer-events: none;
  /* 宿主容器自身也要压在最上层：position: fixed 会生成独立层叠上下文，
     若此处为 auto，宿主任何带 z-index 的界面元素都会盖住整个面板，看起来就像面板透明 */
  z-index: 900000;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: var(--upp-fs-md);
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}
*, *::before, *::after { box-sizing: border-box; }
/* 表单控件默认继承字号，杜绝浏览器给 button/input 塞 13.3px 之类的原生字号 */
button, input, select, textarea { font-family: inherit; font-size: inherit; }
[hidden] { display: none !important; }

/* Unified Theme Palettes: paper (素纸) | ink (青岚) | warm (暖砂) | sakura (淡樱) | glass-dark (深色夜间) */
.upp-backdrop,
.upp-fab-root,
.upp-restore-pill,
.upp-toast-layer {
  --bg: ${PANEL_BACKGROUNDS.paper};
  --chrome: #e5e5de;
  --surface: #e9e9e3;
  --inset: #e8e8e0;
  --inset-strong: #deded5;
  --surface-strong: #ffffff;
  --surface-hover: #e1e1da;
  --border: #d8d8d0;
  --border-strong: #b8b8ae;
  --text: #222220;
  --muted: #656560;
  --accent: #2c2c2e;
  --accent-soft: rgba(44, 44, 46, 0.10);
  --accent-border: color-mix(in srgb, var(--accent) 34%, var(--border));
  --accent-border-strong: color-mix(in srgb, var(--accent) 52%, var(--border));
  --accent-text: #fcfcfb;
  --ok: #367365;
  --ok-soft: rgba(54, 115, 101, 0.14);
  --warn: #9f6730;
  --warn-soft: rgba(159, 103, 48, 0.15);
  --danger: #a53c3c;
  --danger-soft: rgba(165, 60, 60, 0.12);
  --switch-off: #c9c9c1;
  --shadow: 0 12px 32px rgba(18, 20, 26, 0.18), 0 0 0 1px rgba(18, 20, 26, 0.08);
  --modal-shadow: 0 16px 44px rgba(18, 20, 26, 0.24), 0 2px 10px rgba(18, 20, 26, 0.12);
  --card-shadow: 0 1px 2px rgba(18, 20, 26, 0.05);
  --scrim: rgba(20, 24, 32, 0.22);
}

.upp-backdrop[data-theme="ink"],
.upp-fab-root[data-theme="ink"],
.upp-restore-pill[data-theme="ink"],
.upp-toast-layer[data-theme="ink"] {
  --bg: ${PANEL_BACKGROUNDS.ink};
  --chrome: #dde5ea;
  --surface: #e2eaef;
  --inset: #e3ecef;
  --inset-strong: #d9e5ea;
  --surface-strong: #ffffff;
  --surface-hover: #d5e1e8;
  --border: #c8d5de;
  --border-strong: #9fb4c2;
  --text: #1c2830;
  --muted: #536775;
  --accent: #267072;
  --accent-soft: rgba(38, 112, 114, 0.13);
  --accent-text: #ffffff;
  --ok: #267072;
  --ok-soft: rgba(38, 112, 114, 0.14);
  --switch-off: #b8c9d4;
}

.upp-backdrop[data-theme="warm"],
.upp-fab-root[data-theme="warm"],
.upp-restore-pill[data-theme="warm"],
.upp-toast-layer[data-theme="warm"] {
  --bg: ${PANEL_BACKGROUNDS.warm};
  --chrome: #e5ddd0;
  --surface: #e9e2d6;
  --inset: #e9e1d3;
  --inset-strong: #dfd5c4;
  --surface-strong: #fffdf9;
  --surface-hover: #dfd6c6;
  --border: #d5cab8;
  --border-strong: #b6a68e;
  --text: #2c241c;
  --muted: #706455;
  --accent: #825932;
  --accent-soft: rgba(130, 89, 50, 0.13);
  --accent-text: #ffffff;
  --ok: #46745e;
  --ok-soft: rgba(70, 116, 94, 0.14);
  --switch-off: #cabfa9;
}

.upp-backdrop[data-theme="sakura"],
.upp-fab-root[data-theme="sakura"],
.upp-restore-pill[data-theme="sakura"],
.upp-toast-layer[data-theme="sakura"] {
  --bg: ${PANEL_BACKGROUNDS.sakura};
  --chrome: #ecdfe4;
  --surface: #f0e4e8;
  --inset: #f1e6ea;
  --inset-strong: #e8d9df;
  --surface-strong: #ffffff;
  --surface-hover: #e7d5dc;
  --border: #dec9d1;
  --border-strong: #c2a1ae;
  --text: #312128;
  --muted: #755d67;
  --accent: #ad5270;
  --accent-soft: rgba(173, 82, 112, 0.13);
  --accent-text: #ffffff;
  --ok: #477d70;
  --ok-soft: rgba(71, 125, 112, 0.14);
  --switch-off: #d5bcc6;
}

.upp-backdrop[data-theme="glass-dark"],
.upp-fab-root[data-theme="glass-dark"],
.upp-restore-pill[data-theme="glass-dark"],
.upp-toast-layer[data-theme="glass-dark"] {
  --bg: ${PANEL_BACKGROUNDS['glass-dark']};
  --chrome: #111216;
  --surface: #202228;
  --inset: #14161a;
  --inset-strong: #1e2127;
  --surface-strong: #292c34;
  --surface-hover: #333741;
  --border: #353842;
  --border-strong: #525666;
  --text: #f0f0ec;
  --muted: #a1a3ac;
  --accent: #e0e0dc;
  --accent-soft: rgba(224, 224, 220, 0.15);
  --accent-text: #141518;
  --ok: #56b49c;
  --ok-soft: rgba(86, 180, 156, 0.18);
  --warn: #e5a95c;
  --warn-soft: rgba(229, 169, 92, 0.18);
  --danger: #e06c6c;
  --danger-soft: rgba(224, 108, 108, 0.18);
  --switch-off: rgba(255, 255, 255, 0.22);
  --shadow: 0 18px 46px rgba(0, 0, 0, 0.58), 0 0 0 1px rgba(255, 255, 255, 0.08);
  --modal-shadow: 0 22px 58px rgba(0, 0, 0, 0.68), 0 0 0 1px rgba(255, 255, 255, 0.10);
  --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.28);
  --scrim: rgba(0, 0, 0, 0.46);
}

.upp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 30000;
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
  width: min(780px, 100%);
  height: min(690px, 88vh);
  height: min(690px, 88dvh);
  max-height: 100vh;
  max-height: 100dvh;
  /* 实底兜底：先铺一层不透明底色，再由主题色覆盖；任何变量解析失败都绝不透出宿主内容 */
  background-color: #f1f1ec;
  background-image: linear-gradient(var(--bg), var(--bg));
  border: 1.5px solid var(--border-strong);
  border-radius: 16px;
  box-shadow: var(--modal-shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.upp-modal.is-floating {
  position: fixed;
  margin: 0;
}
.upp-modal.is-dragging,
.upp-modal.is-resizing {
  user-select: none;
}
/* 深色配色下的实底兜底（仅在主题色变量异常时才可见，保证永不透底） */
.upp-backdrop[data-theme="glass-dark"] .upp-modal,
.upp-fab-root[data-theme="glass-dark"] .upp-fab-pop {
  background-color: #17181c;
}
/* 悬浮球压在面板的顶栏/底栏时按左右侧让位，标题、状态与按钮都不会被球挡住 */
.upp-modal.is-fab-clear-head-l .upp-header { padding-left: calc(16px + 48px); }
.upp-modal.is-fab-clear-head-r .upp-header { padding-right: calc(16px + 48px); }
.upp-modal.is-fab-clear-foot-l .upp-footer { padding-left: calc(12px + 36px); }
.upp-modal.is-fab-clear-foot-r .upp-footer { padding-right: calc(12px + 36px); }

.upp-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 16px 9px;
  background: var(--chrome);
  border-top: 2.5px solid var(--accent);
  border-bottom: 1px solid var(--border-strong);
}
.upp-modal.is-draggable .upp-header {
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.upp-modal.is-dragging .upp-header {
  cursor: grabbing;
}
/* 明确的拖动抓手：手机端顶栏几乎被控件占满，必须有固定可抓的区域 */
.upp-drag-grip {
  flex-shrink: 0;
  width: 12px;
  height: 22px;
  margin-right: 2px;
  border-radius: 4px;
  background-image: radial-gradient(currentColor 1px, transparent 1.2px);
  background-size: 5px 5px;
  background-position: 50% 50%;
  background-repeat: repeat;
  color: var(--muted);
  opacity: 0.55;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.upp-modal.is-dragging .upp-drag-grip { cursor: grabbing; opacity: 0.8; }
.upp-title-wrap { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.upp-title { font-size: var(--upp-fs-lg); font-weight: 650; letter-spacing: -0.01em; white-space: nowrap; flex-shrink: 0; }
.upp-ctx-chip {
  font-size: var(--upp-fs-xs); color: var(--muted); background: var(--surface); border: 1px solid var(--border);
  border-radius: 999px; padding: 2px 8px; max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.upp-head-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
#upp-theme-select { max-width: 96px; }

.upp-tabs {
  flex-shrink: 0; display: flex; align-items: center; gap: 5px;
  padding: 7px 16px; border-bottom: 1px solid var(--border); background: var(--surface);
  overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none;
}
.upp-tabs::-webkit-scrollbar { display: none; }
.upp-tab {
  height: 32px; min-height: 32px; padding: 0 12px; border-radius: 9px; border: 1px solid transparent;
  background: transparent; color: var(--muted); font-size: var(--upp-fs-md); font-weight: 550; line-height: 1;
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  white-space: nowrap; flex-shrink: 0; vertical-align: middle;
  transition: background 0.14s, color 0.14s, border-color 0.14s, box-shadow 0.14s;
}
.upp-tab > span { line-height: 1; display: inline-flex; align-items: center; }
.upp-tab:hover { color: var(--text); background: var(--surface-hover); }
.upp-tab.active {
  color: var(--accent); background: var(--surface-strong);
  border-color: var(--accent-border-strong); font-weight: 650;
  box-shadow: var(--card-shadow);
}
.upp-tab-count {
  font-size: var(--upp-fs-xs); line-height: 1; height: 16px; min-width: 16px; padding: 0 5px;
  border-radius: 999px; background: var(--surface-strong); border: 1px solid var(--border-strong);
  color: var(--muted); display: inline-flex; align-items: center; justify-content: center;
  font-variant-numeric: tabular-nums;
}
.upp-tab.active .upp-tab-count {
  background: var(--accent); border-color: var(--accent); color: var(--accent-text);
}

.upp-toolbar {
  flex-shrink: 0; display: flex; flex-direction: column; gap: 8px;
  padding: 9px 16px; background: var(--surface); border-bottom: 1px solid var(--border-strong);
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
  background: var(--surface-strong); color: var(--text); font-size: var(--upp-fs-sm); font-family: inherit;
}
.upp-btn {
  padding: 0 10px; display: inline-flex; align-items: center; justify-content: center;
  gap: 5px; cursor: pointer; white-space: nowrap; flex-shrink: 0;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.upp-btn:hover:not(:disabled) { background: var(--surface-hover); border-color: var(--border-strong); }
.upp-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.upp-btn.icon-only { width: 30px; padding: 0; }
.upp-btn.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: 550; }
.upp-btn.primary:hover:not(:disabled) { filter: brightness(1.06); }
.upp-btn.secondary { background: var(--accent-soft); color: var(--accent); border-color: var(--accent-border); font-weight: 520; }
.upp-btn.secondary:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 18%, var(--surface-strong)); border-color: var(--accent-border-strong); }
.upp-btn.active { background: var(--accent-soft); color: var(--accent); border-color: var(--accent-border-strong); }
.upp-btn.danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 28%, var(--border)); }
.upp-btn.danger:hover:not(:disabled) { background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 42%, transparent); }
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
  width: 100%; height: 100%; min-height: 0; border: none; background: transparent; color: var(--text); font-size: var(--upp-fs-sm); font-family: inherit; outline: none;
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
  font-size: var(--upp-fs-sm); color: var(--text); cursor: pointer; white-space: nowrap; flex-shrink: 0; user-select: none;
}

.upp-body {
  flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain;
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
  padding: 10px 16px; border-top: 1px solid var(--border-strong); background: var(--chrome);
}
.upp-foot-status {
  min-width: 0; display: flex; align-items: center; gap: 6px; font-size: var(--upp-fs-sm);
  color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.upp-foot-status > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.upp-foot-status strong { color: var(--text); font-weight: 600; }
.upp-foot-actions { display: flex; align-items: center; gap: 7px; flex-shrink: 0; }
.upp-foot-actions .upp-btn { height: 32px; padding: 0 12px; }

.upp-pill-strip { display: flex; align-items: center; gap: 6px; overflow-x: auto; overscroll-behavior-x: contain; padding-bottom: 1px; scrollbar-width: none; }
.upp-pill-strip::-webkit-scrollbar { display: none; }
.upp-pill {
  height: 26px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--border);
  background: var(--surface); color: var(--muted); font-size: var(--upp-fs-sm); cursor: pointer;
  white-space: nowrap; flex-shrink: 0; display: inline-flex; align-items: center; line-height: 1; vertical-align: middle;
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
  background: var(--surface-strong); border: 1px solid var(--border-strong); border-radius: 13px;
  padding: 11px 13px; display: flex; flex-direction: column; gap: 8px;
  min-width: 0; overflow: hidden; box-shadow: var(--card-shadow);
}
.upp-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.upp-card-head > .upp-row-nowrap:first-child { flex: 1; min-width: 0; }
.upp-card-head > .upp-row-nowrap:last-child:not(:first-child) { flex-shrink: 0; }
.upp-card-head > .upp-card-meta { flex-shrink: 0; }
.upp-card-head .upp-badge { max-width: 150px; }
.upp-card-title { font-size: var(--upp-fs-md); font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.upp-card-meta { font-size: var(--upp-fs-sm); color: var(--muted); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; max-width: 100%; overflow-wrap: anywhere; }

.upp-badge {
  display: inline-flex; align-items: center; justify-content: center;
  height: 20px; max-width: 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  padding: 0 8px; border-radius: 999px; line-height: 1;
  font-size: var(--upp-fs-sm); border: 1px solid var(--border); background: var(--surface-strong); color: var(--muted); white-space: nowrap; flex-shrink: 0;
}
button.upp-badge { display: inline-flex; align-items: center; gap: 4px; }
button.upp-badge > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.upp-badge.accent { color: var(--accent); background: var(--accent-soft); border-color: var(--accent-border); }
.upp-badge.ok { color: var(--ok); background: var(--ok-soft); border-color: color-mix(in srgb, var(--ok) 28%, transparent); }
.upp-badge.warn { color: var(--warn); background: var(--warn-soft); border-color: color-mix(in srgb, var(--warn) 30%, transparent); }

/* Collapsible Group Box (shared by Preset tab and Snapshot Detail Viewer) */
/* 层级：页面底 → 分组下沉底 → 分组标题带 → 条目卡片（最亮），三层肉眼可分 */
.upp-group-box {
  border: 1px solid var(--border); border-left: 3px solid var(--accent-border-strong);
  border-radius: 12px; background: var(--inset); overflow: hidden; box-shadow: none;
}
.upp-group-box.is-disabled { opacity: 0.62; }
.upp-group-box.is-disabled > .upp-group-head { opacity: 0.8; }
.upp-group-head {
  display: flex; align-items: center; gap: 8px; padding: 7px 11px;
  background: var(--inset-strong); border-bottom: 1px solid var(--border);
  box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.03);
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
  display: flex; flex-direction: column; gap: 5px; padding: 6px 8px 8px 9px;
}
.upp-group-items > * { flex-shrink: 0; }
.upp-group-box.is-collapsed > .upp-group-items { display: none; }

/* 世界书选择器：分组胶囊在顶部方便挑，分组栏吸顶，滚到很下面也能随时折叠 */
/* 吸顶要求祖先不剪裁，所以这里单独一套 box/head，不复用 overflow:hidden 的 .upp-group-box */
.upp-wb-chips { flex: 0 0 auto; padding-block: 1px 5px; }
.upp-wb-chip-count { opacity: 0.7; margin-left: 5px; font-variant-numeric: tabular-nums; }
.upp-bp-box {
  border: 1px solid var(--border); border-left: 3px solid var(--accent-border-strong);
  border-radius: 12px; background: var(--inset); overflow: visible; box-shadow: none;
}
.upp-bp-head {
  position: sticky; top: 0; z-index: 3;
  display: flex; align-items: center; gap: 8px; padding: 6px 9px;
  background: var(--inset-strong); border-bottom: 1px solid var(--border);
  border-radius: 11px 11px 0 0; box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.03);
}
.upp-bp-box.is-collapsed .upp-bp-head { border-radius: 11px; border-bottom-color: transparent; }
.upp-bp-items { display: flex; flex-direction: column; gap: 4px; padding: 5px 6px 6px; }
.upp-bp-items > * { flex-shrink: 0; }
.upp-bp-box.is-collapsed > .upp-bp-items { display: none; }

.upp-ps-ov-box { overflow: visible; }
.upp-ps-ov-head { position: sticky; top: 0; z-index: 1; border-radius: 9px; background: var(--bg); }
.upp-ps-ov-scroll { max-height: min(34dvh, 280px); overflow-y: auto; overscroll-behavior: contain; }
#upp-ps-ov-list { display: grid; gap: 5px; }
.upp-ps-ov-master, .upp-ps-ov-prompt { padding: 4px 6px; }
.upp-ps-ov-prompt > .upp-badge { margin-left: auto; }
.upp-ps-sync-options { flex: 0 0 auto; padding: 6px 14px; border-top: 1px solid var(--border); background: var(--surface); }

.upp-entry-list { display: flex; flex-direction: column; gap: 5px; }
.upp-entry-list > * { flex-shrink: 0; }
.upp-entry-row {
  display: flex; align-items: center; gap: 8px; padding: 7px 10px;
  border-radius: 10px; border: 1px solid var(--border-strong); background: var(--surface-strong);
  box-shadow: var(--card-shadow);
  transition: background 0.12s, border-color 0.12s, opacity 0.12s;
}
[data-wb-row], [data-wb-panel] { contain: layout style; }
.upp-entry-row:hover { background: var(--surface-strong); border-color: var(--accent-border-strong); }
.upp-entry-row.is-on { border-color: var(--accent-border-strong); background: var(--surface-strong); }
/* 未开启：整行退成虚框淡出，只让正文与图标变淡，开关保持清晰可点 */
.upp-entry-row.is-off {
  background: transparent;
  border-style: dashed;
  border-color: var(--border);
  box-shadow: none;
}
.upp-entry-row.is-off > .upp-entry-main { opacity: 0.42; }
.upp-entry-row.is-off > .upp-entry-main .upp-dot { opacity: 0.6; }
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
  font-size: var(--upp-fs-xs); font-weight: 650; padding: 1px 5px; border-radius: 5px;
  background: var(--accent-soft); color: var(--accent); flex-shrink: 0; text-transform: uppercase;
}
.upp-role-tag.placeholder { background: var(--surface); color: var(--muted); border: 1px solid var(--border); }
.upp-entry-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.upp-entry-title-row { display: flex; align-items: center; gap: 5px; min-width: 0; overflow: hidden; }
.upp-entry-title-row .upp-badge { flex: 0 1 auto; min-width: 44px; }
.upp-entry-title-row .upp-badge.upp-keep { flex-shrink: 0; min-width: 0; }
.upp-entry-name { flex: 0 1 auto; font-size: var(--upp-fs-md); font-weight: 520; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.upp-entry-preview { font-size: var(--upp-fs-sm); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
  border-left: 3px solid var(--accent);
  border-top: 1px dashed var(--border);
  border-radius: 0 0 10px 10px;
  background: var(--bg);
  padding: 9px 10px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.upp-inline-meta {
  font-size: var(--upp-fs-xs); color: var(--muted);
  display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
}
.upp-inline-pre {
  margin: 0; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--surface-strong); color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "PingFang SC", monospace;
  font-size: var(--upp-fs-sm); line-height: 1.55; white-space: pre-wrap; word-break: break-word;
  max-height: 280px; overflow-y: auto; overscroll-behavior: contain;
}
.upp-inline-textarea {
  width: 100%; min-height: 150px; max-height: 320px; resize: vertical;
  border-radius: 8px; border: 1px solid var(--border-strong);
  background: var(--surface-strong); color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "PingFang SC", monospace;
  font-size: var(--upp-fs-sm); line-height: 1.55; padding: 8px 10px; outline: none;
  overscroll-behavior: contain;
}
[data-wb-inline-content].is-tall { min-height: max(280px, 45dvh); max-height: none; }
[data-wb-wrap].is-highlighted > [data-wb-row] { outline: 2px solid var(--accent); outline-offset: -2px; }
#upp-pin-book-btn { margin-inline-start: auto; }
.upp-inline-textarea:focus { border-color: var(--accent); }
.upp-inline-foot { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.upp-wb-sub { color: var(--muted); font-size: var(--upp-fs-xs); margin-left: 4px; font-weight: 400; }

.upp-persona-live-box {
  font-size: var(--upp-fs-md); line-height: 1.55; color: var(--text); background: var(--surface-strong);
  border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px;
  max-height: 180px; overflow-y: auto; overscroll-behavior: contain; white-space: pre-wrap; word-break: break-word; cursor: pointer;
}
.upp-persona-live-box:hover { border-color: var(--accent); }
.upp-persona-live-box.is-empty { color: var(--muted); }

.upp-book-trigger { flex: 1; min-width: 140px; max-width: 280px; justify-content: space-between; }
.upp-book-trigger span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.upp-bind-strip {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 11px;
  border-radius: 10px; background: var(--accent-soft); border: 1px solid var(--accent-border); font-size: var(--upp-fs-sm);
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
  text-align: center; color: var(--muted); padding: 36px 16px; font-size: var(--upp-fs-md);
  display: flex; flex-direction: column; align-items: center; gap: 10px;
}

/* Drawers — standard dialog + Full-Modal Snapshot Inspector */
.upp-drawer-mask {
  position: absolute; inset: 0; z-index: 20; background: var(--scrim);
  pointer-events: none;
  display: flex; align-items: center; justify-content: center; padding: 14px;
}
.upp-drawer-mask:not([hidden]) {
  pointer-events: auto;
}
.upp-drawer-mask.is-full { padding: 0; background: var(--bg); }
.upp-drawer-mask.is-non-blocking:not([hidden]) {
  pointer-events: none;
  background: transparent;
  justify-content: flex-end;
  align-items: stretch;
  padding: 10px;
}
.upp-drawer-mask.is-non-blocking .upp-drawer {
  pointer-events: auto;
  width: min(440px, 100%);
  height: 100%;
  max-height: 100%;
}
/* 8 invisible edge + corner resize hotzones (desktop / floating mode) */
.upp-rz {
  position: absolute;
  z-index: 16;
  touch-action: none;
  user-select: none;
}
.upp-rz-n { top: 0; left: 10px; right: 10px; height: 6px; cursor: ns-resize; }
.upp-rz-s { bottom: 0; left: 10px; right: 10px; height: 6px; cursor: ns-resize; }
.upp-rz-w { left: 0; top: 10px; bottom: 10px; width: 6px; cursor: ew-resize; }
.upp-rz-e { right: 0; top: 10px; bottom: 10px; width: 6px; cursor: ew-resize; }
.upp-rz-nw { top: 0; left: 0; width: 12px; height: 12px; cursor: nwse-resize; z-index: 17; }
.upp-rz-ne { top: 0; right: 0; width: 12px; height: 12px; cursor: nesw-resize; z-index: 17; }
.upp-rz-sw { bottom: 0; left: 0; width: 12px; height: 12px; cursor: nesw-resize; z-index: 17; }
.upp-rz-se { bottom: 0; right: 0; width: 12px; height: 12px; cursor: nwse-resize; z-index: 17; }
.upp-drawer {
  width: min(620px, 100%); max-height: 100%; background: var(--surface-strong);
  border: 1.5px solid var(--border-strong); border-radius: 15px; box-shadow: var(--modal-shadow);
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
  padding: 11px 14px; border-bottom: 1px solid var(--border); font-weight: 600; font-size: var(--upp-fs-md);
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
  flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; padding: 12px 14px;
  display: flex; flex-direction: column; gap: 8px;
}
.upp-drawer-body > * { flex-shrink: 0; }
.upp-drawer-foot {
  flex-shrink: 0; display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  padding: 10px 14px; border-top: 1px solid var(--border); background: var(--surface);
}

.upp-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.upp-field label { font-size: var(--upp-fs-sm); color: var(--muted); font-weight: 550; }
.upp-text-input, .upp-textarea {
  width: 100%; border-radius: 9px; border: 1px solid var(--border-strong);
  background: var(--bg); color: var(--text); font-family: inherit; font-size: var(--upp-fs-md); padding: 7px 10px; outline: none;
}
.upp-text-input:focus, .upp-textarea:focus { border-color: var(--accent); }
.upp-textarea {
  min-height: 220px; resize: vertical; line-height: 1.55; overscroll-behavior: contain;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "PingFang SC", monospace;
}

.upp-check-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.upp-check-item {
  display: flex; align-items: center; gap: 7px; padding: 7px 9px; border-radius: 9px; min-width: 0;
  border: 1px solid var(--border); background: var(--surface); cursor: pointer; font-size: var(--upp-fs-sm); user-select: none;
}
.upp-check-item input { accent-color: var(--accent); margin: 0; flex-shrink: 0; }
.upp-check-item > span:not(.upp-badge) { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.upp-check-item > .upp-badge { flex-shrink: 0; max-width: 110px; }

.upp-pop-list {
  max-height: 220px; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 4px;
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
  font-size: var(--upp-fs-md); font-weight: 600; color: var(--text); min-width: 0; flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.upp-merge-snippet {
  font-size: var(--upp-fs-sm); color: var(--muted); line-height: 1.45;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  word-break: break-word; padding-left: 21px;
}
.upp-unsaved-bar {
  flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
  padding: 9px 14px; background: var(--warn-soft); border-bottom: 1px solid rgba(166, 110, 56, 0.35);
  color: var(--text); font-size: var(--upp-fs-sm);
}

.upp-diff-box {
  border: 1px solid var(--border); border-radius: 10px; background: var(--bg); padding: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: var(--upp-fs-sm); line-height: 1.5;
  max-height: 320px; overflow-y: auto; overscroll-behavior: contain; white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere;
}
.upp-diff-line { padding: 1px 6px; border-radius: 4px; }
.upp-diff-line.del { background: var(--danger-soft); color: var(--danger); }
.upp-diff-line.add { background: var(--ok-soft); color: var(--ok); }
.upp-diff-line.same { color: var(--muted); }

.upp-sec-title {
  font-size: var(--upp-fs-sm); font-weight: 600; color: var(--muted);
  display: flex; align-items: center; justify-content: space-between; margin-top: 2px;
}
.upp-detail-item {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 9px;
  border-radius: 8px; border: 1px solid var(--border); background: var(--bg);
  cursor: pointer; font-size: var(--upp-fs-sm); color: var(--text); text-align: left; width: 100%; min-width: 0;
}
.upp-detail-item > span:first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.upp-detail-item > *:last-child:not(:first-child) { flex-shrink: 0; }
.upp-row-nowrap > .upp-detail-item { flex: 1; min-width: 0; width: auto; }
.upp-detail-item:hover { border-color: var(--accent); background: var(--surface-hover); }
.upp-ps-inherit-sel { height: 26px; font-size: var(--upp-fs-xs); max-width: 165px; padding: 0 20px 0 6px; }

.upp-modal.is-compact-h .upp-header { padding: 5px 10px; }
.upp-modal.is-compact-h .upp-tabs { padding: 4px 10px; }
.upp-modal.is-compact-h .upp-tab { height: 26px; min-height: 26px; font-size: var(--upp-fs-sm); }
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
.upp-modal.is-compact-h .upp-toolbar .upp-pill { height: 26px; line-height: 24px; font-size: var(--upp-fs-sm); }
.upp-modal.is-compact-h .upp-toolbar .upp-btn,
.upp-modal.is-compact-h .upp-toolbar .upp-select,
.upp-modal.is-compact-h .upp-toolbar .upp-input-wrap,
.upp-modal.is-compact-h .upp-toolbar .upp-switch-label { height: 26px; font-size: var(--upp-fs-sm); }
.upp-modal.is-compact-h .upp-toolbar .upp-btn.icon-only { width: 26px; }
.upp-modal.is-compact-h .upp-footer { flex-direction: row; align-items: center; padding: 5px 10px; gap: 6px; }
.upp-modal.is-compact-h.is-resizable .upp-footer { padding-right: 30px; }
.upp-modal.is-compact-h .upp-foot-actions .upp-btn { height: 28px; font-size: var(--upp-fs-sm); }

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
  .upp-drawer.is-fixed-box, .upp-drawer.is-fixed-sm, .upp-drawer-mask.is-non-blocking .upp-drawer { width: 100%; height: min(560px, 100%); }
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
  .upp-title { font-size: var(--upp-fs-md); }
  .upp-ctx-chip { max-width: 52px; font-size: var(--upp-fs-xs); padding: 1px 6px; }
  .upp-head-actions { gap: 3px; }
  #upp-theme-select { max-width: 76px; height: 26px; padding: 0 16px 0 6px; font-size: var(--upp-fs-xs); }
  #upp-fab-vis-btn { height: 26px; padding: 0 6px; font-size: var(--upp-fs-xs); }
  .upp-header .upp-btn.icon-only { width: 25px; height: 25px; }
  .upp-tabs { padding: 7px 12px; gap: 4px; }
  .upp-tab { padding: 0 9px; font-size: var(--upp-fs-sm); }
  .upp-body { padding: 10px 12px 12px; }
}

@container plugin-win (max-width: 355px) {
  .upp-ctx-chip { display: none; }
  #upp-theme-select { max-width: 66px; font-size: var(--upp-fs-xs); }
  #upp-fab-vis-btn { padding: 0 5px; font-size: var(--upp-fs-xs); }
  .upp-header .upp-btn.icon-only { width: 24px; height: 24px; }
}

@media (max-width: 680px) {
  /* 手机端不再铺整屏实底遮罩：遮罩永远透明可穿透，面板本体是「默认接近全屏」的浮动窗，
     可拖动/可缩放，宿主内容随时可见可点 */
  .upp-backdrop {
    background: transparent;
    pointer-events: none;
    padding: 0;
    padding-left: env(safe-area-inset-left, 0px);
    padding-right: env(safe-area-inset-right, 0px);
    align-items: center;
    justify-content: center;
  }
  /* 没有显式几何（首帧/未拖动过）时也保持接近全屏的浮动窗形态，四周留 8px 方便抓取 */
  .upp-modal:not(.is-floating) {
    width: calc(100% - 16px);
    height: calc(100% - 16px);
    max-height: calc(100dvh - 16px);
    border-radius: 14px;
  }
  .upp-modal:not(.is-floating) .upp-header {
    padding-top: calc(10px + env(safe-area-inset-top, 0px));
  }
  .upp-modal:not(.is-floating) .upp-footer {
    padding-bottom: calc(9px + env(safe-area-inset-bottom, 0px));
  }
  .upp-modal:not(.is-floating) .upp-drawer-foot {
    padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
  }
  .upp-modal:not(.is-floating) .upp-drawer.is-full .upp-drawer-head {
    padding-top: calc(11px + env(safe-area-inset-top, 0px));
  }
}

/* Mobile & coarse-pointer input font-size >= 16px and min-height >= 34px */
@media (max-width: 680px), (pointer: coarse) {
  .upp-input-wrap,
  .upp-text-input,
  .upp-select,
  .upp-fab-search-wrap .upp-input-wrap {
    min-height: 34px !important;
    height: auto;
  }
  .upp-input-wrap input,
  .upp-text-input,
  .upp-select,
  .upp-textarea,
  .upp-inline-textarea,
  .upp-fab-search-wrap input {
    font-size: 16px !important;
  }
  .upp-input-wrap input,
  .upp-fab-search-wrap input {
    min-height: 34px !important;
  }
}

/* Floating Quick-Switch Ball & Popover (inherits theme palette from .upp-fab-root) */
.upp-wb-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 5px 6px 3px;
  font-size: var(--upp-fs-sm);
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
  pointer-events: auto;
  /* 高于透明遮罩（30000）：面板展开时悬浮球依然可见、可拖、可点 */
  z-index: 30001;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  background: var(--surface-strong);
  color: var(--accent);
  box-shadow: var(--modal-shadow);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  touch-action: none;
  user-select: none;
  font-family: inherit;
  font-size: var(--upp-fs-sm);
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
  box-shadow: 0 0 0 2px var(--surface-strong);
}
.upp-fab-pop {
  position: fixed;
  pointer-events: auto;
  z-index: 30002;
  width: min(304px, calc(100% - 24px));
  width: min(304px, calc(100dvw - 24px));
  height: 352px;
  max-height: calc(100vh - 24px);
  max-height: calc(100dvh - 24px);
  background-color: #f1f1ec;
  background-image: linear-gradient(var(--bg), var(--bg));
  border: 1.5px solid var(--border-strong);
  border-radius: 15px;
  box-shadow: var(--modal-shadow);
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
  background: var(--chrome);
  border-top: 2px solid var(--accent);
  border-bottom: 1px solid var(--border-strong);
  font-size: var(--upp-fs-md);
  font-weight: 600;
}
.upp-fab-search-wrap {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.upp-fab-search-wrap .upp-input-wrap {
  height: 30px;
  flex: 1 1 auto;
  min-width: 84px;
  font-size: var(--upp-fs-sm);
}
.upp-fab-search-wrap .upp-input-wrap input { font-size: var(--upp-fs-sm); }
/* 分组下拉：与搜索框同高同字号；长分组名走省略号，完整名称挂 title 提示 */
.upp-fab-search-wrap .upp-select {
  flex: 0 1 auto;
  height: 30px;
  min-width: 92px;
  max-width: 58%;
  font-size: var(--upp-fs-sm);
  text-overflow: ellipsis;
}
.upp-fab-pop-head label { display: flex; align-items: center; gap: 6px; font-size: var(--upp-fs-sm); }
.upp-fab-pop-head label input { margin: 0; }
.upp-fab-save-body { display: grid; align-content: start; gap: 8px; padding: 10px; }
.upp-fab-save-body .upp-text-input { min-height: 36px; font-size: 16px; }
.upp-fab-snap-meta { display: grid; gap: 2px; color: var(--muted); font-size: var(--upp-fs-xs); }
.upp-fab-snap-meta span { min-width: 0; overflow-wrap: anywhere; }
.upp-fab-snap-row { flex-shrink: 0; }
.upp-pill-strip.upp-snapshot-routes {
  flex-wrap: nowrap; overflow-x: auto; overscroll-behavior-x: contain; padding-block: 2px;
}
.upp-snapshot-routes .upp-pill { flex: 0 0 auto; white-space: nowrap; }
.upp-fab-pop-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
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
  font-size: var(--upp-fs-sm);
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
  font-size: var(--upp-fs-xs);
  color: var(--muted);
  line-height: 1.35;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
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
  font-size: var(--upp-fs-sm);
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
.upp-fab-pop-foot .upp-btn { flex: 1; height: 29px; font-size: var(--upp-fs-sm); padding: 0 8px; }
.upp-restore-pill {
  position: fixed;
  z-index: 29992;
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
  font-size: var(--upp-fs-sm);
  font-weight: 550;
  cursor: pointer;
  white-space: nowrap;
  max-width: calc(100dvw - 24px);
  pointer-events: auto;
  transition: border-color 0.14s, background 0.14s;
}
.upp-restore-pill:hover {
  border-color: var(--accent);
  background: var(--surface-strong);
}

/* M3 Sectioning, In-Panel Subviews, Inline Editors & Merge Destination Clarity */
.upp-section-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.upp-ma-block {
  background: var(--surface-strong);
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.upp-block-title {
  margin: 0;
  font-size: var(--upp-fs-md);
  font-weight: 650;
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.upp-subview {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.upp-subview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.upp-subview-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}
.upp-merge-dest-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 200px;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: var(--bg);
}
.upp-merge-dest-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: var(--upp-fs-sm);
  padding: 5px 7px;
  border-radius: 7px;
  background: var(--surface-strong);
  border: 1px solid var(--border);
}
.upp-merge-arrow {
  color: var(--accent);
  font-weight: 650;
}
.upp-sv-meta-panel {
  margin: 8px 14px 0;
  border-radius: 10px;
  border-top: 1px solid var(--border-strong);
  max-height: 55%;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.upp-notice-box {
  padding: 8px 10px;
  border-radius: 9px;
  border: 1px solid color-mix(in srgb, var(--warn) 32%, var(--border));
  background: var(--warn-soft);
  color: var(--text);
  font-size: var(--upp-fs-sm);
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
/* 自带提示条：宿主 toast 容器的层级低于本插件面板（面板 z-index 900000），
   打开面板时会被压在下面看不见，所以提示条画在影子树里并压在面板之上 */
.upp-toast-layer {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 74px);
  z-index: 500000;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  pointer-events: none;
}
.upp-toast {
  max-width: min(440px, 100%);
  padding: 7px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-strong);
  background: var(--surface-strong);
  color: var(--text);
  box-shadow: var(--card-shadow);
  font-size: var(--upp-fs-md);
  line-height: 1.45;
  word-break: break-word;
  opacity: 1;
  transition: opacity 200ms ease, transform 200ms ease;
}
.upp-toast.is-success { border-color: color-mix(in srgb, var(--accent) 46%, var(--border-strong)); background: var(--surface-strong); }
/* 提示条必须是不透底：--warn-soft / --danger-soft 是半透明叠色，直接当底色会透出列表文字 */
.upp-toast.is-warning { border-color: color-mix(in srgb, var(--warn) 52%, var(--border-strong)); border-left: 3px solid var(--warn); background: var(--surface-strong); }
.upp-toast.is-error { border-color: color-mix(in srgb, var(--danger) 52%, var(--border-strong)); border-left: 3px solid var(--danger); background: var(--surface-strong); }
.upp-toast.is-out { opacity: 0; transform: translateY(4px); }
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
  document.getElementById(NATIVE_PERSONA_BAR_ID)?.remove();
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
    // 查看与“设为当前使用”分离：这里只记录正在查看谁，绝不等于切换宿主
    viewPersonaId: '',
    personaSwitchConfirm: false,
    userSearch: '',
    userView: 'main', // main | merge | diff
    userInlineEditor: null, // null | rename | body
    expandedPvIds: new Set(),
    lastPersonaMergeUndo: null,
    userMerge: {
      keepId: '',
      absorbIds: [],
      deleteOld: false,
      orphanAvatars: [],
      query: '',
      previewIds: new Set(),
      showKeepPreview: false,
    },
    userDiff: {
      leftId: '',
      rightId: '',
    },

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
    // 空字符串=跟随宿主当前预设；有值=正在只读查看另一套预设，不改变酒馆
    viewPresetName: '',
    presetUseConfirm: false,
    presetDiskSaveConfirm: false,
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
    expandedRegexIds: new Set(),

    lastPresetSyncUndo: null,
    drawer: null,
    minimized: false,
  };

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${STYLE_CSS}</style>
<div class="upp-fab-root" id="upp-fab-root">
  <button type="button" class="upp-fab" id="upp-fab-btn" title="快照" aria-label="快照" aria-expanded="false" aria-controls="upp-fab-pop">
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
      <span class="upp-drag-grip" id="upp-drag-grip" aria-hidden="true" title="按住拖动窗口"></span>
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
        <button type="button" class="upp-btn" id="upp-fab-vis-btn" title="显示或隐藏悬浮球">悬浮球</button>
        <button type="button" class="upp-btn icon-only" id="upp-min-btn" title="收起为角落恢复条">${ICONS.minimize}</button>
        <button type="button" class="upp-btn icon-only" id="upp-close-btn" title="关闭">${ICONS.close}</button>
      </div>
    </div>
    <div class="upp-tabs" id="upp-tabs"></div>
    <div class="upp-toolbar" id="upp-toolbar"></div>
    <div class="upp-body" id="upp-body"></div>
    <div class="upp-footer" id="upp-footer"></div>
    <div class="upp-drawer-mask" id="upp-drawer-mask" hidden></div>
    <div class="upp-rz upp-rz-n" data-resize="n"></div>
    <div class="upp-rz upp-rz-s" data-resize="s"></div>
    <div class="upp-rz upp-rz-w" data-resize="w"></div>
    <div class="upp-rz upp-rz-e" data-resize="e"></div>
    <div class="upp-rz upp-rz-nw" data-resize="nw"></div>
    <div class="upp-rz upp-rz-ne" data-resize="ne"></div>
    <div class="upp-rz upp-rz-sw" data-resize="sw"></div>
    <div class="upp-rz upp-rz-se" data-resize="se"></div>
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
  const elMinBtn = shadow.getElementById('upp-min-btn');
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
    if (state.viewPersonaId && (!state.personas.some(p => p.avatar_id === state.viewPersonaId)
      || state.viewPersonaId === state.currentPersona?.avatar_id)) {
      // 查看对象消失或已经等于宿主当前 User：退出查看态
      state.viewPersonaId = '';
      state.personaSwitchConfirm = false;
    }
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
    syncPresetViewData();
    state.apiProfiles = Host.listConnectionProfiles();
    scheduleBackfillOnce();
    if (state.tab === 'regex') {
      state.regexList = await Host.getRegexes(state.regexScope);
    }

    render();
    syncNativePersonaBar();
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
      <button type="button" class="upp-tab ${state.tab === t.id ? 'active' : ''}" data-tab="${t.id}">
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
        ${boundSnap ? `<button type="button" class="upp-btn secondary" id="upp-foot-update-btn" data-snap-update="${boundSnap.id}">更新当前快照</button>` : ''}
        <button type="button" class="upp-btn primary" id="upp-foot-save-snap-btn">${ICONS.camera}<span>保存快照</span></button>
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
          <input type="text" id="upp-snap-search" spellcheck="false" placeholder="搜索快照名称或分组…" value="${escapeHtml(state.snapSearch)}" />
        </div>
        <div class="upp-tb-actions">
          <label class="upp-switch-label" title="切换聊天或角色时自动切回绑定快照">
            <span>自动切换</span>
            <button type="button" class="upp-switch" id="upp-auto-bind-sw" role="switch" aria-checked="${autoOn}"></button>
          </label>
          <button type="button" class="upp-btn ${state.snapBatchMode ? 'active' : ''}" id="upp-snap-batch-btn">${state.snapBatchMode ? '退出批量' : '批量管理'}</button>
          <button type="button" class="upp-btn secondary" id="upp-snap-preset-sync-btn" title="同步新增预设条目开关或将旧预设版本快照一键升级迁移到新版本">预设同步</button>
          <button type="button" class="upp-btn" id="upp-backup-btn">${ICONS.backup}<span>备份</span></button>
        </div>
      </div>
      <div class="upp-pill-strip upp-tb-row3">
        <button type="button" class="upp-pill ${state.snapGroup === '' ? 'active' : ''}" data-snap-group="">全部 (${snaps.length})</button>
        ${groups.map(g => `<button type="button" class="upp-pill ${state.snapGroup === g ? 'active' : ''}" data-snap-group="${escapeHtml(g)}">${escapeHtml(g)}</button>`).join('')}
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
            <button type="button" class="upp-btn primary" data-snap-apply="${boundSnap.id}">立即应用</button>
            <button type="button" class="upp-btn" data-unbind-src="${bound.source}">解绑</button>
          </div>
        </div>
      `;
    }

    if (!filtered.length) {
      html += `
        <div class="upp-empty">
          <span>${snaps.length ? '没有匹配的快照' : '在上方各页调好 User、世界书、预设与正则后，点右下角「保存快照」即可记录'}</span>
          ${!snaps.length ? `<button type="button" class="upp-btn primary" data-open-save-snap>${ICONS.camera}<span>保存当前状态为第一份快照</span></button>` : ''}
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
              <button type="button" class="upp-btn primary" data-snap-apply="${s.id}">应用</button>
              <button type="button" class="upp-btn secondary" data-snap-view="${s.id}">${ICONS.eye}<span>查看</span></button>
              <button type="button" class="upp-btn" data-snap-edit="${s.id}">${ICONS.edit}<span>编辑</span></button>
              <button type="button" class="upp-btn" data-snap-update="${s.id}">覆盖更新</button>
              <button type="button" class="upp-btn" data-snap-bind="${s.id}">${ICONS.link}<span>绑定</span></button>
              <div class="upp-spacer"></div>
              <button type="button" class="upp-btn icon-only danger" data-snap-del="${s.id}" title="删除快照">${ICONS.trash}<span class="upp-mobile-only">删除</span></button>
            </div>
          `}
        </div>
      `;
    }).join('');

    elBody.innerHTML = html;
  }

  // 正在查看哪个 User：查看与“酒馆当前使用”分离，下拉只切换查看对象
  function viewingPersona() {
    const cur = state.currentPersona;
    if (!state.viewPersonaId) return cur;
    if (cur && state.viewPersonaId === cur.avatar_id) return cur;
    return state.personas.find(p => p.avatar_id === state.viewPersonaId) || cur;
  }

  function isViewingForeignPersona() {
    return !!(state.currentPersona && state.viewPersonaId
      && state.viewPersonaId !== state.currentPersona.avatar_id
      && state.personas.some(p => p.avatar_id === state.viewPersonaId));
  }

  function renderUserToolbar() {
    const curP = state.currentPersona;
    const viewP = viewingPersona();
    const foreign = isViewingForeignPersona();
    const pVersions = curP ? (state.store.personaVersions[curP.avatar_id] || []) : [];
    const dupGroups = detectProliferatedPersonas(state.personas);
    const personaOptions = state.personas.map(p =>
      `<option value="${escapeHtml(p.avatar_id)}" ${viewP && p.avatar_id === viewP.avatar_id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('');

    elToolbar.innerHTML = `
      <div class="upp-row upp-tb-user-top">
        <div class="upp-tb-u-primary">
          <select class="upp-select" id="upp-persona-select" title="选择要查看的 User（查看不会切换酒馆当前 User）">${personaOptions || '<option value="">无可用 User</option>'}</select>
          ${foreign ? '<span class="upp-badge accent" title="酒馆当前 User 未改变">查看中 · 未切换</span>' : ''}
          <button type="button" class="upp-btn ${state.userView === 'main' && state.userInlineEditor === 'rename' ? 'active' : ''}" id="upp-persona-rename-btn" ${curP && !foreign ? '' : 'disabled'} title="原地修改当前 User 名字，不新增分身">改名</button>
          <button type="button" class="upp-btn secondary ${state.userView === 'main' && state.userInlineEditor === 'body' ? 'active' : ''}" id="upp-persona-edit-btn" ${curP && !foreign ? '' : 'disabled'}>${ICONS.edit}<span>编辑正文</span></button>
        </div>
        <div class="upp-tb-u-secondary">
          <button type="button" class="upp-btn secondary ${state.userView === 'main' && state.userInlineEditor === 'savever' ? 'active' : ''}" id="upp-persona-savever-btn" ${curP && !foreign ? '' : 'disabled'}>${ICONS.plus}<span>存为版本</span></button>
          <button type="button" class="upp-btn ${state.userView === 'diff' ? 'active' : ''}" id="upp-persona-diff-btn" ${curP && !foreign && pVersions.length ? '' : 'disabled'}>${ICONS.diff}<span>对比</span></button>
          <button type="button" class="upp-btn ${state.userView === 'merge' || dupGroups.length ? 'active' : ''}" id="upp-persona-merge-btn" ${foreign ? 'disabled' : ''} title="将同名或换姓分身收回为内部版本">${ICONS.merge}<span>整理分身${dupGroups.length ? ' ' + dupGroups.length : ''}</span></button>
        </div>
      </div>
      <div class="upp-row upp-tb-u-search-row">
        <div class="upp-input-wrap">
          ${ICONS.search}
          <input type="text" id="upp-user-search" spellcheck="false" placeholder="搜索 User 名称、内部版本名或正文关键词…" value="${escapeHtml(state.userSearch)}" ${state.userView === 'main' && !foreign ? '' : 'disabled'} />
        </div>
        <button type="button" class="upp-btn" id="upp-user-search-clear-btn" ${(state.userView === 'main' && state.userSearch) ? '' : 'hidden'} ${state.userView === 'main' && !foreign ? '' : 'disabled'}>清空</button>
      </div>
    `;
  }

  // 查看非当前 User：只读预览 + 一次确认后的显式切换
  function renderPersonaPreviewBody() {
    const curP = state.currentPersona;
    const viewP = viewingPersona();
    if (!viewP) { elBody.innerHTML = `<div class="upp-empty">未读取到当前 User 人设</div>`; return; }
    const desc = String(viewP.description || '');
    const versions = state.store.personaVersions[viewP.avatar_id] || [];
    let html = '';
    if (state.personaSwitchConfirm) {
      html += `
        <div class="upp-bind-strip is-confirm" style="background:var(--warn-soft);border-color:color-mix(in srgb, var(--warn) 35%, transparent);" data-persona-confirm-strip>
          <span>确认把酒馆当前 User 从「${escapeHtml(curP?.name || '无')}」切换为「${escapeHtml(viewP.name)}」？原生界面会短暂刷新。</span>
          <div class="upp-row-nowrap">
            <button type="button" class="upp-btn primary" id="upp-persona-use-confirm">确认切换</button>
            <button type="button" class="upp-btn" id="upp-persona-use-cancel">取消</button>
          </div>
        </div>
      `;
    } else {
      html += `
        <div class="upp-bind-strip" style="background:var(--inset);" data-persona-view-strip>
          <span>正在查看「${escapeHtml(viewP.name)}」· 酒馆当前使用「${escapeHtml(curP?.name || '无')}」，<strong>尚未切换</strong></span>
          <div class="upp-row-nowrap">
            <button type="button" class="upp-btn primary" id="upp-persona-use-btn">设为当前使用</button>
            <button type="button" class="upp-btn" id="upp-persona-view-back-btn">看回当前</button>
          </div>
        </div>
      `;
    }
    html += `
      <section class="upp-card upp-section-block" data-user-section="preview">
        <div class="upp-card-head">
          <div class="upp-row-nowrap">
            <span class="upp-card-title">${escapeHtml(viewP.name)}</span>
            <span class="upp-badge">查看中 · 未切换</span>
          </div>
          <span class="upp-card-meta">${desc.length} 字</span>
        </div>
        ${viewP.lorebook ? `<div class="upp-card-meta"><span class="upp-badge">绑定世界书: ${escapeHtml(viewP.lorebook)}</span></div>` : ''}
        <div class="upp-persona-live-box" style="max-height:min(46dvh,360px);overflow:auto;overscroll-behavior:contain;white-space:pre-wrap;">${escapeHtml(desc || '这个 User 还没有正文')}</div>
        <div class="upp-card-meta">内部版本 ${versions.length} 个 · 查看不会改动酒馆当前 User，也不会改动这份人设</div>
      </section>
    `;
    elBody.innerHTML = html;
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

  function renderUserVersionItemHtml(v, curP, matchedVer, snippetText) {
    const nameMatches = !v.displayName || v.displayName === curP.name;
    const isCur = matchedVer && matchedVer.id === v.id && nameMatches;
    const dnTag = v.displayName ? `<span class="upp-badge">名字: ${escapeHtml(v.displayName)}</span>` : '';
    const vid = escapeHtml(v.id);
    const isExpanded = state.expandedPvIds.has(v.id);
    const snippet = snippetText !== undefined ? snippetText : String(v.description || '').replace(/\s+/g, ' ').trim().slice(0, 72);
    return `
      <div class="upp-entry-wrap ${isExpanded ? 'is-expanded' : ''}" data-pv-wrap="${vid}">
        <div class="upp-entry-row ${isCur ? 'is-on' : ''}">
          <button type="button" class="upp-entry-main" data-pv-view="${vid}">
            <span class="upp-entry-chev">${ICONS.chevron}</span>
            <div class="upp-entry-text">
              <div class="upp-entry-title-row">
                <span class="upp-entry-name">${escapeHtml(v.name)}</span>
                ${dnTag}
                ${isCur ? '<span class="upp-badge accent upp-keep">使用中</span>' : ''}
              </div>
              <div class="upp-entry-preview">${escapeHtml(snippet || '空描述')}</div>
            </div>
          </button>
          <button type="button" class="upp-btn" data-pv-release="${vid}" title="将此内部版本释放为酒馆原生独立 User">放回原生</button>
          <button type="button" class="upp-btn ${isCur ? '' : 'primary'}" data-pv-apply="${vid}" ${isCur ? 'disabled' : ''}>${isCur ? '当前' : '切换'}</button>
          <button type="button" class="upp-btn icon-only danger" data-pv-del-inline="${vid}" title="删除版本">${ICONS.trash}</button>
        </div>
        ${isExpanded ? `
          <div class="upp-inline-panel" data-pv-panel="${vid}">
            <div class="upp-inline-meta">
              <span>内部版本编辑 · ${String(v.description || '').length} 字</span>
              ${v.lorebook ? `<span>绑定世界书：${escapeHtml(v.lorebook)}</span>` : ''}
            </div>
            <div class="upp-row">
              <input type="text" class="upp-text-input" spellcheck="false" style="flex:1;min-width:120px;" data-pv-inline-name="${vid}" value="${escapeHtml(v.name || '')}" placeholder="版本名称" />
              <input type="text" class="upp-text-input" spellcheck="false" style="flex:1;min-width:120px;" data-pv-inline-dn="${vid}" value="${escapeHtml(v.displayName || '')}" placeholder="切换时 User 名字（留空沿用当前）" />
            </div>
            <textarea class="upp-inline-textarea" spellcheck="false" data-pv-inline-desc="${vid}">${escapeHtml(v.description || '')}</textarea>
            <div class="upp-inline-foot">
              <button type="button" class="upp-btn" data-pv-inline-close="${vid}">收起</button>
              <button type="button" class="upp-btn primary" data-pv-save="${vid}">保存</button>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderUserDiffView() {
    const p = state.currentPersona;
    const list = p ? (state.store.personaVersions[p.avatar_id] || []) : [];
    const choices = [{ id: '__live__', name: '当前实时正文', description: p ? p.description : '' }, ...list];
    const leftId = state.userDiff.leftId || (list[0]?.id || '__live__');
    const rightId = state.userDiff.rightId || '__live__';
    const leftItem = choices.find(c => c.id === leftId) || choices[0];
    const rightItem = choices.find(c => c.id === rightId) || choices[0];
    const diffLines = computeLineDiff(leftItem?.description || '', rightItem?.description || '');

    elBody.innerHTML = `
      <div class="upp-subview" data-user-subview="diff">
        <div class="upp-subview-head">
          <div class="upp-row-nowrap">
            <button type="button" class="upp-btn" id="upp-diff-back-btn">${ICONS.back}<span>返回 User 列表</span></button>
            <span class="upp-card-title">版本差异对比 · ${escapeHtml(p?.name || '')}</span>
          </div>
        </div>
        <section class="upp-card upp-section-block" data-user-section="diff">
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
        </section>
      </div>
    `;
  }

  function renderUserMergePlanSection(m, plan) {
    const planEl = shadow.getElementById('upp-merge-plan-box');
    const runBtn = shadow.getElementById('upp-merge-run-btn');
    const keepName = plan?.keepPersona?.name || '主 User';
    const cands = plan?.candidates || [];
    if (runBtn) {
      runBtn.disabled = !cands.length;
      runBtn.textContent = cands.length ? `确认整理并收纳 ${cands.length} 个分身` : '请先勾选待收纳分身';
    }
    if (!planEl) return;
    if (!cands.length) {
      planEl.innerHTML = `<div class="upp-card-meta">尚未勾选待收纳分身。勾选上方分身后，这里会明确展示整理前与整理后的去向。</div>`;
      return;
    }
    const keepDescTrim = String(plan.keepPersona?.description || '').trim();
    planEl.innerHTML = `
      <div class="upp-card-meta">
        <span>保留主 User 为 <strong>${escapeHtml(keepName)}</strong>${keepDescTrim ? '（原有正文将同步备份为「原主描述」）' : ''}。</span>
      </div>
      <div class="upp-merge-dest-list">
        ${cands.map(c => `
          <div class="upp-merge-dest-row">
            <span class="upp-badge">整理前</span>
            <span>原生 User「${escapeHtml(c.name)}」</span>
            <span class="upp-merge-arrow">→</span>
            <span class="upp-badge accent">整理后</span>
            <span>将变为「${escapeHtml(keepName)}」的内部版本「<strong>${escapeHtml(c.versionName)}</strong>」${m.deleteOld ? '，并移出原生列表' : '（保留原原生 User）'}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderUserMergeView() {
    const m = state.userMerge;
    const dupGroups = detectProliferatedPersonas(state.personas);
    const keepId = m.keepId || (state.currentPersona?.avatar_id || state.personas[0]?.avatar_id || '');
    m.keepId = keepId;
    const keepObj = state.personas.find(p => p.avatar_id === keepId);
    const existingVersions = keepObj ? (state.store.personaVersions[keepObj.avatar_id] || []) : [];
    const plan = buildPersonaMergePlan(state.personas, keepId, m.absorbIds, existingVersions);
    const orphans = Array.isArray(m.orphanAvatars) ? m.orphanAvatars : [];

    elBody.innerHTML = `
      <div class="upp-subview" data-user-subview="merge">
        <div class="upp-subview-head">
          <div class="upp-row-nowrap">
            <button type="button" class="upp-btn" id="upp-merge-back-btn">${ICONS.back}<span>返回 User 列表</span></button>
            <span class="upp-card-title">整理同名与换姓分身</span>
          </div>
          ${state.lastPersonaMergeUndo ? `<button type="button" class="upp-btn secondary" id="upp-merge-undo-btn">撤销最近一次整理</button>` : ''}
        </div>
        ${orphans.length ? `
          <div class="upp-bind-strip">
            <span>检测到 ${orphans.length} 个未命名残留头像文件</span>
            <button type="button" class="upp-btn danger" id="upp-clean-orphans-btn">一键清理</button>
          </div>
        ` : ''}
        <section class="upp-card upp-section-block" data-merge-section="keep">
          <h4 class="upp-block-title">
            <span>1. 选择保留的主 User 槽位</span>
            ${keepObj ? `<button type="button" class="upp-pill" style="height:22px;font-size:var(--upp-fs-xs);padding:0 8px;" id="upp-merge-keep-preview-btn">${m.showKeepPreview ? '收起主正文' : '查看主正文'}</button>` : ''}
          </h4>
          ${dupGroups.length ? `
            <div class="upp-pill-strip">
              ${dupGroups.map((g, idx) => `<button type="button" class="upp-pill" data-merge-preset-group="${idx}">${escapeHtml(g.baseName)}（${g.items.length}）</button>`).join('')}
            </div>
          ` : ''}
          <select class="upp-select" id="upp-merge-keep" style="width:100%;">
            ${state.personas.map(p => `<option value="${escapeHtml(p.avatar_id)}" ${p.avatar_id === keepId ? 'selected' : ''}>保留：${escapeHtml(p.name)}（${String(p.description || '').length} 字）</option>`).join('')}
          </select>
          ${keepObj && m.showKeepPreview ? `<pre class="upp-inline-pre" style="max-height:150px;">${escapeHtml(keepObj.description || '（主 User 暂无描述）')}</pre>` : ''}
          <div class="upp-card-meta">该槽位将作为保留后的唯一原生主 User，所有勾选项都会收纳进它的内部版本。</div>
        </section>

        <section class="upp-card upp-section-block" data-merge-section="candidates">
          <h4 class="upp-block-title"><span>2. 选择要收纳为内部版本的分身</span></h4>
          <div class="upp-input-wrap" style="width:100%;flex:0 0 auto;">
            ${ICONS.search}
            <input type="text" id="upp-merge-search" spellcheck="false" placeholder="筛选分身名称或正文关键词…" value="${escapeHtml(m.query || '')}" />
          </div>
          <div class="upp-pop-list" id="upp-merge-candidate-list" style="max-height:240px;"></div>
        </section>

        <section class="upp-card upp-section-block" data-merge-section="plan">
          <h4 class="upp-block-title"><span>3. 整理前 → 整理后去向与可逆保障</span></h4>
          <div id="upp-merge-plan-box"></div>
          <label class="upp-check-item">
            <input type="checkbox" id="upp-merge-delete-old" ${m.deleteOld ? 'checked' : ''} />
            <span>收纳后从酒馆原生列表移除已选分身（已备份头像与正文，可「撤销最近一次整理」或随时「放回原生」）</span>
          </label>
          <div class="upp-subview-foot">
            <button type="button" class="upp-btn" id="upp-merge-cancel-btn">返回列表</button>
            <button type="button" class="upp-btn primary" id="upp-merge-run-btn" ${plan.candidates.length ? '' : 'disabled'}>确认整理并收纳 ${plan.candidates.length} 个分身</button>
          </div>
        </section>
      </div>
    `;
    renderMergeCandidateList(m, plan);
    renderUserMergePlanSection(m, plan);
  }

  function renderUserBody() {
    if (isViewingForeignPersona()) {
      renderPersonaPreviewBody();
      return;
    }
    if (state.userView === 'merge') {
      renderUserMergeView();
      return;
    }
    if (state.userView === 'diff') {
      renderUserDiffView();
      return;
    }

    const curP = state.currentPersona;
    if (!curP) { elBody.innerHTML = `<div class="upp-empty">未读取到当前 User 人设</div>`; return; }

    const pVersions = state.store.personaVersions[curP.avatar_id] || [];
    const matchedVer = findMatchingPersonaVersion(state.store, curP.avatar_id, curP.description, curP.name);
    const liveDesc = String(curP.description || '');
    const q = normalizeText(state.userSearch);

    let html = '';
    if (state.lastPersonaMergeUndo) {
      html += `
        <div class="upp-bind-strip">
          <span>最近整理：${escapeHtml(state.lastPersonaMergeUndo.label || '已收纳分身')}</span>
          <button type="button" class="upp-btn secondary" id="upp-merge-undo-btn">撤销最近一次整理</button>
        </div>
      `;
    }

    if (q) {
      const matchedPersonas = state.personas.filter(p =>
        normalizeText(`${p.name} ${p.description} ${p.lorebook}`).includes(q)
      );
      const matchedVersions = pVersions.filter(v =>
        normalizeText(`${v.name} ${v.displayName || ''} ${v.description} ${v.lorebook || ''}`).includes(q)
      );

      if (!matchedPersonas.length && !matchedVersions.length) {
        elBody.innerHTML = html + `<div class="upp-empty">未找到包含「${escapeHtml(state.userSearch)}」的 User 或内部版本</div>`;
        return;
      }

      if (matchedPersonas.length) {
        html += `
          <section class="upp-section-block" data-user-section="search-personas">
            <div class="upp-sec-title" style="padding: 2px 2px;">
              <span>匹配的 User 人设</span>
              <span>${matchedPersonas.length} 个</span>
            </div>
            <div class="upp-entry-list">
              ${matchedPersonas.map(p => {
                const isCurP = p.avatar_id === curP.avatar_id;
                return `
                  <div class="upp-entry-row ${isCurP ? 'is-on' : ''}">
                    <button type="button" class="upp-entry-main" data-user-switch-id="${escapeHtml(p.avatar_id)}">
                      <div class="upp-entry-text">
                        <div class="upp-entry-title-row">
                          <span class="upp-entry-name">${escapeHtml(p.name)}</span>
                          ${isCurP ? '<span class="upp-badge accent upp-keep">当前 User</span>' : ''}
                        </div>
                        <div class="upp-entry-preview">${escapeHtml(makeMatchedSnippet(p.description, state.userSearch))}</div>
                      </div>
                    </button>
                    <button type="button" class="upp-btn ${isCurP ? '' : 'primary'}" data-user-switch-id="${escapeHtml(p.avatar_id)}" ${isCurP ? 'disabled' : ''}>${isCurP ? '当前' : '切换'}</button>
                  </div>
                `;
              }).join('')}
            </div>
          </section>
        `;
      }

      if (matchedVersions.length) {
        html += `
          <section class="upp-section-block" data-user-section="search-versions">
            <div class="upp-sec-title" style="padding: 4px 2px 2px;">
              <span>当前 User 匹配的内部版本</span>
              <span>${matchedVersions.length} 个</span>
            </div>
            <div class="upp-entry-list">
              ${matchedVersions.map(v => renderUserVersionItemHtml(v, curP, matchedVer, makeMatchedSnippet(v.description, state.userSearch))).join('')}
            </div>
          </section>
        `;
      }

      elBody.innerHTML = html;
      return;
    }

    html += `
      <section class="upp-card upp-section-block" data-user-section="current">
        <div class="upp-card-head">
          <div class="upp-row-nowrap">
            <span class="upp-card-title">${escapeHtml(curP.name)}</span>
            ${matchedVer ? `<span class="upp-badge accent">${escapeHtml(matchedVer.name)}</span>` : '<span class="upp-badge">当前实时</span>'}
          </div>
          <span class="upp-card-meta">${liveDesc.length} 字</span>
        </div>
        ${curP.lorebook ? `<div class="upp-card-meta"><span class="upp-badge">绑定世界书: ${escapeHtml(curP.lorebook)}</span></div>` : ''}
        ${state.userInlineEditor === 'rename' ? `
          <div class="upp-inline-panel" data-user-inline="rename">
            <div class="upp-inline-meta">
              <span>原地改名 · 直接更新当前 User 槽位，不新增分身</span>
            </div>
            <div class="upp-row-nowrap">
              <input type="text" class="upp-text-input" id="upp-rename-input" spellcheck="false" value="${escapeHtml(curP.name || '')}" placeholder="输入新的 User 名字" />
              <button type="button" class="upp-btn" id="upp-rename-clear-btn">清空</button>
            </div>
            <div class="upp-inline-foot">
              <button type="button" class="upp-btn" id="upp-rename-cancel-btn">取消</button>
              <button type="button" class="upp-btn primary" id="upp-rename-confirm-btn" data-user-rename-save>确认改名</button>
            </div>
          </div>
        ` : ''}
        ${state.userInlineEditor === 'savever' ? `
          <div class="upp-inline-panel" data-user-inline="savever">
            <div class="upp-inline-meta">
              <span>存为内部描述版本 · ${escapeHtml(curP.name)}</span>
              <span>${liveDesc.length} 字</span>
            </div>
            <div class="upp-field">
              <label>版本名称</label>
              <input type="text" class="upp-text-input" id="upp-pv-name" spellcheck="false" placeholder="例如：默认 / 现代日常 / 古风线" value="" />
            </div>
            <div class="upp-field">
              <label>切换时使用的 User 名字 · 剧情换姓直接填全名</label>
              <div class="upp-row-nowrap">
                <input type="text" class="upp-text-input" id="upp-pv-display-name" spellcheck="false" placeholder="留空则切换时不改当前名字" value="${escapeHtml(curP.name || '')}" />
                <button type="button" class="upp-btn" id="upp-pv-dn-clear-btn">清空</button>
              </div>
            </div>
            ${pVersions.length ? `
              <div class="upp-field">
                <label>快速覆盖已有版本（可选）</label>
                <select class="upp-select" id="upp-pv-overwrite-sel" style="width:100%;">
                  <option value="">新建版本或手动输入上方名称</option>
                  ${pVersions.map(v => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.name)}${v.displayName ? `（${escapeHtml(v.displayName)}）` : ''}</option>`).join('')}
                </select>
              </div>
            ` : ''}
            <div class="upp-inline-foot">
              <button type="button" class="upp-btn" id="upp-pv-cancel-btn">取消</button>
              <button type="button" class="upp-btn primary" id="upp-pv-save-btn">保存版本</button>
            </div>
          </div>
        ` : ''}
        ${state.userInlineEditor === 'body' ? `
          <div class="upp-inline-panel" data-user-inline="body">
            <div class="upp-inline-meta">
              <span>原地编辑正文 · ${escapeHtml(curP.name)}</span>
              <span>${liveDesc.length} 字</span>
            </div>
            <textarea class="upp-inline-textarea" id="upp-user-body-ta" spellcheck="false" placeholder="编辑当前 User 描述正文…">${escapeHtml(liveDesc)}</textarea>
            <div class="upp-inline-foot">
              <button type="button" class="upp-btn" id="upp-user-body-cancel-btn">取消</button>
              <button type="button" class="upp-btn primary" id="upp-ee-save-btn" data-user-body-save>保存正文</button>
            </div>
          </div>
        ` : `
          <div class="upp-persona-live-box ${liveDesc.trim() ? '' : 'is-empty'}" id="upp-persona-preview-box">${escapeHtml(liveDesc.trim() ? liveDesc : '暂无描述，点击编辑')}</div>
        `}
      </section>
      <section class="upp-card upp-section-block" data-user-section="versions">
        <div class="upp-sec-title" style="padding: 2px 2px; margin-top: 0;">
          <span>内部描述版本 · 可绑定不同名字、原地编辑或放回原生列表</span>
          <span>${pVersions.length} 个</span>
        </div>
        ${!pVersions.length
          ? `<div class="upp-empty" style="padding: 20px 14px;">还没有保存过「${escapeHtml(curP.name)}」的内部版本，点上方「存为版本」或「整理分身」即可收纳。</div>`
          : `<div class="upp-entry-list">${pVersions.map(v => renderUserVersionItemHtml(v, curP, matchedVer)).join('')}</div>`}
      </section>
    `;

    elBody.innerHTML = html;
  }

  function renderWorldbookToolbar() {
    const activeBook = state.activeBook;
    const isPinned = activeBook && state.store.settings.pinnedWorldbooks.includes(activeBook);
    const isGlobal = activeBook && state.globalWorldbooks.includes(activeBook);
    const org = getOrganizerSettings();
    const hasOrg = hasActiveOrganizer();
    const bookFmt = activeBook ? formatWorldbookDisplay(activeBook, org, buildCombinedCharNameMap(org)) : null;
    const bookLabel = bookFmt ? bookFmt.primary : '选择世界书';
    const bookTitle = bookFmt ? (bookFmt.subtitle ? `${bookFmt.primary} (${bookFmt.subtitle})` : bookFmt.primary) : '选择或搜索世界书';

    elToolbar.innerHTML = `
      <div class="upp-row upp-tb-wb-row1">
        <div class="upp-tb-wb-p1">
          <button type="button" class="upp-btn upp-book-trigger" id="upp-book-picker-btn" title="${escapeHtml(bookTitle)}">
            <span>${escapeHtml(bookLabel)}</span>
            ${ICONS.chevron}
          </button>
          <button type="button" class="upp-btn ${isGlobal ? 'active' : ''}" id="upp-global-book-btn" title="开启后对所有角色和聊天生效" ${activeBook ? '' : 'disabled'}>${isGlobal ? '已全局启用' : '全局启用'}</button>
          ${hasOrg ? `<button type="button" class="upp-btn" id="upp-open-wbo-btn" title="直达世界书整理面板">整理分组</button>` : ''}
          <button type="button" class="upp-btn icon-only ${isPinned ? 'pinned' : ''}" id="upp-pin-book-btn" title="${isPinned ? '取消置顶' : '置顶常用世界书'}" ${activeBook ? '' : 'disabled'}>${isPinned ? ICONS.starFill : ICONS.star}</button>
        </div>
        <div class="upp-spacer"></div>
        <div class="upp-tb-wb-p2">
          <button type="button" class="upp-btn secondary" id="upp-new-wb-entry-btn" ${activeBook ? '' : 'disabled'}>${ICONS.plus}<span>新建条目</span></button>
          <button type="button" class="upp-btn icon-only" id="upp-copy-wb-btn" title="复制已开条目纯文本" ${activeBook ? '' : 'disabled'}>${ICONS.copy}</button>
        </div>
      </div>
      <div class="upp-row upp-tb-wb-row2">
        <div class="upp-input-wrap upp-tb-wb-search">
          ${ICONS.search}
          <input type="text" id="upp-wb-search" spellcheck="false" placeholder="搜索条目标题或正文…" value="${escapeHtml(state.wbEntrySearch)}" />
        </div>
        <div class="upp-tb-wb-filters">
          <button type="button" class="upp-btn ${state.wbOnlyOn ? 'active' : ''}" id="upp-wb-only-on-btn">只看已开</button>
          <button type="button" class="upp-btn danger" id="upp-wb-all-off-btn" ${activeBook ? '' : 'disabled'}>全关</button>
        </div>
      </div>
    `;
  }

  // 内联面板模板独立成函数：列表重建和“就地展开某一行”共用同一份结构
  function buildWorldbookInlinePanelHtml(e, warnList, uidKey) {
    return `
            <div class="upp-inline-panel" data-wb-panel="${escapeHtml(uidKey)}">
              <div class="upp-inline-meta">
                <span>顺序 ${e.order} · 约 ${Math.ceil(e.content.replace(/[\x00-\x7f]+/g, text => 'x'.repeat(Math.ceil(text.length / 4))).length)} tokens</span>
                ${warnList.length ? `<span class="upp-badge warn">${ICONS.warn} ${escapeHtml(warnList.join('；'))}</span>` : ''}
              </div>
              <div class="upp-row">
                <input type="text" class="upp-text-input" spellcheck="false" style="flex:1;min-width:140px;" data-wb-inline-name="${escapeHtml(uidKey)}" value="${escapeHtml(e.name || '')}" placeholder="条目名称" />
                <select class="upp-select" data-wb-inline-strategy="${escapeHtml(uidKey)}" style="max-width:140px;">
                  <option value="constant" ${e.strategyType === 'constant' ? 'selected' : ''}>蓝灯常驻</option>
                  <option value="selective" ${e.strategyType === 'selective' ? 'selected' : ''}>绿灯触发</option>
                  <option value="vectorized" ${e.strategyType === 'vectorized' ? 'selected' : ''}>向量</option>
                </select>
              </div>
              <textarea class="upp-inline-textarea" spellcheck="false" data-wb-inline-content="${escapeHtml(uidKey)}">${escapeHtml(e.content || '')}</textarea>
              <details>
                <summary>触发词、位置与深度</summary>
                <div class="upp-field">
                  <label>触发词<input type="text" class="upp-text-input" spellcheck="false" data-wb-inline-key="${escapeHtml(uidKey)}" value="${escapeHtml(e.keys.join(', '))}" /></label>
                  <label>位置<select class="upp-select" data-wb-inline-position="${escapeHtml(uidKey)}">
                    ${['角色前', '角色后', '作者注释前', '作者注释后', '聊天深度', '示例对话前', '示例对话后', 'Outlet'].map((name, pos) => `<option value="${pos}" ${e.position === pos ? 'selected' : ''}>${name}</option>`).join('')}
                    ${e.position > 7 ? `<option value="${e.position}" selected>位置 ${e.position}</option>` : ''}
                  </select></label>
                  <label>深度<input type="number" min="0" step="1" class="upp-text-input" data-wb-inline-depth="${escapeHtml(uidKey)}" value="${e.depth}" /></label>
                </div>
              </details>
              <div class="upp-inline-foot">
                <button type="button" class="upp-btn" data-wb-inline-tall aria-pressed="false">加高</button>
                <button type="button" class="upp-btn" data-wb-inline-copy="${escapeHtml(uidKey)}">${ICONS.copy}<span>复制</span></button>
                <button type="button" class="upp-btn" data-wb-inline-close="${escapeHtml(uidKey)}">收起</button>
                <button type="button" class="upp-btn primary" data-wb-inline-save="${escapeHtml(uidKey)}">保存</button>
              </div>
            </div>
    `;
  }

  function renderWorldbookBody({ preservePanels = false } = {}) {
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
            <button type="button" class="upp-entry-main" data-wb-open="${escapeHtml(uidKey)}">
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
          ${isExpanded ? buildWorldbookInlinePanelHtml(e, warnList, uidKey) : ''}
        </div>
      `;
    }).join('') + `</div>`;

    const panels = preservePanels ? [...elBody.querySelectorAll('[data-wb-panel]')] : [];
    elBody.innerHTML = html;
    const newPanels = new Map([...elBody.querySelectorAll('[data-wb-panel]')].map(panel => [panel.dataset.wbPanel, panel]));
    for (const panel of panels) {
      const replacement = newPanels.get(panel.dataset.wbPanel);
      if (!replacement) continue;
      const row = replacement.parentNode;
      replacement.remove();
      row.appendChild(panel);
    }
  }

  function locateWorldbookRow(uid, highlight = false) {
    const row = [...elBody.querySelectorAll('[data-wb-wrap]')].find(el => el.dataset.wbWrap === uid);
    if (!row) return;
    const top = Math.max(0, elBody.scrollTop + row.getBoundingClientRect().top - elBody.getBoundingClientRect().top - Math.round(elBody.clientHeight * 0.25));
    // 立刻到位，不用 smooth：iOS 平滑滚动期间叠加键盘/视口变化会把外层页面一起带走
    elBody.scrollTo({ top, behavior: 'auto' });
    if (highlight) {
      row.classList.add('is-highlighted');
      window.setTimeout(() => row.classList.remove('is-highlighted'), 1200);
    }
  }

  // 正在查看哪套预设：与“酒馆当前使用”彻底分开，查看不碰宿主
  function viewingPresetName() {
    return state.viewPresetName || state.loadedPresetName;
  }

  function isViewingForeignPreset() {
    return !!state.viewPresetName && state.viewPresetName !== state.loadedPresetName;
  }

  function presetFoldKey(id) {
    return `${viewingPresetName()}::${id}`;
  }

  // 刷新数据后重新对齐“查看”状态：查看的预设被删/已等于当前就退回跟随宿主，
  // 否则按只读方式重新读取被查看的预设条目
  function syncPresetViewData() {
    if (state.viewPresetName
      && (state.viewPresetName === state.loadedPresetName || !state.presets.includes(state.viewPresetName))) {
      state.viewPresetName = '';
      state.presetUseConfirm = false;
    }
    if (state.viewPresetName) {
      const norm = Host.getPresetByNameNormalized(state.viewPresetName);
      if (norm) { state.livePresetNorm = norm; return; }
      state.viewPresetName = '';
      state.presetUseConfirm = false;
    }
    state.livePresetNorm = Host.getLiveNormalizedPreset();
  }

  // 用户显式折叠优先；搜索命中时允许自动展开（autoExpand），但「只看已开」下不自动展开，
  // 否则全部展开/折叠按钮在只看已开模式里点了没反应（意见 #6）
  function isPresetGroupCollapsed(group, { autoExpand = false } = {}) {
    const key = presetFoldKey(group.id);
    if (Object.prototype.hasOwnProperty.call(state.presetFoldState, key)) {
      return !!state.presetFoldState[key];
    }
    if (autoExpand) return false;
    if (state.store.settings.presetGroupsDefaultCollapsed !== false) return true;
    return !!group.collapsed;
  }

  // 当前（含搜索/只看已开过滤后）真正渲染出来的分组节点
  function visiblePresetGroupNodes() {
    const { nodes } = buildPresetRenderNodes(state.livePresetNorm, {
      search: state.presetSearch,
      onlyOn: state.presetOnlyOn,
    });
    return nodes.filter(n => n.type === 'group');
  }

  function presetNodeCollapsed(node) {
    return isPresetGroupCollapsed(node.group, { autoExpand: !state.presetOnlyOn && !!node.forceExpand });
  }

  function renderPresetToolbar() {
    const viewName = viewingPresetName();
    const foreign = isViewingForeignPreset();
    const presetOpts = state.presets.map(name =>
      `<option value="${escapeHtml(name)}" ${name === viewName ? 'selected' : ''}>${escapeHtml(name)}</option>`
    ).join('');
    const groupNodes = visiblePresetGroupNodes();
    const anyExpanded = groupNodes.some(n => !presetNodeCollapsed(n));
    const defFoldOn = state.store.settings.presetGroupsDefaultCollapsed !== false;
    const onCount = (state.livePresetNorm.prompts || []).filter(p => p.enabled).length;

    elToolbar.innerHTML = `
      <div class="upp-row upp-tb-pr-row1">
        <div class="upp-tb-pr-p1">
          <select class="upp-select" id="upp-preset-select" title="选择要查看的预设（查看不会切换酒馆当前预设）">${presetOpts || '<option value="">无可用预设</option>'}</select>
          <button type="button" class="upp-btn secondary" id="upp-preset-sync-btn" ${foreign ? 'disabled' : ''} title="${foreign ? '正在查看非当前预设，先「设为当前使用」再同步' : '把当前预设的新增条目或更新后的开关批量同步或迁移到快照'}">同步到快照</button>
          <button type="button" class="upp-btn secondary" id="upp-preset-save-disk-btn" ${foreign ? 'disabled' : ''} title="${foreign ? '正在查看非当前预设，不能写回预设文件' : '将当前开关与分组状态写入预设文件（会覆盖原生预设，点击后需再确认）'}">保存预设</button>
        </div>
        <div class="upp-spacer"></div>
        <div class="upp-tb-pr-fold">
          ${groupNodes.length ? `<button type="button" class="upp-btn" id="upp-preset-fold-all-btn">${anyExpanded ? '全部折叠' : '全部展开'}</button>` : ''}
          ${groupNodes.length ? `
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
          <input type="text" id="upp-preset-search" spellcheck="false" placeholder="搜索分组、提示词或正文…" value="${escapeHtml(state.presetSearch)}" />
        </div>
        <div class="upp-tb-pr-onlyon">
          <button type="button" class="upp-btn ${state.presetOnlyOn ? 'active' : ''}" id="upp-preset-only-on-btn" aria-pressed="${state.presetOnlyOn ? 'true' : 'false'}" title="${state.presetOnlyOn ? '当前只显示已开启条目，点击看回全部' : '只显示已开启的条目'}">只看已开${state.presetOnlyOn ? ` · ${onCount}` : ''}</button>
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
          <button type="button" class="upp-entry-main" data-pr-open="${pid}" style="${isPh ? 'cursor:default;' : ''}">
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
            <input type="text" class="upp-text-input" spellcheck="false" data-pr-inline-name="${pid}" value="${escapeHtml(p.name || '')}" placeholder="条目名称" />
            <textarea class="upp-inline-textarea" spellcheck="false" data-pr-inline-content="${pid}">${escapeHtml(p.content || '')}</textarea>
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

  // 预设页顶部的状态条：查看中（未切换）/ 切换确认 / 写回预设文件确认
  function renderPresetNoticeStrip() {
    let html = '';
    if (isViewingForeignPreset()) {
      if (state.presetUseConfirm) {
        html += `
          <div class="upp-bind-strip is-confirm" style="background:var(--warn-soft);border-color:color-mix(in srgb, var(--warn) 35%, transparent);" data-preset-view-strip>
            <span>确认把酒馆当前预设从「${escapeHtml(state.loadedPresetName || '无')}」切换为「${escapeHtml(state.viewPresetName)}」？之后的生成会用新预设。</span>
            <div class="upp-row-nowrap">
              <button type="button" class="upp-btn primary" id="upp-preset-use-confirm">确认切换</button>
              <button type="button" class="upp-btn" id="upp-preset-use-cancel">取消</button>
            </div>
          </div>
        `;
      } else {
        html += `
          <div class="upp-bind-strip" style="background:var(--inset);" data-preset-view-strip>
            <span>正在查看「${escapeHtml(state.viewPresetName)}」· 酒馆当前使用「${escapeHtml(state.loadedPresetName || '无')}」，<strong>尚未切换</strong>（查看只读）</span>
            <div class="upp-row-nowrap">
              <button type="button" class="upp-btn primary" id="upp-preset-use-btn">设为当前使用</button>
              <button type="button" class="upp-btn" id="upp-preset-view-back-btn">看回当前</button>
            </div>
          </div>
        `;
      }
    }
    if (state.presetDiskSaveConfirm) {
      html += `
        <div class="upp-bind-strip is-confirm" style="background:var(--danger-soft);border-color:color-mix(in srgb, var(--danger) 35%, transparent);" data-preset-disk-save-strip>
          <span>「保存预设」会把当前开关与分组状态写进酒馆原生预设文件「${escapeHtml(state.loadedPresetName || '无')}」，覆盖原内容。继续？</span>
          <div class="upp-row-nowrap">
            <button type="button" class="upp-btn danger" id="upp-preset-disk-save-confirm">确认写入预设文件</button>
            <button type="button" class="upp-btn" id="upp-preset-disk-save-cancel">取消</button>
          </div>
        </div>
      `;
    }
    return html;
  }

  function renderPresetBody() {
    const { nodes } = buildPresetRenderNodes(state.livePresetNorm, {
      search: state.presetSearch,
      onlyOn: state.presetOnlyOn,
    });

    const notice = renderPresetNoticeStrip();
    if (!nodes.length) {
      elBody.innerHTML = notice + `<div class="upp-empty">${state.livePresetNorm.prompts.length ? '没有匹配的提示词' : '未能读取当前预设条目'}</div>`;
      return;
    }

    elBody.innerHTML = notice + `<div class="upp-entry-list">` + nodes.map(node => {
      if (node.type === 'prompt') return renderPresetPromptRowHtml(node.prompt);
      const g = node.group;
      const collapsed = presetNodeCollapsed(node);
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
    const rgEnabled = isRegexModuleEnabled();
    const rgUnavailable = !rgEnabled || regexEngine === false;
    const list = state.regexList || [];
    const onCount = list.filter(r => r.enabled).length;
    const metaText = !rgEnabled
      ? '模块已禁用'
      : (rgUnavailable ? '模块不可用' : `共 ${list.length} 条 · 已开 ${onCount} 条`);
    elToolbar.innerHTML = `
      <div class="upp-row upp-tb-rg-row1">
        <div class="upp-tb-rg-scopes">
          <button type="button" class="upp-btn ${state.regexScope === 'global' ? 'active' : ''}" data-rg-scope="global">全局</button>
          <button type="button" class="upp-btn ${state.regexScope === 'character' ? 'active' : ''}" data-rg-scope="character">当前角色</button>
          <button type="button" class="upp-btn ${state.regexScope === 'preset' ? 'active' : ''}" data-rg-scope="preset">当前预设</button>
        </div>
        <div class="upp-spacer"></div>
        <span class="upp-card-meta upp-tb-rg-meta">${metaText}</span>
      </div>
      <div class="upp-row upp-tb-rg-row2">
        <div class="upp-input-wrap upp-tb-rg-search">
          ${ICONS.search}
          <input type="text" id="upp-rg-search" spellcheck="false" placeholder="搜索正则名称或规则…" value="${escapeHtml(state.regexSearch)}" />
        </div>
        <div class="upp-tb-rg-onlyon">
          <button type="button" class="upp-btn ${state.regexOnlyOn ? 'active' : ''}" id="upp-rg-only-on-btn">只看已开</button>
        </div>
      </div>
    `;
  }

  function renderRegexBody() {
    if (!isRegexModuleEnabled()) {
      elBody.innerHTML = `<div class="upp-empty"><span>酒馆内置正则模块已禁用</span><span class="upp-card-meta">当前无法读取或切换正则脚本，其余快照与管理功能可正常独立使用。</span></div>`;
      return;
    }
    if (regexEngine === false) {
      elBody.innerHTML = `<div class="upp-empty"><span>未检测到酒馆内置正则模块，该功能当前不可用</span><span class="upp-card-meta">其余快照与管理功能可正常独立使用。</span></div>`;
      return;
    }
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

    const scopeLabel = state.regexScope === 'character' ? '当前角色' : state.regexScope === 'preset' ? '当前预设' : '全局';
    elBody.innerHTML = `<div class="upp-entry-list">` + filtered.map(r => {
      const dest = [r.destination?.display ? '显示' : '', r.destination?.prompt ? '提示词' : ''].filter(Boolean).join('/');
      const rid = escapeHtml(r.id);
      const isExpanded = state.expandedRegexIds.has(r.id);
      const detailText = `【查找正则】\n${r.find_regex || '（空）'}\n\n【替换为】\n${r.replace_string || '（空）'}`;
      return `
        <div class="upp-entry-wrap ${isExpanded ? 'is-expanded' : ''}" data-rg-wrap="${rid}">
          <div class="upp-entry-row ${r.enabled ? 'is-on' : ''}" data-rg-row="${rid}">
            <button type="button" class="upp-entry-main" data-rg-open="${rid}">
              <span class="upp-entry-chev">${ICONS.chevron}</span>
              <div class="upp-entry-text">
                <div class="upp-entry-name">${escapeHtml(r.script_name)}</div>
                <div class="upp-entry-preview">${escapeHtml(r.find_regex)}</div>
              </div>
              ${dest ? `<span class="upp-badge">${dest}</span>` : ''}
            </button>
            <button type="button" class="upp-switch" role="switch" aria-checked="${!!r.enabled}" data-rg-toggle="${rid}"></button>
          </div>
          ${isExpanded ? `
            <div class="upp-inline-panel" data-rg-panel="${rid}">
              <div class="upp-inline-meta">
                <span>范围：${scopeLabel} · 状态：${r.enabled ? '开启' : '关闭'}</span>
                ${dest ? `<span>作用：${escapeHtml(dest)}</span>` : ''}
              </div>
              <pre class="upp-inline-pre">${escapeHtml(detailText)}</pre>
+
                <button type="button" class="upp-btn" data-rg-inline-copy="${rid}">${ICONS.copy}<span>复制规则</span></button>
                <button type="button" class="upp-btn" data-rg-inline-close="${rid}">收起</button>
              </div>
            </div>
          ` : ''}
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
          <button type="button" class="upp-entry-main" data-view-snap-pr="${pid}" style="${isPh ? 'cursor:default;' : ''}">
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
                      <button type="button" class="upp-entry-main" data-view-snap-wb="${escapeHtml(bk)}" data-view-snap-uid="${escapeHtml(u)}" style="${canExpand ? '' : 'cursor:default;'}">
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
          +
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
      const descText = String(s.persona.description || '');
      if (metaEl) {
        metaEl.innerHTML = `
          <span class="upp-badge accent">User：${escapeHtml(s.persona.name || '未命名')}</span>
          ${s.persona.versionName ? `<span class="upp-badge">版本：${escapeHtml(s.persona.versionName)}</span>` : '<span class="upp-badge">独立正文</span>'}
          ${s.persona.lorebook ? `<span class="upp-badge">绑定世界书：${escapeHtml(s.persona.lorebook)}</span>` : ''}
          <span class="upp-badge upp-keep" id="upp-sv-persona-len">${descText.length} 字</span>
        `;
      }
      bodyEl.innerHTML = `
        <div class="upp-card" style="flex:1;min-height:0;">
          <div class="upp-field">
            <label>User 显示名</label>
            <div class="upp-row-nowrap">
              <input type="text" class="upp-text-input" id="upp-sv-persona-name" spellcheck="false" value="${escapeHtml(s.persona.name || '')}" placeholder="输入此快照生效的 User 名字" />
              <button type="button" class="upp-btn" id="upp-sv-persona-name-clear">清空</button>
            </div>
          </div>
          <div class="upp-field" style="flex:1;display:flex;flex-direction:column;min-height:0;">
            <div class="upp-sec-title" style="margin:0;">
              <span>人设详细正文</span>
              <div class="upp-row-nowrap">
                <button type="button" class="upp-btn" style="height:24px;padding:0 8px;font-size:var(--upp-fs-xs);" id="upp-sv-persona-pull" title="用当前酒馆正在使用的 User 名字与正文覆盖下方内容">拉取当前 User</button>
                <button type="button" class="upp-btn" style="height:24px;padding:0 8px;font-size:var(--upp-fs-xs);" id="upp-sv-persona-copy">${ICONS.copy}<span>复制</span></button>
              </div>
            </div>
            <textarea class="upp-textarea" id="upp-sv-persona-desc" spellcheck="false" style="flex:1;min-height:220px;" placeholder="直接微调此快照的 User 人设正文，修改后点右上角「保存修改」生效">${escapeHtml(descText)}</textarea>
          </div>
        </div>
      `;
      return;
    }

    if (sub === 'api' && s.scope.api && s.api) {
      const cmEnabled = isConnectionManagerEnabled();
      const profiles = cmEnabled ? (state.apiProfiles || Host.listConnectionProfiles()) : [];
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
          ${!cmEnabled && (s.api.profileId || s.api.profileName) ? `
            <div class="upp-notice-box">
              <span>酒馆连接配置模块（Connection Manager）当前未启用，可清除此快照的旧配置绑定，改用独立记录的来源与模型。</span>
              <div class="upp-row">
                <button type="button" class="upp-btn secondary" id="upp-sv-api-clear-profile">清除旧配置绑定</button>
              </div>
            </div>
          ` : ''}
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
      const rgEnabled = isRegexModuleEnabled();
      const rgAvailable = rgEnabled && regexEngine !== false;
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
      const noticeHtml = !rgAvailable
        ? `<div class="upp-notice-box"><span>内置正则模块当前${!rgEnabled ? '已禁用' : '不可用'}，仅展示快照已保存的开关状态。</span></div>`
        : '';
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
                const expKey = `rg::${sc.key}::${id}`;
                const canExpand = !!live;
                const isExpanded = canExpand && !!(d.expandedIds && d.expandedIds.has(expKey));
                const detailText = live ? `【查找正则】\n${live.find_regex || '（空）'}\n\n【替换为】\n${live.replace_string || '（空）'}` : '';
                return `
                  <div class="upp-entry-wrap ${isExpanded ? 'is-expanded' : ''}">
                    <div class="upp-entry-row ${on ? 'is-on' : 'is-off'}">
                      <button type="button" class="upp-entry-main" data-view-snap-rg="${sc.key}" data-view-snap-rgid="${escapeHtml(id)}" style="${canExpand ? '' : 'cursor:default;'}">
                        ${canExpand ? `<span class="upp-entry-chev">${ICONS.chevron}</span>` : ''}
                        <span class="upp-dot ${on ? 'snap-on' : 'snap-off'}"></span>
                        <div class="upp-entry-text">
                          <div class="upp-entry-name">${escapeHtml(live ? live.script_name : `正则 #${id.slice(0, 8)}`)}</div>
                          <div class="upp-entry-preview">${escapeHtml(live ? live.find_regex : (!rgAvailable ? '正则模块当前不可用' : '未在当前范围找到'))}</div>
                        </div>
                      </button>
                      <button type="button" class="upp-switch" role="switch" aria-checked="${on}" data-sv-rg-toggle="${sc.key}" data-sv-rg-id="${escapeHtml(id)}"></button>
                    </div>
                    ${isExpanded ? `
                      <div class="upp-inline-panel" data-sv-rg-panel="${escapeHtml(expKey)}">
                        <div class="upp-inline-meta">
                          <span>${sc.label} · 快照中${on ? '开启' : '关闭'}</span>
                        </div>
                        <pre class="upp-inline-pre">${escapeHtml(detailText)}</pre>
          +
                          <button type="button" class="upp-btn" data-sv-rg-copy="${sc.key}" data-sv-rg-copy-id="${escapeHtml(id)}">${ICONS.copy}<span>复制规则</span></button>
                          <button type="button" class="upp-btn" data-sv-rg-close="${escapeHtml(expKey)}">收起</button>
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
      bodyEl.innerHTML = noticeHtml + (blocks ? `<div class="upp-entry-list">${blocks}</div>` : `<div class="upp-empty">没有匹配的正则条目</div>`);
    }
  }

  function renderMergeCandidateList(d, planArg) {
    const listEl = shadow.getElementById('upp-merge-candidate-list');
    if (!listEl) return;
    const keepId = d.keepId || (state.currentPersona?.avatar_id || state.personas[0]?.avatar_id || '');
    const keep = state.personas.find(p => p.avatar_id === keepId);
    const existingVersions = keep ? (state.store.personaVersions[keep.avatar_id] || []) : [];
    const plan = planArg || buildPersonaMergePlan(state.personas, keepId, d.absorbIds, existingVersions);
    const planById = new Map((plan?.candidates || []).map(c => [c.avatar_id, c]));
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
      const candPlan = planById.get(p.avatar_id);
      return `
        <div class="upp-merge-row ${checked ? 'is-checked' : ''}">
          <div class="upp-merge-top">
            <label>
              <input type="checkbox" data-merge-absorb="${aid}" ${checked ? 'checked' : ''} style="accent-color:var(--accent);margin:0;flex-shrink:0;" />
              <span class="upp-merge-name">${escapeHtml(p.name)}</span>
              ${isOverlap ? '<span class="upp-badge accent">相似分身</span>' : ''}
              ${candPlan ? `<span class="upp-badge">将变为：${escapeHtml(candPlan.versionName)}</span>` : ''}
              <span class="upp-card-meta">${desc.length} 字</span>
            </label>
            <button type="button" class="upp-btn" style="height:24px;padding:0 8px;font-size:var(--upp-fs-xs);" data-merge-preview="${aid}">${expanded ? '收起正文' : '查看正文'}</button>
          </div>
          ${!expanded ? `<div class="upp-merge-snippet">${escapeHtml(snippet || '（空描述）')}</div>` : `
            <pre class="upp-inline-pre" style="max-height:180px;">${escapeHtml(desc || '（空描述）')}</pre>
          `}
        </div>
      `;
    };

    let html = '';
    if (topItems.length) {
      html += `<div class="upp-wb-sec-head"><span>推荐收纳 · 重合与已选分身（${topItems.length}）</span></div>`;
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

  function renderSaveSnapshotBooksList(d) {
    const listEl = shadow.getElementById('upp-ss-books-list');
    if (!listEl) return;
    const selectedSet = new Set(d.selectedBooks || []);
    const { sections } = groupWorldbooksByOrganizer(state.worldbooks, getOrganizerSettings(), {
      pinned: state.store.settings.pinnedWorldbooks,
      globals: state.globalWorldbooks,
      charBooks: [state.charWorldbooks.primary, ...(state.charWorldbooks.additional || [])].filter(Boolean),
      chatBook: state.chatWorldbook,
      liveCharBookMap: buildLiveCharBookMap(),
      query: d.bookQuery || '',
    });
    if (!sections.length) {
      listEl.innerHTML = '<div class="upp-card-meta" style="padding:10px;text-align:center;">未找到匹配的世界书</div>';
      return;
    }
    listEl.innerHTML = sections.map(sec => {
      const names = sec.items.map(it => it.name);
      const allChecked = names.length > 0 && names.every(n => selectedSet.has(n));
      const dotHtml = sec.color ? `<span class="upp-wb-dot" style="background:${escapeHtml(sec.color)};"></span>` : '';
      return `
        <div class="upp-wb-sec-head">
          <span class="upp-row-nowrap">${dotHtml}<span>${escapeHtml(sec.name)}（${sec.items.length}）</span>${sec.isExcluded ? '<span class="upp-badge">已排除</span>' : ''}</span>
          <button type="button" class="upp-pill" style="height:22px;font-size:var(--upp-fs-xs);padding:0 8px;" data-ss-toggle-group="${escapeHtml(sec.id)}">${allChecked ? '取消全选' : '全选本组'}</button>
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
  }

  function renderBindChatCharOptions(d) {
    const selEl = shadow.getElementById('upp-bind-chat-char-sel');
    const picksEl = shadow.getElementById('upp-bind-chat-char-picks');
    const q = normalizeText(d.chatCharQuery || '');
    const withAvatar = (d.allChars || []).filter(c => c.avatar);
    const matched = q ? withAvatar.filter(c => normalizeText(c.name + ' ' + c.id).includes(q)) : withAvatar;
    if (selEl) {
      const opts = matched.map(c =>
        `<option value="${escapeHtml(c.avatar)}" ${d.scanCharAvatar === c.avatar ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
      ).join('');
      const hasSelected = matched.some(c => c.avatar === d.scanCharAvatar);
      const selectedObj = !hasSelected && d.scanCharAvatar ? withAvatar.find(c => c.avatar === d.scanCharAvatar) : null;
      selEl.innerHTML = `<option value="">${matched.length ? `选择角色扫描其聊天档（共 ${matched.length} 个）…` : '未找到匹配角色'}</option>`
        + (selectedObj ? `<option value="${escapeHtml(selectedObj.avatar)}" selected>${escapeHtml(selectedObj.name)}</option>` : '')
        + opts;
    }
    if (picksEl) {
      if (q && matched.length) {
        picksEl.hidden = false;
        picksEl.innerHTML = matched.slice(0, 8).map(c =>
          `<button type="button" class="upp-pill ${d.scanCharAvatar === c.avatar ? 'active' : ''}" data-bind-pick-chat-char="${escapeHtml(c.avatar)}">${escapeHtml(c.name)}</button>`
        ).join('');
      } else {
        picksEl.hidden = true;
        picksEl.innerHTML = '';
      }
    }
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

  function bookPickerSections(d, query = '') {
    return groupWorldbooksByOrganizer(state.worldbooks, getOrganizerSettings(), {
      pinned: state.store.settings.pinnedWorldbooks,
      globals: state.globalWorldbooks,
      charBooks: [state.charWorldbooks.primary, ...(state.charWorldbooks.additional || [])].filter(Boolean),
      chatBook: state.chatWorldbook,
      liveCharBookMap: buildLiveCharBookMap(),
      query,
    }).sections;
  }

  // 顶部组胶囊：点一个只看该组，再点「全部」看回来
  function renderBookPickerChips(d, sections) {
    const chipsEl = shadow.getElementById('upp-book-picker-chips');
    if (!chipsEl) return;
    const total = sections.reduce((sum, sec) => sum + sec.items.length, 0);
    const active = d.groupFilter || '';
    const chip = (id, label, count) => `
      <button type="button" class="upp-pill ${active === id ? 'active' : ''}" data-bp-group="${escapeHtml(id)}" aria-pressed="${active === id ? 'true' : 'false'}">
        <span class="upp-pill-text">${escapeHtml(label)}</span><span class="upp-wb-chip-count">${count}</span>
      </button>`;
    chipsEl.innerHTML = chip('', '全部', total) + sections.map(sec => chip(sec.id, sec.name, sec.items.length)).join('');
  }

  function renderBookPickerList(d) {
    const listEl = shadow.getElementById('upp-book-picker-list');
    if (!listEl) return;
    const query = d.query || '';
    const hasQuery = !!normalizeText(query);
    const allSections = bookPickerSections(d, '');
    if (!d.groupFilter || !allSections.some(sec => sec.id === d.groupFilter)) d.groupFilter = '';
    renderBookPickerChips(d, allSections);
    const scoped = hasQuery ? bookPickerSections(d, query) : allSections;
    const sections = d.groupFilter ? scoped.filter(sec => sec.id === d.groupFilter) : scoped;
    if (!sections.length) {
      listEl.innerHTML = '<div class="upp-empty" style="padding:18px;">未找到匹配世界书</div>';
      return;
    }
    listEl.innerHTML = sections.map(sec => {
      // 只看某组时默认展开，省一次点击；其余沿用用户的折叠记录
      const folded = (d.groupFilter === sec.id) ? false : (Object.prototype.hasOwnProperty.call(d.foldMap || {}, sec.id) ? !!d.foldMap[sec.id] : !!sec.defaultCollapsed);
      const dotHtml = sec.color ? `<span class="upp-wb-dot" style="background:${escapeHtml(sec.color)};"></span>` : '';
      return `
        <div class="upp-bp-box ${folded ? 'is-collapsed' : ''}" data-bp-section="${escapeHtml(sec.id)}">
          <div class="upp-bp-head">
            <button type="button" class="upp-group-toggle-btn" data-bp-fold="${escapeHtml(sec.id)}" style="font-size:var(--upp-fs-sm);">
              <span class="upp-group-chev">${ICONS.chevron}</span>
              ${dotHtml}
              <span class="upp-group-name">${escapeHtml(sec.name)}</span>
              ${sec.isExcluded ? '<span class="upp-badge">已排除</span>' : ''}
              <span class="upp-badge">${sec.items.length}</span>
            </button>
          </div>
          <div class="upp-bp-items">
            ${sec.items.map(item => {
              const tags = [];
              if (item.isPinned) tags.push('<span class="upp-badge warn">置顶</span>');
              if (item.isGlobal) tags.push('<span class="upp-badge accent">全局</span>');
              if (item.isChar) tags.push('<span class="upp-badge ok">角色</span>');
              if (item.isChat) tags.push('<span class="upp-badge ok">聊天</span>');
              const sub = item.subtitle ? `<span class="upp-wb-sub">${escapeHtml(item.subtitle)}</span>` : '';
              return `
                <button type="button" class="upp-detail-item" data-pick-book="${escapeHtml(item.name)}" style="${item.name === state.activeBook ? 'border-color:var(--accent);' : ''}">
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

  function syncPresetOverrideCount(d) {
    const badge = shadow.getElementById('upp-ps-ov-count-badge');
    if (!badge) return;
    const total = Object.keys(d.forceOverridePrompts).length + Object.keys(d.forceOverrideGroups).length;
    badge.hidden = total === 0;
    badge.textContent = `已选 ${total}`;
  }

  function renderPresetSyncOverrideList(d) {
    const list = shadow.getElementById('upp-ps-ov-list');
    if (!list) return;
    const scroller = shadow.getElementById('upp-ps-ov-scroll');
    const scrollTop = scroller.scrollTop;
    const { nodes } = buildPresetSyncOverrideTree(d.targetPresetNorm, d.analysis?.newPrompts, { search: d.overrideSearch });
    const visibleGroupIds = new Set(nodes.filter(node => node.type === 'group').map(node => node.group.id));
    const query = normalizeText(d.overrideSearch);
    for (const group of d.targetPresetNorm?.groups || []) {
      if (!visibleGroupIds.has(group.id) && normalizeText(group.name).includes(query)) {
        nodes.push({ type: 'group', group, items: [] });
      }
    }
    const liveState = on => `<span class="upp-badge ${on ? 'ok' : ''}">${on ? '当前：开' : '当前：关'}</span>`;
    const promptRow = p => `
      <label class="upp-check-item upp-ps-ov-prompt">
        <input type="checkbox" data-ps-ov-pr="${escapeHtml(p.id)}" ${Object.prototype.hasOwnProperty.call(d.forceOverridePrompts, p.id) ? 'checked' : ''} />
        <span>${escapeHtml(p.name || p.id)}</span>${liveState(p.enabled)}
      </label>`;
    list.innerHTML = nodes.map(node => {
      if (node.type === 'prompt') return promptRow(node.prompt);
      const { group, items, forceExpand } = node;
      const id = escapeHtml(group.id);
      const collapsed = !forceExpand && d.overrideCollapsed.has(group.id);
      return `
        <div class="upp-group-box ${collapsed ? 'is-collapsed' : ''}">
          <div class="upp-group-head">
            ${items.length ? `<button type="button" class="upp-group-toggle-btn" data-ps-ov-fold="${id}" aria-expanded="${!collapsed}">
              <span class="upp-group-chev">${ICONS.chevron}</span>
              <span class="upp-group-name">${escapeHtml(group.name)}</span>
            </button>` : `<span class="upp-group-name">${escapeHtml(group.name)}</span>`}
            <label class="upp-check-item upp-ps-ov-master">
              <input type="checkbox" data-ps-ov-grp="${id}" ${Object.prototype.hasOwnProperty.call(d.forceOverrideGroups, group.id) ? 'checked' : ''} />
              <span>总开关</span>${liveState(group.enabled)}
            </label>
          </div>
          ${items.length ? `<div class="upp-group-items">${items.map(promptRow).join('')}</div>` : ''}
        </div>`;
    }).join('') || '<div class="upp-card-meta">没有匹配的分组或条目</div>';
    scroller.scrollTop = scrollTop;
  }

  const NON_BLOCKING_DRAWERS = new Set(['bookPicker', 'bindSnapshot', 'presetSync', 'backup']);

  function renderDrawer() {
    const d = state.drawer;
    if (!d) {
      elDrawerMask.hidden = true;
      elDrawerMask.classList.remove('is-full', 'is-non-blocking');
      elDrawerMask.innerHTML = '';
      return;
    }
    elDrawerMask.hidden = false;
    const isFull = d.type === 'viewSnapshot' || (d.type === 'entryEditor' && d.fullView);
    const isNonBlocking = !isFull && NON_BLOCKING_DRAWERS.has(d.type);
    elDrawerMask.classList.toggle('is-full', isFull);
    elDrawerMask.classList.toggle('is-non-blocking', isNonBlocking);

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
      const existingGroups = Array.from(new Set(state.store.snapshots.map(x => x.group).filter(Boolean)));
      const metaDraft = d.metaDraft || {
        name: s.name || '',
        group: s.group || '',
        note: s.note || '',
        scope: { ...s.scope },
      };
      const mSc = metaDraft.scope || { persona: true, worldbooks: true, preset: true, regex: true, api: false };

      elDrawerMask.innerHTML = `
        <div class="upp-drawer is-full">
          <div class="upp-drawer-head">
            <div class="upp-row-nowrap" style="min-width:0;">
              <button type="button" class="upp-btn icon-only" data-sv-back title="返回">${ICONS.back}</button>
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">快照详情 · ${escapeHtml(s.name)}</span>
              ${d.dirty ? '<span class="upp-badge warn">未保存</span>' : ''}
            </div>
            <div class="upp-row-nowrap">
              <button type="button" class="upp-btn secondary ${d.editingMeta ? 'active' : ''}" id="upp-sv-edit-meta-btn" title="原地编辑名称、分组或说明">${ICONS.edit}<span>编辑</span></button>
              <button type="button" class="upp-btn ${d.dirty ? 'primary' : ''}" id="upp-sv-save-btn" ${d.dirty ? '' : 'disabled'}>${ICONS.save}<span>${d.dirty ? '保存修改' : '已保存'}</span></button>
              <button type="button" class="upp-btn ${d.dirty ? 'secondary' : 'primary'}" id="upp-sv-apply-btn">应用此快照</button>
            </div>
          </div>
          ${d.editingMeta ? `
            <div class="upp-card upp-inline-panel upp-sv-meta-panel" data-sv-meta-panel>
              <div class="upp-inline-meta">
                <span>原地编辑快照信息与包含模块</span>
                <button type="button" class="upp-btn" id="upp-em-cancel-btn">收起</button>
              </div>
              <div class="upp-row">
                <div class="upp-field" style="flex:1;min-width:160px;">
                  <label>快照名称</label>
                  <div class="upp-row-nowrap">
                    <input type="text" class="upp-text-input" id="upp-em-name" data-sv-meta-name spellcheck="false" value="${escapeHtml(metaDraft.name || '')}" placeholder="输入快照名称" />
                    <button type="button" class="upp-btn" id="upp-em-name-clear">清空</button>
                  </div>
                </div>
                <div class="upp-field" style="flex:1;min-width:140px;">
                  <label>分组</label>
                  <input type="text" class="upp-text-input" id="upp-em-group" spellcheck="false" value="${escapeHtml(metaDraft.group || '')}" placeholder="可选分组" />
                </div>
              </div>
              ${existingGroups.length ? `<div class="upp-pill-strip">${existingGroups.map(g => `<button type="button" class="upp-pill" data-em-fill-group="${escapeHtml(g)}">${escapeHtml(g)}</button>`).join('')}</div>` : ''}
              <div class="upp-field">
                <label>说明备注</label>
                <input type="text" class="upp-text-input" id="upp-em-note" spellcheck="false" value="${escapeHtml(metaDraft.note || '')}" placeholder="可选简短说明，最多 120 字" />
              </div>
              <div class="upp-check-grid">
                <label class="upp-check-item"><input type="checkbox" id="upp-em-sc-persona" ${mSc.persona ? 'checked' : ''} /><span>User 人设</span></label>
                <label class="upp-check-item"><input type="checkbox" id="upp-em-sc-wb" ${mSc.worldbooks ? 'checked' : ''} /><span>世界书</span></label>
                <label class="upp-check-item"><input type="checkbox" id="upp-em-sc-preset" ${mSc.preset ? 'checked' : ''} /><span>预设与分组</span></label>
                <label class="upp-check-item"><input type="checkbox" id="upp-em-sc-api" ${mSc.api ? 'checked' : ''} /><span>API / 连接配置</span></label>
                <label class="upp-check-item"><input type="checkbox" id="upp-em-sc-regex" ${mSc.regex ? 'checked' : ''} /><span>正则开关</span></label>
              </div>
+
                <button type="button" class="upp-btn" id="upp-em-cancel-btn-foot">取消</button>
                <button type="button" class="upp-btn primary" id="upp-em-save-btn" data-sv-meta-save>保存修改</button>
              </div>
            </div>
          ` : ''}
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
            ${availTabs.map(t => `<button type="button" class="upp-tab ${d.subTab === t.id ? 'active' : ''}" data-sv-tab="${t.id}"><span>${t.label}</span></button>`).join('')}
          </div>
          <div class="upp-drawer-toolbar">
            ${showFilter ? `
              <div class="upp-row">
                <div class="upp-input-wrap">
                  ${ICONS.search}
                  <input type="text" id="upp-sv-search" spellcheck="false" placeholder="搜索分组、名称或正文…" value="${escapeHtml(d.search || '')}" />
                </div>
                <button type="button" class="upp-btn ${d.onlyOn ? 'active' : ''}" id="upp-sv-only-on">只看已开</button>
                ${showFoldAll ? `<button type="button" class="upp-btn" id="upp-sv-fold-all">${d.allExpanded ? '全部折叠' : '全部展开'}</button>` : ''}
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
            <button type="button" class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            <div class="upp-field">
              <label>快照名称</label>
              <div class="upp-row-nowrap">
                <input type="text" class="upp-text-input" id="upp-em-name" spellcheck="false" value="${escapeHtml(d.name || '')}" placeholder="输入快照名称" />
                <button type="button" class="upp-btn" id="upp-em-name-clear">清空</button>
              </div>
            </div>
            <div class="upp-field">
              <label>分组</label>
              <input type="text" class="upp-text-input" id="upp-em-group" spellcheck="false" value="${escapeHtml(d.group || '')}" placeholder="可选，例如：日常 / 现代 / 角色名" />
              ${existingGroups.length ? `<div class="upp-pill-strip" style="margin-top:4px;">${existingGroups.map(g => `<button type="button" class="upp-pill" data-em-fill-group="${escapeHtml(g)}">${escapeHtml(g)}</button>`).join('')}</div>` : ''}
            </div>
            <div class="upp-field">
              <label>说明备注</label>
              <textarea class="upp-inline-textarea" id="upp-em-note" spellcheck="false" style="min-height:80px;" placeholder="可选简短说明，最多 120 字">${escapeHtml(d.note || '')}</textarea>
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
            <button type="button" class="upp-btn" data-drawer-close>取消</button>
            <button type="button" class="upp-btn primary" id="upp-em-save-btn">保存修改</button>
          </div>
        </div>
      `;
      if (canAutoFocusDesktop()) window.setTimeout(() => focusDesktopSafe(shadow.getElementById('upp-em-name')), 10);
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
      const hasOrg = hasActiveOrganizer();
      const org = getOrganizerSettings();
      const charNameMap = buildCombinedCharNameMap(org);
      const cmEnabled = isConnectionManagerEnabled();
      const liveProfiles = cmEnabled ? (state.apiProfiles || []) : [];
      const driftRemoved = Number(health.presetDrift?.removedPromptCount || 0);
      const driftAdded = Number(health.presetDrift?.newPromptCount || 0);
      const summaryBadges = [];
      if (health.missingPersona) summaryBadges.push(`<span class="upp-badge warn">缺失 User：${escapeHtml(health.missingPersona.name)}</span>`);
      if (health.missingWorldbooks.length) summaryBadges.push(`<span class="upp-badge warn">缺失世界书 ${health.missingWorldbooks.length} 本</span>`);
      if (health.missingPreset) summaryBadges.push(`<span class="upp-badge warn">缺失预设：${escapeHtml(health.missingPreset)}</span>`);
      if (health.missingApiProfile) summaryBadges.push(`<span class="upp-badge warn">缺失连接配置：${escapeHtml(health.missingApiProfile.profileName)}</span>`);
      if (driftRemoved > 0) summaryBadges.push(`<span class="upp-badge">预设已删条目 ${driftRemoved} 条</span>`);
      if (driftAdded > 0) summaryBadges.push(`<span class="upp-badge accent">预设新增条目 ${driftAdded} 条</span>`);
      const hasRepairableFields = !!(health.missingPersona || health.missingWorldbooks.length || health.missingPreset || health.missingApiProfile);

      elDrawerMask.innerHTML = `
        <div class="upp-drawer is-fixed-box">
          <div class="upp-drawer-head">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">快照存在缺失项 · ${escapeHtml(snap.name)}</span>
            <button type="button" class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            <section class="upp-section-block upp-ma-block" data-ma-block="summary">
              <h4 class="upp-block-title">1. 诊断摘要与预设变更</h4>
              <div class="upp-card-meta">快照本身已完整保留，不会被删除。请按需在下方直接替代修复，或前往对应模块处理。</div>
              ${summaryBadges.length ? `<div class="upp-card-meta">${summaryBadges.join('')}</div>` : ''}
              ${(driftRemoved > 0 || driftAdded > 0) ? `
                <div class="upp-notice-box">
                  <span>检测到当前预设与快照记录存在变动（已删 ${driftRemoved} 条、新增 ${driftAdded} 条），可用下方「批量迁移旧预设快照」同步开关。</span>
                </div>
              ` : ''}
            </section>

            <section class="upp-section-block upp-ma-block" data-ma-block="repair">
              <h4 class="upp-block-title">2. 原地替代与清理修复</h4>
              ${!hasRepairableFields ? `<div class="upp-card-meta">暂无需要手动重绑的缺失资源。</div>` : ''}
              ${health.missingPersona ? `
                <div class="upp-field">
                  <label>缺失 User（${escapeHtml(health.missingPersona.name)}）替换为：</label>
                  <select class="upp-select" id="upp-ma-persona-sel" style="width:100%;">
                    <option value="">暂不替换（应用时跳过 User）</option>
                    ${state.personas.map(p => `<option value="${escapeHtml(p.avatar_id)}" ${d.personaRemap === p.avatar_id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                  </select>
                </div>
              ` : ''}
              ${health.missingWorldbooks.map(bk => {
                const chosen = (d.bookRemap && d.bookRemap[bk]) || '__keep__';
                return `
                  <div class="upp-field">
                    <label>缺失世界书：<strong>${escapeHtml(bk)}</strong></label>
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
              ${health.missingPreset ? `
                <div class="upp-field">
                  <label>缺失预设（${escapeHtml(health.missingPreset)}）替换为：</label>
                  <select class="upp-select" id="upp-ma-preset-sel" style="width:100%;">
                    <option value="">暂不替换（应用时跳过预设）</option>
                    ${state.presets.map(pr => `<option value="${escapeHtml(pr)}" ${d.presetRemap === pr ? 'selected' : ''}>${escapeHtml(pr)}</option>`).join('')}
                  </select>
                </div>
              ` : ''}
              ${health.missingApiProfile ? `
                <div class="upp-field">
                  <label>缺失 API 连接配置（${escapeHtml(health.missingApiProfile.profileName)}）：</label>
                  ${!cmEnabled ? `<div class="upp-card-meta">酒馆连接配置模块当前未启用，可选择清除旧绑定改用独立记录的来源与模型。</div>` : ''}
                  <select class="upp-select" id="upp-ma-api-sel" style="width:100%;">
                    <option value="" ${!d.apiProfileRemap ? 'selected' : ''}>暂不替换（应用时跳过 API）</option>
                    <option value="__clear_profile__" ${d.apiProfileRemap === '__clear_profile__' ? 'selected' : ''}>清除旧配置绑定（改用来源：${escapeHtml(snap.api?.source || '未记录')} / 模型：${escapeHtml(snap.api?.model || '未记录')}）</option>
                    ${liveProfiles.map(pr => `<option value="${escapeHtml(pr.id)}" ${d.apiProfileRemap === pr.id ? 'selected' : ''}>${escapeHtml(pr.name)}${pr.model ? ` (${escapeHtml(pr.model)})` : ''}</option>`).join('')}
                  </select>
                </div>
              ` : ''}
            </section>

            <section class="upp-section-block upp-ma-block" data-ma-block="nav">
              <h4 class="upp-block-title">3. 前往对应模块处理</h4>
              <div class="upp-row">
                ${health.missingPersona ? `<button type="button" class="upp-btn secondary" data-ma-goto="user">前往 User 页</button>` : ''}
                ${health.missingWorldbooks.length ? `<button type="button" class="upp-btn secondary" data-ma-goto="worldbook">前往世界书页</button>` : ''}
                ${(health.missingWorldbooks.length && hasOrg) ? `<button type="button" class="upp-btn" id="upp-ma-open-wbo">打开整理面板</button>` : ''}
                ${(health.missingPreset || driftRemoved > 0 || driftAdded > 0) ? `<button type="button" class="upp-btn primary" id="upp-ma-migrate-preset">批量迁移旧预设快照</button>` : ''}
                ${health.missingPreset ? `<button type="button" class="upp-btn secondary" data-ma-goto="preset">前往预设页</button>` : ''}
              </div>
              ${!hasRepairableFields && !(driftRemoved > 0 || driftAdded > 0) ? `<div class="upp-card-meta">可直接跳过或返回对应标签页调整配置。</div>` : ''}
            </section>
          </div>
          <div class="upp-drawer-foot">
            <button type="button" class="upp-btn" data-drawer-close>取消</button>
            <button type="button" class="upp-btn ${hasRepairChoice ? '' : 'primary'}" id="upp-ma-skip-apply">跳过缺失项继续应用</button>
            ${hasRepairChoice ? `<button type="button" class="upp-btn primary" id="upp-ma-repair-apply">保存弥补并应用</button>` : ''}
          </div>
        </div>
      `;
      return;
    }

    if (d.type === 'globalBooksConfirm') {
      const diff = d.diff || { target: [], current: [], missing: [], stray: [] };
      const list = (arr) => arr.length ? arr.map(b => `<span class="upp-badge">${escapeHtml(b)}</span>`).join(' ') : '<span class="upp-muted">无</span>';
      elDrawerMask.innerHTML = `
        <div class="upp-drawer is-fixed-sm" style="width:min(460px,100%);">
          <div class="upp-drawer-head">
            <span>应用快照 · 全局世界书</span>
          </div>
          <div class="upp-drawer-body">
            <div class="upp-notice-box">
              <span>快照「${escapeHtml(d.snapshotName || '')}」没有记录这些你现在开着的全局书：</span>
              <div class="upp-row-nowrap" style="flex-wrap:wrap;gap:4px;">${list(diff.stray)}</div>
              <span>按快照覆盖会把它们关掉；保留则会和快照里的书一起开着。</span>
            </div>
            <div class="upp-section-block">
              <div class="upp-sec-title"><span>快照里的全局书</span><span>${diff.target.length} 本</span></div>
              <div class="upp-row-nowrap" style="flex-wrap:wrap;gap:4px;">${list(diff.target)}</div>
            </div>
            <label class="upp-check-item">
              <input type="checkbox" id="upp-gb-remember" />
              <span>记住我的选择，以后不再询问（可在「备份」里改）</span>
            </label>
          </div>
          <div class="upp-drawer-foot">
            <button type="button" class="upp-btn" id="upp-gb-cancel">取消应用</button>
            <button type="button" class="upp-btn" id="upp-gb-merge">保留我挂的书</button>
            <button type="button" class="upp-btn primary" id="upp-gb-replace">按快照覆盖</button>
          </div>
        </div>
      `;
      return;
    }

    if (d.type === 'bookPicker') {
      const hasOrg = hasActiveOrganizer();
      elDrawerMask.innerHTML = `
        <div class="upp-drawer is-fixed-box">
          <div class="upp-drawer-head">
            <span>选择世界书</span>
            <div class="upp-row-nowrap">
              ${hasOrg ? `<button type="button" class="upp-btn" id="upp-open-wbo-in-drawer">整理分组</button>` : ''}
              <button type="button" class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
            </div>
          </div>
          <div class="upp-drawer-body">
            <div class="upp-input-wrap" style="width:100%;flex:0 0 auto;">
              ${ICONS.search}
              <input type="text" id="upp-book-search-input" spellcheck="false" placeholder="输入世界书名称、角色名、别名或分组名筛选…" value="${escapeHtml(d.query || '')}" />
            </div>
            <div class="upp-pill-strip upp-wb-chips" id="upp-book-picker-chips"></div>
            <div class="upp-pop-list is-fill" id="upp-book-picker-list"></div>
          </div>
        </div>
      `;
      renderBookPickerList(d);
      if (canAutoFocusDesktop()) window.setTimeout(() => focusDesktopSafe(shadow.getElementById('upp-book-search-input')), 10);
      return;
    }

    if (d.type === 'entryEditor') {
      const readOnly = !!d.readOnly;
      elDrawerMask.innerHTML = `
        <div class="upp-drawer ${d.fullView ? 'is-full' : 'is-fixed-box'}">
          <div class="upp-drawer-head">
            <div class="upp-row-nowrap">
              ${d.returnTo ? `<button type="button" class="upp-btn icon-only" data-drawer-close title="返回">${ICONS.back}</button>` : ''}
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(d.heading || '条目详情')}</span>
            </div>
            ${!d.returnTo ? `<button type="button" class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>` : ''}
          </div>
          <div class="upp-drawer-body">
            ${d.meta ? `<div class="upp-card-meta">${escapeHtml(d.meta)}</div>` : ''}
            ${d.allowNameEdit ? `
              <div class="upp-field">
                <label>标题</label>
                <input type="text" class="upp-text-input" id="upp-ed-name" spellcheck="false" value="${escapeHtml(d.name || '')}" ${readOnly ? 'readonly' : ''} />
              </div>
            ` : ''}
            ${d.allowDisplayName ? `
              <div class="upp-field">
                <label>切换时使用的 User 名字 · 留空沿用当前名字</label>
                <div class="upp-row-nowrap">
                  <input type="text" class="upp-text-input" id="upp-ed-display-name" spellcheck="false" value="${escapeHtml(d.displayName || '')}" placeholder="例如按剧情换姓后的全名" />
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
              <textarea class="upp-textarea" id="upp-ed-content" spellcheck="false" style="flex:1;min-height:120px;" ${readOnly ? 'readonly' : ''}>${escapeHtml(d.content || '')}</textarea>
            </div>
          </div>
          <div class="upp-drawer-foot">
            <button type="button" class="upp-btn" data-drawer-close>${d.returnTo ? '返回' : '关闭'}</button>
            ${!readOnly ? `<button type="button" class="upp-btn primary" id="upp-ed-save-btn">保存</button>` : ''}
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
            <button type="button" class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            <div class="upp-field">
              <label>快照名称</label>
              <div class="upp-row-nowrap">
                <input type="text" class="upp-text-input" id="upp-ss-name" spellcheck="false" placeholder="例如：角色名 · 日常线" value="${escapeHtml(d.name || '')}" />
                <button type="button" class="upp-btn" id="upp-ss-name-clear">清空</button>
              </div>
              <div class="upp-pill-strip" id="upp-ss-name-suggestions">${renderSnapshotNameSuggestions(nameSuggestions)}</div>
              ${renderSnapshotRoutes(d.name)}
            </div>
            <div class="upp-field">
              <label>分组</label>
              <input type="text" class="upp-text-input" id="upp-ss-group" spellcheck="false" placeholder="可选，例如：日常 / 现代 / 角色名" value="${escapeHtml(d.group || '')}" />
              ${(existingGroups.length || state.charInfo.name) ? `
                <div class="upp-pill-strip" style="margin-top:4px;">
                  ${state.charInfo.name && !existingGroups.includes(state.charInfo.name) ? `<button type="button" class="upp-pill" data-ss-fill-group="${escapeHtml(state.charInfo.name)}">角色：${escapeHtml(state.charInfo.name)}</button>` : ''}
                  ${existingGroups.map(g => `<button type="button" class="upp-pill" data-ss-fill-group="${escapeHtml(g)}">${escapeHtml(g)}</button>`).join('')}
                </div>
              ` : ''}
            </div>
            <div class="upp-field">
              <label>备注</label>
              <input type="text" class="upp-text-input" id="upp-ss-note" spellcheck="false" placeholder="可选简短说明，悬浮球中会直接展示" value="${escapeHtml(d.note || '')}" />
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
              <div class="upp-input-wrap" style="width:100%;flex:0 0 auto;">
                ${ICONS.search}
                <input type="text" id="upp-ss-book-search" spellcheck="false" placeholder="搜索世界书名称、角色名或分组…" value="${escapeHtml(d.bookQuery || '')}" />
              </div>
              <div class="upp-pop-list" id="upp-ss-books-list"></div>
            </div>
          </div>
          <div class="upp-drawer-foot">
            <button type="button" class="upp-btn" data-drawer-close>取消</button>
            <button type="button" class="upp-btn primary" id="upp-ss-confirm-btn">保存快照</button>
          </div>
        </div>
      `;
      renderSaveSnapshotBooksList(d);
      if (canAutoFocusDesktop()) window.setTimeout(() => focusDesktopSafe(shadow.getElementById('upp-ss-name')), 10);
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
            <button type="button" class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
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
            <button type="button" class="upp-btn" data-drawer-close>取消</button>
            <button type="button" class="upp-btn primary" id="upp-confirm-overwrite-btn">确认覆盖更新</button>
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
            <button type="button" class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-tabs" style="padding:7px 14px;">
            <button type="button" class="upp-tab ${tab === 'char' ? 'active' : ''}" data-bind-tab="char"><span>按角色绑定</span></button>
            <button type="button" class="upp-tab ${tab === 'chat' ? 'active' : ''}" data-bind-tab="chat"><span>按角色扫描聊天档</span></button>
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
                <input type="text" id="upp-bind-char-search" spellcheck="false" placeholder="搜索角色名称，可绑定角色默认或点击扫聊天档…" value="${escapeHtml(d.charQuery || '')}" />
              </div>
              <div class="upp-pop-list is-fill" id="upp-bind-char-list"></div>
            ` : `
              <div class="upp-input-wrap" style="width:100%;flex:0 0 auto;">
                ${ICONS.search}
                <input type="text" id="upp-bind-chat-char-search" spellcheck="false" placeholder="搜索角色名称，快速定位下方角色…" value="${escapeHtml(d.chatCharQuery || '')}" />
              </div>
              <div class="upp-pill-strip" id="upp-bind-chat-char-picks" hidden></div>
              <div class="upp-row">
                <select class="upp-select" id="upp-bind-chat-char-sel" style="flex:1;min-width:0;max-width:100%;"></select>
                <button type="button" class="upp-btn" id="upp-bind-rescan-btn" ${d.scanCharAvatar ? '' : 'disabled'}>${ICONS.refresh}<span>扫描</span></button>
              </div>
              <div class="upp-input-wrap" style="width:100%;flex:0 0 auto;">
                ${ICONS.search}
                <input type="text" id="upp-bind-chat-search" spellcheck="false" placeholder="筛选聊天档名称或消息片段…" value="${escapeHtml(d.chatQuery || '')}" />
              </div>
              <div class="upp-pop-list is-fill" id="upp-bind-chat-list"></div>
            `}
          </div>
          <div class="upp-drawer-foot">
            <button type="button" class="upp-btn primary" data-drawer-close>完成</button>
          </div>
        </div>
      `;
      if (tab === 'char') renderBindCharList(d);
      else { renderBindChatCharOptions(d); renderBindChatList(d); }
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
      const hasTargetGroups = Array.isArray(d.targetPresetNorm?.groups) && d.targetPresetNorm.groups.length > 0;

      elDrawerMask.innerHTML = `
        <div class="upp-drawer is-fixed-box">
          <div class="upp-drawer-head">
            <div class="upp-row-nowrap" style="min-width:0;">
              <span>预设升级与批量同步</span>
              <span class="upp-badge ${isUpgrade ? 'accent' : 'ok'}">${isUpgrade ? '跨版本迁移' : '同预设同步'}</span>
            </div>
            <button type="button" class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
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
                <button type="button" class="upp-pill" style="height:22px;font-size:var(--upp-fs-xs);padding:0 8px;" id="upp-ps-toggle-all-snaps">${allSnapsSelected ? '取消全选' : '全选'}</button>
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

            <div class="upp-group-box upp-ps-ov-box ${d.overrideExpanded ? '' : 'is-collapsed'}">
              <div class="upp-group-head upp-ps-ov-head">
                <button type="button" class="upp-group-toggle-btn" id="upp-ps-ov-toggle" aria-expanded="${d.overrideExpanded}">
                  <span class="upp-group-chev">${ICONS.chevron}</span>
                  <span class="upp-group-name">可选：批量覆盖已有开关</span>
                  <span class="upp-badge accent" id="upp-ps-ov-count-badge" ${ovPromptCount + ovGroupCount ? '' : 'hidden'}>已选 ${ovPromptCount + ovGroupCount}</span>
                </button>
              </div>
              <div class="upp-group-items">
                <div class="upp-input-wrap" style="width:100%;">
                  ${ICONS.search}
                  <input type="text" id="upp-ps-ov-search" spellcheck="false" placeholder="筛选要批量覆盖的已有分组或条目…" value="${escapeHtml(d.overrideSearch || '')}" />
                </div>
                <div class="upp-ps-ov-scroll" id="upp-ps-ov-scroll"><div id="upp-ps-ov-list"></div></div>
              </div>
            </div>

          </div>
          <div class="upp-check-grid upp-ps-sync-options" style="${hasTargetGroups ? '' : 'grid-template-columns:minmax(0, 1fr);'}">
            <label class="upp-check-item">
              <input type="checkbox" id="upp-ps-clean-removed" ${d.cleanRemovedIds ? 'checked' : ''} />
              <span>清理新预设已删除的旧条目残留</span>
            </label>
            ${hasTargetGroups ? `
              <label class="upp-check-item">
                <input type="checkbox" id="upp-ps-sync-groups" ${d.syncNewGroups ? 'checked' : ''} />
                <span>同步新预设的新增分组总开关</span>
              </label>
            ` : ''}
          </div>
          <div class="upp-drawer-foot">
            <button type="button" class="upp-btn" data-drawer-close>取消</button>
            <button type="button" class="upp-btn primary" id="upp-ps-run-btn" ${selSet.size ? '' : 'disabled'}>${isUpgrade ? `迁移并同步 ${selSet.size} 份快照` : `同步到 ${selSet.size} 份快照`}</button>
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
            <button type="button" class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            <div class="upp-row">
              <button type="button" class="upp-btn primary" id="upp-export-json-btn">导出全部 JSON</button>
              <button type="button" class="upp-btn" id="upp-import-json-btn">导入 JSON 备份</button>
              <input type="file" id="upp-import-file" accept=".json,application/json" hidden />
            </div>
            <div class="upp-card-meta">包含所有快照、绑定关系及 User 内部描述版本，导入后将与当前列表合并更新。</div>
            <div class="upp-field">
              <label>应用快照时的全局世界书</label>
              <select class="upp-select" id="upp-global-books-mode">
                <option value="ask" ${(resolveGlobalBooksMode(state.store) === 'ask') ? 'selected' : ''}>每次询问（默认）</option>
                <option value="merge" ${(resolveGlobalBooksMode(state.store) === 'merge') ? 'selected' : ''}>总是保留我自己挂的书</option>
                <option value="replace" ${(resolveGlobalBooksMode(state.store) === 'replace') ? 'selected' : ''}>总是按快照覆盖</option>
              </select>
            </div>
            <div class="upp-card-meta">只影响「应用快照」时对全局世界书绑定的处理，不动条目开关。自动切回快照时永远不会静默关掉你自己挂的书。</div>
          </div>
          <div class="upp-drawer-foot">
            <button type="button" class="upp-btn" data-drawer-close>关闭</button>
          </div>
        </div>
      `;
    }
  }

  // 应用快照前问一次全局书处理方式；用户点完才继续（取消＝一个字都不改）
  confirmGlobalBooksHook = (snap, diff, silentPrefix) => new Promise(resolve => {
    state.drawer = {
      type: 'globalBooksConfirm',
      snapshotId: snap.id,
      snapshotName: snap.name || '',
      diff,
      silentPrefix,
      resolve,
    };
    renderDrawer();
  });

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
    if (!Array.isArray(d.selectedSnapIds)) {
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
    const newPromptIds = new Set(d.analysis.newPrompts.map(prompt => prompt.id));
    for (const prompt of tgtNorm?.prompts || []) {
      if (newPromptIds.has(prompt.id)) delete d.forceOverridePrompts[prompt.id];
    }
  }

  function resetPresetOverrides(d) {
    d.forceOverridePrompts = Object.create(null);
    d.forceOverrideGroups = Object.create(null);
    d.overrideCollapsed = new Set();
  }

  function openExternalOrganizerPanel() {
    if (!hasActiveOrganizer()) {
      toast('未检测到已启用的世界书分组扩展，可直接使用当前面板管理世界书', 'info');
      render();
      return false;
    }
    emitWindowEvent('wbo:open-panel');
    const overlay = typeof document !== 'undefined' ? document.getElementById('wbo-manager-overlay') : null;
    if (overlay && !overlay.hidden) {
      closeModal();
      return true;
    }
    toast('未能唤起世界书分组面板，请确认该扩展已就绪', 'warning');
    return false;
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
      overrideExpanded: false,
      overrideSearch: '',
      cleanRemovedIds: true,
      syncNewGroups: true,
    };
    resetPresetOverrides(d);
    recomputePresetSyncAnalysis(d);
    state.drawer = d;
    renderDrawer();
  }

  function snapshotNames(context, group) {
    return suggestSnapshotNames({ ...context, group, existingNames: state.store.snapshots.map(s => s.name) });
  }

  function buildSnapshotDraft(group, context) {
    const { primary, suggestions } = snapshotNames(context, group);
    return {
      type: 'saveSnapshot',
      name: primary,
      autoName: primary,
      nameSuggestions: suggestions,
      namingContext: context,
      group,
      note: '',
      scope: { ...state.store.settings.defaultSnapshotScope },
    };
  }

  function renderSnapshotNameSuggestions(names) {
    return names.map(name => `<button type="button" class="upp-pill" data-ss-fill-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join('');
  }

  function renderSnapshotRoutes(name) {
    const activeRoute = splitSnapshotRoute(name).route;
    return `<div class="upp-pill-strip upp-snapshot-routes" role="group" aria-label="路线后缀">
      ${SNAPSHOT_ROUTES.map(route => `<button type="button" class="upp-pill ${route === activeRoute ? 'active' : ''}" aria-pressed="${route === activeRoute}" data-snapshot-route="${route}">${route}</button>`).join('')}
    </div>`;
  }

  function syncSnapshotRouteButtons(root, name) {
    const { route } = splitSnapshotRoute(name);
    for (const button of root.querySelectorAll('[data-snapshot-route]')) {
      const active = button.dataset.snapshotRoute === route;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  function toggleSnapshotRoute(root, nameInput, nextRoute) {
    const { base, route } = splitSnapshotRoute(nameInput.value);
    nameInput.value = nameWithSnapshotRoute(base, route === nextRoute ? '' : nextRoute);
    syncSnapshotRouteButtons(root, nameInput.value);
  }

  function updateSnapshotNaming(draft, group, nameInput, root) {
    const name = splitSnapshotRoute(nameInput.value);
    const { primary, suggestions } = snapshotNames(draft.namingContext, group);
    if (!name.base || name.base === draft.autoName) {
      nameInput.value = nameWithSnapshotRoute(primary, name.route);
      draft.autoName = splitSnapshotRoute(nameInput.value).base;
    }
    draft.group = group;
    draft.name = nameInput.value;
    draft.nameSuggestions = suggestions;
    const list = shadow.getElementById('upp-ss-name-suggestions');
    if (root === elDrawerMask && list) list.innerHTML = renderSnapshotNameSuggestions(suggestions);
    syncSnapshotRouteButtons(root, nameInput.value);
  }

  function openSaveSnapshotDrawer() {
    state.drawer = buildSnapshotDraft(state.snapGroup || state.charInfo.name || '', {
      charName: state.charInfo.name,
      personaName: state.currentPersona?.name,
      presetName: state.loadedPresetName,
    });
    state.drawer.selectedBooks = getDefaultSnapshotBooks(state.store);
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
    const regexDetails = (snap.scope.regex && snap.regex && isRegexModuleEnabled())
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
      editingMeta: false,
      metaDraft: null,
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
    await applySnapshotLive(snap, state.store, undefined, { interactive: true });
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
    if (next !== 'user') {
      state.userView = 'main';
      state.userInlineEditor = null;
    }
    if (next === 'worldbook' && state.activeBook) await ensureBookEntries(state.activeBook, false);
    else if (next === 'regex') state.regexList = await Host.getRegexes(state.regexScope);
    else if (next === 'preset') {
      state.presets = Host.listPresets();
      state.loadedPresetName = Host.getLoadedPresetName();
      syncPresetViewData();
    } else if (next === 'user') {
      state.personas = Host.listPersonas();
      state.currentPersona = Host.getCurrentPersona();
      if (state.viewPersonaId && (!state.personas.some(p => p.avatar_id === state.viewPersonaId)
        || state.viewPersonaId === state.currentPersona?.avatar_id)) {
        state.viewPersonaId = '';
        state.personaSwitchConfirm = false;
      }
    }
    render();
    syncNativePersonaBar();
  });

  elToolbar.addEventListener('click', async ev => {
    const target = ev.target;

    if (target.closest('#upp-auto-bind-sw')) {
      state.store.settings.autoApplyBindings = !state.store.settings.autoApplyBindings;
      persistStore(state.store);
      const sw = shadow.getElementById('upp-auto-bind-sw');
      if (sw) sw.setAttribute('aria-checked', String(state.store.settings.autoApplyBindings));
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
      state.userView = 'main';
      state.userSearch = '';
      state.userInlineEditor = state.userInlineEditor === 'rename' ? null : 'rename';
      renderUserToolbar(); renderUserBody();
      if (state.userInlineEditor === 'rename' && canAutoFocusDesktop()) {
        window.setTimeout(() => focusDesktopSafe(shadow.getElementById('upp-rename-input')), 10);
      }
      return;
    }
    if (target.closest('#upp-persona-edit-btn') && state.currentPersona) {
      state.userView = 'main';
      state.userSearch = '';
      state.userInlineEditor = state.userInlineEditor === 'body' ? null : 'body';
      renderUserToolbar(); renderUserBody();
      if (state.userInlineEditor === 'body' && canAutoFocusDesktop()) {
        window.setTimeout(() => focusDesktopSafe(shadow.getElementById('upp-user-body-ta')), 10);
      }
      return;
    }
    if (target.closest('#upp-persona-savever-btn') && state.currentPersona) {
      state.userView = 'main';
      state.userSearch = '';
      state.userInlineEditor = state.userInlineEditor === 'savever' ? null : 'savever';
      renderUserToolbar(); renderUserBody();
      if (state.userInlineEditor === 'savever' && canAutoFocusDesktop()) {
        window.setTimeout(() => focusDesktopSafe(shadow.getElementById('upp-pv-name')), 10);
      }
      return;
    }
    if (target.closest('#upp-persona-diff-btn') && state.currentPersona) {
      if (state.userView === 'diff') {
        state.userView = 'main';
      } else {
        const list = state.store.personaVersions[state.currentPersona.avatar_id] || [];
        state.userDiff = { leftId: list[0]?.id || '__live__', rightId: '__live__' };
        state.userView = 'diff';
        state.userInlineEditor = null;
      }
      renderUserToolbar(); renderUserBody(); return;
    }
    if (target.closest('#upp-persona-merge-btn')) {
      if (state.userView === 'merge') {
        state.userView = 'main';
        renderUserToolbar(); renderUserBody();
        return;
      }
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
      state.userMerge = {
        keepId,
        absorbIds,
        deleteOld: false,
        orphanAvatars,
        query: '',
        previewIds: new Set(),
        showKeepPreview: false,
      };
      state.userView = 'merge';
      state.userInlineEditor = null;
      renderUserToolbar(); renderUserBody(); return;
    }

    if (target.closest('#upp-book-picker-btn')) { state.drawer = { type: 'bookPicker', query: '', foldMap: {} }; renderDrawer(); return; }
    if (target.closest('#upp-open-wbo-btn')) {
      openExternalOrganizerPanel();
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
      const book = state.activeBook;
      try {
        const uid = await Host.createWorldbookEntry(book, { name: '新条目', content: '', strategyType: 'constant' });
        await ensureBookEntries(book, true);
        if (state.tab === 'worldbook' && state.activeBook === book) {
          state.wbEntrySearch = '';
          state.expandedWbUids.add(uid);
          renderWorldbookToolbar();
          renderWorldbookBody({ preservePanels: true });
          locateWorldbookRow(uid, true);
        }
        toast('已新建条目', 'success');
      } catch (err) { toast('新建失败：' + (err?.message || err), 'error'); }
      return;
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
      // 只翻转当前真正渲染出来的分组（搜索/只看已开过滤后），否则只看已开里点折叠等于没点
      const groupNodes = visiblePresetGroupNodes();
      const anyExpanded = groupNodes.some(n => !presetNodeCollapsed(n));
      groupNodes.forEach(n => { state.presetFoldState[presetFoldKey(n.group.id)] = anyExpanded; });
      renderPresetToolbar(); renderPresetBody(); return;
    }
    if (target.closest('#upp-preset-default-fold-sw')) {
      const next = !(state.store.settings.presetGroupsDefaultCollapsed !== false);
      state.store.settings.presetGroupsDefaultCollapsed = next;
      persistStore(state.store);
      state.presetFoldState = {};
      renderPresetToolbar(); renderPresetBody();
      toast(next ? '已设为预设分组默认折叠' : '已改为按预设自身展开状态显示');
      return;
    }
    if (target.closest('#upp-preset-sync-btn')) {
      openPresetSyncDrawer({ targetPreset: state.loadedPresetName });
      return;
    }
    if (target.closest('#upp-preset-save-disk-btn')) {
      // 写回原生预设文件是覆盖动作：先弹确认，不直接写盘
      if (isViewingForeignPreset()) { toast('正在查看非当前预设，先「设为当前使用」再保存', 'warning'); return; }
      state.presetDiskSaveConfirm = true;
      renderPresetBody();
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
      if (state.userView !== 'main') return;
      state.userSearch = targetEl.value;
      if (normalizeText(state.userSearch) && state.userInlineEditor) {
        state.userInlineEditor = null;
        shadow.getElementById('upp-persona-rename-btn')?.classList.remove('active');
        shadow.getElementById('upp-persona-edit-btn')?.classList.remove('active');
        shadow.getElementById('upp-persona-savever-btn')?.classList.remove('active');
      }
      const clr = shadow.getElementById('upp-user-search-clear-btn');
      if (clr) clr.hidden = !state.userSearch || state.userView !== 'main';
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
      const curId = state.currentPersona?.avatar_id || '';
      if (!targetId) return;
      // 下拉只改“正在查看”的对象，不碰酒馆当前 User
      state.viewPersonaId = (targetId === curId) ? '' : targetId;
      state.personaSwitchConfirm = false;
      state.userInlineEditor = null;
      renderUserToolbar(); renderUserBody(); renderFooter();
      if (state.viewPersonaId) toast('正在查看该 User，酒馆当前 User 未改变', 'info');
      return;
    }
    if (ev.target.id === 'upp-preset-select') {
      const targetPreset = ev.target.value;
      const curName = Host.getLoadedPresetName();
      state.loadedPresetName = curName;
      if (!targetPreset) return;
      if (targetPreset === curName) {
        // 选回酒馆当前预设＝结束查看，不需要任何确认
        state.viewPresetName = '';
        state.presetUseConfirm = false;
        state.livePresetNorm = Host.getLiveNormalizedPreset();
        state.expandedPresetIds.clear();
        renderPresetToolbar(); renderPresetBody(); renderFooter();
        return;
      }
      // 查看别的预设：只读读取，绝不调用 selectPresetByName
      const norm = Host.getPresetByNameNormalized(targetPreset);
      if (!norm) {
        toast('读取不到该预设的条目，未做任何切换', 'warning');
        renderPresetToolbar();
        return;
      }
      state.viewPresetName = targetPreset;
      state.presetUseConfirm = false;
      state.livePresetNorm = norm;
      state.expandedPresetIds.clear();
      renderPresetToolbar(); renderPresetBody(); renderFooter();
      toast(`正在查看预设「${targetPreset}」，酒馆当前预设未改变`, 'info');
      return;
    }
  });

  function handleBodyInput(targetEl) {
    if (!targetEl) return;
    if (state.tab === 'user' && state.userView === 'merge' && targetEl.id === 'upp-merge-search') {
      state.userMerge.query = targetEl.value;
      renderMergeCandidateList(state.userMerge);
    }
  }
  elBody.addEventListener('compositionstart', ev => {
    if (ev.target) ev.target._uppComposing = true;
  });
  elBody.addEventListener('compositionend', ev => {
    if (ev.target) {
      ev.target._uppComposing = false;
      handleBodyInput(ev.target);
    }
  });
  elBody.addEventListener('input', ev => {
    if (ev.isComposing || ev.target?._uppComposing) return;
    handleBodyInput(ev.target);
  });

  elBody.addEventListener('change', ev => {
    const t = ev.target;
    if (state.tab === 'user' && state.userView === 'main' && t.id === 'upp-pv-overwrite-sel' && state.currentPersona) {
      const aid = state.currentPersona.avatar_id;
      const list = state.store.personaVersions[aid] || [];
      const ver = list.find(v => v.id === t.value);
      const nameInp = shadow.getElementById('upp-pv-name');
      const dnInp = shadow.getElementById('upp-pv-display-name');
      if (ver) {
        if (nameInp) nameInp.value = ver.name || '';
        if (dnInp) dnInp.value = ver.displayName || '';
      }
      return;
    }
    if (state.tab === 'user' && state.userView === 'diff') {
      if (t.id === 'upp-diff-left') { state.userDiff.leftId = t.value; renderUserDiffView(); }
      else if (t.id === 'upp-diff-right') { state.userDiff.rightId = t.value; renderUserDiffView(); }
      return;
    }
    if (state.tab === 'user' && state.userView === 'merge') {
      const m = state.userMerge;
      if (t.id === 'upp-merge-keep') {
        m.keepId = t.value;
        m.absorbIds = (m.absorbIds || []).filter(id => id !== m.keepId);
        renderUserMergeView();
      } else if (t.hasAttribute('data-merge-absorb')) {
        const aid = t.getAttribute('data-merge-absorb');
        const set = new Set(m.absorbIds || []);
        if (t.checked) set.add(aid); else set.delete(aid);
        m.absorbIds = Array.from(set);
        t.closest('.upp-merge-row')?.classList.toggle('is-checked', t.checked);
        const keepObj = state.personas.find(p => p.avatar_id === m.keepId);
        const existingVersions = keepObj ? (state.store.personaVersions[keepObj.avatar_id] || []) : [];
        const plan = buildPersonaMergePlan(state.personas, m.keepId, m.absorbIds, existingVersions);
        const listEl = shadow.getElementById('upp-merge-candidate-list');
        const st = listEl ? listEl.scrollTop : 0;
        renderMergeCandidateList(m, plan);
        if (listEl) listEl.scrollTop = st;
        renderUserMergePlanSection(m, plan);
      } else if (t.id === 'upp-merge-delete-old') {
        m.deleteOld = !!t.checked;
        const keepObj = state.personas.find(p => p.avatar_id === m.keepId);
        const existingVersions = keepObj ? (state.store.personaVersions[keepObj.avatar_id] || []) : [];
        const plan = buildPersonaMergePlan(state.personas, m.keepId, m.absorbIds, existingVersions);
        renderUserMergePlanSection(m, plan);
      }
    }
  });

  elBody.addEventListener('click', async ev => {
    const t = ev.target;
    if (t.closest('[data-open-save-snap]')) { openSaveSnapshotDrawer(); return; }

    // 预设：查看中 → 设为当前使用 / 看回当前 / 写回预设文件确认
    if (t.closest('#upp-preset-use-btn')) {
      if (!isViewingForeignPreset()) return;
      state.presetUseConfirm = true;
      renderPresetBody();
      return;
    }
    if (t.closest('#upp-preset-use-cancel')) {
      state.presetUseConfirm = false;
      renderPresetBody();
      return;
    }
    if (t.closest('#upp-preset-view-back-btn')) {
      state.viewPresetName = '';
      state.presetUseConfirm = false;
      state.livePresetNorm = Host.getLiveNormalizedPreset();
      state.expandedPresetIds.clear();
      renderPresetToolbar(); renderPresetBody(); renderFooter();
      return;
    }
    if (t.closest('#upp-preset-use-confirm')) {
      const target = state.viewPresetName;
      state.presetUseConfirm = false;
      if (!target || !isViewingForeignPreset()) { renderPresetBody(); return; }
      try {
        const ok = await Host.selectPresetByName(target);
        if (!ok) { toast('切换失败：酒馆未找到该预设', 'error'); renderPresetBody(); return; }
        state.viewPresetName = '';
        state.loadedPresetName = Host.getLoadedPresetName();
        state.livePresetNorm = Host.getLiveNormalizedPreset();
        state.expandedPresetIds.clear();
        renderPresetToolbar(); renderPresetBody(); renderFooter();
        toast('已切换预设为「' + target + '」', 'success');
      } catch (err) {
        toast('切换失败：' + (err?.message || err), 'error');
        renderPresetBody();
      }
      return;
    }
    if (t.closest('#upp-preset-disk-save-cancel')) {
      state.presetDiskSaveConfirm = false;
      renderPresetBody();
      return;
    }
    if (t.closest('#upp-preset-disk-save-confirm')) {
      state.presetDiskSaveConfirm = false;
      try {
        await Host.saveActivePresetToDisk();
        toast(`已将开关与分组写入预设文件「${state.loadedPresetName}」`, 'success');
      } catch (err) {
        toast('保存预设失败：' + (err?.message || err), 'error');
      }
      renderPresetBody();
      return;
    }

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
      const curId = state.currentPersona?.avatar_id || '';
      if (targetId && targetId !== curId) {
        // 列表里的“切换”也只进入查看 + 二次确认，不直接改宿主
        state.viewPersonaId = targetId;
        state.personaSwitchConfirm = true;
        state.userInlineEditor = null;
        renderUserToolbar(); renderUserBody(); renderFooter();
      }
      return;
    }

    if (t.closest('#upp-persona-use-btn')) {
      if (!isViewingForeignPersona()) return;
      state.personaSwitchConfirm = true;
      renderUserBody();
      return;
    }
    if (t.closest('#upp-persona-use-cancel')) {
      state.personaSwitchConfirm = false;
      renderUserBody();
      return;
    }
    if (t.closest('#upp-persona-view-back-btn')) {
      state.viewPersonaId = '';
      state.personaSwitchConfirm = false;
      renderUserToolbar(); renderUserBody(); renderFooter();
      return;
    }
    if (t.closest('#upp-persona-use-confirm')) {
      const targetId = state.viewPersonaId;
      state.personaSwitchConfirm = false;
      if (!targetId || !isViewingForeignPersona()) { renderUserBody(); return; }
      try {
        await Host.switchPersona(targetId);
        state.viewPersonaId = '';
        state.personas = Host.listPersonas();
        state.currentPersona = Host.getCurrentPersona();
        state.userInlineEditor = null;
        renderHeader(); renderUserToolbar(); renderUserBody(); renderFooter();
        syncNativePersonaBar();
        toast(`已切换 User：${state.currentPersona?.name || ''}`, 'success');
      } catch (err) {
        toast('切换 User 失败：' + (err?.message || err), 'error');
        renderUserBody();
      }
      return;
    }

    // User inline rename & body editing (R3: in-place, zero popup)
    if (t.closest('#upp-rename-clear-btn')) {
      const inp = shadow.getElementById('upp-rename-input');
      if (inp) { inp.value = ''; focusDesktopSafe(inp); }
      return;
    }
    if (t.closest('#upp-rename-cancel-btn')) {
      state.userInlineEditor = null;
      renderUserToolbar(); renderUserBody();
      return;
    }
    if (t.closest('#upp-rename-confirm-btn, [data-user-rename-save]') && state.currentPersona) {
      const nextName = (shadow.getElementById('upp-rename-input')?.value || '').trim();
      if (!nextName) { toast('请输入新的 User 名字', 'warning'); return; }
      try {
        await Host.renamePersonaInPlace(state.currentPersona.avatar_id, nextName);
        state.personas = Host.listPersonas();
        state.currentPersona = Host.getCurrentPersona();
        state.userInlineEditor = null;
        render();
        syncNativePersonaBar();
        toast(`已将当前 User 改名为「${nextName}」`, 'success');
      } catch (err) {
        toast('改名失败：' + (err?.message || err), 'error');
      }
      return;
    }
    if (t.closest('#upp-persona-preview-box') && state.currentPersona) {
      state.userInlineEditor = 'body';
      renderUserToolbar(); renderUserBody();
      if (canAutoFocusDesktop()) {
        window.setTimeout(() => focusDesktopSafe(shadow.getElementById('upp-user-body-ta')), 10);
      }
      return;
    }
    if (t.closest('#upp-user-body-cancel-btn')) {
      state.userInlineEditor = null;
      renderUserToolbar(); renderUserBody();
      return;
    }
    if (t.closest('#upp-pv-dn-clear-btn')) {
      const inp = shadow.getElementById('upp-pv-display-name');
      if (inp) { inp.value = ''; focusDesktopSafe(inp); }
      return;
    }
    if (t.closest('#upp-pv-cancel-btn')) {
      state.userInlineEditor = null;
      renderUserToolbar(); renderUserBody();
      return;
    }
    if (t.closest('#upp-pv-save-btn') && state.currentPersona) {
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
      state.userInlineEditor = null;
      render();
      syncNativePersonaBar();
      toast(`已保存内部版本「${item.name}」`, 'success');
      return;
    }
    if (t.closest('[data-user-body-save], [data-persona-body-save]') && state.currentPersona) {
      const content = shadow.getElementById('upp-user-body-ta')?.value ?? '';
      try {
        await Host.updatePersonaInPlace(state.currentPersona.avatar_id, content);
        state.personas = Host.listPersonas();
        state.currentPersona = Host.getCurrentPersona();
        state.userInlineEditor = null;
        render();
        syncNativePersonaBar();
        toast('已保存 User 正文', 'success');
      } catch (err) {
        toast('保存失败：' + (err?.message || err), 'error');
      }
      return;
    }

    // User Diff & Merge subviews + Undo + Release-to-Native
    if (t.closest('#upp-diff-back-btn') || t.closest('#upp-merge-back-btn') || t.closest('#upp-merge-cancel-btn')) {
      state.userView = 'main';
      renderUserToolbar(); renderUserBody();
      return;
    }
    if (t.closest('#upp-merge-keep-preview-btn') && state.userView === 'merge') {
      state.userMerge.showKeepPreview = !state.userMerge.showKeepPreview;
      renderUserMergeView();
      return;
    }
    const mergePrevBtn = t.closest('[data-merge-preview]');
    if (mergePrevBtn && state.userView === 'merge') {
      const aid = mergePrevBtn.getAttribute('data-merge-preview');
      if (aid) {
        const m = state.userMerge;
        if (!m.previewIds) m.previewIds = new Set();
        const listEl = shadow.getElementById('upp-merge-candidate-list');
        const st = listEl ? listEl.scrollTop : 0;
        if (m.previewIds.has(aid)) m.previewIds.delete(aid);
        else m.previewIds.add(aid);
        renderMergeCandidateList(m);
        if (listEl) listEl.scrollTop = st;
      }
      return;
    }
    if (t.closest('#upp-clean-orphans-btn') && state.userView === 'merge') {
      const list = Array.isArray(state.userMerge.orphanAvatars) ? [...state.userMerge.orphanAvatars] : [];
      let cleaned = 0;
      for (const aid of list) {
        try { if (await Host.deletePersonaById(aid)) cleaned++; } catch (_) {}
      }
      state.userMerge.orphanAvatars = await Host.listOrphanAvatars();
      await refreshAll(false);
      syncNativePersonaBar();
      toast(`已彻底清理 ${cleaned} 个未命名残留头像`, 'success');
      return;
    }
    const mergeGrpBtn = t.closest('[data-merge-preset-group]');
    if (mergeGrpBtn && state.userView === 'merge') {
      const g = detectProliferatedPersonas(state.personas)[Number(mergeGrpBtn.getAttribute('data-merge-preset-group'))];
      if (g) {
        state.userMerge.keepId = g.items[0].avatar_id;
        state.userMerge.absorbIds = g.items.slice(1).map(x => x.avatar_id);
        renderUserMergeView();
      }
      return;
    }
    if (t.closest('#upp-merge-run-btn') && state.userView === 'merge') {
      const m = state.userMerge;
      const existingVersions = state.store.personaVersions[m.keepId] || [];
      const plan = buildPersonaMergePlan(state.personas, m.keepId, m.absorbIds, existingVersions);
      if (!plan.keepPersona || !plan.candidates.length) return;
      const versionsBackup = structuredClone(existingVersions);
      const deletedPersonas = [];
      let deleted = 0;
      let deleteFailed = 0;
      if (m.deleteOld) {
        for (const c of plan.candidates) {
          const avatarBlob = await Host.fetchPersonaAvatarBlob(c.avatar_id);
          try {
            const ok = await Host.deletePersonaById(c.avatar_id);
            if (ok) {
              deleted++;
              deletedPersonas.push({
                avatarId: c.avatar_id,
                name: c.name,
                versionName: c.versionName,
                displayName: c.displayName,
                description: c.description,
                lorebook: c.lorebook,
                avatarBlob,
                wasDefaultPersona: power_user?.default_persona === c.avatar_id,
                wasChatPersona: chat_metadata?.persona === c.avatar_id,
              });
            } else {
              deleteFailed++;
            }
          } catch (_) {
            deleteFailed++;
          }
        }
      }
      state.store.personaVersions[plan.keepPersona.avatar_id] = applyPersonaMergeToVersions(existingVersions, plan.candidates, {
        keepPersona: plan.keepPersona,
        includeKeepBackup: true,
      });
      if (deletedPersonas.some(dp => dp.avatarId === user_avatar) && power_user?.personas?.[plan.keepPersona.avatar_id]) {
        try { await Host.switchPersona(plan.keepPersona.avatar_id); } catch (_) {}
      }
      state.lastPersonaMergeUndo = {
        keepAvatarId: plan.keepPersona.avatar_id,
        keepName: plan.keepPersona.name,
        versionsBackup,
        deletedPersonas,
        absorbedCount: plan.candidates.length,
        label: `「${plan.keepPersona.name}」收纳 ${plan.candidates.length} 个分身`,
      };
      persistStore(state.store);
      state.userView = 'main';
      await refreshAll(false);
      syncNativePersonaBar();
      if (deleteFailed > 0) {
        toast(
          deleted > 0
            ? `已收纳 ${plan.candidates.length} 个分身并移除 ${deleted} 个旧 User（另有 ${deleteFailed} 个移出失败，已保留在原生列表）`
            : `已收纳 ${plan.candidates.length} 个分身为内部版本，但 ${deleteFailed} 个旧 User 移出失败（已保留在原生列表）`,
          'warning',
        );
      } else {
        toast(deleted > 0 ? `已收纳 ${plan.candidates.length} 个分身并移除 ${deleted} 个旧 User（可随时撤销）` : `已收纳 ${plan.candidates.length} 个分身为「${plan.keepPersona.name}」的内部版本`, 'success');
      }
      return;
    }
    if (t.closest('#upp-merge-undo-btn') && state.lastPersonaMergeUndo) {
      const undo = state.lastPersonaMergeUndo;
      let restoredNative = 0;
      const failedRestores = [];
      for (const dp of (undo.deletedPersonas || [])) {
        try {
          const newId = await Host.createNativePersona({
            name: dp.name,
            description: dp.description,
            lorebook: dp.lorebook,
            avatarBlob: dp.avatarBlob,
            overwriteName: dp.avatarId,
          });
          if (dp.wasDefaultPersona) power_user.default_persona = newId;
          if (dp.wasChatPersona && chat_metadata) chat_metadata.persona = newId;
          restoredNative++;
        } catch (_) {
          failedRestores.push(dp);
        }
      }
      if (restoredNative > 0) saveSettingsDebounced();
      const restoredVersions = restorePersonaMergeVersions(undo.versionsBackup);
      if (failedRestores.length === 0) {
        if (restoredVersions.length) {
          state.store.personaVersions[undo.keepAvatarId] = restoredVersions;
        } else {
          delete state.store.personaVersions[undo.keepAvatarId];
        }
        state.lastPersonaMergeUndo = null;
      } else {
        state.store.personaVersions[undo.keepAvatarId] = applyPersonaMergeToVersions(
          restoredVersions,
          failedRestores.map(dp => ({
            avatar_id: dp.avatarId,
            name: dp.name,
            versionName: dp.versionName || dp.name,
            displayName: dp.displayName ?? dp.name,
            description: dp.description,
            lorebook: dp.lorebook,
          })),
          { includeKeepBackup: false },
        );
        state.lastPersonaMergeUndo = {
          ...undo,
          deletedPersonas: failedRestores,
          label: `待恢复 ${failedRestores.length} 个原生 User（可重试撤销）`,
        };
      }
      persistStore(state.store);
      state.userView = 'main';
      await refreshAll(false);
      syncNativePersonaBar();
      if (failedRestores.length > 0) {
        toast(
          restoredNative > 0
            ? `已恢复 ${restoredNative} 个原生 User，仍有 ${failedRestores.length} 个恢复失败（已保留在内部版本中，可重试撤销）`
            : `恢复原生 User 失败（${failedRestores.length} 个已保留在内部版本中，可重试撤销）`,
          restoredNative > 0 ? 'warning' : 'error',
        );
      } else {
        toast(restoredNative > 0 ? `已撤销最近整理并恢复 ${restoredNative} 个原生 User` : '已撤销最近一次整理', 'success');
      }
      return;
    }

    const pvRelease = t.closest('[data-pv-release]');
    if (pvRelease && state.currentPersona) {
      const vid = pvRelease.getAttribute('data-pv-release');
      const list = state.store.personaVersions[state.currentPersona.avatar_id] || [];
      const ver = list.find(v => v.id === vid);
      if (ver) {
        try {
          const payload = buildReleaseVersionToNativePayload(ver, Host.listPersonas());
          const avatarBlob = await Host.fetchPersonaAvatarBlob(state.currentPersona.avatar_id);
          await Host.createNativePersona({ ...payload, avatarBlob });
          state.personas = Host.listPersonas();
          state.currentPersona = Host.getCurrentPersona();
          renderHeader(); renderUserToolbar(); renderUserBody(); renderFooter();
          syncNativePersonaBar();
          toast(`已将「${ver.name}」放回原生 User 列表（${payload.name}）`, 'success');
        } catch (err) {
          toast('放回原生失败：' + (err?.message || err), 'error');
        }
      }
      return;
    }

    const pvView = t.closest('[data-pv-view]');
    if (pvView && state.currentPersona) {
      const vid = pvView.getAttribute('data-pv-view');
      if (vid) {
        const scrollTop = elBody.scrollTop;
        if (state.expandedPvIds.has(vid)) state.expandedPvIds.delete(vid);
        else state.expandedPvIds.add(vid);
        renderUserBody();
        elBody.scrollTop = scrollTop;
      }
      return;
    }
    const pvInlineClose = t.closest('[data-pv-inline-close]');
    if (pvInlineClose) {
      const vid = pvInlineClose.getAttribute('data-pv-inline-close');
      if (vid) {
        const scrollTop = elBody.scrollTop;
        state.expandedPvIds.delete(vid);
        renderUserBody();
        elBody.scrollTop = scrollTop;
      }
      return;
    }
    const pvSave = t.closest('[data-pv-save]');
    if (pvSave && state.currentPersona) {
      const vid = pvSave.getAttribute('data-pv-save');
      const panel = pvSave.closest('.upp-inline-panel');
      const aid = state.currentPersona.avatar_id;
      const ver = (state.store.personaVersions[aid] || []).find(v => v.id === vid);
      if (ver && panel) {
        const nextName = (panel.querySelector('[data-pv-inline-name]')?.value || '').trim().slice(0, 60);
        const nextDn = (panel.querySelector('[data-pv-inline-dn]')?.value || '').trim().slice(0, 60);
        const nextDesc = panel.querySelector('[data-pv-inline-desc]')?.value ?? '';
        ver.name = nextName || ver.name;
        ver.displayName = nextDn;
        ver.description = nextDesc;
        ver.updatedAt = Date.now();
        persistStore(state.store);
        const scrollTop = elBody.scrollTop;
        renderUserToolbar(); renderUserBody();
        elBody.scrollTop = scrollTop;
        syncNativePersonaBar();
        toast('已更新内部版本', 'success');
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
        syncNativePersonaBar();
        toast(ver.displayName ? `已切换至「${ver.name}」（名字：${ver.displayName}）` : `已切换至「${ver.name}」`, 'success');
      }
      return;
    }
    const pvDelInline = t.closest('[data-pv-del-inline]');
    if (pvDelInline && state.currentPersona) {
      const vid = pvDelInline.getAttribute('data-pv-del-inline');
      const aid = state.currentPersona.avatar_id;
      state.expandedPvIds.delete(vid);
      state.store.personaVersions[aid] = (state.store.personaVersions[aid] || []).filter(v => v.id !== vid);
      persistStore(state.store); renderUserToolbar(); renderUserBody();
      syncNativePersonaBar();
      toast('已删除内部版本'); return;
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
      const book = state.activeBook;
      const u = wbSw.getAttribute('data-wb-toggle');
      const entry = (getCachedBookEntries(state.activeBook) || []).find(e => String(e.uid) === String(u));
      if (!entry) return;
      const next = !entry.enabled;
      entry.enabled = next;
      wbSw.setAttribute('aria-checked', String(next));
      wbSw.closest('.upp-entry-row')?.classList.toggle('is-on', next);
      try {
        await Host.toggleWorldbookEntry(book, u, next);
        if (state.tab === 'worldbook' && state.activeBook === book && (state.wbOnlyOn || entry.content.includes('<'))) {
          const scrollTop = elBody.scrollTop;
          renderWorldbookBody({ preservePanels: true });
          elBody.scrollTop = scrollTop;
        }
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
      const focusBefore = shadow.activeElement;
      const hadSearch = !!state.wbEntrySearch;
      if (hadSearch) {
        state.wbEntrySearch = '';
        // 就地清空搜索框，不重建工具栏：输入框节点、焦点与输入法合成态都不动
        const searchInput = shadow.getElementById('upp-wb-search');
        if (searchInput) searchInput.value = '';
      }
      state.expandedWbUids.add(uidKey);
      const wrap = [...elBody.querySelectorAll('[data-wb-wrap]')].find(el => el.dataset.wbWrap === uidKey);
      if (!hadSearch && wrap) {
        // 就地展开目标行：只往这一行追加面板，不重建整张列表，
        // 正在输入的正文框/搜索框节点不被搬动，焦点和输入法合成态都不会断
        if (!wrap.querySelector('[data-wb-panel]')) {
          const warnList = [
            hygiene.byUid[uidKey].unclosed.length ? '未闭合: ' + hygiene.byUid[uidKey].unclosed.join(', ') : '',
            hygiene.byUid[uidKey].duplicateTags.length ? '重复包裹: ' + hygiene.byUid[uidKey].duplicateTags.join(', ') : '',
          ].filter(Boolean);
          wrap.classList.add('is-expanded');
          const holder = document.createElement('div');
          holder.innerHTML = buildWorldbookInlinePanelHtml(target, warnList, uidKey);
          const panelNode = holder.firstChild;
          if (panelNode) wrap.appendChild(panelNode);
        }
      } else {
        renderWorldbookBody({ preservePanels: true });
      }
      locateWorldbookRow(uidKey);
      // 走重建路径时，内联面板会被搬动、被点的徽章会被销毁；桌面端把焦点还给原来的输入控件，
      // 避免 activeElement 掉到 body（真机 iOS 会因此收键盘并保持视口偏移）
      if (focusBefore && focusBefore !== shadow.activeElement && focusBefore.isConnected
        && typeof focusBefore.matches === 'function'
        && focusBefore.matches('input, textarea, select, [contenteditable="true"]')) {
        focusDesktopSafe(focusBefore);
      }
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
        renderWorldbookBody({ preservePanels: true });
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
        renderWorldbookBody({ preservePanels: true });
        elBody.scrollTop = scrollTop;
      }
      return;
    }
    const wbTall = t.closest('[data-wb-inline-tall]');
    if (wbTall) {
      const textarea = wbTall.closest('[data-wb-panel]').querySelector('[data-wb-inline-content]');
      const tall = textarea.classList.toggle('is-tall');
      wbTall.setAttribute('aria-pressed', String(tall));
      wbTall.textContent = tall ? '恢复高度' : '加高';
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
        const book = state.activeBook;
        const keyText = panel.querySelector('[data-wb-inline-key]').value;
        const entry = (getCachedBookEntries(book) || []).find(item => String(item.uid) === uidKey);
        const keys = keyText === entry?.keys.join(', ') ? undefined : keyText.split(/[,，\n]/).map(key => key.trim()).filter(Boolean);
        const depth = panel.querySelector('[data-wb-inline-depth]').value;
        await Host.updateWorldbookEntry(book, uidKey, name || '未命名条目', content, strategyType, {
          keys, position: Number(panel.querySelector('[data-wb-inline-position]').value), depth: depth === '' ? undefined : Number(depth),
        });
        await ensureBookEntries(book, true);
        if (state.tab !== 'worldbook' || state.activeBook !== book) return;
        const scrollTop = elBody.scrollTop;
        renderWorldbookBody({ preservePanels: true });
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
        state.presetFoldState[presetFoldKey(gid)] = nextCollapsed;
        renderPresetToolbar();
      }
      return;
    }
    if ((t.closest('[data-prg-toggle]') || t.closest('[data-pr-toggle]') || t.closest('[data-pr-inline-save]')) && isViewingForeignPreset()) {
      // 查看非当前预设时只读：开关不改宿主、不写别的预设文件
      toast('正在查看非当前预设（只读），先「设为当前使用」才能改开关', 'warning');
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
      const rid = rgOpen.getAttribute('data-rg-open');
      if (rid) {
        const scrollTop = elBody.scrollTop;
        if (state.expandedRegexIds.has(rid)) state.expandedRegexIds.delete(rid);
        else state.expandedRegexIds.add(rid);
        renderRegexBody();
        elBody.scrollTop = scrollTop;
      }
      return;
    }
    const rgInlineClose = t.closest('[data-rg-inline-close]');
    if (rgInlineClose) {
      const rid = rgInlineClose.getAttribute('data-rg-inline-close');
      if (rid) {
        const scrollTop = elBody.scrollTop;
        state.expandedRegexIds.delete(rid);
        renderRegexBody();
        elBody.scrollTop = scrollTop;
      }
      return;
    }
    const rgInlineCopy = t.closest('[data-rg-inline-copy]');
    if (rgInlineCopy) {
      const rid = rgInlineCopy.getAttribute('data-rg-inline-copy');
      const item = (state.regexList || []).find(r => r.id === rid);
      if (item) {
        const txt = `【查找正则】\n${item.find_regex || ''}\n\n【替换为】\n${item.replace_string || ''}`;
        try { await navigator.clipboard.writeText(txt); toast('已复制正则规则', 'success'); }
        catch (_) { toast('当前环境不支持自动复制', 'warning'); }
      }
      return;
    }
  });

  function markViewSnapshotDirty(d) {
    if (!d || d.type !== 'viewSnapshot') return;
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
  }

  // Drawer input/change/click
  function handleDrawerSearchInput(targetEl) {
    const d = state.drawer;
    if (!d || !targetEl) return;
    if (d.type === 'saveSnapshot') {
      if (targetEl.id === 'upp-ss-group') {
        updateSnapshotNaming(d, targetEl.value, shadow.getElementById('upp-ss-name'), elDrawerMask);
        return;
      }
      if (targetEl.id === 'upp-ss-name') {
        syncSnapshotRouteButtons(elDrawerMask, targetEl.value);
        return;
      }
    }
    if (d.type === 'viewSnapshot') {
      if (targetEl.id === 'upp-sv-search') {
        d.search = targetEl.value;
        renderViewSnapshotBody(d);
        return;
      }
      if (targetEl.id === 'upp-sv-persona-name' && d.draft?.persona) {
        d.draft.persona.name = targetEl.value.slice(0, 60);
        d.draft.persona.versionId = '';
        d.draft.persona.versionName = '';
        markViewSnapshotDirty(d);
        return;
      }
      if (targetEl.id === 'upp-sv-persona-desc' && d.draft?.persona) {
        d.draft.persona.description = targetEl.value;
        d.draft.persona.versionId = '';
        d.draft.persona.versionName = '';
        const lenEl = shadow.getElementById('upp-sv-persona-len');
        if (lenEl) lenEl.textContent = `${targetEl.value.length} 字`;
        markViewSnapshotDirty(d);
        return;
      }
      if (d.editingMeta && d.metaDraft) {
        if (targetEl.id === 'upp-em-name') { d.metaDraft.name = targetEl.value; return; }
        if (targetEl.id === 'upp-em-group') { d.metaDraft.group = targetEl.value; return; }
        if (targetEl.id === 'upp-em-note') { d.metaDraft.note = targetEl.value; return; }
      }
    }
    if (d.type === 'saveSnapshot' && targetEl.id === 'upp-ss-book-search') {
      d.bookQuery = targetEl.value;
      renderSaveSnapshotBooksList(d);
      return;
    }
    if (d.type === 'bookPicker' && targetEl.id === 'upp-book-search-input') {
      d.query = targetEl.value;
      renderBookPickerList(d);
      return;
    }
    if (d.type === 'bindSnapshot') {
      if (targetEl.id === 'upp-bind-char-search') { d.charQuery = targetEl.value; renderBindCharList(d); return; }
      if (targetEl.id === 'upp-bind-chat-char-search') { d.chatCharQuery = targetEl.value; renderBindChatCharOptions(d); return; }
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
    if (d.type === 'backup' && ev.target.id === 'upp-global-books-mode') {
      state.store.settings.globalBooksMode = ['ask', 'replace', 'merge'].includes(ev.target.value) ? ev.target.value : 'ask';
      persistStore(state.store);
      toast('已保存全局世界书处理方式', 'success');
      return;
    }
    if (d.type === 'presetSync') {
      if (ev.target.id === 'upp-ps-source-sel') {
        d.sourcePreset = ev.target.value;
        d.selectedSnapIds = null;
        d.newPromptDecisions = {};
        resetPresetOverrides(d);
        recomputePresetSyncAnalysis(d);
        renderDrawer();
        return;
      }
      if (ev.target.id === 'upp-ps-target-sel') {
        d.targetPreset = ev.target.value;
        d.newPromptDecisions = {};
        resetPresetOverrides(d);
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
        syncPresetOverrideCount(d);
        return;
      }
      if (ev.target.hasAttribute('data-ps-ov-pr')) {
        const pid = ev.target.getAttribute('data-ps-ov-pr');
        const p = (d.targetPresetNorm?.prompts || []).find(x => x.id === pid);
        if (ev.target.checked && p) d.forceOverridePrompts[pid] = !!p.enabled;
        else delete d.forceOverridePrompts[pid];
        syncPresetOverrideCount(d);
        return;
      }
      if (ev.target.id === 'upp-ps-clean-removed') { d.cleanRemovedIds = !!ev.target.checked; return; }
      if (ev.target.id === 'upp-ps-sync-groups') { d.syncNewGroups = !!ev.target.checked; return; }
      return;
    }
    if (d.type === 'viewSnapshot') {
      if (ev.target.id === 'upp-sv-api-profile-sel' && d.draft?.api) {
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
      if (d.editingMeta && d.metaDraft) {
        if (!d.metaDraft.scope) d.metaDraft.scope = {};
        if (ev.target.id === 'upp-em-sc-persona') { d.metaDraft.scope.persona = !!ev.target.checked; return; }
        if (ev.target.id === 'upp-em-sc-wb') { d.metaDraft.scope.worldbooks = !!ev.target.checked; return; }
        if (ev.target.id === 'upp-em-sc-preset') { d.metaDraft.scope.preset = !!ev.target.checked; return; }
        if (ev.target.id === 'upp-em-sc-api') { d.metaDraft.scope.api = !!ev.target.checked; return; }
        if (ev.target.id === 'upp-em-sc-regex') { d.metaDraft.scope.regex = !!ev.target.checked; return; }
      }
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
    if (d.type === 'bindSnapshot' && ev.target.id === 'upp-bind-chat-char-sel') {
      const avatar = ev.target.value || '';
      const rescanBtn = shadow.getElementById('upp-bind-rescan-btn');
      if (rescanBtn) rescanBtn.disabled = !avatar;
      void scanChatsIntoBindDrawer(d, avatar);
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

  // 定位徽章只做跳转：pointerdown 上阻止默认的聚焦行为，点它不会把焦点从正在输入的
  // 搜索框/正文框偷走（取消 pointerdown 会连带取消 mousedown 的聚焦，click 仍然照常触发）
  elBody.addEventListener('pointerdown', ev => {
    const t = ev.target;
    if (!t || typeof t.closest !== 'function') return;
    if (!t.closest('#upp-wb-jump-hygiene-btn')) return;
    if (ev.cancelable) ev.preventDefault();
  }, { signal: ac.signal });

  elDrawerMask.addEventListener('click', async ev => {
    const t = ev.target;
    const d = state.drawer;
    if (!d) return;

    if (d.type === 'globalBooksConfirm') {
      const decide = decision => {
        const remember = !!shadow.getElementById('upp-gb-remember')?.checked;
        const resolve = d.resolve;
        state.drawer = null;
        renderDrawer();
        if (remember && decision) {
          state.store.settings.globalBooksMode = decision;
          persistStore(state.store);
          toast(decision === 'replace' ? '以后应用快照将按快照覆盖全局书' : '以后应用快照会保留你自己挂的全局书', 'info');
        }
        if (resolve) resolve(decision);
      };
      if (t.closest('#upp-gb-replace')) { decide('replace'); return; }
      if (t.closest('#upp-gb-merge')) { decide('merge'); return; }
      if (t.closest('#upp-gb-cancel')) { decide(null); return; }
    }

    if (t.closest('[data-drawer-close]')) {
      if (typeof d.resolve === 'function') d.resolve(null);
      state.drawer = d.returnTo || null;
      renderDrawer();
      return;
    }

    if (d.type === 'viewSnapshot') {
      const markDraftDirty = () => markViewSnapshotDirty(d);

      if (t.closest('#upp-sv-persona-name-clear') && d.draft?.persona) {
        const inp = shadow.getElementById('upp-sv-persona-name');
        if (inp) {
          inp.value = '';
          d.draft.persona.name = '';
          d.draft.persona.versionId = '';
          d.draft.persona.versionName = '';
          markDraftDirty();
          focusDesktopSafe(inp);
        }
        return;
      }
      if (t.closest('#upp-sv-persona-copy') && d.draft?.persona) {
        const desc = shadow.getElementById('upp-sv-persona-desc')?.value ?? d.draft.persona.description ?? '';
        try { await navigator.clipboard.writeText(desc); toast('已复制人设正文', 'success'); }
        catch (_) { toast('当前环境不支持自动复制', 'warning'); }
        return;
      }
      if (t.closest('#upp-sv-persona-pull') && d.draft?.persona) {
        const liveP = Host.getCurrentPersona();
        if (!liveP) { toast('未读取到当前酒馆 User', 'warning'); return; }
        d.draft.persona.name = liveP.name || d.draft.persona.name;
        d.draft.persona.description = liveP.description || '';
        d.draft.persona.lorebook = liveP.lorebook || '';
        d.draft.persona.versionId = '';
        d.draft.persona.versionName = '';
        markDraftDirty();
        renderViewSnapshotBody(d);
        toast(`已拉取当前酒馆 User「${liveP.name}」，点右上角保存生效`, 'info');
        return;
      }

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
        d.editingMeta = !d.editingMeta;
        if (d.editingMeta) {
          const cur = d.draft || d.snapshot;
          d.metaDraft = {
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
          };
        } else {
          d.metaDraft = null;
        }
        renderDrawer();
        if (d.editingMeta && canAutoFocusDesktop()) {
          window.setTimeout(() => focusDesktopSafe(shadow.getElementById('upp-em-name')), 10);
        }
        return;
      }
      if (t.closest('#upp-em-cancel-btn') || t.closest('#upp-em-cancel-btn-foot')) {
        d.editingMeta = false;
        d.metaDraft = null;
        renderDrawer();
        return;
      }
      if (d.editingMeta) {
        if (t.closest('#upp-em-name-clear')) {
          const inp = shadow.getElementById('upp-em-name');
          if (inp) {
            inp.value = '';
            if (d.metaDraft) d.metaDraft.name = '';
            focusDesktopSafe(inp);
          }
          return;
        }
        const fillEmGrp = t.closest('[data-em-fill-group]');
        if (fillEmGrp) {
          const inp = shadow.getElementById('upp-em-group');
          const gVal = fillEmGrp.getAttribute('data-em-fill-group') || '';
          if (inp) inp.value = gVal;
          if (d.metaDraft) d.metaDraft.group = gVal;
          return;
        }
        if (t.closest('#upp-em-save-btn') || t.closest('[data-sv-meta-save]')) {
          const nextName = (shadow.getElementById('upp-em-name')?.value || '').trim().slice(0, 60);
          if (!nextName) { toast('请填写快照名称', 'warning'); return; }
          const nextGroup = (shadow.getElementById('upp-em-group')?.value || '').trim().slice(0, 30);
          const nextNote = (shadow.getElementById('upp-em-note')?.value || '').trim().slice(0, 120);
          const wantedScope = d.metaDraft?.scope || d.draft?.scope || d.snapshot.scope || {};
          if (!wantedScope.persona && !wantedScope.worldbooks && !wantedScope.preset && !wantedScope.regex && !wantedScope.api) {
            toast('请至少保留一项包含模块', 'warning'); return;
          }
          const target = state.store.snapshots.find(s => s.id === d.snapshot.id) || d.snapshot;
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
          d.snapshot = target;
          if (d.draft) {
            d.draft.name = target.name;
            d.draft.group = target.group;
            d.draft.note = target.note;
            d.draft.scope = structuredClone(target.scope);
            ['persona', 'worldbooks', 'preset', 'regex', 'api'].forEach(k => {
              if (!target.scope[k]) d.draft[k] = null;
              else if (!d.draft[k] && target[k]) d.draft[k] = structuredClone(target[k]);
            });
          }
          d.editingMeta = false;
          d.metaDraft = null;
          persistStore(state.store);
          renderDrawer();
          if (state.tab === 'snapshots') renderSnapshotsBody();
          renderTabs();
          renderFooter();
          toast('已更新快照信息与包含模块', 'success');
          return;
        }
      }
      if (t.closest('#upp-sv-api-clear-profile') && d.draft?.api) {
        d.draft.api.profileId = '';
        d.draft.api.profileName = '';
        markDraftDirty();
        renderDrawer();
        toast('已清除旧连接配置绑定，点右上角「保存修改」生效', 'info');
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
        if (sc && rid && live) {
          const expKey = `rg::${sc}::${rid}`;
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
      const svRgClose = t.closest('[data-sv-rg-close]');
      if (svRgClose) {
        const expKey = svRgClose.getAttribute('data-sv-rg-close');
        if (expKey && d.expandedIds) {
          const bodyEl = shadow.getElementById('upp-snap-inspect-body');
          const scrollTop = bodyEl ? bodyEl.scrollTop : 0;
          d.expandedIds.delete(expKey);
          renderViewSnapshotBody(d);
          if (bodyEl) bodyEl.scrollTop = scrollTop;
        }
        return;
      }
      const svRgCopy = t.closest('[data-sv-rg-copy]');
      if (svRgCopy) {
        const sc = svRgCopy.getAttribute('data-sv-rg-copy');
        const rid = svRgCopy.getAttribute('data-sv-rg-copy-id');
        const live = (d.regexDetails[sc] || []).find(r => String(r.id) === String(rid));
        if (live) {
          const txt = `【查找正则】\n${live.find_regex || ''}\n\n【替换为】\n${live.replace_string || ''}`;
          try { await navigator.clipboard.writeText(txt); toast('已复制正则规则', 'success'); }
          catch (_) { toast('当前环境不支持自动复制', 'warning'); }
        }
        return;
      }
      return;
    }

    if (d.type === 'editSnapshotMeta') {
      if (t.closest('#upp-em-name-clear')) {
        const inp = shadow.getElementById('upp-em-name');
        if (inp) { inp.value = ''; focusDesktopSafe(inp); }
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
        openPresetSyncDrawer({ sourcePreset: d.health?.missingPreset || d.snapshot?.preset?.name, targetPreset: state.loadedPresetName });
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
        openExternalOrganizerPanel();
        return;
      }
      if (t.closest('#upp-ma-skip-apply')) {
        const snap = d.snapshot;
        state.drawer = null;
        renderDrawer();
        await applySnapshotLive(snap, state.store, undefined, { interactive: true });
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
          if (d.apiProfileRemap === '__clear_profile__') {
            snap.api.profileId = '';
            snap.api.profileName = '';
            if (!snap.api.source && !snap.api.model) {
              snap.scope.api = false;
              snap.api = null;
            }
            repaired = true;
          } else {
            const pr = (state.apiProfiles || Host.listConnectionProfiles()).find(x => x.id === d.apiProfileRemap);
            if (pr) {
              snap.api.profileId = pr.id;
              snap.api.profileName = pr.name;
              if (pr.api) snap.api.source = pr.api;
              if (pr.model) snap.api.model = pr.model;
              repaired = true;
            }
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
        await applySnapshotLive(snap, state.store, undefined, { interactive: true });
        syncFabUi();
        if (state.open) await refreshAll(true);
        return;
      }
      return;
    }

    if (t.closest('#upp-open-wbo-in-drawer')) {
      openExternalOrganizerPanel();
      return;
    }

    const bpGroup = t.closest('[data-bp-group]');
    if (bpGroup && d.type === 'bookPicker') {
      const gid = bpGroup.getAttribute('data-bp-group') || '';
      d.groupFilter = gid;
      if (gid) {
        if (!d.foldMap) d.foldMap = {};
        d.foldMap[gid] = false;
      }
      renderBookPickerList(d);
      const listEl = shadow.getElementById('upp-book-picker-list');
      if (listEl) listEl.scrollTop = 0;
      return;
    }

    const bpFold = t.closest('[data-bp-fold]');
    if (bpFold && d.type === 'bookPicker') {
      const sid = bpFold.getAttribute('data-bp-fold');
      const box = bpFold.closest('.upp-bp-box');
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

    if (d.type === 'entryEditor' && t.closest('#upp-ed-dn-clear-btn')) {
      const inp = shadow.getElementById('upp-ed-display-name');
      if (inp) { inp.value = ''; focusDesktopSafe(inp); }
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
      if (inp) { inp.value = ''; syncSnapshotRouteButtons(elDrawerMask, ''); focusDesktopSafe(inp); }
      return;
    }
    const routeButton = t.closest('[data-snapshot-route]');
    if (routeButton && d.type === 'saveSnapshot') {
      toggleSnapshotRoute(elDrawerMask, shadow.getElementById('upp-ss-name'), routeButton.dataset.snapshotRoute);
      return;
    }
    const fillName = t.closest('[data-ss-fill-name]');
    if (fillName && d.type === 'saveSnapshot') {
      const inp = shadow.getElementById('upp-ss-name');
      inp.value = nameWithSnapshotRoute(fillName.dataset.ssFillName, splitSnapshotRoute(inp.value).route);
      d.autoName = splitSnapshotRoute(inp.value).base;
      syncSnapshotRouteButtons(elDrawerMask, inp.value);
      return;
    }
    const fillGrp = t.closest('[data-ss-fill-group]');
    if (fillGrp && d.type === 'saveSnapshot') {
      const inp = shadow.getElementById('upp-ss-group');
      inp.value = fillGrp.dataset.ssFillGroup;
      updateSnapshotNaming(d, inp.value, shadow.getElementById('upp-ss-name'), elDrawerMask);
      return;
    }
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
      const pickChatCharBtn = t.closest('[data-bind-pick-chat-char]');
      if (pickChatCharBtn) {
        const avatar = pickChatCharBtn.getAttribute('data-bind-pick-chat-char') || '';
        d.scanCharAvatar = avatar;
        renderBindChatCharOptions(d);
        const rescanBtn = shadow.getElementById('upp-bind-rescan-btn');
        if (rescanBtn) rescanBtn.disabled = !avatar;
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
      const ovFold = t.closest('[data-ps-ov-fold]');
      if (ovFold) {
        const id = ovFold.getAttribute('data-ps-ov-fold');
        const collapsed = ovFold.getAttribute('aria-expanded') === 'true';
        if (collapsed) d.overrideCollapsed.add(id);
        else d.overrideCollapsed.delete(id);
        ovFold.closest('.upp-group-box').classList.toggle('is-collapsed', collapsed);
        ovFold.setAttribute('aria-expanded', String(!collapsed));
        return;
      }
      const ovToggle = t.closest('#upp-ps-ov-toggle');
      if (ovToggle) {
        d.overrideExpanded = !d.overrideExpanded;
        ovToggle.closest('.upp-ps-ov-box').classList.toggle('is-collapsed', !d.overrideExpanded);
        ovToggle.setAttribute('aria-expanded', String(d.overrideExpanded));
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

  function colorAlpha(color) {
    const s = String(color || '').trim();
    if (!s) return 1;
    if (/^transparent$/i.test(s)) return 0;
    const m = s.match(/^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
    if (!m || m[4] === undefined) return 1;
    const raw = m[4];
    const a = raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw);
    return Number.isFinite(a) ? a : 1;
  }

  // 实底守卫：万一宿主或内核把底色算成了半透明，这里用 !important 强制改写回实底，
  // 保证面板在任何环境下都不会透出底层内容（只在真的算错时才动手，正常情况零副作用）。
  let surfaceGuardFired = false;
  function guardPanelSurface(solidBg) {
    if (!elModal || !solidBg) return false;
    let alpha = 1;
    try { alpha = colorAlpha(window.getComputedStyle(elModal).backgroundColor); } catch (_) { return false; }
    if (alpha >= 0.999) return false;
    // 只兜底面板自身的表面；遮罩必须永远透明，绝不为了“看起来实底”去铺整屏
    const targets = [elModal, elFabPop, elRestorePill].filter(Boolean);
    targets.forEach(el => {
      el.style.setProperty('background-color', solidBg, 'important');
      el.style.setProperty('background-image', 'none', 'important');
    });
    if (!surfaceGuardFired) {
      surfaceGuardFired = true;
      try { toast('已强制面板不透明显示', 'warning'); } catch (_) {}
    }
    return true;
  }

  function clearSurfaceGuard() {
    [elModal, elFabPop, elRestorePill, elBackdrop].filter(Boolean).forEach(el => {
      el.style.removeProperty('background-image');
      el.style.removeProperty('background-color');
    });
  }

  function applyThemeAll() {
    const mode = state.store.settings.themeMode || 'paper';
    clearSurfaceGuard();
    const solidBg = applyThemeToElement(elBackdrop, mode);
    elModal.style.backgroundColor = solidBg;
    const solidFab = applyThemeToElement(elFabRoot, mode);
    elFabPop.style.backgroundColor = solidFab;
    elRestorePill.style.backgroundColor = applyThemeToElement(elRestorePill, mode);
    const toastLayer = getToastLayer();
    if (toastLayer) applyThemeToElement(toastLayer, mode);
    if (elThemeSelect) elThemeSelect.value = mode;
    guardPanelSurface(solidBg);
    if (state.open) {
      window.requestAnimationFrame(() => {
        try { guardPanelSurface(solidBg); } catch (_) {}
      });
    }
    return { solidBg, solidFab };
  }

  // 面板实底自检：控制台执行 __uppPaintDiag() 即可看到各层真实计算出的底色与层级
  function collectPaintDiag() {
    const read = el => {
      if (!el) return null;
      const cs = window.getComputedStyle(el);
      return {
        background: cs.backgroundColor,
        image: String(cs.backgroundImage || '').slice(0, 48),
        zIndex: cs.zIndex,
        visible: !el.hidden,
      };
    };
    const rootStyle = window.getComputedStyle(document.documentElement);
    return {
      version: APP_VERSION,
      themeMode: state.store?.settings?.themeMode || '',
      hostTint: rootStyle.getPropertyValue('--SmartThemeBlurTintColor').trim(),
      hostBodyBg: window.getComputedStyle(document.body || document.documentElement).backgroundColor,
      viewport: getViewportSize(),
      mobileFullscreen: isMobileViewport(),
      hostZ: window.getComputedStyle(host).zIndex,
      modal: read(elModal),
      backdrop: read(elBackdrop),
      fabPop: read(elFabPop),
      drawer: read(elDrawerMask?.querySelector('.upp-drawer') || null),
    };
  }
  try {
    window.__uppPaintDiag = collectPaintDiag;
    if (!window.__uppPaintAnnounced) {
      window.__uppPaintAnnounced = true;
      console.info(`[快照管家] v${APP_VERSION} 面板实底模式就绪；显示异常时可在控制台执行 __uppPaintDiag()`);
    }
  } catch (_) {}

  elThemeSelect.addEventListener('change', () => {
    state.store = loadStore();
    state.store.settings.themeMode = elThemeSelect.value;
    persistStore(state.store);
    applyThemeAll();
  }, { signal: ac.signal });

  // =========================
  // Floating Window Geometry, Drag, Resize & Minimize
  // =========================

  const modalGeo = {
    floating: false,
    resized: false,
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    baseLeft: 0,
    baseTop: 0,
    baseWidth: 0,
    baseHeight: 0,
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
    return getViewportSize().vw <= 680;
  }

  // 手机端默认几何：接近全屏的浮动窗，四周留 8px 供抓取拖动/缩放
  function defaultNarrowModalRect() {
    const { vw, vh } = getViewportSize();
    const inset = vw <= 420 ? 8 : 12;
    return {
      left: inset,
      top: inset,
      width: Math.max(1, vw - inset * 2),
      height: Math.max(1, vh - inset * 2),
    };
  }

  function syncModalLayoutClasses() {
    if (!elModal) return;
    elModal.classList.toggle('is-floating', !!modalGeo.floating);
    // 手机与桌面都允许拖动/缩放（手机默认接近全屏，但仍可抓取调整）
    elModal.classList.toggle('is-draggable', true);
    elModal.classList.toggle('is-resizable', true);
    elBackdrop?.classList.toggle('is-mini', !!modalGeo.floating);
    let h = modalGeo.floating && modalGeo.height ? modalGeo.height : (elModal.getBoundingClientRect().height || 0);
    if (!h && state.open) h = getViewportSize().vh;
    elModal.classList.toggle('is-compact-h', h > 0 && h <= 330);
  }

  function applyModalRect(rect, updateBase = true) {
    if (!rect || !elModal) return;
    modalGeo.left = rect.left;
    modalGeo.top = rect.top;
    modalGeo.width = rect.width;
    modalGeo.height = rect.height;
    if (updateBase) {
      modalGeo.baseLeft = rect.left;
      modalGeo.baseTop = rect.top;
      modalGeo.baseWidth = rect.width;
      modalGeo.baseHeight = rect.height;
    }
    elModal.style.left = rect.left + 'px';
    elModal.style.top = rect.top + 'px';
    elModal.style.width = rect.width + 'px';
    elModal.style.height = rect.height + 'px';
    syncModalLayoutClasses();
  }

  function restorePersistedModalSize() {
    const settings = state.store?.settings || {};
    const sw = Number(settings.modalWidth) || 0;
    const sh = Number(settings.modalHeight) || 0;
    const hasPos = Number.isFinite(Number(settings.modalLeft)) && Number.isFinite(Number(settings.modalTop))
      && Number(settings.modalLeft) >= 0 && Number(settings.modalTop) >= 0;
    const hasSize = sw > 0 && sh > 0;
    if (!hasSize && !hasPos && !isMobileViewport()) {
      // 桌面首次打开：交给 CSS 居中，不做内联几何
      resetModalGeometry();
      return;
    }
    const { vw, vh } = getViewportSize();
    // 有保存的尺寸就沿用；没有（手机首次）就是接近全屏的浮动窗
    const base = hasSize
      ? {
        width: sw,
        height: sh,
        left: hasPos ? Number(settings.modalLeft) : Math.round((vw - sw) / 2),
        top: hasPos ? Number(settings.modalTop) : Math.round((vh - sh) / 2),
      }
      : (hasPos
        ? { ...defaultNarrowModalRect(), left: Number(settings.modalLeft), top: Number(settings.modalTop) }
        : defaultNarrowModalRect());
    modalGeo.floating = true;
    modalGeo.resized = hasSize;
    modalGeo.baseLeft = base.left;
    modalGeo.baseTop = base.top;
    modalGeo.baseWidth = base.width;
    modalGeo.baseHeight = base.height;
    // 只有真的跑出视口才夹回来，不再每次重开都重新居中
    applyModalRect(clampModalRect({
      left: base.left,
      top: base.top,
      width: base.width,
      height: base.height,
      viewportWidth: vw,
      viewportHeight: vh,
    }), false);
  }

  // 拖动/缩放结束后记住落点与尺寸（用户摆的位置优先，重开不回到居中）
  function persistModalGeometry() {
    if (!state.store?.settings) return;
    const left = Math.round(Number.isFinite(modalGeo.baseLeft) ? modalGeo.baseLeft : modalGeo.left);
    const top = Math.round(Number.isFinite(modalGeo.baseTop) ? modalGeo.baseTop : modalGeo.top);
    if (Number.isFinite(left)) state.store.settings.modalLeft = left;
    if (Number.isFinite(top)) state.store.settings.modalTop = top;
    const w = Math.round(modalGeo.baseWidth || modalGeo.width || 0);
    const h = Math.round(modalGeo.baseHeight || modalGeo.height || 0);
    // 手机端最小可缩到 310×250，门槛不能比它还高，否则手机上缩过之后就记不住
    if (w >= 300 && h >= 240) {
      state.store.settings.modalWidth = w;
      state.store.settings.modalHeight = h;
    }
    persistStore(state.store);
  }

  function resetModalGeometry() {
    modalGeo.floating = false;
    modalGeo.resized = false;
    modalGeo.left = 0;
    modalGeo.top = 0;
    modalGeo.width = 0;
    modalGeo.height = 0;
    modalGeo.baseLeft = 0;
    modalGeo.baseTop = 0;
    modalGeo.baseWidth = 0;
    modalGeo.baseHeight = 0;
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
    if (modalGeo.floating) {
      const srcLeft = modalGeo.baseWidth ? modalGeo.baseLeft : modalGeo.left;
      const srcTop = modalGeo.baseHeight ? modalGeo.baseTop : modalGeo.top;
      const srcWidth = modalGeo.baseWidth || modalGeo.width;
      const srcHeight = modalGeo.baseHeight || modalGeo.height;
      applyModalRect(clampModalRect({
        left: srcLeft,
        top: srcTop,
        width: srcWidth,
        height: srcHeight,
        viewportWidth: vw,
        viewportHeight: vh,
      }), false);
    } else {
      syncModalLayoutClasses();
    }
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
      render();
      void refreshAll(false);
      return;
    }
    state.minimized = false;
    elBackdrop.classList.remove('is-minimized');
    elBackdrop.removeAttribute('aria-hidden');
    elRestorePill.hidden = true;
    restorePersistedModalSize();
    state.open = true;
    state.drawer = null;
    state.userView = 'main';
    state.userInlineEditor = null;
    elBackdrop.hidden = false;
    syncModalLayoutClasses();
    syncFabVisBtn();
    void refreshAll(false);
    adaptPanelToFab();
  }

  function closeModal() {
    if (typeof state.drawer?.resolve === 'function') state.drawer.resolve(null);
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
    elModal.classList.remove('is-fab-clear-foot-l', 'is-fab-clear-foot-r', 'is-fab-clear-head-l', 'is-fab-clear-head-r');
    // 不清几何：用户摆的位置/尺寸由设置持久化，下次打开按保存值恢复
    syncFabUi();
  }

  // Unified PointerEvent Drag on .upp-header
  elHeader.addEventListener('pointerdown', ev => {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    if (!state.open || state.minimized) return;
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
    modalGeo.baseLeft = pos.left;
    modalGeo.baseTop = pos.top;
    elModal.style.left = pos.left + 'px';
    elModal.style.top = pos.top + 'px';
  }, { signal: ac.signal });

  function finishModalDrag(ev) {
    if (!dragState || ev.pointerId !== dragState.pointerId) return;
    const moved = !!dragState.moved;
    dragState = null;
    elModal.classList.remove('is-dragging');
    try { elHeader.releasePointerCapture(ev.pointerId); } catch (_) {}
    // 落点持久化：下次打开回到用户摆的位置，不再每次重新居中
    if (moved && modalGeo.floating) persistModalGeometry();
  }
  elHeader.addEventListener('pointerup', finishModalDrag, { signal: ac.signal });
  elHeader.addEventListener('pointercancel', finishModalDrag, { signal: ac.signal });

  // Unified PointerEvent 8-Direction Resize on invisible edge + corner hotzones (.upp-rz)
  shadow.querySelectorAll('.upp-rz[data-resize]').forEach(rzEl => {
    const handle = rzEl.getAttribute('data-resize') || 'se';
    rzEl.addEventListener('pointerdown', ev => {
      if (ev.button !== 0 && ev.pointerType === 'mouse') return;
      if (!state.open || state.minimized) return;
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
        handle,
        el: rzEl,
        startX: ev.clientX,
        startY: ev.clientY,
        origLeft: modalGeo.left,
        origTop: modalGeo.top,
        origWidth: modalGeo.width,
        origHeight: modalGeo.height,
      };
      elModal.classList.add('is-resizing');
      try { rzEl.setPointerCapture(ev.pointerId); } catch (_) {}
    }, { signal: ac.signal });

    rzEl.addEventListener('pointermove', ev => {
      if (!resizeState || ev.pointerId !== resizeState.pointerId) return;
      const { vw, vh } = getViewportSize();
      const nextRect = computeResizedModalRect({
        origLeft: resizeState.origLeft,
        origTop: resizeState.origTop,
        origWidth: resizeState.origWidth,
        origHeight: resizeState.origHeight,
        dx: ev.clientX - resizeState.startX,
        dy: ev.clientY - resizeState.startY,
        handle: resizeState.handle,
        viewportWidth: vw,
        viewportHeight: vh,
      });
      applyModalRect(nextRect, true);
    }, { signal: ac.signal });

    const finishResize = ev => {
      if (!resizeState || ev.pointerId !== resizeState.pointerId) return;
      resizeState = null;
      elModal.classList.remove('is-resizing');
      try { rzEl.releasePointerCapture(ev.pointerId); } catch (_) {}
      // 尺寸 + 落点一起记住（≥340×280 才写尺寸，避免误缩放成不可用的小窗）
      persistModalGeometry();
    };
    rzEl.addEventListener('pointerup', finishResize, { signal: ac.signal });
    rzEl.addEventListener('pointercancel', finishResize, { signal: ac.signal });
  });

  function handleEscapeKey() {
    if (fabPopOpen) { closeFabPop(); return true; }
    if (state.open && !state.minimized) {
      if (state.drawer) {
        if (typeof state.drawer.resolve === 'function') state.drawer.resolve(null);
        if (state.drawer.type === 'viewSnapshot' && state.drawer.dirty) {
          state.drawer.pendingAction = 'close';
          renderDrawer();
          return true;
        }
        state.drawer = state.drawer.returnTo || null;
        renderDrawer();
        return true;
      }
      closeModal();
      return true;
    }
    return false;
  }

  const SCROLLABLE_ANCESTOR_SELECTOR = [
    '.upp-body',
    '.upp-drawer-body',
    '.upp-pop-list',
    '.upp-fab-pop-list',
    '.upp-inline-pre',
    '.upp-inline-textarea',
    '.upp-textarea',
    '.upp-persona-live-box',
    '.upp-diff-box',
    '.upp-merge-dest-list',
    '.upp-sv-meta-panel',
    '#upp-ps-ov-scroll',
    '.upp-ps-ov-scroll',
  ].join(', ');

  function findScrollableInRoot(ev, boundaryEl) {
    const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [ev.target];
    const candidates = [];
    for (let i = 0; i < path.length; i++) {
      const node = path[i];
      if (!node || node === boundaryEl || node === shadow || node === document || node === window) break;
      if (node.nodeType !== 1) continue;
      const matchesKnown = typeof node.matches === 'function' && node.matches(SCROLLABLE_ANCESTOR_SELECTOR);
      let hasScrollStyle = matchesKnown;
      if (!hasScrollStyle) {
        try {
          const oy = window.getComputedStyle?.(node)?.overflowY || '';
          hasScrollStyle = /(auto|scroll)/.test(oy);
        } catch (_) {}
      }
      if (hasScrollStyle && (node.scrollHeight || 0) > (node.clientHeight || 0) + 1) {
        candidates.push(node);
      }
    }
    return candidates;
  }

  // Bubble-phase isolation on EVERY floating root (prevent collapsing ST .openDrawer or leaking shortcuts/scroll)
  function stopBubbleToHost(el) {
    if (!el) return;
    const stop = ev => { ev.stopPropagation(); };
    el.addEventListener('mousedown', stop, { signal: ac.signal });
    el.addEventListener('pointerdown', stop, { signal: ac.signal });
    el.addEventListener('mouseup', stop, { signal: ac.signal });
    el.addEventListener('pointerup', stop, { signal: ac.signal });
    el.addEventListener('touchstart', stop, { signal: ac.signal, passive: true });
    el.addEventListener('touchend', stop, { signal: ac.signal });
    el.addEventListener('click', stop, { signal: ac.signal });
    el.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && handleEscapeKey()) {
        ev.preventDefault();
      }
      ev.stopPropagation();
    }, { signal: ac.signal });
    el.addEventListener('keyup', stop, { signal: ac.signal });
    el.addEventListener('keypress', stop, { signal: ac.signal });
  }
  [host, elModal, elDrawerMask, elRestorePill, elFabBtn, elFabPop].forEach(stopBubbleToHost);

  [elModal, elDrawerMask, elFabPop, elFabBtn, elRestorePill].forEach(rootEl => {
    if (!rootEl) return;
    const isFixedButton = rootEl === elFabBtn || rootEl === elRestorePill;
    rootEl.addEventListener('wheel', ev => {
      ev.stopPropagation();
      if (isFixedButton) {
        if (ev.cancelable) ev.preventDefault();
        return;
      }
      const scrollers = findScrollableInRoot(ev, rootEl);
      if (!scrollers.length) {
        if (ev.cancelable) ev.preventDefault();
        return;
      }
      const dy = Number(ev.deltaY || 0);
      if (dy !== 0) {
        const canScroll = scrollers.some(s => (
          (dy < 0 && (s.scrollTop || 0) > 0)
          || (dy > 0 && ((s.scrollTop || 0) + (s.clientHeight || 0)) < ((s.scrollHeight || 0) - 1))
        ));
        if (!canScroll && ev.cancelable) ev.preventDefault();
      }
    }, { passive: false, signal: ac.signal });

    // 手势到顶/到底后继续同向拖，事件会链式传给宿主文档，被 iOS 当成整页滚动；
    // 记住上一个触点位置判断方向，只在边界处截断
    let lastTouchY = null;
    const resetTouchY = () => { lastTouchY = null; };
    rootEl.addEventListener('touchstart', ev => {
      lastTouchY = ev.touches?.[0]?.clientY ?? null;
    }, { signal: ac.signal, passive: true });
    rootEl.addEventListener('touchend', resetTouchY, { signal: ac.signal, passive: true });
    rootEl.addEventListener('touchcancel', resetTouchY, { signal: ac.signal, passive: true });

    rootEl.addEventListener('touchmove', ev => {
      ev.stopPropagation();
      const y = ev.touches?.[0]?.clientY;
      const dy = (lastTouchY === null || y === undefined || y === null) ? 0 : y - lastTouchY;
      if (y !== undefined && y !== null) lastTouchY = y;
      if (isFixedButton) {
        if (ev.cancelable) ev.preventDefault();
        return;
      }
      const scrollers = findScrollableInRoot(ev, rootEl);
      if (!scrollers.length) {
        if (ev.cancelable) ev.preventDefault();
        return;
      }
      if (!ev.cancelable || dy === 0) return;
      const atTop = scrollers.every(s => (s.scrollTop || 0) <= 0);
      const atBottom = scrollers.every(s => ((s.scrollTop || 0) + (s.clientHeight || 0)) >= ((s.scrollHeight || 0) - 1));
      if ((dy > 0 && atTop) || (dy < 0 && atBottom)) ev.preventDefault();
    }, { passive: false, signal: ac.signal });
  });

  elModal.addEventListener('pointerdown', () => { if (fabPopOpen) closeFabPop(); }, { signal: ac.signal });
  elRestorePill.addEventListener('pointerdown', () => { if (fabPopOpen) closeFabPop(); }, { signal: ac.signal });

  // =========================
  // Draggable Floating Ball & Quick Snapshot Popover
  // =========================

  let fabPopOpen = false;
  let fabSearchQuery = '';
  let fabGroup = '';
  let fabDraft = null;
  let fabDragging = false;
  let fabPointerId = null;
  let fabMoved = false;
  let fabStartX = 0;
  let fabStartY = 0;
  let fabOrigLeft = 0;
  let fabOrigTop = 0;

  function syncFabVisBtn() {
    const show = state.store.settings.showFloatingBall !== false;
    if (elFabVisBtn) elFabVisBtn.classList.toggle('active', show);
  }

  function fabBounds() {
    const width = window.innerWidth || 390;
    const height = window.innerHeight || 780;
    return { left: 10, top: 10, right: Math.max(10, width - 52), bottom: Math.max(10, height - 52), height };
  }

  function positionFab() {
    if (fabDragging) return;
    const { left, top, right, bottom, height } = fabBounds();
    const { fabSide, fabY, fabPosition } = state.store.settings;
    const x = fabPosition ? left + (right - left) * fabPosition[0] : fabSide === 'left' ? left : right;
    const y = fabPosition ? top + (bottom - top) * fabPosition[1] : Math.min(bottom, Math.max(top, height * fabY - 21));
    elFabBtn.style.left = Math.round(x) + 'px';
    elFabBtn.style.top = Math.round(y) + 'px';
  }

  function positionFabPop() {
    const vv = window.visualViewport;
    const x = vv?.offsetLeft || 0;
    const y = vv?.offsetTop || 0;
    const width = vv?.width || window.innerWidth || 390;
    const height = vv?.height || window.innerHeight || 780;
    const margin = 12;
    const gap = 8;
    const ball = elFabBtn.getBoundingClientRect();
    const left = x + margin;
    const right = x + width - margin;
    const top = y + margin;
    const bottom = y + height - margin;
    const popWidth = Math.min(304, Math.max(1, right - left));
    const roomLeft = ball.left - gap - left;
    const roomRight = right - ball.right - gap;
    const fitsBeside = Math.max(roomLeft, roomRight) >= popWidth;
    const roomAbove = ball.top - gap - top;
    const roomBelow = bottom - ball.bottom - gap;
    const above = roomAbove > roomBelow;
    const space = above ? roomAbove : roomBelow;
    const availableHeight = fitsBeside || space < 160 ? bottom - top : Math.min(space, bottom - top);
    const popHeight = Math.max(1, Math.min(352, availableHeight));
    const desiredLeft = fitsBeside
      ? (roomLeft > roomRight ? ball.left - gap - popWidth : ball.right + gap)
      : ball.left + (ball.width - popWidth) / 2;
    const desiredTop = fitsBeside ? ball.top : above ? ball.top - gap - popHeight : ball.bottom + gap;
    Object.assign(elFabPop.style, {
      width: `${popWidth}px`, maxHeight: `${popHeight}px`,
      left: `${Math.round(Math.max(left, Math.min(right - popWidth, desiredLeft)))}px`,
      top: `${Math.round(Math.max(top, Math.min(bottom - popHeight, desiredTop)))}px`,
    });
  }
  function renderFabPopList() {
    const listEl = shadow.getElementById('upp-fab-pop-list');
    if (!listEl) return;
    const { snapshots, bindings } = state.store;
    const chatId = readCurrentChatId();
    const character = readCurrentCharInfo();
    const chatBinding = chatId && bindings.chats[chatId];
    const charBinding = character.id && bindings.characters[character.id];
    const preset = Host.getLoadedPresetName();
    const characterGroup = normalizeText(character.name);
    const score = snap => {
      if (snap.id === chatBinding) return 4;
      if (snap.id === charBinding) return 3;
      if (characterGroup && normalizeText(snap.group) === characterGroup) return 2;
      return preset && snap.scope.preset && snap.preset?.name === preset ? 1 : 0;
    };
    const q = normalizeText(fabSearchQuery);
    const filtered = snapshots.filter(snap => (!fabGroup || snap.group === fabGroup)
      && (!q || normalizeText(`${snap.name} ${snap.group} ${snap.note}`).includes(q)));
    filtered.sort((a, b) => score(b) - score(a));

    listEl.innerHTML = filtered.length ? filtered.map(s => {
      const binding = s.id === chatBinding ? '本聊天' : s.id === charBinding ? '本角色' : '';
      const wb = s.scope.worldbooks ? s.worldbooks : null;
      const books = wb ? [...new Set([
        ...(wb.global || []), wb.char?.primary, ...(wb.char?.additional || []), wb.chat,
        ...Object.keys(wb.entries || {}),
      ].filter(Boolean))] : [];
      const summary = [
        ['User 人设', s.scope.persona && s.persona?.name],
        ['预设', s.scope.preset && s.preset?.name],
        ['世界书', books.join('、')],
      ].filter(([, value]) => value);
      return `
        <div class="upp-fab-snap-row ${binding ? 'is-bound' : ''}">
          <div class="upp-fab-snap-main">
            <div class="upp-fab-snap-top">
              <span class="upp-fab-snap-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
              ${binding ? `<span class="upp-badge ok">${binding}</span>` : s.group ? `<span class="upp-badge">${escapeHtml(s.group)}</span>` : ''}
            </div>
            ${summary.length ? `<div class="upp-fab-snap-meta">${summary.map(([label, value]) => `<span>${label}：${escapeHtml(value)}</span>`).join('')}</div>` : ''}
            ${s.note ? `<div class="upp-fab-snap-note" title="${escapeHtml(s.note)}">${escapeHtml(s.note)}</div>` : ''}
          </div>
          <button type="button" class="upp-fab-apply-btn" data-fab-apply="${escapeHtml(s.id)}">应用</button>
        </div>
      `;
    }).join('') : `<div class="upp-empty" style="padding:18px 10px;font-size:var(--upp-fs-sm);">${snapshots.length ? '没有匹配的快照' : '暂无快照'}</div>`;
  }

  function renderFabPop() {
    const groups = [...new Set(state.store.snapshots.map(s => s.group).filter(Boolean))];
    if (!groups.includes(fabGroup)) fabGroup = '';
    elFabPop.innerHTML = `
      <div class="upp-fab-pop-head">
        <span>快照</span>
        <label><input type="checkbox" id="upp-fab-auto-sw" ${state.store.settings.autoApplyBindings ? 'checked' : ''} />切聊天时自动应用绑定快照</label>
      </div>
      <div class="upp-fab-search-wrap">
        <div class="upp-input-wrap">
          ${ICONS.search}
          <input type="text" id="upp-fab-search" spellcheck="false" placeholder="搜索快照" value="${escapeHtml(fabSearchQuery)}" />
        </div>
        <select class="upp-select" id="upp-fab-group" aria-label="快照分组" title="${escapeHtml(fabGroup || '全部分组')}">
          <option value="">全部分组</option>
          ${groups.map(group => `<option value="${escapeHtml(group)}" ${group === fabGroup ? 'selected' : ''}>${escapeHtml(group)}</option>`).join('')}
        </select>
      </div>
      <div class="upp-fab-pop-list" id="upp-fab-pop-list"></div>
      <div class="upp-fab-pop-foot">
        <button type="button" class="upp-btn primary" id="upp-fab-save-btn">${ICONS.plus}<span>保存快照</span></button>
      </div>
    `;
    renderFabPopList();
  }

  function openFabSave() {
    const charName = readCurrentCharInfo().name;
    fabDraft = buildSnapshotDraft(fabGroup || charName, {
      charName, personaName: Host.getCurrentPersona()?.name, presetName: Host.getLoadedPresetName(),
    });
    elFabPop.innerHTML = `
      <div class="upp-fab-pop-head"><span>保存快照</span></div>
      <div class="upp-fab-pop-list upp-fab-save-body">
        <label class="upp-field">名称<input type="text" class="upp-text-input" id="upp-fab-save-name" spellcheck="false" maxlength="60" value="${escapeHtml(fabDraft.name)}" /></label>
        ${renderSnapshotRoutes(fabDraft.name)}
        <label class="upp-field">分组<input type="text" class="upp-text-input" id="upp-fab-save-group" spellcheck="false" maxlength="30" value="${escapeHtml(fabDraft.group)}" /></label>
        <label class="upp-field">备注<input type="text" class="upp-text-input" id="upp-fab-save-note" spellcheck="false" maxlength="120" /></label>
      </div>
      <div class="upp-fab-pop-foot">
        <button type="button" class="upp-btn" id="upp-fab-save-back">返回</button>
        <button type="button" class="upp-btn primary" id="upp-fab-save-confirm">保存</button>
      </div>
    `;
  }
  function openFabPop() {
    state.store = loadStore();
    applyThemeAll();
    renderFabPop();
    elFabPop.hidden = false;
    fabPopOpen = true;
    elFabBtn.setAttribute('aria-expanded', 'true');
    positionFabPop();
  }

  function closeFabPop() {
    if (!fabPopOpen) return;
    fabPopOpen = false;
    fabDraft = null;
    elFabPop.hidden = true;
    elFabBtn.setAttribute('aria-expanded', 'false');
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
    if (fabPopOpen && !fabDraft) renderFabPopList();
  }

  function fabRect() {
    return elFabBtn.getBoundingClientRect();
  }

  // 面板展开时拖动悬浮球 → 让面板跟着让位：浮动窗口整体挪开，全屏窗口给顶/底操作条留出让位空间
  function adaptPanelToFab() {
    if (!elModal || !state.open || state.minimized) return;
    const ball = fabRect();
    const rect = elModal.getBoundingClientRect();
    const pad = 10;
    const overlaps = ball.right + pad > rect.left && ball.left - pad < rect.right
      && ball.bottom + pad > rect.top && ball.top - pad < rect.bottom;
    const clearClasses = [
      'is-fab-clear-head-l', 'is-fab-clear-head-r',
      'is-fab-clear-foot-l', 'is-fab-clear-foot-r',
    ];
    elModal.classList.remove(...clearClasses);
    if (!overlaps) {
      if (modalGeo.floating) reclampModalGeometry();
      return;
    }
    // 球与面板重叠时不再搬动面板：面板落点由用户决定，球自己可拖走，
    // 只在手机窄窗时给顶/底操作条留出让位内边距，避免球压住标题或按钮
    const footerRect = elFooter?.getBoundingClientRect();
    const headerRect = elHeader?.getBoundingClientRect();
    const ballCenterX = ball.left + ball.width / 2;
    const side = ballCenterX < rect.left + rect.width / 2 ? 'l' : 'r';
    if (footerRect && ball.bottom > footerRect.top && ball.top < footerRect.bottom) {
      elModal.classList.add(`is-fab-clear-foot-${side}`);
    } else if (headerRect && ball.bottom > headerRect.top && ball.top < headerRect.bottom) {
      elModal.classList.add(`is-fab-clear-head-${side}`);
    }
  }

  elFabBtn.addEventListener('pointerdown', ev => {
    if (fabDragging || (ev.button !== 0 && ev.pointerType === 'mouse')) return;
    fabDragging = true;
    fabPointerId = ev.pointerId;
    fabMoved = false;
    fabStartX = ev.clientX;
    fabStartY = ev.clientY;
    const rect = elFabBtn.getBoundingClientRect();
    fabOrigLeft = rect.left;
    fabOrigTop = rect.top;
    try { elFabBtn.setPointerCapture(ev.pointerId); } catch (_) {}
  }, { signal: ac.signal });

  elFabBtn.addEventListener('pointermove', ev => {
    if (!fabDragging || ev.pointerId !== fabPointerId) return;
    const dx = ev.clientX - fabStartX;
    const dy = ev.clientY - fabStartY;
    if (!fabMoved && Math.hypot(dx, dy) >= 6) {
      fabMoved = true;
      elFabBtn.classList.add('is-dragging');
      closeFabPop();
    }
    if (!fabMoved) return;
    const bounds = fabBounds();
    const left = Math.min(bounds.right, Math.max(bounds.left, fabOrigLeft + dx));
    const top = Math.min(bounds.bottom, Math.max(bounds.top, fabOrigTop + dy));
    elFabBtn.style.left = Math.round(left) + 'px';
    elFabBtn.style.top = Math.round(top) + 'px';
  }, { signal: ac.signal });

  function finishFabPointer(ev) {
    if (!fabDragging || ev.pointerId !== fabPointerId) return;
    fabDragging = false;
    elFabBtn.classList.remove('is-dragging');
    try { elFabBtn.releasePointerCapture(ev.pointerId); } catch (_) {}
    if (fabMoved) {
      const { left, top, right, bottom, height } = fabBounds();
      const x = parseFloat(elFabBtn.style.left);
      const y = parseFloat(elFabBtn.style.top);
      state.store = loadStore();
      state.store.settings.fabPosition = [
        (x - left) / Math.max(1, right - left),
        (y - top) / Math.max(1, bottom - top),
      ];
      state.store.settings.fabSide = x < (left + right) / 2 ? 'left' : 'right';
      state.store.settings.fabY = (y + 21) / height;
      persistStore(state.store);
      adaptPanelToFab();
    } else if (ev.type === 'pointerup') {
      if (fabPopOpen) closeFabPop();
      else openFabPop();
    }
  }
  elFabBtn.addEventListener('pointerup', finishFabPointer, { signal: ac.signal });
  elFabBtn.addEventListener('pointercancel', finishFabPointer, { signal: ac.signal });

  elFabBtn.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    if (ev.repeat) return;
    if (fabPopOpen) closeFabPop();
    else openFabPop();
  }, { signal: ac.signal });

  function handleFabInput(target) {
    if (target.id === 'upp-fab-search') {
      fabSearchQuery = target.value;
      renderFabPopList();
    } else if (fabDraft && target.id === 'upp-fab-save-group') {
      updateSnapshotNaming(fabDraft, target.value, shadow.getElementById('upp-fab-save-name'), elFabPop);
    } else if (fabDraft && target.id === 'upp-fab-save-name') {
      syncSnapshotRouteButtons(elFabPop, target.value);
    }
  }

  elFabPop.addEventListener('compositionstart', ev => {
    if (ev.target) ev.target._uppComposing = true;
  }, { signal: ac.signal });
  elFabPop.addEventListener('compositionend', ev => {
    if (!ev.target) return;
    ev.target._uppComposing = false;
    handleFabInput(ev.target);
  }, { signal: ac.signal });
  elFabPop.addEventListener('input', ev => {
    if (ev.isComposing || ev.target?._uppComposing) return;
    handleFabInput(ev.target);
  }, { signal: ac.signal });
  elFabPop.addEventListener('change', ev => {
    if (ev.target.id === 'upp-fab-group') {
      fabGroup = ev.target.value;
      ev.target.title = fabGroup || '全部分组';
      renderFabPopList();
      shadow.getElementById('upp-fab-pop-list').scrollTop = 0;
    } else if (ev.target.id === 'upp-fab-auto-sw') {
      state.store = loadStore();
      state.store.settings.autoApplyBindings = ev.target.checked;
      if (ev.target.checked) lastAutoKey = '';
      persistStore(state.store);
      if (state.open && state.tab === 'snapshots') renderSnapshotsToolbar();
    }
  }, { signal: ac.signal });

  let fabSaving = false;
  elFabPop.addEventListener('click', async ev => {
    const t = ev.target;
    if (t.closest('#upp-fab-save-btn')) {
      if (!fabSaving) openFabSave();
      return;
    }
    if (t.closest('#upp-fab-save-back')) {
      fabDraft = null;
      renderFabPop();
      return;
    }
    const route = t.closest('[data-snapshot-route]');
    if (route && fabDraft) {
      toggleSnapshotRoute(elFabPop, shadow.getElementById('upp-fab-save-name'), route.dataset.snapshotRoute);
      return;
    }
    const confirm = t.closest('#upp-fab-save-confirm');
    if (confirm && fabDraft && !fabSaving) {
      const draft = fabDraft;
      const group = shadow.getElementById('upp-fab-save-group').value.trim();
      const name = shadow.getElementById('upp-fab-save-name').value.trim() || snapshotNames(draft.namingContext, group).primary;
      const note = shadow.getElementById('upp-fab-save-note').value.trim();
      if (!Object.values(draft.scope).some(Boolean)) {
        toast('请至少勾选一项保存范围', 'warning');
        return;
      }
      fabSaving = true;
      confirm.disabled = true;
      try {
        const contextKey = () => JSON.stringify([readCurrentChatId(), readCurrentCharInfo().id, Host.getLoadedPresetName()]);
        const capturedContext = contextKey();
        const snapshot = await captureLiveSnapshot({ name, group, note, scope: draft.scope }, loadStore());
        if (ac.signal.aborted) return;
        if (contextKey() !== capturedContext) {
          toast('聊天或预设已切换，请重新保存', 'warning');
          return;
        }
        state.store = loadStore();
        state.store.snapshots.unshift(snapshot);
        persistStore(state.store);
        if (fabDraft === draft) {
          fabDraft = null;
          if (fabGroup) fabGroup = group;
          renderFabPop();
        } else if (fabPopOpen && !fabDraft) {
          renderFabPopList();
        }
        if (state.open && state.tab === 'snapshots') {
          renderSnapshotsToolbar();
          renderSnapshotsBody();
        }
        toast(`已保存快照「${snapshot.name}」`, 'success');
      } catch (err) {
        toast('保存失败：' + (err?.message || err), 'error');
      } finally {
        fabSaving = false;
        confirm.disabled = false;
      }
      return;
    }
    const applyItem = t.closest('[data-fab-apply]');
    if (applyItem) {
      const snap = loadStore().snapshots.find(s => s.id === applyItem.dataset.fabApply);
      closeFabPop();
      if (snap) await requestApplySnapshot(snap, { fromFab: true });
    }
  }, { signal: ac.signal });
  elFabVisBtn.addEventListener('click', () => {
    state.store = loadStore();
    state.store.settings.showFloatingBall = !(state.store.settings.showFloatingBall !== false);
    persistStore(state.store);
    syncFabUi();
    if (state.open && state.minimized) positionRestorePill();
    toast(state.store.settings.showFloatingBall ? '已显示悬浮球' : '已隐藏悬浮球');
  }, { signal: ac.signal });

  document.addEventListener('pointerdown', ev => {
    if (!fabPopOpen) return;
    const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [];
    if (path.includes(elFabPop) || path.includes(elFabBtn)) return;
    closeFabPop();
  }, { capture: true, signal: ac.signal });

  const handleSelect2Opening = () => { closeFabPop(); };
  if (typeof window.jQuery === 'function') {
    try { window.jQuery(document).on('select2:opening.upp', handleSelect2Opening); } catch (_) {}
  }
  document.addEventListener('select2:opening', handleSelect2Opening, { capture: true, signal: ac.signal });

  // 旋转、软键盘、宿主主题热切换后重新读取主题色，保证面板底色始终是实底
  let themeRefreshTimer = null;
  function scheduleThemeRefresh() {
    if (themeRefreshTimer) return;
    themeRefreshTimer = window.setTimeout(() => {
      themeRefreshTimer = null;
      try { applyThemeAll(); } catch (_) {}
      try { syncModalLayoutClasses(); } catch (_) {}
    }, 140);
  }

  function handleViewportChange() {
    scheduleThemeRefresh();
    if (state.store.settings.showFloatingBall !== false) {
      positionFab();
      if (fabPopOpen) positionFabPop();
    }
    if (state.open && state.minimized) {
      positionRestorePill();
    } else if (state.open && !state.minimized) {
      reclampModalGeometry();
      adaptPanelToFab();
    }
  }
  window.addEventListener('resize', handleViewportChange, { signal: ac.signal });
  window.addEventListener('orientationchange', handleViewportChange, { signal: ac.signal });
  window.visualViewport?.addEventListener('resize', handleViewportChange, { signal: ac.signal });
  window.addEventListener('pageshow', scheduleThemeRefresh, { signal: ac.signal });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleThemeRefresh();
  }, { signal: ac.signal });

  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      handleEscapeKey();
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

  let presetSyncTimer = null;
  function handleHostPresetChanged() {
    if (fabPopOpen && !fabDraft) renderFabPopList();
    if (!state.open || state.minimized || isApplyingSnapshot) return;
    if (presetSyncTimer) window.clearTimeout(presetSyncTimer);
    presetSyncTimer = window.setTimeout(() => {
      presetSyncTimer = null;
      if (!state.open || isApplyingSnapshot) return;
      state.presets = Host.listPresets();
      state.loadedPresetName = Host.getLoadedPresetName();
      syncPresetViewData();
      if (state.tab === 'preset') { renderPresetToolbar(); renderPresetBody(); }
      renderFooter();
    }, 250);
  }

  eventSource.on(event_types.CHAT_CHANGED, scheduleAutoApply);
  eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, handleHostPresetChanged);

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

  function syncNativePersonaBar() {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById(NATIVE_PERSONA_BAR_ID);
    if (!isNativePersonaBarEnabled()) {
      existing?.remove();
      return;
    }
    const block = document.querySelector('#persona_management .persona_controls_buttons_block')
      || document.querySelector('.persona_controls_buttons_block');
    if (!block) {
      existing?.remove();
      return;
    }
    const curP = Host.getCurrentPersona();
    const storeNow = state.store || loadStore();
    const versions = curP ? (storeNow.personaVersions?.[curP.avatar_id] || []) : [];

    let bar = existing;
    if (!bar || bar.parentElement !== block) {
      existing?.remove();
      bar = document.createElement('div');
      bar.id = NATIVE_PERSONA_BAR_ID;
      bar.className = 'upp-native-persona-bar';
      const stopNative = ev => { ev.stopPropagation(); };
      bar.addEventListener('mousedown', stopNative, { signal: ac.signal });
      bar.addEventListener('pointerdown', stopNative, { signal: ac.signal });
      bar.addEventListener('touchstart', stopNative, { signal: ac.signal, passive: true });
      bar.addEventListener('click', async ev => {
        ev.stopPropagation();
        const t = ev.target;
        if (t.closest('#upp-native-apply-ver-btn')) {
          const p = Host.getCurrentPersona();
          const vid = bar.querySelector('#upp-native-ver-sel')?.value || '';
          const st = loadStore();
          const ver = p ? (st.personaVersions?.[p.avatar_id] || []).find(v => v.id === vid) : null;
          if (!p || !ver) return;
          autoBackupPersonaBeforeOverwrite(st, p);
          persistStore(st);
          if (ver.displayName && ver.displayName !== p.name) {
            await Host.renamePersonaInPlace(p.avatar_id, ver.displayName);
          }
          await Host.updatePersonaInPlace(p.avatar_id, ver.description, ver.lorebook || undefined);
          syncNativePersonaBar();
          if (state.open) await refreshAll(false);
          toast(`已切换至内部版本「${ver.name}」`, 'success');
          return;
        }
        if (t.closest('#upp-native-release-ver-btn')) {
          const p = Host.getCurrentPersona();
          const vid = bar.querySelector('#upp-native-ver-sel')?.value || '';
          const st = loadStore();
          const ver = p ? (st.personaVersions?.[p.avatar_id] || []).find(v => v.id === vid) : null;
          if (!p || !ver) return;
          try {
            const payload = buildReleaseVersionToNativePayload(ver, Host.listPersonas());
            const avatarBlob = await Host.fetchPersonaAvatarBlob(p.avatar_id);
            await Host.createNativePersona({ ...payload, avatarBlob });
            syncNativePersonaBar();
            if (state.open) await refreshAll(false);
            toast(`已将「${ver.name}」放回原生 User 列表（${payload.name}）`, 'success');
          } catch (err) {
            toast('放回原生失败：' + (err?.message || err), 'error');
          }
        }
      }, { signal: ac.signal });
      block.appendChild(bar);
    }

    bar.innerHTML = `
      ${versions.length ? `
        <select class="upp-native-select" id="upp-native-ver-sel" title="当前 User 的内部版本">
          ${versions.map(v => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.name)}${v.displayName ? ` (${escapeHtml(v.displayName)})` : ''}</option>`).join('')}
        </select>
        <button type="button" class="menu_button upp-native-btn" id="upp-native-apply-ver-btn">切版本</button>
        <button type="button" class="menu_button upp-native-btn" id="upp-native-release-ver-btn">放回原生</button>
      ` : ''}
    `;
  }

  document.body.appendChild(host);
  syncFabUi();
  mountWandMenu();
  syncNativePersonaBar();
  function onAppReady() {
    mountWandMenu();
    syncFabUi();
    syncNativePersonaBar();
  }
  eventSource.on(event_types.APP_READY, onAppReady);

  activeCleanup = () => {
    ac.abort();
    dragState = null;
    resizeState = null;
    fabDragging = false;
    document.getElementById(NATIVE_PERSONA_BAR_ID)?.remove();
    if (autoTimer) { window.clearTimeout(autoTimer); autoTimer = null; }
    if (presetSyncTimer) { window.clearTimeout(presetSyncTimer); presetSyncTimer = null; }
    if (backfillIdleId !== null) {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(backfillIdleId);
      else window.clearTimeout(backfillIdleId);
      backfillIdleId = null;
    }
    try {
      if (typeof window.jQuery === 'function') {
        window.jQuery(document).off('select2:opening.upp', handleSelect2Opening);
      }
      eventSource.removeListener?.(event_types.CHAT_CHANGED, scheduleAutoApply);
      eventSource.removeListener?.(event_types.OAI_PRESET_CHANGED_AFTER, handleHostPresetChanged);
      eventSource.removeListener?.(event_types.APP_READY, onAppReady);
      eventSource.off?.(event_types.CHAT_CHANGED, scheduleAutoApply);
      eventSource.off?.(event_types.OAI_PRESET_CHANGED_AFTER, handleHostPresetChanged);
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
