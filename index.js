import {
  characters,
  chat_metadata,
  eventSource,
  event_types,
  getCurrentChatId,
  getRequestHeaders,
  reloadCurrentChat,
  saveSettingsDebounced,
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
  buildCleanCopyText,
  buildPresetRenderNodes,
  buildSnapshotPresetInspectModel,
  computeLineDiff,
  createEmptyStore,
  detectProliferatedPersonas,
  escapeHtml,
  exportStoreJson,
  formatTimeShort,
  groupWorldbooksByOrganizer,
  inferThemeFromTextColor,
  inspectTagHygiene,
  normalizeNativePreset,
  normalizeText,
  parseImportJson,
  pickActivePromptOrder,
  resolveBindingForContext,
  sanitizeStore,
  uid,
} from './core.js';

const EXT_KEY = 'user_persona_snapshot';
const LEGACY_LOCAL_KEY = 'userPersonaPicker.v6';
const HOST_ID = 'user-persona-picker-host';
const MENU_ENTRY_ID = 'user-persona-picker-menu-entry';
const SETTINGS_BOX_ID = 'user-persona-picker-ext-settings';

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
  if (t && typeof t[type] === 'function') t[type](String(msg), 'User 组装与快照');
  else console.log('[User组装与快照]', msg);
}

function detectHostTheme() {
  try {
    const rootStyle = window.getComputedStyle(document.documentElement);
    const hasIgLight = !!rootStyle.getPropertyValue('--ig-panel-bg').trim();
    const bodyColor = window.getComputedStyle(document.body || document.documentElement).color;
    const smartColor = rootStyle.getPropertyValue('--SmartThemeBodyColor').trim();
    return inferThemeFromTextColor(bodyColor || smartColor, hasIgLight);
  } catch (_) {
    return 'dark';
  }
}

function readHostThemeVars() {
  try {
    const rs = window.getComputedStyle(document.documentElement);
    const getVar = name => rs.getPropertyValue(name).trim();
    const bodyColor = getVar('--SmartThemeBodyColor') || window.getComputedStyle(document.body || document.documentElement).color;
    const isLight = inferThemeFromTextColor(bodyColor, !!getVar('--ig-panel-bg')) === 'light';
    const blurBg = getVar('--SmartThemeBlurTintColor') || getVar('--color-bg-main');
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
  ['--bg', '--surface', '--surface-strong', '--border', '--border-strong', '--text', '--accent', '--accent-soft', '--accent-text'].forEach(k => {
    el.style.removeProperty(k);
  });
  if (resolvedMode === 'host') {
    const hv = readHostThemeVars();
    el.dataset.theme = hv.isLight ? 'glass-light' : 'glass-dark';
    if (hv.blurBg) el.style.setProperty('--bg', hv.blurBg);
    if (hv.bodyColor) el.style.setProperty('--text', hv.bodyColor);
    if (hv.borderCol) {
      el.style.setProperty('--border', hv.borderCol);
      el.style.setProperty('--border-strong', hv.borderCol);
    }
    if (hv.emCol && !/^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,?\s*0?\s*\)$/i.test(hv.emCol)) {
      el.style.setProperty('--accent', hv.emCol);
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

function getBaiBaiRuntimeState() {
  try {
    const rt = globalThis.__baiBaiToolkitExtensionInstalled?.presetPromptGroupRuntimeState;
    if (rt && Array.isArray(rt.groups) && rt.groups.length) return rt;
  } catch (_) {}
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
  async deletePersonaById(avatarId) {
    if (!avatarId) return false;
    // Must delete the avatar file on backend too, otherwise ST resurrects it as [Unnamed Persona]
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
      return avatars.filter(id => {
        if (!id || id === user_avatar) return false;
        const name = map[id];
        return !name || !String(name).trim() || String(name).trim() === '[Unnamed Persona]';
      });
    } catch (_) {
      return [];
    }
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
  async getWorldbookEntries(bookName) {
    if (!bookName || !world_names.includes(bookName)) return [];
    const data = await loadWorldInfo(bookName);
    if (!data || !data.entries) return [];
    return Object.values(data.entries).map(e => ({
      uid: e.uid,
      name: String(e.comment || (Array.isArray(e.key) ? e.key.filter(Boolean).join(', ') : '') || `条目 #${e.uid}`),
      enabled: !e.disable,
      content: String(e.content || ''),
      strategyType: e.vectorized ? 'vectorized' : (e.constant ? 'constant' : 'selective'),
      order: Number(e.order ?? 100),
      raw: e,
    })).sort((a, b) => a.order - b.order || Number(a.uid) - Number(b.uid));
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

  // --- Presets (Native + ANY on-disk preset + BaiBai runtime sync!) ---
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
    return normalizeNativePreset(oai, getBaiBaiRuntimeState(), this.getActiveDiskPreset());
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
    const canonicalGroups = getBaiBaiRuntimeState()
      || oai.extensions?.baibaiToolkit?.presetPromptGroups
      || disk?.extensions?.baibaiToolkit?.presetPromptGroups;
    if (canonicalGroups) {
      if (!payload.extensions || typeof payload.extensions !== 'object') payload.extensions = {};
      if (!payload.extensions.baibaiToolkit || typeof payload.extensions.baibaiToolkit !== 'object') {
        payload.extensions.baibaiToolkit = {};
      }
      payload.extensions.baibaiToolkit.presetPromptGroups = structuredClone({
        version: 1,
        groups: canonicalGroups.groups || [],
        prompts: canonicalGroups.prompts || {},
      });
    }
    if (typeof mgr.savePreset === 'function') {
      await mgr.savePreset(curName, payload, { skipUpdate: true });
    }
    if (disk && payload.extensions?.baibaiToolkit?.presetPromptGroups) {
      if (!disk.extensions || typeof disk.extensions !== 'object') disk.extensions = {};
      if (!disk.extensions.baibaiToolkit || typeof disk.extensions.baibaiToolkit !== 'object') disk.extensions.baibaiToolkit = {};
      disk.extensions.baibaiToolkit.presetPromptGroups = structuredClone(payload.extensions.baibaiToolkit.presetPromptGroups);
    }
  },
  applyBaiBaiGroupMapInMemory(groupMap, { syncToDiskCache = true } = {}) {
    const oai = getContext()?.chatCompletionSettings;
    const disk = this.getActiveDiskPreset();
    const bbExt = globalThis.__baiBaiToolkitExtensionInstalled;
    const runtime = getBaiBaiRuntimeState();
    const canonical = runtime
      || oai?.extensions?.baibaiToolkit?.presetPromptGroups
      || disk?.extensions?.baibaiToolkit?.presetPromptGroups;
    if (!canonical || !Array.isArray(canonical.groups)) {
      return { changed: 0, matched: new Set() };
    }

    // Ensure oai.extensions.baibaiToolkit.presetPromptGroups exists so ST persists it in settings.json
    if (oai) {
      if (!oai.extensions || typeof oai.extensions !== 'object') oai.extensions = {};
      if (!oai.extensions.baibaiToolkit || typeof oai.extensions.baibaiToolkit !== 'object') {
        oai.extensions.baibaiToolkit = {};
      }
      if (!oai.extensions.baibaiToolkit.presetPromptGroups || !Array.isArray(oai.extensions.baibaiToolkit.presetPromptGroups.groups)) {
        oai.extensions.baibaiToolkit.presetPromptGroups = structuredClone({
          version: 1,
          groups: canonical.groups,
          prompts: canonical.prompts || {},
        });
      }
    }

    // Collect every live & cached group array to keep BaiBai, ST promptManager, oai, and preset cache 100% synced
    const targets = [];
    if (runtime?.groups) targets.push(runtime.groups);
    if (oai?.extensions?.baibaiToolkit?.presetPromptGroups?.groups) {
      targets.push(oai.extensions.baibaiToolkit.presetPromptGroups.groups);
    }
    const pmGroups = getContext()?.promptManager?.serviceSettings?.extensions?.baibaiToolkit?.presetPromptGroups?.groups;
    if (Array.isArray(pmGroups)) targets.push(pmGroups);
    if (syncToDiskCache && disk?.extensions?.baibaiToolkit?.presetPromptGroups?.groups) {
      targets.push(disk.extensions.baibaiToolkit.presetPromptGroups.groups);
    }

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

    // Also patch BaiBai's live Vue list items & clear its sync key so its UI reflects the toggle immediately
    if (bbExt && typeof bbExt === 'object') {
      try { delete bbExt.presetPromptGroupExtensionSyncKey; } catch (_) {}
      Object.values(bbExt).forEach(val => {
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
    }

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
    const { changed, matched } = this.applyBaiBaiGroupMapInMemory({ [String(groupId)]: !!enabled }, { syncToDiskCache: true });
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
      const grpRes = this.applyBaiBaiGroupMapInMemory(groupMap, { syncToDiskCache: true });
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
      norm.prompts.forEach(p => { map[p.id] = !!p.enabled; });
      const grpMap = {};
      norm.groups.forEach(g => { grpMap[g.id] = g.enabled !== false; });
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
      global: mapList(await Host.getRegexes('global')),
      character: mapList(await Host.getRegexes('character')),
      preset: mapList(await Host.getRegexes('preset')),
    };
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
      const entriesMap = snap.worldbooks.entries || {};
      for (const bk of Object.keys(entriesMap)) {
        if (!allBooks.has(bk)) { totalSkipped++; continue; }
        const res = await Host.batchToggleWorldbookEntries(bk, entriesMap[bk]);
        totalSkipped += res.skipped;
      }
    }

    if (snap.scope.preset && snap.preset) {
      if (snap.preset.name) {
        const wasSame = Host.getLoadedPresetName() === snap.preset.name;
        const ok = await Host.selectPresetByName(snap.preset.name);
        if (ok) {
          // Wait briefly after preset switch so BaiBai finishes initializing runtime group state before we override it
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
    console.error('[User组装与快照] 应用失败', err);
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

/* Theme Palettes: paper (default warm paper & ink) | glass-light | glass-dark */
.upp-backdrop,
.upp-fab-root {
  --bg: #fbfbfb;
  --surface: #f4f4f4;
  --surface-strong: #ffffff;
  --surface-hover: #eaeae6;
  --border: #e2e2de;
  --border-strong: #cfcfca;
  --text: #262626;
  --muted: #777777;
  --accent: #56819a;
  --accent-soft: rgba(86, 129, 154, 0.13);
  --accent-text: #ffffff;
  --ok: #4f8689;
  --ok-soft: rgba(79, 134, 137, 0.14);
  --warn: #a66e38;
  --warn-soft: rgba(166, 110, 56, 0.13);
  --danger: #a53c3c;
  --danger-soft: rgba(165, 60, 60, 0.11);
  --switch-off: #d4d4d0;
  --shadow: 0 18px 46px rgba(38, 38, 38, 0.14);
  --modal-blur: 0px;
}

.upp-backdrop[data-theme="glass-light"],
.upp-fab-root[data-theme="glass-light"] {
  --bg: rgba(247, 249, 253, 0.94);
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
  --modal-blur: 22px;
}

.upp-backdrop[data-theme="glass-dark"],
.upp-fab-root[data-theme="glass-dark"] {
  --bg: rgba(24, 28, 37, 0.96);
  --surface: rgba(36, 42, 56, 0.82);
  --surface-strong: rgba(42, 49, 64, 0.97);
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
  --modal-blur: 22px;
}

.upp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  background: rgba(24, 24, 24, 0.34);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  color: var(--text);
}
.upp-backdrop[data-theme="glass-dark"] { background: rgba(5, 8, 14, 0.62); }
.upp-fab-root { color: var(--text); }

.upp-modal {
  position: relative;
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

.upp-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 16px 9px;
  border-bottom: 1px solid var(--border);
}
.upp-title-wrap { display: flex; align-items: center; gap: 8px; min-width: 0; }
.upp-title { font-size: 15px; font-weight: 650; letter-spacing: -0.01em; white-space: nowrap; }
.upp-ctx-chip {
  font-size: 11px; color: var(--muted); background: var(--surface); border: 1px solid var(--border);
  border-radius: 999px; padding: 2px 8px; max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.upp-head-actions { display: flex; align-items: center; gap: 6px; }

.upp-tabs {
  flex-shrink: 0; display: flex; align-items: center; gap: 5px;
  padding: 7px 16px; border-bottom: 1px solid var(--border); background: var(--surface);
  overflow-x: auto; scrollbar-width: none;
}
.upp-tabs::-webkit-scrollbar { display: none; }
.upp-tab {
  height: 30px; padding: 0 12px; border-radius: 9px; border: 1px solid transparent;
  background: transparent; color: var(--muted); font-size: 12.5px; font-weight: 550;
  cursor: pointer; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; flex-shrink: 0;
  transition: background 0.14s, color 0.14s, border-color 0.14s;
}
.upp-tab:hover { color: var(--text); background: var(--surface-hover); }
.upp-tab.active { color: var(--accent); background: var(--accent-soft); border-color: rgba(58, 123, 213, 0.28); }
.upp-tab-count { font-size: 11px; opacity: 0.78; }

.upp-toolbar {
  flex-shrink: 0; display: flex; flex-direction: column; gap: 8px;
  padding: 10px 16px; border-bottom: 1px solid var(--border);
}
.upp-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.upp-row-nowrap { display: flex; align-items: center; gap: 6px; min-width: 0; }
.upp-spacer { flex: 1; min-width: 4px; }

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
.upp-btn.active { background: var(--accent-soft); color: var(--accent); border-color: rgba(58, 123, 213, 0.35); }
.upp-btn.danger { color: var(--danger); }
.upp-btn.danger:hover { background: var(--danger-soft); border-color: rgba(214, 69, 69, 0.35); }
.upp-btn.pinned { color: var(--warn); background: var(--warn-soft); border-color: rgba(199, 119, 22, 0.32); }

.upp-select { padding: 0 24px 0 9px; cursor: pointer; max-width: 220px; outline: none; }
.upp-select:focus { border-color: var(--accent); }

.upp-input-wrap {
  display: inline-flex; align-items: center; gap: 6px; padding: 0 9px; flex: 1; min-width: 120px;
}
.upp-input-wrap svg { color: var(--muted); flex-shrink: 0; }
.upp-input-wrap input {
  width: 100%; border: none; background: transparent; color: var(--text); font-size: 12px; font-family: inherit; outline: none;
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
.upp-foot-status {
  min-width: 0; display: flex; align-items: center; gap: 6px; font-size: 12px;
  color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.upp-foot-status strong { color: var(--text); font-weight: 600; }
.upp-foot-actions { display: flex; align-items: center; gap: 7px; flex-shrink: 0; }
.upp-foot-actions .upp-btn { height: 32px; padding: 0 12px; }

.upp-pill-strip { display: flex; align-items: center; gap: 6px; overflow-x: auto; padding-bottom: 1px; scrollbar-width: none; }
.upp-pill-strip::-webkit-scrollbar { display: none; }
.upp-pill {
  height: 28px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--border);
  background: var(--surface); color: var(--muted); font-size: 12px; cursor: pointer;
  white-space: nowrap; flex-shrink: 0; display: inline-flex; align-items: center; gap: 5px;
}
.upp-pill:hover { color: var(--text); border-color: var(--border-strong); }
.upp-pill.active { color: var(--accent); background: var(--accent-soft); border-color: rgba(58, 123, 213, 0.35); font-weight: 550; }

.upp-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: 13px;
  padding: 11px 13px; display: flex; flex-direction: column; gap: 8px;
}
.upp-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.upp-card-title { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.upp-card-meta { font-size: 11.5px; color: var(--muted); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.upp-badge {
  display: inline-flex; align-items: center; gap: 3px; padding: 1px 7px; border-radius: 999px;
  font-size: 11px; border: 1px solid var(--border); background: var(--surface-strong); color: var(--muted); white-space: nowrap;
}
.upp-badge.accent { color: var(--accent); background: var(--accent-soft); border-color: rgba(58, 123, 213, 0.28); }
.upp-badge.ok { color: var(--ok); background: var(--ok-soft); border-color: rgba(29, 154, 108, 0.28); }
.upp-badge.warn { color: var(--warn); background: var(--warn-soft); border-color: rgba(199, 119, 22, 0.3); }

/* BaiBai Collapsible Group Box (shared by Preset tab AND Snapshot Detail Viewer!) */
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
.upp-group-box.is-collapsed .upp-group-items { display: none; }

.upp-entry-list { display: flex; flex-direction: column; gap: 5px; }
.upp-entry-row {
  display: flex; align-items: center; gap: 8px; padding: 7px 10px;
  border-radius: 10px; border: 1px solid var(--border); background: var(--surface);
  transition: background 0.12s, border-color 0.12s;
}
.upp-entry-row:hover { background: var(--surface-strong); border-color: var(--border-strong); }
.upp-entry-row.is-on { border-color: rgba(58, 123, 213, 0.28); background: var(--surface-strong); }
.upp-entry-row.is-off { opacity: 0.68; }
.upp-entry-main {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px;
  background: none; border: none; padding: 0; text-align: left; color: inherit; cursor: pointer; font: inherit;
}
.upp-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.upp-dot.constant { background: #3b82f6; }
.upp-dot.selective { background: #22c55e; }
.upp-dot.vectorized { background: #a855f7; }
.upp-dot.snap-on { background: var(--ok); }
.upp-dot.snap-off { background: transparent; border: 1.5px solid var(--muted); }

.upp-role-tag {
  font-size: 10px; font-weight: 650; padding: 1px 5px; border-radius: 5px;
  background: var(--accent-soft); color: var(--accent); flex-shrink: 0; text-transform: uppercase;
}
.upp-role-tag.placeholder { background: var(--surface); color: var(--muted); border: 1px solid var(--border); }
.upp-entry-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.upp-entry-name { font-size: 13px; font-weight: 520; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.upp-entry-preview { font-size: 11.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

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
  border-radius: 10px; background: var(--accent-soft); border: 1px solid rgba(58, 123, 213, 0.25); font-size: 12px;
}

.upp-empty {
  text-align: center; color: var(--muted); padding: 36px 16px; font-size: 13px;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
}

/* Drawers — standard dialog + Full-Modal Snapshot Inspector */
.upp-drawer-mask {
  position: absolute; inset: 0; z-index: 20; background: rgba(15, 22, 36, 0.36);
  display: flex; align-items: center; justify-content: center; padding: 14px;
}
.upp-drawer-mask.is-full { padding: 0; background: var(--bg); }
.upp-drawer {
  width: min(620px, 100%); max-height: 100%; background: var(--surface-strong);
  border: 1px solid var(--border-strong); border-radius: 15px; box-shadow: var(--shadow);
  display: flex; flex-direction: column; overflow: hidden;
}
.upp-drawer.is-full {
  width: 100%; height: 100%; border: none; border-radius: 0; box-shadow: none; background: var(--bg);
}
.upp-drawer-head {
  flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 11px 14px; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 14px;
}
.upp-drawer-toolbar {
  flex-shrink: 0; display: flex; flex-direction: column; gap: 8px;
  padding: 9px 14px; border-bottom: 1px solid var(--border); background: var(--surface);
}
.upp-drawer-body {
  flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px;
  display: flex; flex-direction: column; gap: 8px;
}
.upp-drawer-body > * { flex-shrink: 0; }
.upp-drawer-foot {
  flex-shrink: 0; display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  padding: 10px 14px; border-top: 1px solid var(--border); background: var(--surface);
}

.upp-field { display: flex; flex-direction: column; gap: 4px; }
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
  display: flex; align-items: center; gap: 7px; padding: 7px 9px; border-radius: 9px;
  border: 1px solid var(--border); background: var(--surface); cursor: pointer; font-size: 12px; user-select: none;
}
.upp-check-item input { accent-color: var(--accent); margin: 0; }
.upp-check-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.upp-pop-list {
  max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;
  border: 1px solid var(--border); border-radius: 10px; padding: 6px; background: var(--bg);
}

.upp-diff-box {
  border: 1px solid var(--border); border-radius: 10px; background: var(--bg); padding: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5;
  max-height: 320px; overflow-y: auto; white-space: pre-wrap; word-break: break-word;
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
  cursor: pointer; font-size: 12px; color: var(--text); text-align: left; width: 100%;
}
.upp-detail-item:hover { border-color: var(--accent); background: var(--surface-hover); }

@media (max-width: 640px) {
  .upp-backdrop { padding: 0; align-items: flex-end; }
  .upp-modal { width: 100vw; height: 88dvh; border-radius: 18px 18px 0 0; border-bottom: none; }
  .upp-header { padding: 10px 12px 8px; }
  .upp-tabs { padding: 7px 12px; gap: 4px; }
  .upp-tab { padding: 0 9px; font-size: 12px; }
  .upp-toolbar { padding: 8px 12px; }
  .upp-body { padding: 10px 12px 12px; }
  .upp-footer { padding: 9px 12px; }
  .upp-check-grid { grid-template-columns: 1fr; }
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
}
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
  z-index: 2147482001;
  width: min(260px, calc(100vw - 24px));
  max-height: min(380px, 70dvh);
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
.upp-fab-snap-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 7px 9px;
  border-radius: 9px;
  border: 1px solid transparent;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s, border-color 0.12s;
}
.upp-fab-snap-item:hover { background: var(--surface-hover); border-color: var(--border); }
.upp-fab-snap-item.is-bound { border-color: var(--accent); background: var(--accent-soft); }
.upp-fab-snap-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 550; }
.upp-fab-pop-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-top: 1px solid var(--border);
}
.upp-fab-pop-foot .upp-btn { flex: 1; height: 29px; font-size: 11.5px; padding: 0 8px; }
`;

// =========================
// Extension Runtime Initialization
// =========================

function initExtension() {
  // Remove previous instance cleanly if hot-reloaded
  document.getElementById(HOST_ID)?.remove();
  document.getElementById(MENU_ENTRY_ID)?.remove();
  document.getElementById(SETTINGS_BOX_ID)?.remove();

  const state = {
    open: false,
    tab: 'snapshots', // snapshots | user | worldbook | preset | regex
    store: loadStore(),
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
    livePresetNorm: { prompts: [], groups: [], groupsById: {}, promptGroupMap: {} },
    presetSearch: '',
    presetOnlyOn: false,
    presetFoldState: {},

    regexScope: 'global',
    regexList: [],
    regexSearch: '',
    regexOnlyOn: false,

    drawer: null,
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
<div class="upp-backdrop" hidden>
  <div class="upp-modal" role="dialog" aria-modal="true" aria-label="User 组装与快照">
    <div class="upp-header">
      <div class="upp-title-wrap">
        <span class="upp-title">User 组装与快照</span>
        <span class="upp-ctx-chip" id="upp-ctx-chip" hidden></span>
      </div>
      <div class="upp-head-actions">
        <select class="upp-select" id="upp-theme-select" title="切换面板配色" style="max-width:96px;padding:0 8px;">
          <option value="paper">素纸</option>
          <option value="host">跟随酒馆</option>
          <option value="glass-light">浅色玻璃</option>
          <option value="glass-dark">深色夜间</option>
        </select>
        <button class="upp-btn" id="upp-fab-vis-btn" title="显示或隐藏悬浮球">悬浮球</button>
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

  const elFabRoot = shadow.getElementById('upp-fab-root');
  const elFabBtn = shadow.getElementById('upp-fab-btn');
  const elFabDot = shadow.getElementById('upp-fab-dot');
  const elFabPop = shadow.getElementById('upp-fab-pop');
  const elFabVisBtn = shadow.getElementById('upp-fab-vis-btn');
  const elThemeSelect = shadow.getElementById('upp-theme-select');
  const elBackdrop = shadow.querySelector('.upp-backdrop');
  const elCtxChip = shadow.getElementById('upp-ctx-chip');
  const elTabs = shadow.getElementById('upp-tabs');
  const elToolbar = shadow.getElementById('upp-toolbar');
  const elBody = shadow.getElementById('upp-body');
  const elFooter = shadow.getElementById('upp-footer');
  const elDrawerMask = shadow.getElementById('upp-drawer-mask');

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
    if (state.activeBook && (state.tab === 'worldbook' || forceBookReload)) {
      await ensureBookEntries(state.activeBook, !!forceBookReload);
    }

    state.presets = Host.listPresets();
    state.loadedPresetName = Host.getLoadedPresetName();
    state.livePresetNorm = Host.getLiveNormalizedPreset();
    state.regexList = await Host.getRegexes(state.regexScope);

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
    if (!curP) { elBody.innerHTML = `<div class="upp-empty">未读取到当前 User 人设</div>`; return; }

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
        <span>内部描述版本</span>
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
    if (!activeBook) { elBody.innerHTML = `<div class="upp-empty">酒馆中暂无世界书</div>`; return; }

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
            <span class="upp-dot ${e.strategyType}" title="${e.strategyType === 'constant' ? '蓝灯常驻' : e.strategyType === 'selective' ? '绿灯触发' : '向量'}"></span>
            <div class="upp-entry-text">
              <div class="upp-entry-name">${escapeHtml(e.name)}</div>
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
    const groups = state.livePresetNorm.groups || [];
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
        <button class="upp-btn" id="upp-preset-save-disk-btn" title="将当前开关与分组状态写入预设文件">保存预设</button>
      </div>
    `;
  }

  function renderPresetPromptRowHtml(p) {
    const isPh = p.marker || typeof p.content !== 'string';
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
  // Full-Size Xiaotian-Style Snapshot Detail Viewer
  // =========================

  function renderSnapInspectPresetRow(item) {
    const isPh = item.marker || typeof item.content !== 'string';
    const roleShort = isPh ? '占位' : (item.role === 'user' ? 'USR' : item.role === 'assistant' ? 'AST' : 'SYS');
    const snippet = isPh ? '酒馆原生占位槽位' : String(item.content || '').replace(/\s+/g, ' ').trim().slice(0, 72);
    return `
      <div class="upp-entry-row ${item.effectiveOn ? 'is-on' : 'is-off'}">
        <button class="upp-entry-main" data-view-snap-pr="${escapeHtml(item.id)}">
          <span class="upp-dot ${item.effectiveOn ? 'snap-on' : 'snap-off'}" title="${item.effectiveOn ? '本快照中生效' : '本快照中关闭'}"></span>
          <span class="upp-role-tag ${isPh ? 'placeholder' : ''}">${roleShort}</span>
          <div class="upp-entry-text">
            <div class="upp-entry-name">${escapeHtml(item.name || item.id)}</div>
            <div class="upp-entry-preview">${escapeHtml(snippet || '空正文')}</div>
          </div>
          ${item.statusNote ? `<span class="upp-badge warn">${escapeHtml(item.statusNote)}</span>` : ''}
        </button>
        <button type="button" class="upp-switch" role="switch" aria-checked="${!!item.selfOn}" data-sv-pr-toggle="${escapeHtml(item.id)}" title="切换此条目在本快照中的状态"></button>
      </div>
    `;
  }

  function renderViewSnapshotBody(d) {
    const bodyEl = shadow.getElementById('upp-snap-inspect-body');
    const metaEl = shadow.getElementById('upp-snap-inspect-meta');
    if (!bodyEl) return;

    const s = d.snapshot;
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
          <span class="upp-badge ok">生效 ${model.effectiveOnTotal} / ${model.totalPrompts} 条</span>
          ${model.powerOffGroupCount ? `<span class="upp-badge warn">${model.powerOffGroupCount} 组已关</span>` : ''}
          ${model.missingIds.length ? `<span class="upp-badge">${model.missingIds.length} 条已从预设删除</span>` : ''}
        `;
      }
      if (!model.nodes.length) {
        bodyEl.innerHTML = `<div class="upp-empty">没有匹配的预设条目</div>`;
        return;
      }
      let html = `<div class="upp-entry-list">` + model.nodes.map(node => {
        if (node.type === 'prompt') return renderSnapInspectPresetRow(node.prompt);
        const g = node.group;
        const collapsed = node.forceExpand
          ? false
          : (Object.prototype.hasOwnProperty.call(d.foldMap, g.id) ? !!d.foldMap[g.id] : (node.effectiveOnCount === 0));
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
              <button type="button" class="upp-switch" role="switch" aria-checked="${!!g.enabled}" data-sv-grp-toggle="${escapeHtml(g.id)}" title="整组总开关（直接保存）"></button>
            </div>
            <div class="upp-group-items">
              ${node.items.map(it => renderSnapInspectPresetRow(it)).join('')}
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
          <span class="upp-badge accent">已录 ${bookNames.length} 本世界书</span>
          ${Array.isArray(s.worldbooks.global) ? `<span class="upp-badge">全局绑定 ${s.worldbooks.global.length} 本</span>` : ''}
        `;
      }
      if (!bookNames.length) {
        bodyEl.innerHTML = `<div class="upp-empty">本快照仅记录全局世界书绑定，未录具体条目开关</div>`;
        return;
      }
      const blocks = bookNames.map(bk => {
        const map = entriesMap[bk] || {};
        const liveList = d.wbDetails[bk] || [];
        const byUid = new Map(liveList.map(e => [String(e.uid), e]));
        const allUids = Object.keys(map);
        const onCount = allUids.filter(u => map[u]).length;
        const rows = allUids.filter(u => {
          if (d.onlyOn && !map[u]) return false;
          if (!q) return true;
          const live = byUid.get(u);
          return normalizeText(bk + ' ' + (live ? (live.name + ' ' + live.content) : u)).includes(q);
        });
        if (!rows.length) return '';
        const collapsed = !!q || d.onlyOn ? false : !!d.foldMap['wb::' + bk];
        return `
          <div class="upp-group-box ${collapsed ? 'is-collapsed' : ''}" data-sv-grp="wb::${escapeHtml(bk)}">
            <div class="upp-group-head">
              <button type="button" class="upp-group-toggle-btn" data-sv-fold="wb::${escapeHtml(bk)}">
                <span class="upp-group-chev">${ICONS.chevron}</span>
                <span class="upp-group-name">${escapeHtml(bk)}</span>
                <span class="upp-badge accent">${onCount}/${allUids.length} 开启</span>
              </button>
            </div>
            <div class="upp-group-items">
              ${rows.map(u => {
                const live = byUid.get(u);
                const on = !!map[u];
                const snippet = live ? String(live.content || '').replace(/\s+/g, ' ').trim().slice(0, 72) : '该条目已从世界书删除';
                return `
                  <div class="upp-entry-row ${on ? 'is-on' : 'is-off'}">
                    <button class="upp-entry-main" data-view-snap-wb="${escapeHtml(bk)}" data-view-snap-uid="${escapeHtml(u)}">
                      <span class="upp-dot ${on ? 'snap-on' : 'snap-off'}"></span>
                      <div class="upp-entry-text">
                        <div class="upp-entry-name">${escapeHtml(live ? live.name : `已删除条目 #${u}`)}</div>
                        <div class="upp-entry-preview">${escapeHtml(snippet || '空正文')}</div>
                      </div>
                    </button>
                    <button type="button" class="upp-switch" role="switch" aria-checked="${on}" data-sv-wb-toggle="${escapeHtml(bk)}" data-sv-wb-uid="${escapeHtml(u)}"></button>
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
          <span class="upp-badge">全局开 ${cnt('global')}</span>
          <span class="upp-badge">角色开 ${cnt('character')}</span>
          <span class="upp-badge">预设开 ${cnt('preset')}</span>
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

  function renderBookPickerList(d) {
    const listEl = shadow.getElementById('upp-book-picker-list');
    if (!listEl) return;
    const { sections } = groupWorldbooksByOrganizer(state.worldbooks, getOrganizerSettings(), {
      pinned: state.store.settings.pinnedWorldbooks,
      globals: state.globalWorldbooks,
      charBooks: [state.charWorldbooks.primary, ...(state.charWorldbooks.additional || [])].filter(Boolean),
      chatBook: state.chatWorldbook,
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
              const sub = item.alias && item.alias !== item.name ? ` <span style="color:var(--muted);font-size:11px;">(${escapeHtml(item.name)})</span>` : '';
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
      const s = d.snapshot;
      const availTabs = [];
      if (s.scope.preset && s.preset) availTabs.push({ id: 'preset', label: '预设' });
      if (s.scope.worldbooks && s.worldbooks) availTabs.push({ id: 'worldbooks', label: '世界书' });
      if (s.scope.persona && s.persona) availTabs.push({ id: 'persona', label: 'User' });
      if (s.scope.regex && s.regex) availTabs.push({ id: 'regex', label: '正则' });
      if (!availTabs.some(t => t.id === d.subTab)) d.subTab = availTabs[0]?.id || 'preset';

      const showFilter = d.subTab === 'preset' || d.subTab === 'worldbooks' || d.subTab === 'regex';
      const showFoldAll = d.subTab === 'preset' && (d.presetNorm?.groups?.length > 0);

      elDrawerMask.innerHTML = `
        <div class="upp-drawer is-full">
          <div class="upp-drawer-head">
            <div class="upp-row-nowrap">
              <button class="upp-btn icon-only" data-drawer-close title="返回">${ICONS.back}</button>
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">快照详情 · ${escapeHtml(s.name)}</span>
            </div>
            <button class="upp-btn primary" data-snap-apply="${s.id}">应用此快照</button>
          </div>
          <div class="upp-tabs" style="padding:7px 14px;">
            ${availTabs.map(t => `<button class="upp-tab ${d.subTab === t.id ? 'active' : ''}" data-sv-tab="${t.id}">${t.label}</button>`).join('')}
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

    if (d.type === 'bookPicker') {
      elDrawerMask.innerHTML = `
        <div class="upp-drawer">
          <div class="upp-drawer-head">
            <span>选择世界书</span>
            <button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            <div class="upp-input-wrap" style="width:100%;">
              ${ICONS.search}
              <input type="text" id="upp-book-search-input" placeholder="输入世界书名称、别名或分组名筛选…" value="${escapeHtml(d.query || '')}" />
            </div>
            <div class="upp-pop-list" id="upp-book-picker-list" style="max-height:390px;"></div>
          </div>
        </div>
      `;
      renderBookPickerList(d);
      window.setTimeout(() => shadow.getElementById('upp-book-search-input')?.focus(), 10);
      return;
    }

    if (d.type === 'entryEditor') {
      const readOnly = !!d.readOnly;
      elDrawerMask.innerHTML = `
        <div class="upp-drawer ${d.fullView ? 'is-full' : ''}">
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
            ${d.showStrategy ? `
              <div class="upp-field">
                <label>激活方式</label>
                <select class="upp-select" id="upp-ed-strategy" style="max-width:none;width:100%;">
                  <option value="constant" ${d.strategyType === 'constant' ? 'selected' : ''}>蓝灯常驻</option>
                  <option value="selective" ${d.strategyType === 'selective' ? 'selected' : ''}>绿灯关键字触发</option>
                </select>
              </div>
            ` : ''}
            <div class="upp-field" style="flex:1;display:flex;flex-direction:column;">
              <label>正文</label>
              <textarea class="upp-textarea" id="upp-ed-content" style="flex:1;min-height:260px;" ${readOnly ? 'readonly' : ''}>${escapeHtml(d.content || '')}</textarea>
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
                ${(() => {
                  const { sections } = groupWorldbooksByOrganizer(state.worldbooks, getOrganizerSettings(), {
                    pinned: state.store.settings.pinnedWorldbooks,
                    globals: state.globalWorldbooks,
                    charBooks: [state.charWorldbooks.primary, ...(state.charWorldbooks.additional || [])].filter(Boolean),
                    chatBook: state.chatWorldbook,
                  });
                  return sections.map(sec => {
                    const names = sec.items.map(it => it.name);
                    const allChecked = names.length > 0 && names.every(n => selectedSet.has(n));
                    const dotHtml = sec.color ? `<span class="upp-wb-dot" style="background:${escapeHtml(sec.color)};"></span>` : '';
                    return `
                      <div class="upp-wb-sec-head">
                        <span class="upp-row-nowrap">${dotHtml}<span>${escapeHtml(sec.name)}（${sec.items.length}）</span></span>
                        <button type="button" class="upp-pill" style="height:22px;font-size:11px;padding:0 8px;" data-ss-toggle-group="${escapeHtml(sec.id)}">${allChecked ? '取消全选' : '全选本组'}</button>
                      </div>
                      ${sec.items.map(it => `
                        <label class="upp-check-item" style="border:none;background:transparent;padding:4px 6px;">
                          <input type="checkbox" data-ss-book="${escapeHtml(it.name)}" ${selectedSet.has(it.name) ? 'checked' : ''} />
                          <span>${escapeHtml(it.displayTitle)}</span>
                          ${it.isPinned ? '<span class="upp-badge warn" style="margin-left:auto;">置顶</span>' : ''}
                        </label>
                      `).join('')}
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
      window.setTimeout(() => shadow.getElementById('upp-ss-name')?.focus(), 10);
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
      window.setTimeout(() => shadow.getElementById('upp-pv-name')?.focus(), 10);
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
      const orphans = Array.isArray(d.orphanAvatars) ? d.orphanAvatars : [];
      elDrawerMask.innerHTML = `
        <div class="upp-drawer">
          <div class="upp-drawer-head">
            <span>整理同名与旧分身 User</span>
            <button class="upp-btn icon-only" data-drawer-close>${ICONS.close}</button>
          </div>
          <div class="upp-drawer-body">
            ${orphans.length ? `
              <div class="upp-bind-strip">
                <span>检测到 ${orphans.length} 个未命名残留头像文件（[Unnamed Persona]）</span>
                <button type="button" class="upp-btn danger" id="upp-clean-orphans-btn">一键清理</button>
              </div>
            ` : ''}
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
  elBackdrop.addEventListener('click', ev => { if (ev.target === elBackdrop) closeModal(); });
  elDrawerMask.addEventListener('click', ev => {
    if (ev.target === elDrawerMask && !elDrawerMask.classList.contains('is-full')) {
      state.drawer = null;
      renderDrawer();
    }
  });

  elFooter.addEventListener('click', async ev => {
    const t = ev.target;
    if (t.closest('#upp-foot-save-snap-btn')) { openSaveSnapshotDrawer(); return; }
    const updBtn = t.closest('#upp-foot-update-btn');
    if (updBtn) await overwriteSnapshotById(updBtn.getAttribute('data-snap-update'));
  });

  elTabs.addEventListener('click', async ev => {
    const btn = ev.target.closest('[data-tab]');
    if (!btn) return;
    const next = btn.getAttribute('data-tab');
    if (next === state.tab) return;
    state.tab = next;
    state.drawer = null;
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
    if (target.closest('#upp-backup-btn')) { state.drawer = { type: 'backup' }; renderDrawer(); return; }
    const gBtn = target.closest('[data-snap-group]');
    if (gBtn) { state.snapGroup = gBtn.getAttribute('data-snap-group') || ''; renderSnapshotsToolbar(); renderSnapshotsBody(); return; }

    if (target.closest('#upp-persona-edit-btn') && state.currentPersona) {
      state.drawer = { type: 'entryEditor', mode: 'editPersona', heading: `编辑 User 正文 · ${state.currentPersona.name}`, content: state.currentPersona.description || '' };
      renderDrawer(); return;
    }
    if (target.closest('#upp-persona-savever-btn') && state.currentPersona) { state.drawer = { type: 'savePersonaVersion', name: '' }; renderDrawer(); return; }
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
      state.drawer = { type: 'mergePersonas', keepId, absorbIds, deleteOld: false, orphanAvatars };
      renderDrawer(); return;
    }

    if (target.closest('#upp-book-picker-btn')) { state.drawer = { type: 'bookPicker', query: '', foldMap: {} }; renderDrawer(); return; }
    if (target.closest('#upp-pin-book-btn') && state.activeBook) {
      const list = state.store.settings.pinnedWorldbooks;
      const idx = list.indexOf(state.activeBook);
      if (idx >= 0) list.splice(idx, 1); else list.unshift(state.activeBook);
      persistStore(state.store); renderWorldbookToolbar(); return;
    }
    if (target.closest('#upp-global-book-btn') && state.activeBook) {
      const next = new Set(state.globalWorldbooks);
      if (next.has(state.activeBook)) next.delete(state.activeBook); else next.add(state.activeBook);
      await Host.setGlobalWorldbooks(Array.from(next));
      state.globalWorldbooks = Host.getGlobalWorldbooks();
      renderWorldbookToolbar(); return;
    }
    if (target.closest('#upp-new-wb-entry-btn') && state.activeBook) {
      state.drawer = { type: 'entryEditor', mode: 'createWb', heading: `新建条目 · ${state.activeBook}`, bookName: state.activeBook, allowNameEdit: true, showStrategy: true, strategyType: 'constant', name: '', content: '' };
      renderDrawer(); return;
    }
    if (target.closest('#upp-copy-wb-btn') && state.activeBook) {
      const text = buildCleanCopyText(state.bookEntriesCache[state.activeBook] || []);
      if (!text) { toast('本世界书暂无已开启的非空条目', 'warning'); return; }
      try { await navigator.clipboard.writeText(text); toast('已复制当前已开条目纯文本', 'success'); }
      catch (_) { state.drawer = { type: 'entryEditor', heading: '复制纯文本', content: text, readOnly: true }; renderDrawer(); }
      return;
    }
    if (target.closest('#upp-wb-only-on-btn')) { state.wbOnlyOn = !state.wbOnlyOn; renderWorldbookToolbar(); renderWorldbookBody(); return; }
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

    if (target.closest('#upp-preset-only-on-btn')) { state.presetOnlyOn = !state.presetOnlyOn; renderPresetToolbar(); renderPresetBody(); return; }
    if (target.closest('#upp-preset-fold-all-btn')) {
      const groups = state.livePresetNorm.groups || [];
      const anyExpanded = groups.some(g => !isPresetGroupCollapsed(g));
      groups.forEach(g => { state.presetFoldState[`${state.loadedPresetName}::${g.id}`] = anyExpanded; });
      renderPresetToolbar(); renderPresetBody(); return;
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

  elToolbar.addEventListener('input', ev => {
    const id = ev.target.id;
    if (id === 'upp-snap-search') { state.snapSearch = ev.target.value; renderSnapshotsBody(); }
    else if (id === 'upp-wb-search') { state.wbEntrySearch = ev.target.value; renderWorldbookBody(); }
    else if (id === 'upp-preset-search') { state.presetSearch = ev.target.value; renderPresetBody(); }
    else if (id === 'upp-rg-search') { state.regexSearch = ev.target.value; renderRegexBody(); }
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
        renderPresetToolbar(); renderPresetBody(); renderFooter();
        toast('已切换预设：' + targetPreset, 'success');
      }
    }
  });

  elBody.addEventListener('click', async ev => {
    const t = ev.target;
    if (t.closest('[data-open-save-snap]')) { openSaveSnapshotDrawer(); return; }

    const applyBtn = t.closest('[data-snap-apply]');
    if (applyBtn) {
      const snap = state.store.snapshots.find(x => x.id === applyBtn.getAttribute('data-snap-apply'));
      if (snap) { await applySnapshotLive(snap, state.store); await refreshAll(true); }
      return;
    }
    const viewBtn = t.closest('[data-snap-view]');
    if (viewBtn) {
      const snap = state.store.snapshots.find(x => x.id === viewBtn.getAttribute('data-snap-view'));
      if (snap) {
        const wbDetails = {};
        if (snap.scope.worldbooks && snap.worldbooks?.entries) {
          for (const bk of Object.keys(snap.worldbooks.entries)) {
            wbDetails[bk] = await ensureBookEntries(bk, false);
          }
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
          subTab: snap.scope.preset ? 'preset' : snap.scope.worldbooks ? 'worldbooks' : snap.scope.persona ? 'persona' : 'regex',
          search: '',
          onlyOn: false,
          allExpanded: false,
          foldMap: {},
          presetNorm,
          wbDetails,
          regexDetails,
        };
        renderDrawer();
      }
      return;
    }
    const updBtn = t.closest('[data-snap-update]');
    if (updBtn) { await overwriteSnapshotById(updBtn.getAttribute('data-snap-update')); return; }
    const bindBtn = t.closest('[data-snap-bind]');
    if (bindBtn) {
      const snap = state.store.snapshots.find(x => x.id === bindBtn.getAttribute('data-snap-bind'));
      if (snap) { state.drawer = { type: 'bindSnapshot', snapshot: snap }; renderDrawer(); }
      return;
    }
    const delBtn = t.closest('[data-snap-del]');
    if (delBtn) {
      const sid = delBtn.getAttribute('data-snap-del');
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

    if (t.closest('#upp-persona-preview-box') && state.currentPersona) {
      state.drawer = { type: 'entryEditor', mode: 'editPersona', heading: `编辑 User 正文 · ${state.currentPersona.name}`, content: state.currentPersona.description || '' };
      renderDrawer(); return;
    }
    const pvView = t.closest('[data-pv-view]');
    if (pvView && state.currentPersona) {
      const list = state.store.personaVersions[state.currentPersona.avatar_id] || [];
      const ver = list.find(v => v.id === pvView.getAttribute('data-pv-view'));
      if (ver) {
        state.drawer = { type: 'entryEditor', mode: 'editPersonaVersion', versionId: ver.id, heading: `编辑内部版本 · ${state.currentPersona.name}`, allowNameEdit: true, name: ver.name, content: ver.description || '' };
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
        await Host.updatePersonaInPlace(state.currentPersona.avatar_id, ver.description, ver.lorebook || undefined);
        state.currentPersona = Host.getCurrentPersona();
        renderUserToolbar(); renderUserBody();
        toast(`已切换至「${ver.name}」`, 'success');
      }
      return;
    }
    const pvDelInline = t.closest('[data-pv-del-inline]');
    if (pvDelInline && state.currentPersona) {
      const aid = state.currentPersona.avatar_id;
      state.store.personaVersions[aid] = (state.store.personaVersions[aid] || []).filter(v => v.id !== pvDelInline.getAttribute('data-pv-del-inline'));
      persistStore(state.store); renderUserToolbar(); renderUserBody(); toast('已删除内部版本'); return;
    }

    const wbSw = t.closest('[data-wb-toggle]');
    if (wbSw && state.activeBook) {
      const u = wbSw.getAttribute('data-wb-toggle');
      const entry = (state.bookEntriesCache[state.activeBook] || []).find(e => String(e.uid) === String(u));
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
    const wbOpen = t.closest('[data-wb-open]');
    if (wbOpen && state.activeBook) {
      const entry = (state.bookEntriesCache[state.activeBook] || []).find(e => String(e.uid) === String(wbOpen.getAttribute('data-wb-open')));
      if (entry) {
        state.drawer = { type: 'entryEditor', mode: 'editWb', heading: state.activeBook, bookName: state.activeBook, uid: entry.uid, allowNameEdit: true, showStrategy: true, strategyType: entry.strategyType, name: entry.name, content: entry.content, meta: `UID #${entry.uid} · 顺序 ${entry.order}` };
        renderDrawer();
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
      const item = (state.livePresetNorm.prompts || []).find(p => p.id === prOpen.getAttribute('data-pr-open'));
      if (item) {
        const isPh = item.marker || typeof item.content !== 'string';
        state.drawer = { type: 'entryEditor', mode: 'editPreset', heading: `预设提示词 · ${state.loadedPresetName}`, promptId: item.id, allowNameEdit: !isPh, readOnly: isPh, name: item.name, content: isPh ? '此项为酒馆原生占位槽位，仅支持开关启停。' : item.content, meta: `ID: ${item.id} · 角色: ${item.role}` };
        renderDrawer();
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
        state.drawer = { type: 'entryEditor', heading: `正则详情 · ${item.script_name}`, content: `【查找正则】\n${item.find_regex}\n\n【替换为】\n${item.replace_string}`, readOnly: true, meta: `范围: ${state.regexScope} · 状态: ${item.enabled ? '开启' : '关闭'}` };
        renderDrawer();
      }
    }
  });

  // Drawer input/change/click
  elDrawerMask.addEventListener('input', ev => {
    const d = state.drawer;
    if (!d) return;
    if (d.type === 'viewSnapshot' && ev.target.id === 'upp-sv-search') {
      d.search = ev.target.value;
      renderViewSnapshotBody(d);
      return;
    }
    if (d.type === 'bookPicker' && ev.target.id === 'upp-book-search-input') {
      d.query = ev.target.value;
      renderBookPickerList(d);
    }
  });

  elDrawerMask.addEventListener('change', ev => {
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
      const tabBtn = t.closest('[data-sv-tab]');
      if (tabBtn) { d.subTab = tabBtn.getAttribute('data-sv-tab'); d.search = ''; renderDrawer(); return; }
      if (t.closest('#upp-sv-only-on')) { d.onlyOn = !d.onlyOn; renderDrawer(); return; }
      if (t.closest('#upp-sv-fold-all')) {
        d.allExpanded = !d.allExpanded;
        (d.presetNorm?.groups || []).forEach(g => { d.foldMap[g.id] = !d.allExpanded; });
        renderDrawer(); return;
      }
      const svGrpToggle = t.closest('[data-sv-grp-toggle]');
      if (svGrpToggle && d.snapshot?.preset) {
        const gid = svGrpToggle.getAttribute('data-sv-grp-toggle');
        if (!d.snapshot.preset.groups) d.snapshot.preset.groups = {};
        const fallback = d.presetNorm?.groupsById?.[gid]?.enabled !== false;
        const cur = Object.prototype.hasOwnProperty.call(d.snapshot.preset.groups, gid)
          ? d.snapshot.preset.groups[gid] !== false
          : fallback;
        d.snapshot.preset.groups[gid] = !cur;
        d.snapshot.updatedAt = Date.now();
        persistStore(state.store);
        renderViewSnapshotBody(d);
        return;
      }
      const svPrToggle = t.closest('[data-sv-pr-toggle]');
      if (svPrToggle && d.snapshot?.preset) {
        const pid = svPrToggle.getAttribute('data-sv-pr-toggle');
        if (!d.snapshot.preset.prompts) d.snapshot.preset.prompts = {};
        const liveDef = (d.presetNorm?.prompts || []).find(p => p.id === pid);
        const cur = Object.prototype.hasOwnProperty.call(d.snapshot.preset.prompts, pid)
          ? d.snapshot.preset.prompts[pid] === true
          : !!liveDef?.enabled;
        d.snapshot.preset.prompts[pid] = !cur;
        d.snapshot.updatedAt = Date.now();
        persistStore(state.store);
        renderViewSnapshotBody(d);
        return;
      }
      const svWbToggle = t.closest('[data-sv-wb-toggle]');
      if (svWbToggle && d.snapshot?.worldbooks?.entries) {
        const bk = svWbToggle.getAttribute('data-sv-wb-toggle');
        const u = svWbToggle.getAttribute('data-sv-wb-uid');
        if (d.snapshot.worldbooks.entries[bk]) {
          d.snapshot.worldbooks.entries[bk][u] = !d.snapshot.worldbooks.entries[bk][u];
          d.snapshot.updatedAt = Date.now();
          persistStore(state.store);
          renderViewSnapshotBody(d);
        }
        return;
      }
      const svRgToggle = t.closest('[data-sv-rg-toggle]');
      if (svRgToggle && d.snapshot?.regex) {
        const sc = svRgToggle.getAttribute('data-sv-rg-toggle');
        const rid = svRgToggle.getAttribute('data-sv-rg-id');
        if (d.snapshot.regex[sc]) {
          d.snapshot.regex[sc][rid] = !d.snapshot.regex[sc][rid];
          d.snapshot.updatedAt = Date.now();
          persistStore(state.store);
          renderViewSnapshotBody(d);
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
      const applyInDrawer = t.closest('[data-snap-apply]');
      if (applyInDrawer) {
        await applySnapshotLive(d.snapshot, state.store);
        state.drawer = null;
        await refreshAll(true);
        return;
      }
      const prItem = t.closest('[data-view-snap-pr]');
      if (prItem) {
        const pid = prItem.getAttribute('data-view-snap-pr');
        const live = (d.presetNorm?.prompts || []).find(p => p.id === pid);
        if (live) {
          state.drawer = {
            type: 'entryEditor',
            fullView: true,
            heading: `${d.snapshot.preset.name || '预设'} · ${live.name || pid}`,
            content: live.marker || typeof live.content !== 'string' ? '酒馆原生占位槽位，无正文内容。' : live.content,
            readOnly: true,
            meta: `ID: ${live.id} · 角色: ${live.role}`,
            returnTo: d,
          };
          renderDrawer();
        }
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
            fullView: true,
            heading: `${bk} · ${live.name}`,
            content: live.content || '',
            readOnly: true,
            meta: `UID #${live.uid} · 顺序 ${live.order}`,
            returnTo: d,
          };
          renderDrawer();
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
      state.drawer = null;
      await ensureBookEntries(state.activeBook, true);
      render(); return;
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
          const ver = (state.store.personaVersions[aid] || []).find(v => v.id === d.versionId);
          if (ver) { ver.name = name || ver.name; ver.description = content; ver.updatedAt = Date.now(); persistStore(state.store); toast('已更新内部版本', 'success'); }
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

    const fillGrp = t.closest('[data-ss-fill-group]');
    if (fillGrp) { const inp = shadow.getElementById('upp-ss-group'); if (inp) inp.value = fillGrp.getAttribute('data-ss-fill-group') || ''; return; }
    if (t.closest('#upp-ss-confirm-btn') && d.type === 'saveSnapshot') {
      const name = (shadow.getElementById('upp-ss-name')?.value || '').trim();
      if (!name) { toast('请填写快照名称', 'warning'); return; }
      const group = (shadow.getElementById('upp-ss-group')?.value || '').trim();
      const note = (shadow.getElementById('upp-ss-note')?.value || '').trim();
      if (!d.scope.persona && !d.scope.worldbooks && !d.scope.preset && !d.scope.regex) {
        toast('请至少勾选一项保存范围', 'warning'); return;
      }
      const snap = await captureLiveSnapshot({ name, group, note, scope: d.scope, selectedBooks: d.selectedBooks }, state.store);
      state.store.snapshots.unshift(snap);
      persistStore(state.store);
      state.drawer = null;
      state.tab = 'snapshots';
      render();
      toast(`已保存快照「${snap.name}」`, 'success');
      return;
    }

    if (d.type === 'bindSnapshot') {
      const sid = d.snapshot.id;
      if (t.closest('#upp-bind-chat-btn') && state.chatId) {
        if (state.store.bindings.chats[state.chatId] === sid) delete state.store.bindings.chats[state.chatId];
        else state.store.bindings.chats[state.chatId] = sid;
        persistStore(state.store); render(); return;
      }
      if (t.closest('#upp-bind-char-btn') && state.charInfo.id) {
        if (state.store.bindings.characters[state.charInfo.id] === sid) delete state.store.bindings.characters[state.charInfo.id];
        else state.store.bindings.characters[state.charInfo.id] = sid;
        persistStore(state.store); render(); return;
      }
    }

    if (d.type === 'savePersonaVersion' && state.currentPersona) {
      const fillPv = t.closest('[data-pv-fill-name]');
      if (fillPv) { const inp = shadow.getElementById('upp-pv-name'); if (inp) inp.value = fillPv.getAttribute('data-pv-fill-name') || ''; return; }
      const delPv = t.closest('[data-pv-del]');
      if (delPv) {
        const aid = state.currentPersona.avatar_id;
        state.store.personaVersions[aid] = (state.store.personaVersions[aid] || []).filter(v => v.id !== delPv.getAttribute('data-pv-del'));
        persistStore(state.store); render(); return;
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
        if ((keep.description || '').trim() && !list.some(v => v.description === keep.description)) {
          list.unshift({ id: uid('pv'), name: '原主描述', description: keep.description, lorebook: keep.lorebook || '', updatedAt: Date.now() });
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
          list.push({ id: uid('pv'), name: label.slice(0, 60), description: oldP.description || '', lorebook: oldP.lorebook || '', updatedAt: Date.now() });
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

  function openModal() {
    closeFabPop();
    state.store = loadStore();
    applyThemeAll();
    state.open = true;
    state.drawer = null;
    elBackdrop.hidden = false;
    syncFabVisBtn();
    void refreshAll(false);
  }

  function closeModal() {
    state.open = false;
    state.drawer = null;
    elBackdrop.hidden = true;
    syncFabUi();
  }

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
    const rect = elFabBtn.getBoundingClientRect();
    const popW = Math.min(260, vw - 24);
    const popH = Math.min(380, Math.round(vh * 0.7));
    const margin = 10;
    let left = rect.left > vw / 2 ? (rect.left - popW - 8) : (rect.right + 8);
    left = Math.min(vw - popW - margin, Math.max(margin, left));
    let top = rect.top - 24;
    if (top + popH > vh - margin) top = Math.max(margin, vh - popH - margin);
    if (top < margin) top = margin;
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
            <button type="button" class="upp-fab-snap-item ${isBound ? 'is-bound' : ''}" data-fab-apply="${s.id}">
              <span class="upp-fab-snap-name">${escapeHtml(s.name)}</span>
              ${isBound ? `<span class="upp-badge ok">${bound.source === 'chat' ? '本聊天' : '本角色'}</span>` : (s.group ? `<span class="upp-badge">${escapeHtml(s.group)}</span>` : '')}
            </button>
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
    const applyItem = t.closest('[data-fab-apply]');
    if (applyItem) {
      const sid = applyItem.getAttribute('data-fab-apply');
      const snap = state.store.snapshots.find(s => s.id === sid);
      closeFabPop();
      if (snap) {
        await applySnapshotLive(snap, state.store);
        syncFabUi();
        if (state.open) await refreshAll(true);
      }
    }
  });

  elFabVisBtn.addEventListener('click', () => {
    state.store = loadStore();
    state.store.settings.showFloatingBall = !(state.store.settings.showFloatingBall !== false);
    persistStore(state.store);
    syncFabUi();
    syncExtSettingsCheckbox();
    toast(state.store.settings.showFloatingBall ? '已显示悬浮球' : '已隐藏悬浮球');
  });

  document.addEventListener('pointerdown', ev => {
    if (!fabPopOpen) return;
    const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [];
    if (path.includes(elFabPop) || path.includes(elFabBtn)) return;
    closeFabPop();
  });

  window.addEventListener('resize', () => {
    if (state.store.settings.showFloatingBall !== false) {
      positionFab();
      if (fabPopOpen) positionFabPop();
    }
  });

  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      if (fabPopOpen) { closeFabPop(); return; }
      if (state.open) {
        if (state.drawer) { state.drawer = state.drawer.returnTo || null; renderDrawer(); }
        else closeModal();
      }
    }
  });

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
      '<span>User 组装与快照</span>';
    item.addEventListener('click', ev => { ev.preventDefault(); if (state.open) closeModal(); else openModal(); });
    item.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (state.open) closeModal(); else openModal(); } });
    menu.appendChild(item);
  }

  // Mount compact drawer inside Extensions Settings
  function syncExtSettingsCheckbox() {
    const st = loadStore().settings;
    const cb = document.getElementById('upp-ext-auto-apply-cb');
    if (cb) cb.checked = !!st.autoApplyBindings;
    const fabCb = document.getElementById('upp-ext-fab-cb');
    if (fabCb) fabCb.checked = st.showFloatingBall !== false;
  }

  function mountExtSettings() {
    const container = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!container || document.getElementById(SETTINGS_BOX_ID)) return;
    const box = document.createElement('div');
    box.id = SETTINGS_BOX_ID;
    box.className = 'inline-drawer';
    box.innerHTML = `
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>User 组装与快照 v${APP_VERSION}</b>
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
          <span>面板配色</span>
          <select id="upp-ext-theme-sel" class="text_pole" style="width:auto;min-width:110px;">
            <option value="paper" ${state.store.settings.themeMode === 'paper' ? 'selected' : ''}>素纸</option>
            <option value="host" ${state.store.settings.themeMode === 'host' ? 'selected' : ''}>跟随酒馆</option>
            <option value="glass-light" ${state.store.settings.themeMode === 'glass-light' ? 'selected' : ''}>浅色玻璃</option>
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
  eventSource.on(event_types.APP_READY, () => {
    mountWandMenu();
    mountExtSettings();
    syncFabUi();
  });
}

if (typeof window !== 'undefined' && typeof window.jQuery === 'function') {
  window.jQuery(() => {
    initExtension();
  });
} else if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initExtension);
  else initExtension();
}
