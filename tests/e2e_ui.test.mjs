import test from 'node:test';
import assert from 'node:assert/strict';
import util from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { register } from 'node:module';

// ============================================================================
// 1. Node v24 ESM Loader Hook (data URL) for SillyTavern Host Modules
// ============================================================================

const LOADER_SOURCE = `
export async function resolve(specifier, context, nextResolve) {
  const parent = String(context?.parentURL || '');
  if (parent.includes('user-persona-picker')) {
    if (specifier.endsWith('/script.js')) {
      return { url: 'upp-mock:///script.js', shortCircuit: true };
    }
    if (specifier.endsWith('/extensions.js')) {
      return { url: 'upp-mock:///extensions.js', shortCircuit: true };
    }
    if (specifier.endsWith('/world-info.js')) {
      return { url: 'upp-mock:///world-info.js', shortCircuit: true };
    }
    if (specifier.endsWith('/preset-manager.js')) {
      return { url: 'upp-mock:///preset-manager.js', shortCircuit: true };
    }
    if (specifier.endsWith('/power-user.js')) {
      return { url: 'upp-mock:///power-user.js', shortCircuit: true };
    }
    if (specifier.endsWith('/personas.js')) {
      return { url: 'upp-mock:///personas.js', shortCircuit: true };
    }
    if (specifier.endsWith('/regex/engine.js')) {
      if (parent.includes('regexMissing=1')) {
        return { url: 'upp-mock:///regex-missing.js?t=' + encodeURIComponent(parent), shortCircuit: true };
      }
      return { url: 'upp-mock:///regex/engine.js', shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === 'upp-mock:///script.js') {
    return {
      format: 'module',
      shortCircuit: true,
      source: \`
        const H = () => globalThis.__uppMockHost;
        export let characters = [];
        export let chat_metadata = {};
        export let this_chid = undefined;
        export const event_types = {
          CHAT_CHANGED: 'CHAT_CHANGED',
          OAI_PRESET_CHANGED_AFTER: 'OAI_PRESET_CHANGED_AFTER',
          APP_READY: 'APP_READY',
        };
        export const eventSource = {
          on(ev, fn) { H()?.eventSource?.on?.(ev, fn); },
          once(ev, fn) { H()?.eventSource?.once?.(ev, fn); },
          off(ev, fn) { H()?.eventSource?.off?.(ev, fn); },
          removeListener(ev, fn) { H()?.eventSource?.removeListener?.(ev, fn); },
          emit(ev, ...args) { return H()?.eventSource?.emit?.(ev, ...args); },
        };
        export function getCurrentChatId() { return H()?.chatId ?? ''; }
        export function getRequestHeaders() { return { 'Content-Type': 'application/json', 'X-CSRF-Token': 'mock' }; }
        export async function reloadCurrentChat() { if (H()) H().reloadChatCalls++; }
        export function saveSettingsDebounced() { if (H()) H().saveSettingsCalls++; }
        export function setUserName(name, opts) {
          if (H()) H().setUserNameCalls.push({ name, opts });
          const inp = typeof document !== 'undefined' ? document.getElementById('your_name') : null;
          if (inp) inp.value = String(name ?? '');
        }
        function __sync() {
          const h = H();
          if (!h) return;
          characters = h.characters;
          chat_metadata = h.chat_metadata;
          this_chid = h.this_chid;
        }
        H()?.__syncFns?.add(__sync);
        __sync();
      \`,
    };
  }
  if (url === 'upp-mock:///extensions.js') {
    return {
      format: 'module',
      shortCircuit: true,
      source: \`
        const H = () => globalThis.__uppMockHost;
        export let extension_settings = {};
        function __sync() {
          const h = H();
          if (h) extension_settings = h.extension_settings;
        }
        H()?.__syncFns?.add(__sync);
        __sync();
      \`,
    };
  }
  if (url === 'upp-mock:///world-info.js') {
    return {
      format: 'module',
      shortCircuit: true,
      source: \`
        const H = () => globalThis.__uppMockHost;
        export let world_names = [];
        export function getWorldInfoSettings() { return H()?.worldInfoSettings || { world_info: { charLore: [] } }; }
        export async function loadWorldInfo(name) {
          const h = H();
          if (!h) return null;
          h.loadWorldInfoCalls.push(name);
          const data = h.worldInfoStore[name];
          return data ? structuredClone(data) : null;
        }
        export function onWorldInfoChange(arg) { H()?.onWorldInfoChangeCalls?.push(arg); }
        export async function saveWorldInfo(name, data, immediately) {
          const h = H();
          if (!h) return;
          h.worldInfoStore[name] = structuredClone(data);
          h.saveWorldInfoCalls.push({ name, immediately });
        }
        function __sync() {
          const h = H();
          if (h) world_names = h.world_names;
        }
        H()?.__syncFns?.add(__sync);
        __sync();
      \`,
    };
  }
  if (url === 'upp-mock:///preset-manager.js') {
    return {
      format: 'module',
      shortCircuit: true,
      source: \`
        const H = () => globalThis.__uppMockHost;
        export function getPresetManager(type) { return H()?.presetManager || null; }
      \`,
    };
  }
  if (url === 'upp-mock:///power-user.js') {
    return {
      format: 'module',
      shortCircuit: true,
      source: \`
        const H = () => globalThis.__uppMockHost;
        export let power_user = {};
        function __sync() {
          const h = H();
          if (h) power_user = h.power_user;
        }
        H()?.__syncFns?.add(__sync);
        __sync();
      \`,
    };
  }
  if (url === 'upp-mock:///personas.js') {
    return {
      format: 'module',
      shortCircuit: true,
      source: \`
        const H = () => globalThis.__uppMockHost;
        export let user_avatar = '';
        export async function getUserAvatars(refresh, highlight) {
          const h = H();
          if (!h) return [];
          h.getUserAvatarsCalls.push({ refresh, highlight });
          return [...h.avatarsList];
        }
        export function setPersonaDescription() {
          const h = H();
          if (h) h.setPersonaDescriptionCalls++;
        }
        export async function setUserAvatar(avatarId, opts) {
          const h = H();
          if (!h) return;
          h.setUserAvatarCalls.push({ avatarId, opts });
          h.user_avatar = avatarId;
          user_avatar = avatarId;
          const desc = h.power_user?.persona_descriptions?.[avatarId];
          if (desc) {
            h.power_user.persona_description = desc.description || '';
            h.power_user.persona_description_lorebook = desc.lorebook || '';
          }
        }
        function __sync() {
          const h = H();
          if (h) user_avatar = h.user_avatar;
        }
        H()?.__syncFns?.add(__sync);
        __sync();
      \`,
    };
  }
  if (url === 'upp-mock:///regex/engine.js') {
    return {
      format: 'module',
      shortCircuit: true,
      source: \`
        const H = () => globalThis.__uppMockHost;
        export const SCRIPT_TYPES = { GLOBAL: 0, SCOPED: 1, PRESET: 2 };
        export function getScriptsByType(type) {
          const h = H();
          if (!h) return [];
          const key = type === 1 ? 'character' : type === 2 ? 'preset' : 'global';
          return h.regexScripts[key] || [];
        }
        export async function saveScriptsByType(scripts, type) {
          const h = H();
          if (!h) return;
          const key = type === 1 ? 'character' : type === 2 ? 'preset' : 'global';
          h.regexScripts[key] = structuredClone(scripts || []);
          h.saveRegexCalls.push({ scope: key, count: (scripts || []).length });
        }
      \`,
    };
  }
  if (url.startsWith('upp-mock:///regex-missing.js')) {
    return {
      format: 'module',
      shortCircuit: true,
      source: \`throw new Error('Mock missing regex/engine.js');\`,
    };
  }
  return nextLoad(url, context);
}
`;

register(`data:text/javascript;base64,${Buffer.from(LOADER_SOURCE, 'utf8').toString('base64')}`);

// ============================================================================
// 2. Host State Manager (globalThis.__uppMockHost)
// ============================================================================

function createEventSourceMock() {
  const map = new Map();
  return {
    _map: map,
    on(ev, fn) {
      if (!map.has(ev)) map.set(ev, new Set());
      map.get(ev).add(fn);
    },
    once(ev, fn) {
      const wrap = (...args) => {
        this.off(ev, wrap);
        fn(...args);
      };
      this.on(ev, wrap);
    },
    off(ev, fn) {
      map.get(ev)?.delete(fn);
    },
    removeListener(ev, fn) {
      map.get(ev)?.delete(fn);
    },
    async emit(ev, ...args) {
      const listeners = [...(map.get(ev) || [])];
      for (const fn of listeners) await fn(...args);
    },
    clear() {
      map.clear();
    },
  };
}

function createDefaultPresetData() {
  return {
    PresetA: {
      prompts: [
        { identifier: 'p1', name: 'Main System', role: 'system', content: 'System prompt body', marker: false },
        { identifier: 'p2', name: 'World Lore', role: 'system', content: 'Lore prompt body', marker: false },
        { identifier: 'p3', name: 'Style Guide', role: 'assistant', content: 'Style guide body', marker: false },
        { identifier: 'chatHistory', name: 'Chat History', role: 'system', marker: true },
      ],
      prompt_order: [
        {
          character_id: 100001,
          order: [
            { identifier: 'p1', enabled: true },
            { identifier: 'p2', enabled: false },
            { identifier: 'p3', enabled: true },
            { identifier: 'chatHistory', enabled: true },
          ],
        },
      ],
      extensions: {
        presetPromptGroups: {
          version: 1,
          groups: [
            { id: 'grp_core', name: '核心设定组', enabled: true, collapsed: false },
          ],
          prompts: {
            p1: { groupId: 'grp_core' },
            p2: { groupId: 'grp_core' },
          },
        },
      },
    },
    PresetB: {
      prompts: [
        { identifier: 'p1', name: 'Main System', role: 'system', content: 'System prompt body v2', marker: false },
        { identifier: 'p2', name: 'World Lore', role: 'system', content: 'Lore prompt body v2', marker: false },
        { identifier: 'p4', name: 'Safety Rule', role: 'system', content: 'New prompt p4', marker: false },
      ],
      prompt_order: [
        {
          character_id: 100001,
          order: [
            { identifier: 'p1', enabled: true },
            { identifier: 'p2', enabled: true },
            { identifier: 'p4', enabled: true },
          ],
        },
      ],
      extensions: {
        presetPromptGroups: {
          version: 1,
          groups: [
            { id: 'grp_core', name: '核心设定组', enabled: true, collapsed: false },
            { id: 'grp_new', name: '新增规则组', enabled: true, collapsed: false },
          ],
          prompts: {
            p1: { groupId: 'grp_core' },
            p2: { groupId: 'grp_core' },
            p4: { groupId: 'grp_new' },
          },
        },
      },
    },
  };
}

function createMockHost() {
  const syncFns = new Set();
  const host = {
    __syncFns: syncFns,
    __sync() {
      for (const fn of syncFns) fn();
    },
    characters: [],
    this_chid: 0,
    chatId: 'chat_001',
    chat_metadata: {},
    extension_settings: {},
    worldInfoSettings: { world_info: { charLore: [] } },
    world_names: [],
    worldInfoStore: {},
    presetsStore: {},
    loadedPresetName: '',
    chatCompletionSettings: {},
    promptManagerServiceSettings: {},
    power_user: {},
    user_avatar: '',
    avatarsList: [],
    avatarBlobs: {},
    characterChats: {},
    regexScripts: { global: [], character: [], preset: [] },
    toasts: [],
    fetchCalls: [],
    fetchHandlers: {},
    saveSettingsCalls: 0,
    reloadChatCalls: 0,
    setUserNameCalls: [],
    setUserAvatarCalls: [],
    setPersonaDescriptionCalls: 0,
    getUserAvatarsCalls: [],
    loadWorldInfoCalls: [],
    saveWorldInfoCalls: [],
    onWorldInfoChangeCalls: [],
    saveRegexCalls: [],
    slashCommands: [],
    eventSource: createEventSourceMock(),
    presetManager: null,
    reset(overrides = {}) {
      const presetsStore = overrides.presetsStore ? structuredClone(overrides.presetsStore) : createDefaultPresetData();
      const loadedPresetName = overrides.loadedPresetName !== undefined ? overrides.loadedPresetName : 'PresetA';
      const activePreset = presetsStore[loadedPresetName] ? structuredClone(presetsStore[loadedPresetName]) : { prompts: [], prompt_order: [], extensions: {} };

      this.characters = overrides.characters ?? [
        { name: 'CharAlpha', avatar: 'CharAlpha.png', data: { extensions: { world: 'BookMain' } } },
      ];
      this.this_chid = overrides.this_chid !== undefined ? overrides.this_chid : 0;
      this.chatId = overrides.chatId !== undefined ? overrides.chatId : 'chat_001';
      this.chat_metadata = overrides.chat_metadata ?? { world_info: 'BookChat' };
      this.extension_settings = overrides.extension_settings ?? {};
      this.worldInfoSettings = overrides.worldInfoSettings ?? { world_info: { charLore: [] } };
      this.world_names = overrides.world_names ?? ['BookMain', 'BookGlobal', 'BookChat'];
      this.worldInfoStore = overrides.worldInfoStore ?? {
        BookMain: {
          entries: {
            '1': { uid: 1, comment: 'EntryOne', content: 'First entry body', disable: false, constant: true, selective: false, order: 10, key: ['k1'], keysecondary: [], position: 1, depth: 4 },
            '2': { uid: 2, comment: 'EntryTwo', content: 'Second entry body <tag>unclosed', disable: true, constant: false, selective: true, order: 20, key: ['k2', 'k3'], keysecondary: ['s1'], position: 4, depth: 2 },
          },
        },
        BookGlobal: {
          entries: {
            '10': { uid: 10, comment: 'GlobalEntry', content: 'Global content <warn>unclosed', disable: false, constant: true, selective: false, order: 10, key: [], keysecondary: [], position: 0, depth: 4 },
          },
        },
        BookChat: {
          entries: {
            '20': { uid: 20, comment: 'ChatEntry', content: 'Chat content', disable: false, constant: false, selective: true, order: 10, key: ['chat'], keysecondary: [], position: 1, depth: 4 },
          },
        },
      };
      this.presetsStore = presetsStore;
      this.loadedPresetName = loadedPresetName;
      this.chatCompletionSettings = overrides.chatCompletionSettings ?? activePreset;
      this.promptManagerServiceSettings = overrides.promptManagerServiceSettings ?? {};
      this.power_user = overrides.power_user ?? {
        personas: {
          'u_main.png': '林晚晴',
          'u_alt1.png': '沈晚晴',
          'u_alt2.png': '林晚晴 (校园)',
        },
        persona_descriptions: {
          'u_main.png': { description: 'Main user description text.', lorebook: 'BookMain' },
          'u_alt1.png': { description: 'Alt surname user description.', lorebook: '' },
          'u_alt2.png': { description: 'Campus branch description.', lorebook: '' },
        },
        persona_description: 'Main user description text.',
        persona_description_lorebook: 'BookMain',
      };
      this.user_avatar = overrides.user_avatar !== undefined ? overrides.user_avatar : 'u_main.png';
      this.avatarsList = overrides.avatarsList ?? Object.keys(this.power_user.personas || {});
      this.avatarBlobs = overrides.avatarBlobs ?? {
        'u_main.png': new Blob(['MAIN_PNG'], { type: 'image/png' }),
        'u_alt1.png': new Blob(['ALT1_PNG'], { type: 'image/png' }),
        'u_alt2.png': new Blob(['ALT2_PNG'], { type: 'image/png' }),
      };
      this.characterChats = overrides.characterChats ?? {
        'CharAlpha.png': [
          { file_name: 'chat_001.jsonl', last_mes: '2026-01-01', mes: 'Hello world', chat_items: 12 },
        ],
      };
      this.regexScripts = overrides.regexScripts ?? {
        global: [
          { id: 'rg1', scriptName: 'TrimExtra', disabled: false, findRegex: '/\\n{3,}/g', replaceString: '\\n\\n', markdownOnly: true, promptOnly: false },
        ],
        character: [],
        preset: [],
      };
      this.toasts = [];
      this.fetchCalls = [];
      this.fetchHandlers = overrides.fetchHandlers ?? {};
      this.saveSettingsCalls = 0;
      this.reloadChatCalls = 0;
      this.setUserNameCalls = [];
      this.setUserAvatarCalls = [];
      this.setPersonaDescriptionCalls = 0;
      this.getUserAvatarsCalls = [];
      this.loadWorldInfoCalls = [];
      this.saveWorldInfoCalls = [];
      this.onWorldInfoChangeCalls = [];
      this.saveRegexCalls = [];
      this.slashCommands = [];
      this.eventSource.clear();

      const self = this;
      this.presetManager = {
        select: '#settings_preset_openai',
        getPresetList() {
          return { preset_names: Object.keys(self.presetsStore) };
        },
        getSelectedPresetName() {
          return self.loadedPresetName;
        },
        getCompletionPresetByName(name) {
          return self.presetsStore[name] || null;
        },
        async savePreset(name, payload) {
          self.presetsStore[name] = structuredClone(payload);
        },
        selectPreset(val) {
          const names = Object.keys(self.presetsStore);
          const idx = Number(val);
          const nextName = Number.isFinite(idx) && names[idx] ? names[idx] : String(val || '');
          if (self.presetsStore[nextName]) {
            self.loadedPresetName = nextName;
            self.chatCompletionSettings = structuredClone(self.presetsStore[nextName]);
            void self.eventSource.emit('OAI_PRESET_CHANGED_AFTER', nextName);
          }
        },
      };
      this.__sync();
    },
  };
  host.reset();
  return host;
}

const mockHost = createMockHost();
globalThis.__uppMockHost = mockHost;

// ============================================================================
// 3. Memory-Safe Shadow-DOM MockNode Fake DOM (AGENTS.md §四.11)
// ============================================================================

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function installMockDom({
  innerWidth = 1280,
  innerHeight = 800,
  pointerCoarse = false,
  withNativePersonaControls = true,
  computedVars = {},
} = {}) {
  const savedKeys = [
    'window', 'document', 'Element', 'HTMLElement', 'HTMLInputElement',
    'HTMLTextAreaElement', 'HTMLButtonElement', 'HTMLSelectElement',
    'HTMLOptionElement', 'HTMLOptGroupElement', 'ShadowRoot',
    'Event', 'PointerEvent', 'CustomEvent', 'KeyboardEvent',
    'MutationObserver', 'CSS', 'jQuery', 'SillyTavern',
    'requestAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
    'getComputedStyle', 'visualViewport', 'innerWidth', 'innerHeight',
    'addEventListener', 'removeEventListener', 'dispatchEvent',
    'matchMedia', 'localStorage', 'location', 'toastr', 'fetch',
    'FileReader', 'setTimeout', 'clearTimeout',
  ];
  const saved = {};
  for (const k of savedKeys) {
    saved[k] = Object.prototype.hasOwnProperty.call(globalThis, k) ? globalThis[k] : undefined;
  }
  const savedNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  const winListeners = new Map();
  const vvListeners = new Map();
  const activeTimeouts = new Set();
  const activeIdles = new Set();
  const nativeSetTimeout = globalThis.setTimeout;
  const nativeClearTimeout = globalThis.clearTimeout;

  const focusCalls = [];
  const scrollIntoViewCalls = [];
  const outerScrollCalls = [];
  const allScrollCalls = [];
  let isMobileViewportFlag = () => globalThis.innerWidth <= 680 || pointerCoarse;

  class MockEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.bubbles = Boolean(init.bubbles);
      this.cancelable = Boolean(init.cancelable);
      this.composed = init.composed !== undefined ? Boolean(init.composed) : true;
      this.defaultPrevented = false;
      this.cancelBubble = false;
      this._stopImmediate = false;
      this.target = init.target || null;
      this.currentTarget = null;
      this._composedPath = [];
      this.key = init.key || '';
      this.code = init.code || '';
      this.keyCode = init.keyCode || 0;
      this.isComposing = Boolean(init.isComposing);
      this.deltaY = init.deltaY ?? 0;
      this.deltaX = init.deltaX ?? 0;
      this.clientX = init.clientX ?? 0;
      this.clientY = init.clientY ?? 0;
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
      this.button = init.button ?? 0;
    }
    preventDefault() {
      this.defaultPrevented = true;
    }
    stopPropagation() {
      this.cancelBubble = true;
    }
    stopImmediatePropagation() {
      this.cancelBubble = true;
      this._stopImmediate = true;
    }
    composedPath() {
      return [...this._composedPath];
    }
  }

  class MockClassList {
    constructor(el) {
      Object.defineProperty(this, '_el', {
        value: el,
        writable: true,
        configurable: true,
        enumerable: false,
      });
      this._set = new Set();
    }
    [util.inspect.custom]() {
      return `MockClassList(${[...this._set].join(' ')})`;
    }
    _syncFromString(str) {
      this._set = new Set(String(str || '').split(/\s+/).filter(Boolean));
    }
    _syncToAttr() {
      this._el._attrs.set('class', [...this._set].join(' '));
    }
    add(...names) {
      for (const n of names) if (n) this._set.add(n);
      this._syncToAttr();
    }
    remove(...names) {
      for (const n of names) this._set.delete(n);
      this._syncToAttr();
    }
    toggle(name, force) {
      if (force === undefined) {
        if (this._set.has(name)) this._set.delete(name);
        else this._set.add(name);
      } else if (force) {
        this._set.add(name);
      } else {
        this._set.delete(name);
      }
      this._syncToAttr();
      return this._set.has(name);
    }
    contains(name) {
      return this._set.has(name);
    }
  }

  function parseAttrs(rawAttrs) {
    const attrs = new Map();
    const re = /([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m;
    while ((m = re.exec(rawAttrs)) !== null) {
      const val = m[2] ?? m[3] ?? m[4] ?? '';
      attrs.set(m[1], decodeHtmlEntities(val));
    }
    return attrs;
  }

  function splitSelectorGroups(sel) {
    const out = [];
    let cur = '';
    let paren = 0;
    let bracket = 0;
    let quote = '';
    for (let i = 0; i < sel.length; i++) {
      const ch = sel[i];
      if (quote) {
        cur += ch;
        if (ch === quote && sel[i - 1] !== '\\') quote = '';
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
      if (ch === '(') paren++;
      else if (ch === ')' && paren > 0) paren--;
      else if (ch === '[') bracket++;
      else if (ch === ']' && bracket > 0) bracket--;
      else if (ch === ',' && paren === 0 && bracket === 0) {
        if (cur.trim()) out.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function tokenizeSelectorGroup(grp) {
    const tokens = [];
    let cur = '';
    let paren = 0;
    let bracket = 0;
    let quote = '';
    let pendingComb = null;
    for (let i = 0; i < grp.length; i++) {
      const ch = grp[i];
      if (quote) {
        cur += ch;
        if (ch === quote && grp[i - 1] !== '\\') quote = '';
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
      if (ch === '(') { paren++; cur += ch; continue; }
      if (ch === ')' && paren > 0) { paren--; cur += ch; continue; }
      if (ch === '[') { bracket++; cur += ch; continue; }
      if (ch === ']' && bracket > 0) { bracket--; cur += ch; continue; }
      if (paren === 0 && bracket === 0 && (ch === '>' || /\s/.test(ch))) {
        if (cur) {
          tokens.push({ type: 'compound', value: cur });
          cur = '';
        }
        if (ch === '>') {
          pendingComb = '>';
        } else if (pendingComb === null && tokens.length > 0 && tokens[tokens.length - 1].type === 'compound') {
          pendingComb = ' ';
        }
        continue;
      }
      if (pendingComb !== null) {
        tokens.push({ type: 'comb', value: pendingComb });
        pendingComb = null;
      }
      cur += ch;
    }
    if (cur) tokens.push({ type: 'compound', value: cur });
    return tokens;
  }

  function matchesCompound(el, compound, scopeEl = null) {
    if (!(el instanceof MockElement)) return false;
    let clean = compound.trim();
    if (!clean) return false;
    if (clean === ':scope') return el === scopeEl;
    const notClauses = [];
    clean = clean.replace(/:not\(([^)]+)\)/g, (_, inner) => {
      notClauses.push(inner.trim());
      return '';
    });
    let requireChecked = false;
    if (clean.includes(':checked')) {
      requireChecked = true;
      clean = clean.replace(/:checked/g, '');
    }
    let requireDisabled = false;
    if (clean.includes(':disabled')) {
      requireDisabled = true;
      clean = clean.replace(/:disabled/g, '');
    }
    let requireEnabled = false;
    if (clean.includes(':enabled')) {
      requireEnabled = true;
      clean = clean.replace(/:enabled/g, '');
    }
    if (clean) {
      const tokens = clean.match(/([#.][^\s#.[\]:]+|\[[^\]]+\]|^[a-zA-Z0-9_-]+)/g);
      if (!tokens || tokens.join('') !== clean) return false;
      for (const tok of tokens) {
        if (tok.startsWith('#')) {
          if (el.id !== tok.slice(1)) return false;
        } else if (tok.startsWith('.')) {
          if (!el.classList.contains(tok.slice(1))) return false;
        } else if (tok.startsWith('[')) {
          const m = tok.match(/^\[([a-zA-Z0-9_:-]+)(?:([*^$]?=)(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]$/);
          if (!m) return false;
          const attrName = m[1];
          if (!el.hasAttribute(attrName)) return false;
          const op = m[2];
          if (op) {
            const expected = m[3] ?? m[4] ?? m[5] ?? '';
            const actual = el.getAttribute(attrName) ?? '';
            if (op === '=' && actual !== expected) return false;
            if (op === '*=' && !actual.includes(expected)) return false;
            if (op === '^=' && !actual.startsWith(expected)) return false;
            if (op === '$=' && !actual.endsWith(expected)) return false;
          }
        } else if (el.tagName !== tok.toUpperCase()) {
          return false;
        }
      }
    }
    if (requireChecked) {
      if (el.tagName === 'OPTION') {
        if (!el.selected) return false;
      } else if (!el.checked) {
        return false;
      }
    }
    if (requireDisabled && !el.disabled) return false;
    if (requireEnabled && el.disabled) return false;
    for (const inner of notClauses) {
      if (matchesCompound(el, inner, scopeEl)) return false;
    }
    return true;
  }

  function matchTokenSeq(el, tokens, idx, scopeEl) {
    const item = tokens[idx];
    if (!item || item.type !== 'compound') return false;
    if (!matchesCompound(el, item.value, scopeEl)) return false;
    if (idx === 0) return true;
    const comb = tokens[idx - 1];
    if (!comb || comb.type !== 'comb') return false;
    if (comb.value === '>') {
      const parent = el.parentNode;
      if (tokens[idx - 2]?.value === ':scope' && scopeEl) {
        return parent === scopeEl && idx - 2 === 0;
      }
      return parent instanceof MockElement && matchTokenSeq(parent, tokens, idx - 2, scopeEl);
    }
    let cur = el.parentElement;
    while (cur) {
      if (matchTokenSeq(cur, tokens, idx - 2, scopeEl)) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  function matchesSelector(el, selector, scopeEl = null) {
    if (!(el instanceof MockElement)) return false;
    const groups = splitSelectorGroups(String(selector || ''));
    return groups.some((grp) => {
      const tokens = tokenizeSelectorGroup(grp);
      if (tokens.length === 0) return false;
      return matchTokenSeq(el, tokens, tokens.length - 1, scopeEl);
    });
  }

  function addListenerWithSignal(map, type, fn, opts, remover) {
    const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture);
    const signal = typeof opts === 'object' && opts ? opts.signal : null;
    if (signal?.aborted) return;
    if (!map.has(type)) map.set(type, []);
    const arr = map.get(type);
    arr.push({ fn, capture });
    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', () => remover(type, fn, opts), { once: true });
    }
  }

  function removeListenerFromMap(map, type, fn, opts) {
    const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture);
    const arr = map.get(type);
    if (!arr) return;
    map.set(type, arr.filter((e) => e.fn !== fn || e.capture !== capture));
  }

  function parseHtmlInto(rootNode, html) {
    rootNode.childNodes = [];
    const voidTags = new Set(['input', 'br', 'hr', 'img', 'meta', 'link', 'circle', 'path', 'line', 'polyline', 'polygon', 'rect']);
    const stack = [rootNode];
    const tokenRe = /<!--[\s\S]*?-->|<style\b([^>]*)>([\s\S]*?)<\/style>|<\/?([a-zA-Z0-9_-]+)([^>]*)>|([^<]+)/g;
    let m;
    while ((m = tokenRe.exec(String(html || ''))) !== null) {
      const parent = stack[stack.length - 1];
      if (m[0].startsWith('<!--')) continue;
      if (m[2] !== undefined) {
        const styleEl = doc.createElement('style');
        const attrs = parseAttrs(m[1] || '');
        for (const [k, v] of attrs.entries()) styleEl.setAttribute(k, v);
        const tn = new MockNode(3, m[2]);
        tn.parentNode = styleEl;
        styleEl.childNodes.push(tn);
        parent.appendChild(styleEl);
        continue;
      }
      if (m[5] !== undefined) {
        const decoded = decodeHtmlEntities(m[5]);
        if (decoded) {
          const tn = new MockNode(3, decoded);
          tn.parentNode = parent;
          parent.childNodes.push(tn);
        }
        continue;
      }
      const full = m[0];
      const tag = m[3].toLowerCase();
      if (full.startsWith('</')) {
        while (stack.length > 1 && stack[stack.length - 1].tagName?.toLowerCase() !== tag) {
          stack.pop();
        }
        if (stack.length > 1) {
          const closed = stack.pop();
          if (closed.tagName === 'TEXTAREA') {
            closed.value = closed.textContent;
          }
        }
      } else {
        const child = doc.createElement(tag);
        const attrs = parseAttrs(m[4] || '');
        for (const [k, v] of attrs.entries()) child.setAttribute(k, v);
        parent.appendChild(child);
        if (!voidTags.has(tag) && !full.endsWith('/>')) {
          stack.push(child);
        }
      }
    }
  }

  class MockNode {
    constructor(nodeType, textContent = '') {
      this.nodeType = nodeType;
      Object.defineProperty(this, 'parentNode', {
        value: null,
        writable: true,
        configurable: true,
        enumerable: false,
      });
      this._textContent = textContent;
    }
    [util.inspect.custom]() {
      return `MockNode(type=${this.nodeType})`;
    }
    get parentElement() {
      return this.parentNode instanceof MockElement ? this.parentNode : null;
    }
    get textContent() {
      return this._textContent;
    }
    set textContent(v) {
      this._textContent = String(v ?? '');
    }
    remove() {
      if (this.parentNode && Array.isArray(this.parentNode.childNodes)) {
        const idx = this.parentNode.childNodes.indexOf(this);
        if (idx >= 0) this.parentNode.childNodes.splice(idx, 1);
        this.parentNode = null;
      }
    }
  }

  class MockShadowRoot extends MockNode {
    constructor(hostEl, mode = 'open') {
      super(11, '');
      this.mode = mode;
      this.childNodes = [];
      this._listeners = new Map();
      Object.defineProperty(this, 'host', {
        value: hostEl,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
    [util.inspect.custom]() {
      return `MockShadowRoot(mode=${this.mode})`;
    }
    get children() {
      return this.childNodes.filter((c) => c instanceof MockElement);
    }
    get firstChild() {
      return this.childNodes[0] || null;
    }
    get isConnected() {
      return Boolean(this.host?.isConnected);
    }
    set innerHTML(html) {
      parseHtmlInto(this, html);
    }
    appendChild(node) {
      if (node instanceof MockFragment) {
        for (const c of [...node.childNodes]) this.appendChild(c);
        return node;
      }
      node.remove?.();
      node.parentNode = this;
      this.childNodes.push(node);
      if (node instanceof MockOptionElement && node.selected) {
        const sel = this.tagName === 'SELECT' ? this : this.closest?.('select');
        if (sel && !sel.multiple) {
          for (const o of sel.options) {
            if (o !== node) o._selected = false;
          }
        }
      }
      return node;
    }
    append(...nodes) {
      for (const n of nodes) {
        if (typeof n === 'string') {
          const tn = new MockNode(3, n);
          tn.parentNode = this;
          this.childNodes.push(tn);
        } else if (n) {
          this.appendChild(n);
        }
      }
    }
    getElementById(id) {
      const target = String(id || '');
      let found = null;
      const walk = (node) => {
        for (const c of node.children || []) {
          if (c.id === target) { found = c; return true; }
          if (walk(c)) return true;
        }
        return false;
      };
      walk(this);
      return found;
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = (node) => {
        for (const c of node.children || []) {
          if (matchesSelector(c, sel, this)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    }
    contains(other) {
      let cur = other;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentNode;
      }
      return false;
    }
    addEventListener(type, fn, opts) {
      addListenerWithSignal(this._listeners, type, fn, opts, this.removeEventListener.bind(this));
    }
    removeEventListener(type, fn, opts) {
      removeListenerFromMap(this._listeners, type, fn, opts);
    }
  }

  class MockElement extends MockNode {
    constructor(tagName) {
      super(1, '');
      this.tagName = String(tagName || 'div').toUpperCase();
      this.childNodes = [];
      this._attrs = new Map();
      this.classList = new MockClassList(this);
      this.style = {
        setProperty(k, v) { this[k] = String(v ?? ''); },
        removeProperty(k) { delete this[k]; },
        getPropertyValue(k) { return this[k] ?? ''; },
      };
      this._listeners = new Map();
      this._rect = { left: 10, top: 80, right: 250, bottom: 116, width: 240, height: 36 };
      this._scrollTop = 0;
      this.scrollLeft = 0;
      this.scrollWidth = 200;
      this.clientWidth = 200;
      this.scrollHeight = 600;
      this.clientHeight = 200;
      this.offsetWidth = 240;
      this.offsetHeight = 36;
      this.disabled = false;
      this.readOnly = false;
      this.tabIndex = 0;
      this.dataset = new Proxy({}, {
        get: (_, prop) => {
          const attr = `data-${String(prop).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
          return this._attrs.has(attr) ? this._attrs.get(attr) : undefined;
        },
        set: (_, prop, val) => {
          const attr = `data-${String(prop).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
          this._attrs.set(attr, String(val));
          return true;
        },
        deleteProperty: (_, prop) => {
          const attr = `data-${String(prop).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
          this._attrs.delete(attr);
          return true;
        },
      });
    }
    [util.inspect.custom]() {
      const idPart = this.id ? `#${this.id}` : '';
      return `MockElement(${this.tagName.toLowerCase()}${idPart})`;
    }
    get scrollTop() {
      return this._scrollTop;
    }
    set scrollTop(v) {
      const num = Number(v) || 0;
      if (this._isOuterScrollTarget && num !== this._scrollTop) {
        outerScrollCalls.push({ kind: 'scrollTop', id: this.id || this.tagName.toLowerCase(), top: num });
      }
      this._scrollTop = num;
    }
    get _isOuterScrollTarget() {
      return this === doc.documentElement || this === doc.body || this.id === 'sheld' || this.id === 'send_form';
    }
    get hidden() {
      return this._attrs.has('hidden');
    }
    set hidden(v) {
      if (v) this._attrs.set('hidden', '');
      else this._attrs.delete('hidden');
    }
    get isConnected() {
      let cur = this;
      while (cur) {
        if (cur === doc.documentElement || cur === doc.body) return true;
        cur = cur.parentNode || cur.host || null;
      }
      return false;
    }
    get id() {
      return this._attrs.get('id') || '';
    }
    set id(val) {
      this._attrs.set('id', String(val ?? ''));
    }
    get className() {
      return this._attrs.get('class') || '';
    }
    set className(val) {
      this._attrs.set('class', String(val ?? ''));
      this.classList._syncFromString(val);
    }
    get children() {
      return this.childNodes.filter((c) => c instanceof MockElement);
    }
    get firstChild() {
      return this.childNodes[0] || null;
    }
    get previousElementSibling() {
      if (!this.parentNode) return null;
      const siblings = this.parentNode.children || [];
      const idx = siblings.indexOf(this);
      return idx > 0 ? siblings[idx - 1] : null;
    }
    get nextElementSibling() {
      if (!this.parentNode) return null;
      const siblings = this.parentNode.children || [];
      const idx = siblings.indexOf(this);
      return idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
    }
    get textContent() {
      if (this.childNodes.length === 0) return this._textContent;
      return this.childNodes.map((c) => c.textContent).join('');
    }
    set textContent(val) {
      this.childNodes = [];
      this._textContent = String(val ?? '');
      if (this._textContent) {
        const tn = new MockNode(3, this._textContent);
        tn.parentNode = this;
        this.childNodes.push(tn);
      }
    }
    attachShadow({ mode = 'open' } = {}) {
      const sr = new MockShadowRoot(this, mode);
      Object.defineProperty(this, 'shadowRoot', {
        value: sr,
        writable: true,
        configurable: true,
        enumerable: false,
      });
      return sr;
    }
    setAttribute(name, value) {
      const val = String(value ?? '');
      this._attrs.set(name, val);
      if (name === 'class') this.classList._syncFromString(val);
      if (name === 'hidden') this._attrs.set('hidden', '');
      if (name === 'disabled') this.disabled = true;
      if (name === 'readonly') this.readOnly = true;
      if (name === 'checked') this.checked = true;
      if (name === 'selected') this.selected = true;
      if (name === 'value' && ('value' in this)) this.value = val;
    }
    removeAttribute(name) {
      this._attrs.delete(name);
      if (name === 'class') this.classList._syncFromString('');
      if (name === 'disabled') this.disabled = false;
      if (name === 'readonly') this.readOnly = false;
      if (name === 'checked') this.checked = false;
      if (name === 'selected') this.selected = false;
    }
    getAttribute(name) {
      return this._attrs.has(name) ? this._attrs.get(name) : null;
    }
    hasAttribute(name) {
      return this._attrs.has(name);
    }
    appendChild(node) {
      if (node instanceof MockFragment) {
        for (const c of [...node.childNodes]) this.appendChild(c);
        return node;
      }
      node.remove?.();
      node.parentNode = this;
      this.childNodes.push(node);
      if (node instanceof MockOptionElement && node.selected) {
        const sel = this.tagName === 'SELECT' ? this : this.closest?.('select');
        if (sel && !sel.multiple) {
          for (const o of sel.options) {
            if (o !== node) o._selected = false;
          }
        }
      }
      return node;
    }
    append(...nodes) {
      for (const n of nodes) {
        if (typeof n === 'string') {
          const tn = new MockNode(3, n);
          tn.parentNode = this;
          this.childNodes.push(tn);
        } else if (n) {
          this.appendChild(n);
        }
      }
    }
    insertBefore(newNode, refNode) {
      if (!refNode) return this.appendChild(newNode);
      newNode.remove?.();
      newNode.parentNode = this;
      const idx = this.childNodes.indexOf(refNode);
      if (idx >= 0) this.childNodes.splice(idx, 0, newNode);
      else this.childNodes.push(newNode);
      return newNode;
    }
    insertAdjacentElement(pos, node) {
      if (pos === 'afterend' && this.parentNode) {
        node.remove?.();
        node.parentNode = this.parentNode;
        const idx = this.parentNode.childNodes.indexOf(this);
        this.parentNode.childNodes.splice(idx + 1, 0, node);
      }
      return node;
    }
    set innerHTML(html) {
      parseHtmlInto(this, html);
    }
    contains(other) {
      let cur = other;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentNode;
      }
      return false;
    }
    matches(sel) {
      return matchesSelector(this, sel);
    }
    closest(sel) {
      let cur = this;
      while (cur) {
        if (cur instanceof MockElement && matchesSelector(cur, sel)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = (node) => {
        for (const c of node.children || []) {
          if (matchesSelector(c, sel, this)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    }
    getBoundingClientRect() {
      if (this.style.left || this.style.top || this.style.width || this.style.height) {
        const l = parseFloat(this.style.left) || this._rect.left;
        const t = parseFloat(this.style.top) || this._rect.top;
        const w = parseFloat(this.style.width) || this._rect.width;
        const h = parseFloat(this.style.height) || this._rect.height;
        return { left: l, top: t, width: w, height: h, right: l + w, bottom: t + h };
      }
      return { ...this._rect };
    }
    addEventListener(type, fn, opts) {
      addListenerWithSignal(this._listeners, type, fn, opts, this.removeEventListener.bind(this));
    }
    removeEventListener(type, fn, opts) {
      removeListenerFromMap(this._listeners, type, fn, opts);
    }
    dispatchEvent(ev) {
      if (!ev.target) ev.target = this;
      const path = [];
      let cur = this;
      while (cur) {
        path.push(cur);
        cur = cur.parentNode || (ev.composed ? cur.host : null) || null;
      }
      ev._composedPath = path;
      for (let i = path.length - 1; i >= 0; i -= 1) {
        if (ev.cancelBubble) break;
        const node = path[i];
        const list = [...(node._listeners?.get(ev.type) || [])].filter((e) => e.capture);
        ev.currentTarget = node;
        for (const entry of list) {
          entry.fn(ev);
          if (ev._stopImmediate) break;
        }
      }
      for (let i = 0; i < path.length; i += 1) {
        if (ev.cancelBubble && (ev.bubbles || i > 0)) break;
        if (!ev.bubbles && i > 0) break;
        const node = path[i];
        const list = [...(node._listeners?.get(ev.type) || [])].filter((e) => !e.capture);
        ev.currentTarget = node;
        for (const entry of list) {
          entry.fn(ev);
          if (ev._stopImmediate) break;
        }
      }
      return !ev.defaultPrevented;
    }
    focus(opts) {
      focusCalls.push({
        id: this.id || '',
        tagName: this.tagName,
        opts: opts ? { ...opts } : undefined,
        hasPreventScroll: Boolean(opts && opts.preventScroll === true),
        mobileViewport: isMobileViewportFlag(),
      });
      doc.activeElement = this;
    }
    blur() {
      if (doc.activeElement === this) doc.activeElement = doc.body;
    }
    click() {
      this.dispatchEvent(new MockEvent('click', { bubbles: true, cancelable: true }));
    }
    scrollIntoView(arg) {
      scrollIntoViewCalls.push({ id: this.id || '', tagName: this.tagName, arg });
    }
    scrollTo(argOrX, y) {
      const nextTop = typeof argOrX === 'object' && argOrX !== null ? Number(argOrX.top ?? 0) : Number(y ?? 0);
      allScrollCalls.push({ id: this.id || this.tagName.toLowerCase(), top: nextTop, el: this });
      if (this._isOuterScrollTarget) {
        outerScrollCalls.push({ kind: 'scrollTo', id: this.id || this.tagName.toLowerCase(), top: nextTop });
      }
      this._scrollTop = nextTop;
    }
    setPointerCapture() {}
    releasePointerCapture() {}
  }

  class MockInputElement extends MockElement {
    constructor() {
      super('input');
      this.value = '';
      this.checked = false;
      this.files = [];
    }
    get type() {
      return this._attrs.get('type') || 'text';
    }
    set type(v) {
      this._attrs.set('type', String(v ?? 'text'));
    }
    click() {
      if (this.type === 'checkbox') {
        this.checked = !this.checked;
        const ev = new MockEvent('click', { bubbles: true, cancelable: true });
        this.dispatchEvent(ev);
        if (!ev.defaultPrevented) {
          this.dispatchEvent(new MockEvent('change', { bubbles: true, cancelable: false }));
        }
        return;
      }
      super.click();
    }
  }
  class MockTextAreaElement extends MockElement {
    constructor() {
      super('textarea');
      this.value = '';
      this.selectionStart = 0;
      this.selectionEnd = 0;
    }
  }
  class MockButtonElement extends MockElement {
    constructor() {
      super('button');
    }
    get type() {
      return this._attrs.get('type') || 'submit';
    }
    set type(v) {
      this._attrs.set('type', String(v ?? 'button'));
    }
  }
  class MockOptionElement extends MockElement {
    constructor() {
      super('option');
      this._selected = false;
    }
    get selected() {
      return this._selected;
    }
    set selected(v) {
      const next = Boolean(v);
      this._selected = next;
      if (next) {
        const sel = this.closest?.('select');
        if (sel && !sel.multiple) {
          for (const o of sel.options) {
            if (o !== this) o._selected = false;
          }
        }
      }
    }
    get value() {
      return this._attrs.has('value') ? this._attrs.get('value') : this.textContent;
    }
    set value(v) {
      this._attrs.set('value', String(v ?? ''));
    }
  }
  class MockOptGroupElement extends MockElement {
    constructor() {
      super('optgroup');
    }
    get label() {
      return this._attrs.get('label') || '';
    }
    set label(v) {
      this._attrs.set('label', String(v ?? ''));
    }
  }
  class MockSelectElement extends MockElement {
    constructor() {
      super('select');
      this.multiple = false;
    }
    get options() {
      return this.querySelectorAll('option');
    }
    get selectedOptions() {
      return this.options.filter((o) => o.selected);
    }
    get value() {
      if (this.selectedOptions[0]) return this.selectedOptions[0].value;
      if (!this.multiple && this.options.length > 0) return this.options[0].value;
      return '';
    }
    set value(v) {
      if (Array.isArray(v)) {
        const set = new Set(v.map(String));
        for (const o of this.options) o._selected = set.has(o.value);
        return;
      }
      const s = String(v ?? '');
      for (const o of this.options) o.selected = o.value === s;
    }
  }
  class MockFragment {
    constructor() {
      this.childNodes = [];
    }
    appendChild(node) {
      node.remove?.();
      node.parentNode = null;
      this.childNodes.push(node);
      return node;
    }
  }

  const doc = {
    readyState: 'complete',
    documentElement: null,
    body: null,
    activeElement: null,
    createElement(tag) {
      const t = String(tag).toLowerCase();
      if (t === 'input') return new MockInputElement();
      if (t === 'textarea') return new MockTextAreaElement();
      if (t === 'button') return new MockButtonElement();
      if (t === 'select') return new MockSelectElement();
      if (t === 'option') return new MockOptionElement();
      if (t === 'optgroup') return new MockOptGroupElement();
      return new MockElement(t);
    },
    createDocumentFragment() {
      return new MockFragment();
    },
    getElementById(id) {
      const target = String(id || '');
      let found = null;
      const walk = (node) => {
        for (const c of node.children || []) {
          if (c.id === target) { found = c; return true; }
          if (walk(c)) return true;
        }
        return false;
      };
      walk(this.documentElement);
      return found;
    },
    querySelector(sel) {
      return this.documentElement.querySelector(sel);
    },
    querySelectorAll(sel) {
      return this.documentElement.querySelectorAll(sel);
    },
    addEventListener(type, fn, opts) {
      this.documentElement.addEventListener(type, fn, opts);
    },
    removeEventListener(type, fn, opts) {
      this.documentElement.removeEventListener(type, fn, opts);
    },
  };
  doc.documentElement = new MockElement('html');
  doc.documentElement.clientWidth = innerWidth;
  doc.documentElement.clientHeight = innerHeight;
  doc.body = new MockElement('body');
  doc.documentElement.appendChild(doc.body);
  doc.activeElement = doc.body;

  // Mount native SillyTavern DOM skeleton
  doc.body.innerHTML = `
    <div id="top-settings-holder">
      <div class="drawer-content openDrawer" id="st-open-drawer">ST Drawer</div>
    </div>
    <div id="sheld">
      <div id="chat"></div>
      <form id="send_form">
        <textarea id="send_textarea"></textarea>
      </form>
    </div>
    <div id="extensionsMenu"></div>
    <div id="extensions_settings2"></div>
    <select id="world_info" multiple></select>
    <div id="persona_management">
      <div id="user_avatar_block"></div>
      ${withNativePersonaControls ? '<div class="persona_controls_buttons_block"></div>' : ''}
      <input id="your_name" type="text" value="林晚晴" />
      <textarea id="persona_description">Main user description text.</textarea>
    </div>
    <select id="connection_profiles"></select>
    <select id="chat_completion_source"></select>
    <input id="custom_model_id" type="text" value="" />
    <select id="settings_preset_openai">
      <option value="0" selected>PresetA</option>
      <option value="1">PresetB</option>
    </select>
    <div id="toast-container"></div>
  `;
  const worldInfoSel = doc.getElementById('world_info');
  worldInfoSel.multiple = true;
  ['BookMain', 'BookGlobal', 'BookChat'].forEach((name, idx) => {
    const opt = doc.createElement('option');
    opt.value = String(idx);
    opt.textContent = name;
    if (name === 'BookGlobal') opt.selected = true;
    worldInfoSel.appendChild(opt);
  });

  // Track if ST's .openDrawer gets closed by a leaked click/mousedown
  let stOpenDrawerClosedCount = 0;
  doc.addEventListener('mousedown', (ev) => {
    const drawer = doc.getElementById('st-open-drawer');
    if (drawer && drawer.classList.contains('openDrawer') && !drawer.contains(ev.target)) {
      stOpenDrawerClosedCount++;
      drawer.classList.remove('openDrawer');
    }
  });

  const vv = {
    width: innerWidth,
    height: innerHeight,
    offsetTop: 0,
    addEventListener(type, fn, opts) {
      if (opts?.signal?.aborted) return;
      if (!vvListeners.has(type)) vvListeners.set(type, new Set());
      vvListeners.get(type).add(fn);
      opts?.signal?.addEventListener('abort', () => this.removeEventListener(type, fn), { once: true });
    },
    removeEventListener(type, fn) {
      vvListeners.get(type)?.delete(fn);
    },
    dispatchEvent(ev) {
      for (const fn of [...(vvListeners.get(ev.type) || [])]) fn(ev);
      return true;
    },
  };

  const storageMap = new Map();
  const mockLocalStorage = {
    getItem(k) { return storageMap.has(k) ? storageMap.get(k) : null; },
    setItem(k, v) { storageMap.set(k, String(v)); },
    removeItem(k) { storageMap.delete(k); },
    clear() { storageMap.clear(); },
  };

  function makeJqWrapper(target) {
    let items = [];
    if (typeof target === 'string') {
      items = doc.querySelectorAll(target);
    } else if (target instanceof MockElement) {
      items = [target];
    } else if (Array.isArray(target)) {
      items = target;
    }
    const api = {
      length: items.length,
      get(idx) { return idx === undefined ? items : items[idx]; },
      find(sel) {
        const found = [];
        for (const el of items) found.push(...el.querySelectorAll(sel));
        return makeJqWrapper(found);
      },
      filter(fn) {
        const out = items.filter((el, i) => fn(i, el));
        return makeJqWrapper(out);
      },
      first() {
        return makeJqWrapper(items[0] ? [items[0]] : []);
      },
      map(fn) {
        const mapped = items.map((el, i) => fn(i, el));
        return { get: () => mapped };
      },
      text() {
        return items[0]?.textContent ?? '';
      },
      val(v) {
        if (v === undefined) {
          const el = items[0];
          if (!el) return undefined;
          if (el instanceof MockSelectElement && el.multiple) {
            return el.selectedOptions.map((o) => o.value);
          }
          return el.value;
        }
        for (const el of items) el.value = v;
        return api;
      },
      trigger(type) {
        for (const el of items) el.dispatchEvent(new MockEvent(type, { bubbles: true }));
        return api;
      },
    };
    items.forEach((el, i) => { api[i] = el; });
    return api;
  }
  function mockJQuery(arg) {
    if (typeof arg === 'function') {
      arg();
      return;
    }
    return makeJqWrapper(arg);
  }

  const clipboardWrites = [];
  const mockNavigator = {
    clipboard: {
      async writeText(txt) {
        clipboardWrites.push(String(txt ?? ''));
      },
    },
  };

  class MockFileReader {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.result = null;
    }
    readAsText(file) {
      queueMicrotask(async () => {
        try {
          this.result = typeof file?.text === 'function' ? await file.text() : String(file?.content ?? '');
          this.onload?.({ target: this });
        } catch (err) {
          this.onerror?.(err);
        }
      });
    }
  }

  globalThis.Element = MockElement;
  globalThis.HTMLElement = MockElement;
  globalThis.HTMLInputElement = MockInputElement;
  globalThis.HTMLTextAreaElement = MockTextAreaElement;
  globalThis.HTMLButtonElement = MockButtonElement;
  globalThis.HTMLSelectElement = MockSelectElement;
  globalThis.HTMLOptionElement = MockOptionElement;
  globalThis.HTMLOptGroupElement = MockOptGroupElement;
  globalThis.ShadowRoot = MockShadowRoot;
  globalThis.Event = MockEvent;
  globalThis.PointerEvent = MockEvent;
  globalThis.KeyboardEvent = MockEvent;
  globalThis.CustomEvent = class MockCustomEvent extends MockEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.detail = init.detail;
    }
  };
  globalThis.document = doc;
  globalThis.innerWidth = innerWidth;
  globalThis.innerHeight = innerHeight;
  globalThis.visualViewport = vv;
  globalThis.addEventListener = (type, fn, opts) => {
    if (opts?.signal?.aborted) return;
    if (!winListeners.has(type)) winListeners.set(type, new Set());
    winListeners.get(type).add(fn);
    opts?.signal?.addEventListener('abort', () => globalThis.removeEventListener(type, fn), { once: true });
  };
  globalThis.removeEventListener = (type, fn) => {
    winListeners.get(type)?.delete(fn);
  };
  globalThis.dispatchEvent = (ev) => {
    for (const fn of [...(winListeners.get(ev.type) || [])]) fn(ev);
    return true;
  };
  globalThis.matchMedia = (q) => ({
    matches: q.includes('pointer: coarse') ? pointerCoarse : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  });
  globalThis.localStorage = mockLocalStorage;
  globalThis.location = { href: 'http://localhost:8000/' };
  globalThis.toastr = {
    info: (m, t) => mockHost.toasts.push({ type: 'info', msg: m, title: t }),
    success: (m, t) => mockHost.toasts.push({ type: 'success', msg: m, title: t }),
    warning: (m, t) => mockHost.toasts.push({ type: 'warning', msg: m, title: t }),
    error: (m, t) => mockHost.toasts.push({ type: 'error', msg: m, title: t }),
  };
  globalThis.jQuery = mockJQuery;
  globalThis.CSS = { escape: (s) => String(s).replace(/([^\w-])/g, '\\$1') };
  globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
  globalThis.setTimeout = (fn, ms, ...args) => {
    const id = nativeSetTimeout(() => {
      activeTimeouts.delete(id);
      fn(...args);
    }, Math.min(Number(ms) || 0, 20));
    activeTimeouts.add(id);
    return id;
  };
  globalThis.clearTimeout = (id) => {
    activeTimeouts.delete(id);
    nativeClearTimeout(id);
  };
  globalThis.requestIdleCallback = (fn) => {
    const id = globalThis.setTimeout(() => {
      activeIdles.delete(id);
      fn({ didTimeout: false, timeRemaining: () => 50 });
    }, 0);
    activeIdles.add(id);
    return id;
  };
  globalThis.cancelIdleCallback = (id) => {
    activeIdles.delete(id);
    globalThis.clearTimeout(id);
  };
  globalThis.getComputedStyle = () => ({
    color: computedVars.color || 'rgb(220, 220, 220)',
    backgroundColor: computedVars.backgroundColor || 'rgb(30, 30, 30)',
    getPropertyValue(name) {
      if (Object.prototype.hasOwnProperty.call(computedVars, name)) return computedVars[name];
      if (name === '--SmartThemeBlurTintColor') return 'rgb(30, 30, 30)';
      if (name === '--SmartThemeBodyColor') return 'rgb(220, 220, 220)';
      return doc.documentElement.style.getPropertyValue(name);
    },
  });
  globalThis.MutationObserver = class MockMutationObserver {
    observe() {}
    disconnect() {}
    takeRecords() { return []; }
  };
  globalThis.FileReader = MockFileReader;
  Object.defineProperty(globalThis, 'navigator', {
    value: mockNavigator,
    writable: true,
    configurable: true,
    enumerable: true,
  });
  globalThis.SillyTavern = {
    getContext: () => ({
      characters: mockHost.characters,
      chatId: mockHost.chatId,
      extensionSettings: mockHost.extension_settings,
      chatCompletionSettings: mockHost.chatCompletionSettings,
      promptManager: { serviceSettings: mockHost.promptManagerServiceSettings },
      getChatCompletionModel: () => mockHost.chatCompletionSettings?.model || 'gpt-mock',
      executeSlashCommandsWithOptions: async (cmd) => { mockHost.slashCommands.push(cmd); },
    }),
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    let bodyObj = null;
    if (typeof init.body === 'string') {
      try { bodyObj = JSON.parse(init.body); } catch (_) { bodyObj = init.body; }
    } else if (init.body) {
      bodyObj = init.body;
    }
    mockHost.fetchCalls.push({ url: u, method: init.method || 'GET', body: bodyObj });

    if (typeof mockHost.fetchHandlers[u] === 'function') {
      return mockHost.fetchHandlers[u](u, init, bodyObj);
    }
    if (u.endsWith('/api/worldinfo/get')) {
      const data = mockHost.worldInfoStore[bodyObj?.name];
      if (!data) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => structuredClone(data) };
    }
    if (u.endsWith('/api/avatars/delete')) {
      const aid = bodyObj?.avatar;
      mockHost.avatarsList = mockHost.avatarsList.filter((x) => x !== aid);
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    if (u.includes('/User%20Avatars/') || u.includes('/User Avatars/')) {
      const aid = decodeURIComponent(u.split('/').pop().split('?')[0]);
      const blob = mockHost.avatarBlobs[aid] || new Blob(['AVATAR'], { type: 'image/png' });
      return { ok: true, status: 200, blob: async () => blob };
    }
    if (u.endsWith('/api/avatars/upload')) {
      let overwriteName = '';
      let blob = new Blob(['NEW'], { type: 'image/png' });
      if (init.body && typeof init.body.get === 'function') {
        overwriteName = String(init.body.get('overwrite_name') || init.body.get('avatar_name') || '');
        const f = init.body.get('avatar');
        if (f) blob = f;
      }
      const newId = overwriteName || `u_restored_${mockHost.avatarsList.length + 1}.png`;
      if (!mockHost.avatarsList.includes(newId)) mockHost.avatarsList.push(newId);
      mockHost.avatarBlobs[newId] = blob;
      return {
        ok: true,
        status: 200,
        json: async () => ({ path: newId }),
        text: async () => JSON.stringify({ path: newId }),
      };
    }
    if (u.endsWith('/api/characters/chats')) {
      const list = mockHost.characterChats[bodyObj?.avatar_url] || [];
      return { ok: true, status: 200, json: async () => structuredClone(list) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  globalThis.window = {
    get innerWidth() { return globalThis.innerWidth; },
    set innerWidth(v) { globalThis.innerWidth = v; },
    get innerHeight() { return globalThis.innerHeight; },
    set innerHeight(v) { globalThis.innerHeight = v; },
    get visualViewport() { return vv; },
    get computedStyle() { return globalThis.getComputedStyle; },
    getComputedStyle: (...a) => globalThis.getComputedStyle(...a),
    matchMedia: (...a) => globalThis.matchMedia(...a),
    localStorage: mockLocalStorage,
    location: globalThis.location,
    toastr: globalThis.toastr,
    jQuery: mockJQuery,
    setTimeout: (...a) => globalThis.setTimeout(...a),
    clearTimeout: (...a) => globalThis.clearTimeout(...a),
    requestIdleCallback: (...a) => globalThis.requestIdleCallback(...a),
    cancelIdleCallback: (...a) => globalThis.cancelIdleCallback(...a),
    requestAnimationFrame: (...a) => globalThis.requestAnimationFrame(...a),
    addEventListener: (...a) => globalThis.addEventListener(...a),
    removeEventListener: (...a) => globalThis.removeEventListener(...a),
    dispatchEvent: (...a) => globalThis.dispatchEvent(...a),
    scrollTo(argOrX, y) {
      const top = typeof argOrX === 'object' && argOrX !== null ? Number(argOrX.top ?? 0) : Number(y ?? 0);
      outerScrollCalls.push({ kind: 'window.scrollTo', id: 'window', top });
    },
  };

  const restore = () => {
    for (const id of [...activeTimeouts]) nativeClearTimeout(id);
    activeTimeouts.clear();
    activeIdles.clear();
    if (savedNavigatorDesc) {
      Object.defineProperty(globalThis, 'navigator', savedNavigatorDesc);
    } else {
      delete globalThis.navigator;
    }
    for (const k of savedKeys) {
      if (saved[k] === undefined) delete globalThis[k];
      else globalThis[k] = saved[k];
    }
  };

  return {
    doc,
    vv,
    window: globalThis.window,
    MockEvent,
    focusCalls,
    scrollIntoViewCalls,
    outerScrollCalls,
    allScrollCalls,
    clipboardWrites,
    getStOpenDrawerClosedCount: () => stOpenDrawerClosedCount,
    setViewport(w, h) {
      globalThis.innerWidth = w;
      globalThis.innerHeight = h;
      doc.documentElement.clientWidth = w;
      doc.documentElement.clientHeight = h;
      vv.width = w;
      vv.height = h;
    },
    restore,
  };
}

let caseSeq = 0;

async function mountExtension(opts = {}) {
  mockHost.reset(opts.hostOverrides || {});
  const dom = installMockDom(opts.domOpts || {});
  const query = `case=${++caseSeq}${opts.regexMissing ? '&regexMissing=1' : ''}`;
  await import(`../index.js?${query}`);
  const hostEl = dom.doc.getElementById('user-persona-picker-host');
  const shadow = hostEl?.shadowRoot || null;
  const openModal = async () => {
    const entry = dom.doc.getElementById('user-persona-picker-menu-entry');
    assert.ok(entry, 'Magic wand menu entry #user-persona-picker-menu-entry should be mounted');
    entry.click();
    await new Promise((r) => setTimeout(r, 30));
  };
  const cleanup = () => {
    try {
      globalThis.window?.dispatchEvent(new dom.MockEvent('pagehide'));
    } finally {
      dom.restore();
    }
  };
  return { dom, hostEl, shadow, openModal, cleanup };
}

async function flushAsync() {
  await new Promise((r) => setTimeout(r, 30));
}

function getAllButtonsInShadow(shadow) {
  return shadow ? shadow.querySelectorAll('button') : [];
}

function findButtonByText(root, text) {
  return root.querySelectorAll('button').find((b) => b.textContent.includes(text)) || null;
}

function findButtonByTextRe(root, re) {
  return root.querySelectorAll('button').find((b) => re.test(b.textContent || '')) || null;
}

function isElementAbsentOrHidden(el) {
  if (!el) return true;
  if (el.hidden || el.closest?.('[hidden]') !== null) return true;
  if (el.style?.display === 'none' || el.style?.visibility === 'hidden') return true;
  return false;
}

function assertAllShadowButtonsHaveTypeButton(shadow, label) {
  const buttons = getAllButtonsInShadow(shadow);
  assert.ok(buttons.length > 0, `${label}: should render buttons inside Shadow DOM`);
  for (const btn of buttons) {
    assert.equal(btn.getAttribute('type'), 'button', `[${label}] Shadow button missing type="button": ${btn.id || btn.className}`);
  }
}

function findOverrideScroller(shadow) {
  const byId = shadow.getElementById('upp-ps-ov-scroll');
  if (byId) return byId;
  const ovList = shadow.getElementById('upp-ps-ov-list');
  if (!ovList) return null;
  return ovList.closest('.upp-ps-ov-scroll, [data-ps-ov-scroll], .upp-scroll-box') || null;
}

function stripJsCommentsPreserveNewlines(src) {
  let out = '';
  let i = 0;
  let state = 'code'; // code | sq | dq | tpl | line | block
  const tplBraceStack = [];
  while (i < src.length) {
    const ch = src[i];
    const nx = src[i + 1];
    if (state === 'line') {
      if (ch === '\n' || ch === '\r') {
        out += ch;
        state = tplBraceStack.length ? 'code' : 'code';
      } else {
        out += ' ';
      }
      i++;
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && nx === '/') {
        out += '  ';
        i += 2;
        state = 'code';
      } else {
        out += (ch === '\n' || ch === '\r') ? ch : ' ';
        i++;
      }
      continue;
    }
    if (state === 'sq' || state === 'dq') {
      const q = state === 'sq' ? "'" : '"';
      out += ch;
      if (ch === '\\' && nx !== undefined) {
        out += nx;
        i += 2;
        continue;
      }
      if (ch === q) state = 'code';
      i++;
      continue;
    }
    if (state === 'tpl') {
      if (ch === '\\' && nx !== undefined) {
        out += ch + nx;
        i += 2;
        continue;
      }
      if (ch === '$' && nx === '{') {
        out += '${';
        tplBraceStack.push(1);
        state = 'code';
        i += 2;
        continue;
      }
      out += ch;
      if (ch === '`') state = 'code';
      i++;
      continue;
    }
    // state === 'code'
    if (ch === '/' && nx === '*') {
      out += '  ';
      state = 'block';
      i += 2;
      continue;
    }
    if (ch === '/' && nx === '/') {
      // Only treat as comment when not preceded by ':' (e.g., https://) or inside regex literal heuristics
      const prev = i > 0 ? src[i - 1] : '\n';
      if (prev !== ':') {
        out += '  ';
        state = 'line';
        i += 2;
        continue;
      }
    }
    if (ch === "'") { out += ch; state = 'sq'; i++; continue; }
    if (ch === '"') { out += ch; state = 'dq'; i++; continue; }
    if (ch === '`') { out += ch; state = 'tpl'; i++; continue; }
    if (tplBraceStack.length > 0) {
      if (ch === '{') tplBraceStack[tplBraceStack.length - 1]++;
      else if (ch === '}') {
        tplBraceStack[tplBraceStack.length - 1]--;
        if (tplBraceStack[tplBraceStack.length - 1] === 0) {
          tplBraceStack.pop();
          out += ch;
          state = 'tpl';
          i++;
          continue;
        }
      }
    }
    out += ch;
    i++;
  }
  return out;
}

function extractCssSelectors(cssText) {
  const clean = String(cssText || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [];
  let i = 0;
  let quote = '';
  const parseBlock = (skipRules) => {
    let header = '';
    while (i < clean.length) {
      const ch = clean[i];
      if (quote) {
        header += ch;
        if (ch === quote && clean[i - 1] !== '\\') quote = '';
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        header += ch;
        i++;
        continue;
      }
      if (ch === ';') {
        header = '';
        i++;
        continue;
      }
      if (ch === '{') {
        const hdr = header.trim();
        header = '';
        i++;
        if (hdr.startsWith('@')) {
          const isKeyframes = /^@(?:-webkit-)?keyframes\b/i.test(hdr);
          parseBlock(isKeyframes);
        } else {
          if (!skipRules && hdr) {
            for (const s of hdr.split(',')) {
              const trimmed = s.trim();
              if (trimmed) selectors.push(trimmed);
            }
          }
          // Skip inside rule declaration block until matching '}'
          let depth = 1;
          while (i < clean.length && depth > 0) {
            const c2 = clean[i];
            if (quote) {
              if (c2 === quote && clean[i - 1] !== '\\') quote = '';
            } else if (c2 === '"' || c2 === "'") {
              quote = c2;
            } else if (c2 === '{') {
              depth++;
            } else if (c2 === '}') {
              depth--;
            }
            i++;
          }
        }
        continue;
      }
      if (ch === '}') {
        i++;
        return;
      }
      header += ch;
      i++;
    }
  };
  parseBlock(false);
  return selectors;
}

function scanHtmlStartTags(src, tagNamesSet) {
  const tags = [];
  const len = src.length;
  for (let i = 0; i < len; i++) {
    if (src[i] !== '<') continue;
    const rest = src.slice(i + 1, i + 24);
    const m = /^([a-zA-Z][a-zA-Z0-9-]*)(?=[\s/>])/.exec(rest);
    if (!m) continue;
    const tagLower = m[1].toLowerCase();
    if (!tagNamesSet.has(tagLower)) continue;
    let j = i + 1 + m[1].length;
    let attrQuote = '';
    while (j < len) {
      const ch = src[j];
      if (ch === '$' && src[j + 1] === '{') {
        j += 2;
        let depth = 1;
        let jsQ = '';
        while (j < len && depth > 0) {
          const jc = src[j];
          if (jsQ) {
            if (jc === '\\' && j + 1 < len) { j += 2; continue; }
            if (jc === jsQ) jsQ = '';
          } else if (jc === "'" || jc === '"' || jc === '`') {
            jsQ = jc;
          } else if (jc === '{') {
            depth++;
          } else if (jc === '}') {
            depth--;
          }
          j++;
        }
        continue;
      }
      if (attrQuote) {
        if (ch === attrQuote) attrQuote = '';
        j++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        attrQuote = ch;
        j++;
        continue;
      }
      if (ch === '>') {
        tags.push({ tagName: tagLower, raw: src.slice(i, j + 1) });
        i = j;
        break;
      }
      j++;
    }
  }
  return tags;
}

function triggerFabTap(dom, shadow) {
  const fabBtn = shadow.getElementById('upp-fab-btn');
  fabBtn.dispatchEvent(new dom.MockEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', pointerId: 1, clientX: 350, clientY: 500 }));
  fabBtn.dispatchEvent(new dom.MockEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', pointerId: 1, clientX: 350, clientY: 500 }));
}

// ============================================================================
// 4. TIER 1 — Feature Coverage (ALL R1–R8 Acceptance Criteria)
// ============================================================================

test('Tier 1 [R6 & R2]: Init mounts cleanly with ZERO auto-opening guide popups, clean header, and clear button hierarchy', async () => {
  const { shadow, openModal, cleanup } = await mountExtension();
  try {
    assert.ok(shadow, 'ShadowRoot should be mounted');
    const backdrop = shadow.querySelector('.upp-backdrop');
    assert.ok(backdrop, 'Modal backdrop should exist');
    assert.equal(backdrop.hidden, true, 'Modal MUST remain closed (.upp-backdrop[hidden]) on init — no auto-opening guide popups');

    // Open modal normally
    await openModal();
    assert.equal(backdrop.hidden, false, 'Modal should open only on explicit user click');
    const drawerMask = shadow.getElementById('upp-drawer-mask');
    assert.equal(drawerMask.hidden, true, 'No welcome/guide drawer should auto-open when opening main modal');

    // No guide clutter buttons in header/toolbar
    const headBtns = shadow.querySelectorAll('.upp-head-actions button');
    for (const b of headBtns) {
      assert.equal(/指南|教程|新手|guide|help/i.test(b.textContent + ' ' + (b.getAttribute('title') || '')), false, 'Header must not add cluttered guide buttons');
    }

    // R2 button visual hierarchy: primary save button, secondary tier in STYLE_CSS, danger on WB [全关]
    const saveSnapBtn = shadow.getElementById('upp-foot-save-snap-btn');
    assert.ok(saveSnapBtn.classList.contains('primary'), 'Footer save snapshot button must have .primary hierarchy');

    const indexSrc = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(indexSrc, /\.upp-btn\.secondary\b/, 'STYLE_CSS must define .upp-btn.secondary visual hierarchy tier (R2)');

    // Switch to Worldbook tab and verify [全关] carries .danger class
    shadow.querySelector('[data-tab="worldbook"]').click();
    await flushAsync();
    const allOffBtn = shadow.getElementById('upp-wb-all-off-btn');
    assert.ok(allOffBtn, '#upp-wb-all-off-btn should exist on Worldbook tab');
    assert.ok(allOffBtn.classList.contains('danger'), 'Destructive [全关] button must carry .danger class (R2)');
  } finally {
    cleanup();
  }
});

test('Tier 1 [R1]: 「整理分身」Before→After clarity, batch undo restoring deleted personas & versions, and single version release-to-native', async () => {
  const { dom, shadow, openModal, cleanup } = await mountExtension();
  try {
    await openModal();
    shadow.querySelector('[data-tab="user"]').click();
    await flushAsync();

    const mergeBtn = shadow.getElementById('upp-persona-merge-btn');
    assert.ok(mergeBtn, '#upp-persona-merge-btn must exist on User tab');
    mergeBtn.click();
    await flushAsync();

    // Expect R1 clear Before→After presentation (retained main User + absorbed candidates + destination explanation)
    const mergeContainer = shadow.getElementById('upp-merge-candidate-list')?.closest('.upp-drawer, .upp-body, .upp-subview') || shadow;
    const mergeText = mergeContainer.textContent;
    assert.ok(
      mergeText.includes('保留') && (mergeText.includes('收纳') || mergeText.includes('合并') || mergeText.includes('变成')),
      'Merge UI must clearly explain retained main User and destination of candidates',
    );
    assert.ok(
      /整理前|整理后|保留为|将变为|去向/.test(mergeText),
      'R1: Merge view must provide explicit Before→After / destination clarity',
    );

    // Enable deleteOld and run merge
    const store = mockHost.extension_settings.user_persona_snapshot;
    const preMergeVersions = structuredClone(store.personaVersions?.['u_main.png'] || []);
    const delOldCb = shadow.getElementById('upp-merge-delete-old');
    assert.ok(delOldCb, '#upp-merge-delete-old should exist');
    if (!delOldCb.checked) delOldCb.click();

    const runBtn = shadow.getElementById('upp-merge-run-btn');
    assert.ok(runBtn && !runBtn.disabled, 'Merge run button should be enabled with candidates selected');
    runBtn.click();
    await flushAsync();

    // Verify /User Avatars/ blob fetch occurred BEFORE /api/avatars/delete and absorbed versions stored
    const fetchUrls = mockHost.fetchCalls.map((c) => c.url);
    const avatarFetchIdx = fetchUrls.findIndex((u) => u.includes('/User%20Avatars/') || u.includes('/User Avatars/'));
    const deleteIdx = fetchUrls.findIndex((u) => u.endsWith('/api/avatars/delete'));
    assert.ok(avatarFetchIdx >= 0, 'R1: Merge with deleteOld must fetch /User Avatars/ avatar blob before deletion');
    assert.ok(deleteIdx > avatarFetchIdx, 'R1: /User Avatars/ avatar blob fetch must happen BEFORE /api/avatars/delete');
    const versionsAfterMerge = store.personaVersions['u_main.png'] || [];
    assert.ok(versionsAfterMerge.length >= 2, 'Absorbed personas should be stored in personaVersions');

    // Verify batch undo button is available and restores deleted native personas + pre-merge personaVersions
    const undoBtn = shadow.getElementById('upp-merge-undo-btn')
      || findButtonByTextRe(shadow, /撤销最近一次整理|撤销整理|撤回整理/);
    assert.ok(undoBtn, 'R1: 「撤销最近一次整理」 button must be exposed after merge');
    undoBtn.click();
    await flushAsync();

    assert.ok(
      mockHost.fetchCalls.some((c) => c.url.endsWith('/api/avatars/upload')),
      'R1 batch undo must restore deleted native persona avatar via /api/avatars/upload',
    );
    assert.ok(
      Object.values(mockHost.power_user.personas).includes('沈晚晴'),
      'R1 batch undo must restore deleted native persona into power_user.personas',
    );
    assert.equal(
      (store.personaVersions['u_main.png'] || []).length,
      preMergeVersions.length,
      'R1 batch undo must revert store.personaVersions["u_main.png"] back to pre-merge state',
    );

    // Re-open merge or test single internal version release-to-native
    // Add/ensure an internal version exists and release it back to native User list
    store.personaVersions['u_main.png'] = [
      { id: 'pv_rel_1', name: '古风线', displayName: '苏清', description: 'Released ancient description', lorebook: 'BookMain', updatedAt: Date.now() },
    ];
    shadow.querySelector('[data-tab="snapshots"]').click();
    await flushAsync();
    shadow.querySelector('[data-tab="user"]').click();
    await flushAsync();

    const relRow = shadow.querySelector('[data-pv-view="pv_rel_1"]')?.closest('.upp-entry-row, .upp-entry-wrap');
    const releaseBtn = shadow.querySelector('[data-pv-release="pv_rel_1"]')
      || (relRow ? findButtonByTextRe(relRow, /放回原生/) : null)
      || shadow.querySelector('[data-pv-release]')
      || findButtonByTextRe(shadow, /放回原生/);
    assert.ok(releaseBtn, 'R1: Each internal version must expose 「放回原生 User」 action');
    const uploadBeforeRelease = mockHost.fetchCalls.filter((c) => c.url.endsWith('/api/avatars/upload')).length;
    releaseBtn.click();
    await flushAsync();

    const uploadAfterRelease = mockHost.fetchCalls.filter((c) => c.url.endsWith('/api/avatars/upload')).length;
    assert.ok(uploadAfterRelease > uploadBeforeRelease, 'R1 release-to-native must upload avatar via /api/avatars/upload');
    const releasedEntry = Object.entries(mockHost.power_user.personas).find(([, name]) => name === '苏清');
    assert.ok(releasedEntry, 'R1 release-to-native must create native persona in power_user.personas');
    const [releasedAvatarId] = releasedEntry;
    const releasedDescObj = mockHost.power_user.persona_descriptions?.[releasedAvatarId];
    assert.ok(releasedDescObj, 'R1 release-to-native must populate power_user.persona_descriptions');
    assert.equal(releasedDescObj.description, 'Released ancient description', 'R1 release-to-native must retain description');
    assert.equal(releasedDescObj.lorebook, 'BookMain', 'R1 release-to-native must retain lorebook');
  } finally {
    cleanup();
  }
});

test('Tier 1 [R3]: missingAudit 3-block split, User tab sectioning, and in-place inline editors without stacked modal drawers', async () => {
  const missingSnap = {
    id: 'snap_missing_1',
    name: 'BrokenSnap',
    group: 'Test',
    note: '',
    updatedAt: Date.now(),
    scope: { persona: true, worldbooks: true, preset: true, regex: false, api: true },
    persona: { avatarId: 'u_deleted.png', name: 'GhostUser', versionId: '', versionName: '', description: 'x', lorebook: '' },
    worldbooks: { global: ['MissingBook'], char: null, chat: null, entries: { MissingBook: { '1': true } } },
    preset: { name: 'MissingPreset', prompts: { p1: true }, groups: {} },
    regex: null,
    api: { profileId: 'prof_missing', profileName: 'MissingAPI', source: 'openai', model: 'gpt-4' },
  };
  const { shadow, openModal, cleanup } = await mountExtension({
    hostOverrides: {
      extension_settings: {
        user_persona_snapshot: {
          version: 7,
          settings: { themeMode: 'paper', showFloatingBall: true },
          snapshots: [missingSnap],
          personaVersions: {
            'u_main.png': [
              { id: 'pv1', name: '现代线', displayName: '林晚晴', description: 'Modern desc', lorebook: '', updatedAt: Date.now() },
            ],
          },
          bindings: { chats: {}, characters: {} },
        },
        connectionManager: { selectedProfile: '', profiles: [] },
      },
    },
  });
  try {
    await openModal();

    // 1. Trigger missingAudit -> verify 3-block split
    shadow.querySelector('[data-snap-apply="snap_missing_1"]').click();
    await flushAsync();
    const drawerMask = shadow.getElementById('upp-drawer-mask');
    assert.equal(drawerMask.hidden, false, 'missingAudit should open');
    const maBody = drawerMask.querySelector('.upp-drawer-body') || drawerMask;
    const maBlocks = maBody.querySelectorAll('.upp-ma-block, .upp-audit-block, [data-ma-block], .upp-section-block, .upp-ma-section, .upp-audit-section, [data-ma-section], section');
    const maHeadings = maBody.querySelectorAll('h3, h4, .upp-section-title, .upp-block-title');
    assert.ok(
      maBlocks.length >= 3 || maHeadings.length >= 3,
      'R3: missingAudit must split into 3 clearly demarcated functional blocks',
    );

    // Close audit
    drawerMask.querySelector('[data-drawer-close]').click();
    await flushAsync();

    // 2. Snapshot meta edit inside viewSnapshot must render inline without stacking a new drawer & must save
    shadow.querySelector('[data-snap-view="snap_missing_1"]').click();
    await flushAsync();
    const editMetaBtn = shadow.getElementById('upp-sv-edit-meta-btn');
    assert.ok(editMetaBtn, '#upp-sv-edit-meta-btn should exist');
    editMetaBtn.click();
    await flushAsync();
    assert.equal(
      Boolean(drawerMask.querySelector('.upp-drawer.is-fixed-box, .upp-drawer.is-fixed-sm')),
      false,
      'R3: Editing snapshot meta from viewSnapshot must NOT stack a new modal drawer (.upp-drawer.is-fixed-box / .is-fixed-sm)',
    );
    const metaNameInput = drawerMask.querySelector('#upp-em-name, [data-sv-meta-name], input[type="text"]:not(#upp-sv-search), input:not([type]):not(#upp-sv-search)');
    assert.ok(metaNameInput, 'R3: Clicking #upp-sv-edit-meta-btn must render inline snapshot meta input inside viewSnapshot');
    metaNameInput.value = 'BrokenSnapRenamed';
    const metaSaveBtn = shadow.getElementById('upp-em-save-btn')
      || drawerMask.querySelector('[data-sv-meta-save]')
      || findButtonByTextRe(drawerMask, /保存修改|保存/);
    assert.ok(metaSaveBtn, 'R3: Inline snapshot meta editor must expose a save button');
    metaSaveBtn.click();
    await flushAsync();
    assert.equal(
      mockHost.extension_settings.user_persona_snapshot.snapshots.find((s) => s.id === 'snap_missing_1')?.name,
      'BrokenSnapRenamed',
      'R3: Inline snapshot meta edit must save updated snapshot name to store',
    );
    drawerMask.querySelector('[data-sv-back]')?.click();
    drawerMask.querySelector('[data-drawer-close]')?.click();
    await flushAsync();

    // 3. User tab: sectioning + inline rename + inline body edit + inline internal version edit
    shadow.querySelector('[data-tab="user"]').click();
    await flushAsync();
    const userBody = shadow.getElementById('upp-body');
    const userSections = userBody.querySelectorAll('.upp-section-block, .upp-card, [data-user-section], section');
    assert.ok(userSections.length >= 2, 'R3: User tab must separate active User and internal versions into clear blocks');

    shadow.getElementById('upp-persona-rename-btn').click();
    await flushAsync();
    assert.equal(drawerMask.hidden, true, 'R3: User rename must expand inline in-place without opening #upp-drawer-mask popup');
    const renameInput = userBody.querySelector('input[type="text"]:not(#upp-user-search), input:not([type]):not(#upp-user-search)');
    assert.ok(renameInput, 'R3: Clicking #upp-persona-rename-btn must render an inline rename text input inside #upp-body');
    renameInput.value = '林晚晴_新';
    const renameSaveBtn = userBody.querySelector('#upp-rename-confirm-btn, [data-user-rename-save]')
      || findButtonByTextRe(userBody, /确认|保存/);
    assert.ok(renameSaveBtn, 'R3: Inline rename must provide confirm/save button');
    renameSaveBtn.click();
    await flushAsync();
    assert.equal(mockHost.power_user.personas['u_main.png'], '林晚晴_新', 'R3: Inline User rename must update persona name');

    shadow.getElementById('upp-persona-edit-btn').click();
    await flushAsync();
    assert.equal(drawerMask.hidden, true, 'R3: User body edit must expand inline in-place without opening #upp-drawer-mask popup');
    const bodyTa = userBody.querySelector('textarea');
    assert.ok(bodyTa, 'R3: Clicking #upp-persona-edit-btn must render an inline textarea inside #upp-body');
    bodyTa.value = 'Edited inline user body';
    const bodySaveBtn = userBody.querySelector('#upp-ee-save-btn, [data-user-body-save], [data-persona-body-save]')
      || findButtonByTextRe(userBody, /保存/);
    assert.ok(bodySaveBtn, 'R3: Inline User body editor must provide save button');
    bodySaveBtn.click();
    await flushAsync();
    assert.equal(
      mockHost.power_user.persona_descriptions['u_main.png']?.description,
      'Edited inline user body',
      'R3: Inline User body edit must update persona description',
    );

    shadow.querySelector('[data-pv-view="pv1"]').click();
    await flushAsync();
    assert.equal(drawerMask.hidden, true, 'R3: Internal version edit must expand inline in-place without opening #upp-drawer-mask popup');
    const pvTa = userBody.querySelector('textarea');
    const pvInp = userBody.querySelector('input[type="text"]:not(#upp-user-search), input:not([type]):not(#upp-user-search)');
    assert.ok(pvTa || pvInp, 'R3: Clicking [data-pv-view="pv1"] must render an inline editor inside #upp-body');
    if (pvTa) {
      pvTa.value = 'Modern desc edited';
      const pvSaveBtn = userBody.querySelector('[data-pv-save], #upp-ee-save-btn') || findButtonByTextRe(userBody, /保存/);
      assert.ok(pvSaveBtn, 'R3: Inline internal version editor must provide save button');
      pvSaveBtn.click();
      await flushAsync();
      assert.equal(
        mockHost.extension_settings.user_persona_snapshot.personaVersions['u_main.png'].find((v) => v.id === 'pv1')?.description,
        'Modern desc edited',
        'R3: Inline internal version edit must save updated description',
      );
    }

    // 4. Regex tab: clicking regex item expands details inline (not popup drawer)
    shadow.querySelector('[data-tab="regex"]').click();
    await flushAsync();
    const rgOpen = shadow.querySelector('[data-rg-open="rg1"]');
    assert.ok(rgOpen, '[data-rg-open="rg1"] should exist');
    rgOpen.click();
    await flushAsync();
    assert.equal(drawerMask.hidden, true, 'R3: Regex details must expand inline in-place without opening #upp-drawer-mask popup');
    const rgBody = shadow.getElementById('upp-body');
    const rgInlineDetail = rgBody.querySelector('.upp-inline-panel, [data-rg-panel="rg1"], textarea, pre, code');
    assert.ok(rgInlineDetail, 'R3: Clicking [data-rg-open="rg1"] must render inline regex detail panel inside #upp-body');
  } finally {
    cleanup();
  }
});

test('Tier 1 [R4]: Standalone operation with zero external plugins (stale WBO settings + disabled WBO/CM + missing regex)', async () => {
  const { dom, shadow, openModal, cleanup } = await mountExtension({
    regexMissing: true,
    hostOverrides: {
      extension_settings: {
        disabledExtensions: ['worldbook-organizer', 'connection-manager'],
        worldbook_organizer: {
          groups: [{ id: 'g1', name: 'StaleGroup', color: '#446688' }],
          assignments: { BookMain: 'g1' },
        },
        connectionManager: {
          selectedProfile: 'p_stale',
          profiles: [{ id: 'p_stale', name: 'StaleProfile', api: 'openai', model: 'gpt-4' }],
        },
      },
    },
  });
  try {
    let wboOpenCount = 0;
    dom.window.addEventListener('wbo:open-panel', () => { wboOpenCount++; });

    await openModal();

    // Worldbook tab: WBO entry button must be hidden/omitted when worldbook-organizer is disabled/inactive
    shadow.querySelector('[data-tab="worldbook"]').click();
    await flushAsync();
    assert.equal(
      isElementAbsentOrHidden(shadow.getElementById('upp-open-wbo-btn')),
      true,
      'R4: #upp-open-wbo-btn must be hidden/omitted when worldbook-organizer is disabled/inactive',
    );

    // Book picker drawer: WBO button hidden/omitted too
    shadow.getElementById('upp-book-picker-btn').click();
    await flushAsync();
    assert.equal(
      isElementAbsentOrHidden(shadow.getElementById('upp-open-wbo-in-drawer')),
      true,
      'R4: #upp-open-wbo-in-drawer must be hidden/omitted when worldbook-organizer is disabled/inactive',
    );
    shadow.querySelector('[data-drawer-close]').click();
    await flushAsync();

    // Regex tab with missing regex/engine.js: zero uncaught exceptions + clear disabled/unavailable hint
    shadow.querySelector('[data-tab="regex"]').click();
    await flushAsync();
    const rgText = shadow.getElementById('upp-body').textContent;
    assert.ok(/未启用|未安装|不可用|禁用|未检测到/.test(rgText), 'R4: Regex tab must display clear standalone hint when regex module is unavailable');

    // Save snapshot still succeeds smoothly standalone and must NOT record disabled connection-manager stale profile
    shadow.getElementById('upp-foot-save-snap-btn').click();
    await flushAsync();
    const ssConfirm = shadow.getElementById('upp-ss-confirm-btn');
    assert.ok(ssConfirm, '#upp-ss-confirm-btn should open');
    ssConfirm.click();
    await flushAsync();

    assert.equal(mockHost.extension_settings.user_persona_snapshot.snapshots.length, 1, 'Standalone snapshot save must succeed cleanly');
    const savedStandalone = mockHost.extension_settings.user_persona_snapshot.snapshots[0];
    assert.equal(savedStandalone.api?.profileId || '', '', 'R4: Disabled connection-manager stale profile must NOT be captured into saved snapshot');
    assert.equal(wboOpenCount, 0, 'Should never emit unhandled wbo:open-panel when disabled');
  } finally {
    cleanup();
  }

  // Also test built-in regex disabled via disabledExtensions: ['regex'] even when regex/engine.js module exists
  const regexDisabledMount = await mountExtension({
    regexMissing: false,
    hostOverrides: {
      extension_settings: {
        disabledExtensions: ['worldbook-organizer', 'connection-manager', 'regex'],
        connectionManager: {
          selectedProfile: 'p_stale',
          profiles: [{ id: 'p_stale', name: 'StaleProfile', api: 'openai', model: 'gpt-4' }],
        },
      },
    },
  });
  try {
    await regexDisabledMount.openModal();
    regexDisabledMount.shadow.querySelector('[data-tab="regex"]').click();
    await flushAsync();
    const rgBodyEl = regexDisabledMount.shadow.getElementById('upp-body');
    const rgDisabledText = rgBodyEl.textContent;
    assert.ok(
      /未启用|已禁用|未开启|不可用|禁用|未检测到/.test(rgDisabledText),
      'R4: Regex tab must show clear disabled/unavailable hint when disabledExtensions includes "regex"',
    );
  } finally {
    regexDisabledMount.cleanup();
  }
});

test('Tier 1 [R5]: Preset sync 「指定已有开关」 grouped collapsible tree, sticky header, independent inner scroller, and pinned bottom checkboxes', async () => {
  const snap = {
    id: 'snap_ps_1',
    name: 'PresetSnap1',
    group: '',
    note: '',
    updatedAt: Date.now(),
    scope: { persona: false, worldbooks: false, preset: true, regex: false, api: false },
    persona: null,
    worldbooks: null,
    preset: {
      name: 'PresetA',
      prompts: { p1: true, p2: false, p3: true },
      groups: { grp_core: true },
      promptNames: { p1: 'Main System', p2: 'World Lore', p3: 'Style Guide' },
      groupNames: { grp_core: '核心设定组' },
    },
    regex: null,
    api: null,
  };
  const { shadow, openModal, cleanup } = await mountExtension({
    hostOverrides: {
      extension_settings: {
        user_persona_snapshot: {
          version: 7,
          settings: {},
          snapshots: [snap],
          personaVersions: {},
          bindings: { chats: {}, characters: {} },
        },
      },
    },
  });
  try {
    await openModal();
    shadow.getElementById('upp-snap-preset-sync-btn').click();
    await flushAsync();

    // Expand 「指定已有开关」
    const ovToggle = shadow.getElementById('upp-ps-ov-toggle');
    assert.ok(ovToggle, '#upp-ps-ov-toggle must exist');
    ovToggle.click();
    await flushAsync();

    // Verify sticky header, independent scroller, and grouped tree structure (opaque-box resilient)
    const ovHead = shadow.querySelector('.upp-ps-ov-head') || ovToggle.closest('.upp-ps-ov-head, .upp-group-head');
    assert.ok(ovHead, 'R5: Override header element must exist');
    const ovList = shadow.getElementById('upp-ps-ov-list');
    assert.ok(ovList, '#upp-ps-ov-list must exist');
    const ovScroll = findOverrideScroller(shadow);
    assert.ok(ovScroll, 'R5: Independent inner scroll container (#upp-ps-ov-scroll / .upp-ps-ov-scroll) must exist');
    assert.ok(ovScroll.contains(ovList), '#upp-ps-ov-list must live inside inner scroll container');

    // Bottom checkboxes must be pinned OUTSIDE inner scroller so large preset lists cannot push them out
    const cleanCb = shadow.getElementById('upp-ps-clean-removed');
    const syncGrpCb = shadow.getElementById('upp-ps-sync-groups');
    assert.ok(cleanCb && syncGrpCb, 'Bottom checkboxes #upp-ps-clean-removed and #upp-ps-sync-groups must exist');
    assert.equal(ovScroll.contains(cleanCb), false, '#upp-ps-clean-removed must be outside inner scroll container');
    assert.equal(ovScroll.contains(syncGrpCb), false, '#upp-ps-sync-groups must be outside inner scroll container');

    // Grouped collapsible tree inside override list: group box containing group master switch + member prompt checkboxes
    const groupBox = ovList.querySelector('.upp-group-box');
    assert.ok(groupBox, 'R5: Override list must render collapsible .upp-group-box tree');
    assert.ok(groupBox.querySelector('[data-ps-ov-grp="grp_core"]'), 'Group box must include group master switch [data-ps-ov-grp]');
    assert.ok(groupBox.querySelector('[data-ps-ov-pr="p1"]'), 'Group box must nest its member prompt [data-ps-ov-pr="p1"]');
    assert.ok(ovList.querySelector('[data-ps-ov-pr="p3"]'), 'Ungrouped prompt p3 must appear in preset order');
    assert.equal(groupBox.querySelector('[data-ps-ov-pr="p3"]'), null, 'Ungrouped prompt p3 must NOT be placed inside grp_core');

    // Collapse and expand group inside #upp-ps-ov-list
    const foldBtn = groupBox.querySelector('[data-ps-ov-fold], [data-prg-fold], .upp-group-toggle-btn, button:not([data-ps-ov-grp])');
    assert.ok(foldBtn, 'R5: Group box in override list must expose fold/expand toggle');
    const wasCollapsed = groupBox.classList.contains('is-collapsed') || !groupBox.querySelector('[data-ps-ov-pr="p1"]');
    foldBtn.click();
    await flushAsync();
    const groupBoxAfterFold = ovList.querySelector('.upp-group-box');
    const isNowCollapsed = groupBoxAfterFold.classList.contains('is-collapsed') || !groupBoxAfterFold.querySelector('[data-ps-ov-pr="p1"]');
    assert.notEqual(isNowCollapsed, wasCollapsed, 'R5: Clicking group fold toggle in #upp-ps-ov-list must collapse/expand group');
    const foldBtn2 = groupBoxAfterFold.querySelector('[data-ps-ov-fold], [data-prg-fold], .upp-group-toggle-btn, button:not([data-ps-ov-grp])');
    foldBtn2.click();
    await flushAsync();
    const groupBoxRestored = ovList.querySelector('.upp-group-box');
    const isRestoredCollapsed = groupBoxRestored.classList.contains('is-collapsed') || !groupBoxRestored.querySelector('[data-ps-ov-pr="p1"]');
    assert.equal(isRestoredCollapsed, wasCollapsed, 'R5: Clicking group fold toggle again must restore expanded/collapsed state');

    // Static CSS checks: sticky rule on ovHead's class/id + overflow-y: auto & overscroll-behavior: contain on ovScroll
    const indexSrc = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const headClasses = [...(ovHead.className || '').split(/\s+/).filter(Boolean).map((c) => `.${c}`)];
    if (ovHead.id) headClasses.push(`#${ovHead.id}`);
    const hasStickyHeadCss = headClasses.some((tok) => new RegExp(`${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{[^}]*position\\s*:\\s*sticky\\b`).test(indexSrc));
    assert.ok(hasStickyHeadCss, 'R5: Override sticky header must declare position: sticky in STYLE_CSS');
    const scrollTokens = [...(ovScroll.className || '').split(/\s+/).filter(Boolean).map((c) => `.${c}`)];
    if (ovScroll.id) scrollTokens.push(`#${ovScroll.id}`);
    const hasScrollCss = scrollTokens.some((tok) => {
      const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`${esc}[^{]*\\{[^}]*overflow-y\\s*:\\s*auto\\b`).test(indexSrc)
        && new RegExp(`${esc}[^{]*\\{[^}]*overscroll-behavior\\s*:\\s*contain\\b`).test(indexSrc);
    });
    assert.ok(hasScrollCss, 'R5: Override inner scroller must declare overflow-y: auto and overscroll-behavior: contain in STYLE_CSS');
  } finally {
    cleanup();
  }
});

test('Tier 1 [R8]: Native ST UI/Scroll isolation — zero scrollIntoView, preventScroll, type="button", overscroll-behavior, navigateToCurrent:false, #upp-wb-jump-hygiene-btn & .openDrawer protection', async () => {
  const { dom, shadow, openModal, cleanup } = await mountExtension();
  try {
    await openModal();

    // 1. Every <button> inside Shadow DOM must have explicit type="button" across ALL tabs and drawers
    assertAllShadowButtonsHaveTypeButton(shadow, 'snapshots');

    // 2. Host.switchPersona uses navigateToCurrent: false + user tab button types
    shadow.querySelector('[data-tab="user"]').click();
    await flushAsync();
    assertAllShadowButtonsHaveTypeButton(shadow, 'user');
    const pSel = shadow.getElementById('upp-persona-select');
    pSel.value = 'u_alt1.png';
    const switchesBefore = mockHost.setUserAvatarCalls.length;
    pSel.dispatchEvent(new dom.MockEvent('change', { bubbles: true }));
    await flushAsync();
    // 意见 #5/#15（D4）：下拉只改“正在查看”的对象，浏览不得切换酒馆当前 User
    assert.equal(mockHost.setUserAvatarCalls.length, switchesBefore, 'D4: 查看 User 不得调用 setUserAvatar（浏览不切宿主）');
    assert.ok(shadow.getElementById('upp-persona-use-btn'), 'D4: 查看态必须提供显式「设为当前使用」按钮');
    assert.ok(shadow.getElementById('upp-persona-view-back-btn'), 'D4: 查看态必须能退回当前 User');
    // 显式确认后才切换，且仍不跳转聊天
    shadow.getElementById('upp-persona-use-btn').click();
    await flushAsync();
    assert.equal(mockHost.setUserAvatarCalls.length, switchesBefore, 'D4: 设为当前使用需二次确认，点一次不能直接切换');
    shadow.getElementById('upp-persona-use-confirm').click();
    await flushAsync();
    assert.ok(mockHost.setUserAvatarCalls.length > switchesBefore, 'D4: 确认后必须切换酒馆当前 User');
    const lastSwitch = mockHost.setUserAvatarCalls[mockHost.setUserAvatarCalls.length - 1];
    assert.equal(lastSwitch.opts?.navigateToCurrent, false, 'R8: Host.switchPersona MUST pass navigateToCurrent: false');

    // 3. Worldbook tab + inline editor + bookPicker drawer button types + #upp-wb-jump-hygiene-btn scroll isolation
    shadow.querySelector('[data-tab="worldbook"]').click();
    await flushAsync();
    assertAllShadowButtonsHaveTypeButton(shadow, 'worldbook');
    shadow.getElementById('upp-book-picker-btn').click();
    await flushAsync();
    assertAllShadowButtonsHaveTypeButton(shadow, 'bookPicker');
    shadow.querySelector('[data-drawer-close]').click();
    await flushAsync();

    dom.outerScrollCalls.length = 0;
    dom.scrollIntoViewCalls.length = 0;
    dom.allScrollCalls.length = 0;

    const jumpBtn = shadow.getElementById('upp-wb-jump-hygiene-btn');
    assert.ok(jumpBtn, '#upp-wb-jump-hygiene-btn should render for unclosed tag entry');
    jumpBtn.click();
    await flushAsync();
    assertAllShadowButtonsHaveTypeButton(shadow, 'worldbook-inline');

    assert.equal(dom.scrollIntoViewCalls.length, 0, 'R8: Zero scrollIntoView() calls permitted');
    assert.equal(dom.outerScrollCalls.length, 0, 'R8: Clicking #upp-wb-jump-hygiene-btn must NEVER scroll ST outer page or #send_form');
    assert.ok(
      dom.allScrollCalls.some((c) => c.id === 'upp-body'),
      'R8: #upp-wb-jump-hygiene-btn must scroll internal #upp-body via scrollTo()',
    );

    // Preset + Regex tabs + presetSync + backup + saveSnapshot drawers button type="button" check
    shadow.querySelector('[data-tab="preset"]').click();
    await flushAsync();
    assertAllShadowButtonsHaveTypeButton(shadow, 'preset');
    shadow.getElementById('upp-preset-sync-btn')?.click();
    await flushAsync();
    assertAllShadowButtonsHaveTypeButton(shadow, 'presetSync');
    shadow.querySelector('[data-drawer-close]')?.click();
    await flushAsync();

    shadow.querySelector('[data-tab="regex"]').click();
    await flushAsync();
    assertAllShadowButtonsHaveTypeButton(shadow, 'regex');

    // 4. All programmatic .focus() calls on desktop must include { preventScroll: true }
    dom.focusCalls.length = 0;
    shadow.getElementById('upp-foot-save-snap-btn').click();
    await flushAsync();
    assertAllShadowButtonsHaveTypeButton(shadow, 'saveSnapshot');
    for (const fc of dom.focusCalls) {
      assert.equal(fc.hasPreventScroll, true, `R8: Programmatic .focus() on #${fc.id} must use { preventScroll: true }`);
    }
    shadow.querySelector('[data-drawer-close]').click();
    await flushAsync();

    shadow.getElementById('upp-backup-btn')?.click();
    await flushAsync();
    assertAllShadowButtonsHaveTypeButton(shadow, 'backup');
    shadow.querySelector('[data-drawer-close]')?.click();
    await flushAsync();

    // 5. Clicking inside Shadow DOM modal, restore pill, FAB, and FAB pop does NOT collapse ST's native .openDrawer,
    //    nor leak wheel/keydown/touchmove
    const stDrawer = dom.doc.getElementById('st-open-drawer');
    assert.ok(stDrawer.classList.contains('openDrawer'));
    let hostWheelCount = 0;
    let hostKeydownCount = 0;
    let hostTouchMoveCount = 0;
    dom.doc.body.addEventListener('wheel', () => { hostWheelCount++; });
    dom.doc.body.addEventListener('keydown', () => { hostKeydownCount++; });
    dom.doc.body.addEventListener('touchmove', () => { hostTouchMoveCount++; });

    const modal = shadow.querySelector('.upp-modal');
    modal.dispatchEvent(new dom.MockEvent('mousedown', { bubbles: true, cancelable: true }));
    modal.dispatchEvent(new dom.MockEvent('touchstart', { bubbles: true, cancelable: true }));
    modal.dispatchEvent(new dom.MockEvent('touchmove', { bubbles: true, cancelable: true }));
    modal.dispatchEvent(new dom.MockEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(dom.getStOpenDrawerClosedCount(), 0, 'R8: Click/mousedown inside Shadow DOM modal must not close ST .openDrawer');
    assert.equal(stDrawer.classList.contains('openDrawer'), true);

    const drawerBody = shadow.querySelector('.upp-drawer-body') || shadow.getElementById('upp-body');
    drawerBody.dispatchEvent(new dom.MockEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 }));
    drawerBody.dispatchEvent(new dom.MockEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' }));
    drawerBody.dispatchEvent(new dom.MockEvent('touchmove', { bubbles: true, cancelable: true }));
    assert.equal(hostWheelCount, 0, 'R8: wheel events inside plugin must not bubble into ST host body');
    assert.equal(hostKeydownCount, 0, 'R8: keydown events inside plugin must not leak into ST host shortcuts');
    assert.equal(hostTouchMoveCount, 0, 'R8: touchmove events inside plugin modal/body must not bubble into ST host body');

    // Minimize modal -> test #upp-restore-pill .openDrawer & touchmove isolation
    shadow.getElementById('upp-min-btn').click();
    await flushAsync();
    const restorePill = shadow.getElementById('upp-restore-pill');
    assert.equal(restorePill.hidden, false, '#upp-restore-pill should appear when minimized');
    restorePill.dispatchEvent(new dom.MockEvent('mousedown', { bubbles: true, cancelable: true }));
    restorePill.dispatchEvent(new dom.MockEvent('touchstart', { bubbles: true, cancelable: true }));
    restorePill.dispatchEvent(new dom.MockEvent('touchmove', { bubbles: true, cancelable: true }));
    restorePill.dispatchEvent(new dom.MockEvent('click', { bubbles: true, cancelable: true }));
    await flushAsync();
    assert.equal(dom.getStOpenDrawerClosedCount(), 0, 'R8: #upp-restore-pill clicks must not close ST .openDrawer');
    assert.equal(stDrawer.classList.contains('openDrawer'), true);
    assert.equal(hostTouchMoveCount, 0, 'R8: #upp-restore-pill touchmove must not bubble into ST host body');

    // Close modal -> test #upp-fab-btn & #upp-fab-pop .openDrawer & touchmove isolation
    shadow.getElementById('upp-close-btn').click();
    await flushAsync();
    triggerFabTap(dom, shadow);
    await flushAsync();
    const fabBtn = shadow.getElementById('upp-fab-btn');
    const fabPop = shadow.getElementById('upp-fab-pop');
    assert.equal(fabPop.hidden, false, '#upp-fab-pop should be open');
    for (const rootEl of [fabBtn, fabPop]) {
      rootEl.dispatchEvent(new dom.MockEvent('mousedown', { bubbles: true, cancelable: true }));
      rootEl.dispatchEvent(new dom.MockEvent('touchstart', { bubbles: true, cancelable: true }));
      rootEl.dispatchEvent(new dom.MockEvent('touchmove', { bubbles: true, cancelable: true }));
      rootEl.dispatchEvent(new dom.MockEvent('click', { bubbles: true, cancelable: true }));
    }
    assert.equal(dom.getStOpenDrawerClosedCount(), 0, 'R8: #upp-fab-btn and #upp-fab-pop clicks must not close ST .openDrawer');
    assert.equal(stDrawer.classList.contains('openDrawer'), true);
    assert.equal(hostTouchMoveCount, 0, 'R8: #upp-fab-btn and #upp-fab-pop touchmove must not bubble into ST host body');
  } finally {
    cleanup();
  }
});

// ============================================================================
// 5. TIER 2 — Boundary & Corner Cases
// ============================================================================

test('Tier 2 [Mobile & Soft-Keyboard]: <=680px breakpoint, pointer:coarse zero auto-focus, modalGeo.height & FAB pop survival on visualViewport shrink', async () => {
  // Verify CSS rules for <= 680px, 16px input font-size, >= 34px mobile min-height, 100dvh, safe-area-inset-left/right
  const indexSrc = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.match(indexSrc, /@media\s*\(max-width:\s*680px\)/, 'Mobile CSS breakpoint must be unified to 680px');
  assert.equal(/@media\s*\(max-width:\s*640px\)/.test(indexSrc), false, 'Old 640px CSS breakpoint must not remain');
  assert.match(indexSrc, /env\(safe-area-inset-left/, 'Mobile CSS must include env(safe-area-inset-left)');
  assert.match(indexSrc, /env\(safe-area-inset-right/, 'Mobile CSS must include env(safe-area-inset-right)');
  assert.match(indexSrc, /min-height:\s*34px\s*!important|min-height:\s*34px/, 'Mobile inputs must enforce >= 34px min-height');
  assert.match(indexSrc, /font-size:\s*16px\s*!important/, 'Mobile/coarse inputs must enforce >= 16px font-size');

  // Boundary vw=680: mobile -> ZERO auto-focus
  const { dom, shadow, openModal, cleanup } = await mountExtension({
    domOpts: { innerWidth: 680, innerHeight: 844, pointerCoarse: true },
  });
  try {
    await openModal();
    dom.focusCalls.length = 0;

    // Open Save Snapshot drawer on mobile: must NOT auto-focus input
    shadow.getElementById('upp-foot-save-snap-btn').click();
    await flushAsync();
    assert.equal(dom.focusCalls.length, 0, 'Mobile <=680px / pointer:coarse must NEVER auto-focus inputs');
    shadow.querySelector('[data-drawer-close]').click();
    await flushAsync();

    // Open FAB quick popover, focus #upp-fab-search, then shrink visualViewport (soft keyboard) -> FAB pop MUST stay open!
    shadow.getElementById('upp-close-btn').click();
    await flushAsync();
    triggerFabTap(dom, shadow);
    await flushAsync();
    const fabPop = shadow.getElementById('upp-fab-pop');
    const fabSearch = shadow.getElementById('upp-fab-search');
    assert.equal(fabPop.hidden, false, 'FAB popover should be open');
    fabSearch.focus({ preventScroll: true });

    dom.vv.height = 460;
    dom.vv.dispatchEvent(new dom.MockEvent('resize'));
    globalThis.window.dispatchEvent(new dom.MockEvent('resize'));
    await flushAsync();

    assert.equal(fabPop.hidden, false, 'Soft-keyboard visualViewport shrink must NOT close FAB popover');
    assert.equal(dom.doc.activeElement, fabSearch, 'Soft-keyboard resize must NOT drop #upp-fab-search focus');
  } finally {
    cleanup();
  }

  const phone = await mountExtension({
    domOpts: { innerWidth: 390, innerHeight: 844, pointerCoarse: true,
      computedVars: { '--SmartThemeBlurTintColor': 'rgba(12, 20, 30, 0.25)' } },
    hostOverrides: {
      extension_settings: { user_persona_snapshot: { version: 7, settings: { themeMode: 'host' }, snapshots: [] } },
    },
  });
  try {
    await phone.openModal();
    const modal = phone.shadow.querySelector('.upp-modal');
    assert.match(modal.style.backgroundColor, /^rgb\(\d+, \d+, \d+\)$/, '390px host theme must paint an opaque modal surface');
    assert.doesNotMatch(phone.shadow.querySelector('.upp-backdrop').style.backgroundColor || '', /^rgb\(/);
    phone.shadow.getElementById('upp-close-btn').click();
    triggerFabTap(phone.dom, phone.shadow);
    assert.equal(phone.shadow.getElementById('upp-fab-pop').style.backgroundColor, modal.style.backgroundColor);
  } finally {
    phone.cleanup();
  }

  // Desktop soft-keyboard / visualViewport height shrink must NOT mutate persisted modalHeight
  const desktopMount = await mountExtension({
    domOpts: { innerWidth: 1024, innerHeight: 760, pointerCoarse: false },
    hostOverrides: {
      extension_settings: {
        user_persona_snapshot: {
          version: 7,
          settings: { modalWidth: 720, modalHeight: 620 },
          snapshots: [],
          personaVersions: {},
          bindings: { chats: {}, characters: {} },
        },
      },
    },
  });
  try {
    await desktopMount.openModal();
    const modal = desktopMount.shadow.querySelector('.upp-modal');
    const hBefore = parseFloat(modal.style.height);
    assert.equal(hBefore, 620, 'Persisted modalHeight 620 should be restored');

    // Focus an input inside the modal, shrink visualViewport (soft keyboard), then restore visualViewport
    const modalInput = desktopMount.shadow.getElementById('upp-snap-search');
    assert.ok(modalInput, 'Modal search input should exist for desktop soft-keyboard focus test');
    modalInput.focus({ preventScroll: true });

    desktopMount.dom.vv.height = 420;
    desktopMount.dom.vv.dispatchEvent(new desktopMount.dom.MockEvent('resize'));
    globalThis.window.dispatchEvent(new desktopMount.dom.MockEvent('resize'));
    await flushAsync();

    assert.equal(
      desktopMount.dom.focusCalls.every((c) => c.hasPreventScroll),
      true,
      'Desktop focus calls must use preventScroll: true',
    );
    assert.equal(
      mockHost.extension_settings.user_persona_snapshot.settings.modalHeight,
      620,
      'Soft-keyboard visualViewport height shrink must NOT overwrite persisted modalHeight',
    );

    // Restore visualViewport height -> modal.style.height MUST recover to 620px (proving modalGeo.height was not clobbered)
    desktopMount.dom.vv.height = 760;
    desktopMount.dom.vv.dispatchEvent(new desktopMount.dom.MockEvent('resize'));
    globalThis.window.dispatchEvent(new desktopMount.dom.MockEvent('resize'));
    await flushAsync();

    assert.equal(
      parseFloat(modal.style.height),
      620,
      'R8: Desktop modal.style.height / modalGeo.height MUST recover to 620px after soft-keyboard visualViewport shrink restores to 760',
    );
    assert.equal(
      mockHost.extension_settings.user_persona_snapshot.settings.modalHeight,
      620,
      'Persisted modalHeight must remain 620 after visualViewport restores',
    );
  } finally {
    desktopMount.cleanup();
  }
});

test('Tier 2 [Boundary]: Duplicate persona name collision on release-to-native creates deduplicated name without overwriting', async () => {
  const { shadow, openModal, cleanup } = await mountExtension({
    hostOverrides: {
      extension_settings: {
        user_persona_snapshot: {
          version: 7,
          settings: {},
          snapshots: [],
          personaVersions: {
            'u_main.png': [
              { id: 'pv_dup', name: '分身版', displayName: '林晚晴', description: 'Duplicate name version', lorebook: '', updatedAt: Date.now() },
            ],
          },
          bindings: { chats: {}, characters: {} },
        },
      },
    },
  });
  try {
    await openModal();
    shadow.querySelector('[data-tab="user"]').click();
    await flushAsync();

    const releaseBtn = shadow.querySelector('[data-pv-release="pv_dup"]')
      || findButtonByText(shadow, '放回原生');
    assert.ok(releaseBtn, 'R1: Release-to-native button must exist on internal version');
    releaseBtn.click();
    await flushAsync();

    const names = Object.values(mockHost.power_user.personas);
    assert.ok(names.length >= 4, 'Releasing colliding name must create a new persona instead of overwriting');
    assert.equal(mockHost.power_user.personas['u_main.png'], '林晚晴', 'Original native persona name must remain intact');
    const releasedNames = names.filter((n) => n !== '林晚晴' && n !== '沈晚晴' && n !== '林晚晴 (校园)');
    assert.equal(releasedNames.length, 1, 'Released persona must have a deduplicated distinct name');
    assert.notEqual(releasedNames[0], '林晚晴', 'Colliding released persona name must be deduplicated');
  } finally {
    cleanup();
  }
});

test('Tier 2 [Boundary]: Empty preset groups (groups.length === 0) hides #upp-ps-sync-groups and Preset fold controls', async () => {
  const noGroupPreset = {
    FlatPreset: {
      prompts: [
        { identifier: 'fp1', name: 'FlatPrompt1', role: 'system', content: 'Body 1', marker: false },
      ],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'fp1', enabled: true }] }],
      extensions: {},
    },
  };
  const snap = {
    id: 'snap_flat',
    name: 'FlatSnap',
    group: '',
    note: '',
    updatedAt: Date.now(),
    scope: { persona: false, worldbooks: false, preset: true, regex: false, api: false },
    preset: { name: 'FlatPreset', prompts: { fp1: true }, groups: {} },
  };
  const { shadow, openModal, cleanup } = await mountExtension({
    hostOverrides: {
      presetsStore: noGroupPreset,
      loadedPresetName: 'FlatPreset',
      extension_settings: {
        user_persona_snapshot: {
          version: 7,
          settings: {},
          snapshots: [snap],
          personaVersions: {},
          bindings: { chats: {}, characters: {} },
        },
      },
    },
  });
  try {
    await openModal();

    // Preset tab toolbar hides fold controls when 0 groups
    shadow.querySelector('[data-tab="preset"]').click();
    await flushAsync();
    assert.equal(isElementAbsentOrHidden(shadow.getElementById('upp-preset-fold-all-btn')), true, 'Fold-all button must be hidden when preset has 0 groups');
    assert.equal(isElementAbsentOrHidden(shadow.getElementById('upp-preset-default-fold-sw')), true, 'Default-fold switch must be hidden when preset has 0 groups');

    // presetSync drawer hides #upp-ps-sync-groups when target preset has 0 groups
    shadow.getElementById('upp-preset-sync-btn').click();
    await flushAsync();
    const syncGroupsEl = shadow.getElementById('upp-ps-sync-groups');
    const isHiddenOrAbsent = !syncGroupsEl || syncGroupsEl.hidden || syncGroupsEl.closest('[hidden]') !== null;
    assert.equal(isHiddenOrAbsent, true, 'R4/Boundary: #upp-ps-sync-groups must be hidden when target preset has 0 groups');
  } finally {
    cleanup();
  }
});

test('Tier 2 [Boundary]: IME composition (isComposing / compositionstart & compositionend) guards toolbar, drawer, and FAB search inputs', async () => {
  const snaps = [
    { id: 's1', name: '星际远航', group: '', note: '', updatedAt: Date.now(), scope: { persona: false, worldbooks: false, preset: true, regex: false, api: false }, preset: { name: 'PresetA', prompts: { p1: true, p2: false, p3: true }, groups: { grp_core: true } } },
    { id: 's2', name: '校园日常', group: '', note: '', updatedAt: Date.now(), scope: { persona: false, worldbooks: false, preset: true, regex: false, api: false }, preset: { name: 'PresetA', prompts: { p1: true, p2: false, p3: true }, groups: { grp_core: true } } },
  ];
  const { dom, shadow, openModal, cleanup } = await mountExtension({
    hostOverrides: {
      extension_settings: {
        user_persona_snapshot: { version: 7, settings: {}, snapshots: snaps, personaVersions: {}, bindings: { chats: {}, characters: {} } },
      },
    },
  });
  try {
    await openModal();

    // 1. Toolbar #upp-snap-search IME composition guard
    const snapSearch = shadow.getElementById('upp-snap-search');
    snapSearch.dispatchEvent(new dom.MockEvent('compositionstart', { bubbles: true }));
    snapSearch.value = 'xingji';
    snapSearch.dispatchEvent(new dom.MockEvent('input', { bubbles: true, isComposing: true }));
    assert.equal(shadow.querySelectorAll('.upp-card').length, 2, 'Toolbar search must NOT filter mid-composition');
    snapSearch.value = '校园';
    snapSearch.dispatchEvent(new dom.MockEvent('compositionend', { bubbles: true }));
    assert.equal(shadow.querySelectorAll('.upp-card').length, 1, 'Toolbar search must update on compositionend');

    // Clear search and test Drawer #upp-ps-ov-search IME composition guard
    snapSearch.value = '';
    snapSearch.dispatchEvent(new dom.MockEvent('input', { bubbles: true }));
    shadow.getElementById('upp-snap-preset-sync-btn').click();
    await flushAsync();
    shadow.getElementById('upp-ps-ov-toggle').click();
    await flushAsync();
    const ovSearch = shadow.getElementById('upp-ps-ov-search');
    const beforeItems = shadow.getElementById('upp-ps-ov-list').querySelectorAll('[data-ps-ov-pr]').length;
    ovSearch.dispatchEvent(new dom.MockEvent('compositionstart', { bubbles: true }));
    ovSearch.value = 'nomatch_ime';
    ovSearch.dispatchEvent(new dom.MockEvent('input', { bubbles: true, isComposing: true }));
    assert.equal(shadow.getElementById('upp-ps-ov-list').querySelectorAll('[data-ps-ov-pr]').length, beforeItems, 'Drawer override search must ignore input during IME composition');
    ovSearch.value = 'Style';
    ovSearch.dispatchEvent(new dom.MockEvent('compositionend', { bubbles: true }));
    assert.equal(shadow.getElementById('upp-ps-ov-list').querySelectorAll('[data-ps-ov-pr]').length, 1, 'Drawer override search must filter on compositionend');

    // 3. FAB search #upp-fab-search IME guard
    shadow.getElementById('upp-close-btn').click();
    await flushAsync();
    triggerFabTap(dom, shadow);
    await flushAsync();
    const fabSearch = shadow.getElementById('upp-fab-search');
    fabSearch.dispatchEvent(new dom.MockEvent('compositionstart', { bubbles: true }));
    fabSearch.value = 'ime_wip';
    fabSearch.dispatchEvent(new dom.MockEvent('input', { bubbles: true, isComposing: true }));
    assert.equal(shadow.querySelectorAll('.upp-fab-snap-row').length, 2, 'FAB search must ignore mid-composition input');
    fabSearch.value = '星际';
    fabSearch.dispatchEvent(new dom.MockEvent('compositionend', { bubbles: true }));
    assert.equal(shadow.querySelectorAll('.upp-fab-snap-row').length, 1, 'FAB search must apply on compositionend');
  } finally {
    cleanup();
  }
});

test('Tier 2 [Boundary]: Large preset (55 entries across 5 groups) preserves #upp-ps-ov-scroll scrollTop & keeps bottom checkboxes pinned outside scroller', async () => {
  const prompts = [];
  const order = [];
  const groups = [];
  const groupPrompts = {};
  for (let g = 1; g <= 5; g++) {
    groups.push({ id: `grp_${g}`, name: `大型分组 ${g}`, enabled: true, collapsed: false });
  }
  for (let i = 1; i <= 55; i++) {
    const pid = `lp_${i}`;
    prompts.push({ identifier: pid, name: `Prompt Item ${i}`, role: 'system', content: `Content ${i}`, marker: false });
    order.push({ identifier: pid, enabled: i % 2 === 0 });
    if (i <= 50) groupPrompts[pid] = { groupId: `grp_${((i - 1) % 5) + 1}` };
  }
  const bigPresets = {
    BigPreset: {
      prompts,
      prompt_order: [{ character_id: 100001, order }],
      extensions: { presetPromptGroups: { version: 1, groups, prompts: groupPrompts } },
    },
  };
  const snap = {
    id: 'snap_big',
    name: 'BigSnap',
    group: '',
    note: '',
    updatedAt: Date.now(),
    scope: { persona: false, worldbooks: false, preset: true, regex: false, api: false },
    preset: { name: 'BigPreset', prompts: Object.fromEntries(prompts.map(p => [p.identifier, true])), groups: { grp_1: true } },
  };
  const { dom, shadow, openModal, cleanup } = await mountExtension({
    hostOverrides: {
      presetsStore: bigPresets,
      loadedPresetName: 'BigPreset',
      extension_settings: {
        user_persona_snapshot: { version: 7, settings: {}, snapshots: [snap], personaVersions: {}, bindings: { chats: {}, characters: {} } },
      },
    },
  });
  try {
    await openModal();
    shadow.getElementById('upp-snap-preset-sync-btn').click();
    await flushAsync();
    shadow.getElementById('upp-ps-ov-toggle').click();
    await flushAsync();

    const ovScroll = findOverrideScroller(shadow);
    assert.ok(ovScroll, 'Inner override scroller (#upp-ps-ov-scroll / .upp-ps-ov-scroll) must exist for 55-entry preset');
    assert.equal(shadow.querySelectorAll('[data-ps-ov-pr]').length, 55, 'All 55 prompts must render inside override tree');
    assert.equal(shadow.querySelectorAll('[data-ps-ov-grp]').length, 5, 'All 5 group switches must render');

    // Simulate scroll down inside #upp-ps-ov-scroll and toggle a prompt checkbox -> scrollTop preserved & footer checkboxes outside
    ovScroll.scrollTop = 240;
    const cb = shadow.querySelector('[data-ps-ov-pr="lp_25"]');
    cb.checked = true;
    cb.dispatchEvent(new dom.MockEvent('change', { bubbles: true }));
    await flushAsync();

    assert.equal(ovScroll.scrollTop, 240, 'Toggling override checkbox must preserve #upp-ps-ov-scroll.scrollTop');
    assert.equal(ovScroll.contains(shadow.getElementById('upp-ps-clean-removed')), false);
    assert.equal(ovScroll.contains(shadow.getElementById('upp-ps-sync-groups')), false);
  } finally {
    cleanup();
  }
});

// ============================================================================
// 6. TIER 3 — Cross-Feature Combinations
// ============================================================================

test('Tier 3 [R1 + Audit]: Merge personas -> undo -> merge again -> release one version to native -> verify missingAudit consistency', async () => {
  const snapOnAlt = {
    id: 'snap_alt',
    name: 'AltUserSnap',
    group: '',
    note: '',
    updatedAt: Date.now(),
    scope: { persona: true, worldbooks: false, preset: false, regex: false, api: false },
    persona: { avatarId: 'u_alt1.png', name: '沈晚晴', versionId: '', versionName: '', description: 'Alt surname user description.', lorebook: '' },
  };
  const { shadow, openModal, cleanup } = await mountExtension({
    hostOverrides: {
      extension_settings: {
        user_persona_snapshot: { version: 7, settings: {}, snapshots: [snapOnAlt], personaVersions: {}, bindings: { chats: {}, characters: {} } },
      },
    },
  });
  try {
    await openModal();
    shadow.querySelector('[data-tab="user"]').click();
    await flushAsync();

    // 1. Merge with deleteOld=true
    shadow.getElementById('upp-persona-merge-btn').click();
    await flushAsync();
    const delCb = shadow.getElementById('upp-merge-delete-old');
    if (!delCb.checked) delCb.click();
    shadow.getElementById('upp-merge-run-btn').click();
    await flushAsync();
    assert.equal(mockHost.power_user.personas['u_alt1.png'], undefined, 'u_alt1.png deleted after merge');

    // 2. Undo merge -> u_alt1.png restored and personaVersions reverted
    const undoBtn = shadow.getElementById('upp-merge-undo-btn') || findButtonByTextRe(shadow, /撤销最近一次整理|撤销整理|撤回整理/);
    assert.ok(undoBtn, 'Undo button must exist after merge');
    undoBtn.click();
    await flushAsync();
    assert.ok(Object.values(mockHost.power_user.personas).includes('沈晚晴'), 'Undo restores 沈晚晴');
    const store = mockHost.extension_settings.user_persona_snapshot;
    assert.equal((store.personaVersions['u_main.png'] || []).length, 0, 'Undo reverts personaVersions back to pre-merge empty state');

    // 3. Merge again
    shadow.getElementById('upp-persona-merge-btn').click();
    await flushAsync();
    const delCb2 = shadow.getElementById('upp-merge-delete-old');
    if (!delCb2.checked) delCb2.click();
    shadow.getElementById('upp-merge-run-btn').click();
    await flushAsync();

    // 4. Snapshot pointing to deleted u_alt1.png now triggers missingAudit cleanly
    shadow.querySelector('[data-tab="snapshots"]').click();
    await flushAsync();
    shadow.querySelector('[data-snap-apply="snap_alt"]').click();
    await flushAsync();
    assert.equal(shadow.getElementById('upp-drawer-mask').hidden, false, 'missingAudit triggers when snapshot targets merged-out persona');
    shadow.querySelector('[data-drawer-close]').click();
    await flushAsync();

    // 5. Release one internal version back to native -> native persona count increases and retains description/lorebook
    shadow.querySelector('[data-tab="user"]').click();
    await flushAsync();
    const beforeKeys = new Set(Object.keys(mockHost.power_user.personas));
    const relBtn = shadow.querySelector('[data-pv-release]') || findButtonByTextRe(shadow, /放回原生/);
    assert.ok(relBtn, 'Release button must exist');
    relBtn.click();
    await flushAsync();
    const afterKeys = Object.keys(mockHost.power_user.personas);
    assert.equal(afterKeys.length, beforeKeys.size + 1, 'Releasing version adds 1 native persona');
    const newAvatarId = afterKeys.find((k) => !beforeKeys.has(k));
    assert.ok(newAvatarId, 'Released native persona must have an avatar key');
    const releasedMeta = mockHost.power_user.persona_descriptions?.[newAvatarId];
    assert.ok(releasedMeta && typeof releasedMeta.description === 'string' && releasedMeta.description.length > 0, 'Released native persona retains description');
    assert.ok('lorebook' in releasedMeta, 'Released native persona retains lorebook field');
  } finally {
    cleanup();
  }
});

test('Tier 3 [R4 + R3 + R5]: Stale WBO + disabled CM -> 3-block missingAudit -> migrate preset -> grouped presetSync override', async () => {
  const legacySnap = {
    id: 'snap_legacy',
    name: 'LegacySnap',
    group: '',
    note: '',
    updatedAt: Date.now(),
    scope: { persona: true, worldbooks: true, preset: true, regex: false, api: true },
    persona: { avatarId: 'u_main.png', name: '林晚晴', versionId: '', versionName: '', description: 'x', lorebook: '' },
    worldbooks: { global: ['OldMissingBook'], char: null, chat: null, entries: { OldMissingBook: { '1': true } } },
    preset: { name: 'OldPreset', prompts: { p1: false, p2: false }, groups: { grp_core: false }, promptNames: { p1: 'Main System', p2: 'World Lore' }, groupNames: { grp_core: '核心设定组' } },
    api: { profileId: 'old_prof', profileName: 'OldProfile', source: 'openai', model: 'gpt-4' },
  };
  const { dom, shadow, openModal, cleanup } = await mountExtension({
    hostOverrides: {
      extension_settings: {
        disabledExtensions: ['worldbook-organizer', 'connection-manager'],
        worldbook_organizer: { groups: [{ id: 'g1', name: 'Stale' }], assignments: {} },
        connectionManager: {
          selectedProfile: 'p_stale',
          profiles: [{ id: 'p_stale', name: 'StaleProfile', api: 'openai', model: 'gpt-4' }],
        },
        user_persona_snapshot: { version: 7, settings: {}, snapshots: [legacySnap], personaVersions: {}, bindings: { chats: {}, characters: {} } },
      },
    },
  });
  try {
    await openModal();
    shadow.querySelector('[data-snap-apply="snap_legacy"]').click();
    await flushAsync();

    const drawerMask = shadow.getElementById('upp-drawer-mask');
    assert.equal(drawerMask.hidden, false, 'missingAudit should open');
    assert.equal(isElementAbsentOrHidden(shadow.getElementById('upp-ma-open-wbo')), true, 'WBO button must be hidden/omitted in missingAudit when WBO disabled');
    const maApiSel = shadow.getElementById('upp-ma-api-sel');
    assert.equal(Boolean(maApiSel?.querySelector('option[value="p_stale"]')), false, 'R4: missingAudit must ignore stale connectionManager profile when connection-manager is disabled');

    // Migrate missing preset directly into presetSync
    shadow.getElementById('upp-ma-migrate-preset').click();
    await flushAsync();
    assert.ok(shadow.getElementById('upp-ps-ov-toggle'), 'Should transition smoothly into presetSync');

    // Switch target preset to PresetB BEFORE toggling grouped override switches (so recomputePresetSyncAnalysis does not wipe selections)
    const tgtSel = shadow.getElementById('upp-ps-target-sel');
    tgtSel.value = 'PresetB';
    tgtSel.dispatchEvent(new dom.MockEvent('change', { bubbles: true }));
    await flushAsync();

    shadow.getElementById('upp-ps-ov-toggle').click();
    await flushAsync();
    const grpOv = shadow.querySelector('[data-ps-ov-grp="grp_core"]');
    assert.ok(grpOv, 'Target preset group override switch must appear in grouped tree');
    grpOv.checked = true;
    grpOv.dispatchEvent(new dom.MockEvent('change', { bubbles: true }));
    await flushAsync();

    const p1Ov = shadow.querySelector('[data-ps-ov-pr="p1"]');
    assert.ok(p1Ov, 'Target preset prompt p1 override switch must appear in grouped tree');
    p1Ov.checked = true;
    p1Ov.dispatchEvent(new dom.MockEvent('change', { bubbles: true }));
    await flushAsync();

    shadow.getElementById('upp-ps-run-btn').click();
    await flushAsync();

    const updatedSnap = mockHost.extension_settings.user_persona_snapshot.snapshots[0];
    assert.equal(updatedSnap.preset.name, 'PresetB', 'Snapshot migrated to PresetB cleanly');
    assert.equal(updatedSnap.preset.prompts.p4, true, 'New prompt p4 synced from PresetB');
    assert.equal(updatedSnap.preset.groups.grp_core, true, 'R5: Group master switch override updated updatedSnap.preset.groups.grp_core to PresetB state (false -> true)');
    assert.equal(updatedSnap.preset.prompts.p1, true, 'R5: Prompt override updated updatedSnap.preset.prompts.p1 to PresetB state (false -> true)');
  } finally {
    cleanup();
  }
});

test('Tier 3 [Worldbook Alignment + R8]: Inline editor (is-tall, <details> trigger/position/depth, token stats, sibling preservation & scrollTop) + #upp-wb-jump-hygiene-btn', async () => {
  const { dom, shadow, openModal, cleanup } = await mountExtension();
  try {
    await openModal();
    shadow.querySelector('[data-tab="worldbook"]').click();
    await flushAsync();
    shadow.getElementById('upp-book-picker-btn').click();
    await flushAsync();
    shadow.querySelector('[data-pick-book="BookMain"]').click();
    await flushAsync();

    const elBody = shadow.getElementById('upp-body');
    const pinBtn = shadow.getElementById('upp-pin-book-btn');
    assert.ok(pinBtn, '#upp-pin-book-btn should exist');

    // Verify STYLE_CSS has right-aligned pin / margin-left: auto and contain: layout style
    const indexSrc = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(indexSrc, /contain:\s*layout\s+style/, 'F13: Worldbook entry rows must use contain: layout style');
    assert.match(indexSrc, /is-tall/, 'F13: Worldbook inline editor must support is-tall textarea expansion');
    const pinHasRightAlignCss = /(?:#upp-pin-book-btn|\.upp-[a-z-]*pin[a-z-]*|\[data-[a-z-]*pin[^\]]*\])[^{]*\{[^}]*margin-(?:left|inline-start)\s*:\s*auto\b/.test(indexSrc)
      || (pinBtn.getAttribute('style') || '').includes('margin-left:auto')
      || (pinBtn.getAttribute('style') || '').includes('margin-left: auto');
    assert.ok(pinHasRightAlignCss, 'F13: Worldbook ★ pin button must enforce right-aligned margin-left: auto CSS');

    // Expand Entry 1 and type unsaved draft into its textarea
    shadow.querySelector('[data-wb-open="1"]').click();
    await flushAsync();
    const panel1 = shadow.querySelector('[data-wb-panel="1"]');
    assert.ok(panel1, 'Entry 1 inline panel should open');

    // Verify <details> metadata is collapsed by default and exposes trigger keys / position / depth + token stats
    const detailsEl = panel1.querySelector('details');
    assert.ok(detailsEl, 'F13: Inline panel must collapse low-frequency trigger/position/depth fields inside <details>');
    assert.equal(detailsEl.hasAttribute('open'), false, 'F13: <details> metadata inside Worldbook inline editor must be collapsed by default');
    const keyInput = panel1.querySelector('[data-wb-inline-key="1"], [data-wb-inline-keys="1"], input[data-wb-inline-field="key"], [data-wb-key="1"]')
      || detailsEl.querySelector('input[type="text"], input:not([type])');
    const posSelect = panel1.querySelector('[data-wb-inline-position="1"], select[data-wb-inline-field="position"], [data-wb-position="1"]')
      || detailsEl.querySelector('select');
    const depthInput = panel1.querySelector('[data-wb-inline-depth="1"], input[data-wb-inline-field="depth"], [data-wb-depth="1"]')
      || detailsEl.querySelector('input[type="number"]');
    assert.ok(keyInput || /触发词|关键字/.test(detailsEl.textContent), 'F13: <details> must expose trigger keys metadata');
    assert.ok(posSelect || /位置|深度/.test(detailsEl.textContent), 'F13: <details> must expose position/depth metadata');
    assert.ok(/token|Tokens/i.test(panel1.textContent), 'F13: Inline panel must display token estimate');

    // Edit & persist key / position / depth inside <details>
    assert.ok(keyInput && posSelect && depthInput, 'F13: Inline <details> must provide editable key, position, and depth inputs');
    keyInput.value = 'k1, k_added';
    posSelect.value = '4';
    depthInput.value = '6';
    panel1.querySelector('[data-wb-inline-save="1"]').click();
    await flushAsync();
    const savedEntry1 = mockHost.worldInfoStore.BookMain.entries['1'];
    assert.ok(Array.isArray(savedEntry1.key) && savedEntry1.key.includes('k_added'), 'F13: Saved entry must persist edited trigger keys from <details>');
    assert.equal(Number(savedEntry1.position), 4, 'F13: Saved entry must persist edited position from <details>');
    assert.equal(Number(savedEntry1.depth), 6, 'F13: Saved entry must persist edited depth from <details>');

    // Toggle 「加高编辑区」 (.is-tall) while preserving elBody.scrollTop
    elBody.scrollTop = 95;
    const tallBtn = findButtonByText(panel1, '加高') || panel1.querySelector('[data-wb-inline-tall]');
    assert.ok(tallBtn, 'F13: Inline panel must include 「加高编辑区」 button');
    tallBtn.click();
    await flushAsync();
    const ta1 = panel1.querySelector('[data-wb-inline-content="1"]');
    assert.ok(ta1.classList.contains('is-tall'), 'F13: Clicking tall toggle must add .is-tall to textarea');
    assert.equal(elBody.scrollTop, 95, 'F13: Toggling tall mode must preserve #upp-body.scrollTop');

    // Type unsaved text in Entry 1, then expand Entry 2 & toggle Entry 2 switch -> Entry 1 unsaved text MUST survive!
    ta1.value = 'UNSAVED_ENTRY_1_DRAFT';
    shadow.querySelector('[data-wb-open="2"]').click();
    await flushAsync();
    shadow.querySelector('[data-wb-toggle="2"]').click();
    await flushAsync();

    const ta1After = shadow.querySelector('[data-wb-inline-content="1"]');
    assert.equal(ta1After?.value, 'UNSAVED_ENTRY_1_DRAFT', 'F13: Targeted DOM patching must preserve sibling open editor unsaved content');

    // Clicking #upp-wb-jump-hygiene-btn never scrolls outer ST viewport
    dom.outerScrollCalls.length = 0;
    dom.scrollIntoViewCalls.length = 0;
    shadow.getElementById('upp-wb-jump-hygiene-btn').click();
    await flushAsync();
    assert.equal(dom.outerScrollCalls.length, 0);
    assert.equal(dom.scrollIntoViewCalls.length, 0);

    // Creating a new worldbook entry (#upp-new-wb-entry-btn) expands inline, scrolls #upp-body internally, and highlights without outer scroll
    dom.outerScrollCalls.length = 0;
    dom.scrollIntoViewCalls.length = 0;
    dom.allScrollCalls.length = 0;
    const entryCountBefore = shadow.querySelectorAll('[data-wb-row]').length;
    shadow.getElementById('upp-new-wb-entry-btn').click();
    await flushAsync();
    assert.equal(shadow.getElementById('upp-drawer-mask').hidden, true, 'F13: #upp-new-wb-entry-btn must expand inline without opening popup drawer');
    assert.ok(shadow.querySelectorAll('[data-wb-row]').length > entryCountBefore || shadow.querySelectorAll('.upp-inline-panel').length >= 1, 'F13: New worldbook entry must appear and expand inline');
    assert.equal(dom.outerScrollCalls.length, 0, 'F13: Creating new entry must NOT scroll outer ST page');
    assert.equal(dom.scrollIntoViewCalls.length, 0, 'F13: Creating new entry must use 0 scrollIntoView() calls');
    assert.ok(dom.allScrollCalls.some((c) => c.id === 'upp-body'), 'F13: Creating new entry must scroll internal #upp-body');
    const highlightedEl = elBody.querySelector('.is-highlight, .is-highlighted, .is-flash, .upp-highlight, [class*="highlight"], [class*="flash"]');
    assert.ok(highlightedEl, 'F13: Creating new entry must apply brief highlight state on the new entry');
  } finally {
    cleanup();
  }
});

// ============================================================================
// 7. TIER 4 — Real-World Workflows & Static Compliance Guardrails
// ============================================================================

test('Tier 4 [Static Compliance Guardrails]: zero backdrop-filter/blur, 100% spellcheck="false", scoped style.css, zero 100vw modal leaks, toast-safe z-index, zero scrollIntoView, 100% type="button", zero private/3rd-party/local-doc leaks', () => {
  const files = ['../core.js', '../index.js', '../style.css', '../README.md', '../manifest.json', '../tests/core.test.mjs'];
  const indexSrc = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const styleCss = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const coreSrc = readFileSync(new URL('../core.js', import.meta.url), 'utf8');

  // 1. Zero backdrop-filter / blur( across CSS & JS
  for (const [name, txt] of [['style.css', styleCss], ['index.js', indexSrc]]) {
    assert.equal(/backdrop-filter\s*:/i.test(txt), false, `${name} must not use backdrop-filter`);
    assert.equal(/\bblur\s*\(/i.test(txt), false, `${name} must not use blur()`);
  }

  // 2. 100% spellcheck="false" on all text/search/typeless <input> and <textarea> templates in index.js
  //    Uses balanced ${...}-aware tag scanner so nested `{}` / `>` inside template interpolations never truncate tags.
  const noCommentsIndex = stripJsCommentsPreserveNewlines(indexSrc);
  const nonTextInputTypes = new Set(['checkbox', 'radio', 'file', 'hidden', 'number', 'range', 'color', 'button', 'submit', 'reset']);
  const scannedInputAndTextarea = scanHtmlStartTags(noCommentsIndex, new Set(['input', 'textarea']));
  const textInputTags = scannedInputAndTextarea.filter((t) => {
    if (t.tagName === 'textarea') return true;
    const typeMatch = t.raw.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+))/i);
    if (!typeMatch) return true; // omitted type defaults to text in HTML
    const typeVal = (typeMatch[1] ?? typeMatch[2] ?? typeMatch[3] ?? '').toLowerCase();
    return !nonTextInputTypes.has(typeVal);
  });
  assert.ok(textInputTags.length >= 15, 'Should inspect all text/search/typeless input & textarea templates in index.js');
  for (const tag of textInputTags) {
    assert.match(tag.raw, /\bspellcheck\s*=\s*["']false["']/i, `Missing spellcheck="false": ${tag.raw}`);
  }

  // 3. Scoped style.css (zero un-scoped selectors, including inside @media / @supports blocks)
  const selectors = extractCssSelectors(styleCss);
  assert.ok(selectors.length >= 1, 'style.css should define scoped selectors');
  for (const sel of selectors) {
    assert.ok(
      sel.startsWith('#user-persona-picker-') || sel.startsWith('.upp-'),
      `style.css selector must be scoped under #user-persona-picker-* or .upp-*: "${sel}"`,
    );
  }

  // 4. Zero scrollIntoView anywhere in core.js / index.js / style.css (strip comments first)
  for (const [name, txt] of [['core.js', coreSrc], ['index.js', indexSrc], ['style.css', styleCss]]) {
    const codeOnly = stripJsCommentsPreserveNewlines(txt);
    assert.equal(/scrollIntoView\s*\(/.test(codeOnly), false, `${name} must have ZERO scrollIntoView() calls`);
  }

  // 5. All .focus() / .focus?.() calls in index.js must use preventScroll: true + desktop guard
  const lines = noCommentsIndex.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const codeLine = lines[i];
    if (!/\.focus(?:\?\.)?\s*\(/.test(codeLine)) continue;
    const ctxWindow = lines.slice(Math.max(0, i - 4), i + 3).join('\n');
    assert.match(ctxWindow, /preventScroll\s*:\s*true/, `index.js:${i + 1} .focus() must pass { preventScroll: true }`);
    assert.match(ctxWindow, /canAutoFocusDesktop|focusDesktopSafe/, `index.js:${i + 1} .focus() must be desktop-guarded`);
  }

  // 6. All <button> templates in index.js must specify type="button" (using balanced ${...}-aware tag scanner)
  const buttonTags = scanHtmlStartTags(noCommentsIndex, new Set(['button']));
  assert.ok(buttonTags.length >= 20, 'Should inspect all <button> templates in index.js');
  for (const bTag of buttonTags) {
    assert.match(bTag.raw, /\btype\s*=\s*["']button["']/i, `Missing type="button" on <button>: ${bTag.raw}`);
  }

  // 7. Zero 100vw modal/popover width leaks, toast-safe z-index (< 999999), overscroll-behavior: contain, dead mini-window removed
  assert.equal(/100vw/.test(indexSrc), false, 'index.js must not leak 100vw width rules');
  const zMatches = [...indexSrc.matchAll(/z-index\s*:\s*(\d+)/gi)].map((m) => Number(m[1]));
  assert.ok(zMatches.length > 0);
  for (const z of zMatches) {
    assert.ok(z < 999999, `z-index ${z} must remain below ST #toast-container (999999)`);
  }
  assert.match(indexSrc, /overscroll-behavior:\s*contain/, 'STYLE_CSS must declare overscroll-behavior: contain on scrollable areas');
  assert.equal(/computeMiniWindowRect|ICONS\.miniWindow|ICONS\.restoreSize/.test(indexSrc), false, 'Dead mini-window code must be removed (F6)');

  // 8. Zero private/third-party names or doc leaks in tracked files (regex constructed via escapes)
  const forbiddenRe = new RegExp(
    [
      '\\b\\x62\\x61\\x69\\x62\\x61\\x69\\b',
      '\\x73\\x74-\\x62\\x61\\x69\\x62\\x61\\x69-tools',
      '\\u67cf\\u5b9d\\u7bb1',
      '\\b\\x4e\\x45\\x58\\x54\\.md\\b',
    ].join('|'),
    'i',
  );
  for (const rel of files) {
    const absUrl = new URL(rel, import.meta.url);
    if (!existsSync(absUrl)) continue;
    const txt = readFileSync(absUrl, 'utf8');
    assert.equal(forbiddenRe.test(txt), false, `Forbidden reference or local-doc leak found in ${rel}`);
  }
});

test('Tier 4 [Real-World Workflow]: Capture snapshot -> switch persona -> edit WB entry -> inspect snapshot -> preset sync -> export JSON backup', async () => {
  const { dom, shadow, openModal, cleanup } = await mountExtension();
  try {
    await openModal();

    // Step 1: Capture snapshot
    shadow.getElementById('upp-foot-save-snap-btn').click();
    await flushAsync();
    const ssName = shadow.getElementById('upp-ss-name');
    ssName.value = 'WorkflowSnap';
    shadow.getElementById('upp-ss-confirm-btn').click();
    await flushAsync();
    const snaps = mockHost.extension_settings.user_persona_snapshot.snapshots;
    assert.equal(snaps.length, 1);
    assert.equal(snaps[0].name, 'WorkflowSnap');

    // Step 2: 查看另一个 User 不切宿主；确认后才切换，且不跳转聊天
    shadow.querySelector('[data-tab="user"]').click();
    await flushAsync();
    const pSel = shadow.getElementById('upp-persona-select');
    const switchesBefore = mockHost.setUserAvatarCalls.length;
    pSel.value = 'u_alt1.png';
    pSel.dispatchEvent(new dom.MockEvent('change', { bubbles: true }));
    await flushAsync();
    assert.equal(mockHost.user_avatar, 'u_main.png', 'D4: 查看 User 不得改变酒馆当前 User');
    shadow.getElementById('upp-persona-use-btn').click();
    await flushAsync();
    shadow.getElementById('upp-persona-use-confirm').click();
    await flushAsync();
    assert.equal(mockHost.user_avatar, 'u_alt1.png');
    assert.equal(mockHost.setUserAvatarCalls[mockHost.setUserAvatarCalls.length - 1]?.opts?.navigateToCurrent, false);

    // Step 3: Edit Worldbook entry inline and save
    shadow.querySelector('[data-tab="worldbook"]').click();
    await flushAsync();
    shadow.getElementById('upp-book-picker-btn').click();
    await flushAsync();
    shadow.querySelector('[data-pick-book="BookMain"]').click();
    await flushAsync();
    shadow.querySelector('[data-wb-open="1"]').click();
    await flushAsync();
    const wbTa = shadow.querySelector('[data-wb-inline-content="1"]');
    wbTa.value = 'Updated workflow entry content';
    shadow.querySelector('[data-wb-inline-save="1"]').click();
    await flushAsync();
    assert.equal(mockHost.worldInfoStore.BookMain.entries['1'].content, 'Updated workflow entry content');

    // Step 4: Inspect snapshot
    shadow.querySelector('[data-tab="snapshots"]').click();
    await flushAsync();
    shadow.querySelector(`[data-snap-view="${snaps[0].id}"]`).click();
    await flushAsync();
    assert.equal(shadow.getElementById('upp-drawer-mask').hidden, false, 'Snapshot detail inspector should open');
    shadow.querySelector('[data-sv-back]').click();
    await flushAsync();

    // Step 5: Open Preset Sync & apply grouped override to snapshot
    shadow.getElementById('upp-snap-preset-sync-btn').click();
    await flushAsync();
    shadow.getElementById('upp-ps-ov-toggle').click();
    await flushAsync();
    shadow.getElementById('upp-ps-run-btn').click();
    await flushAsync();

    // Step 6: Export JSON backup
    const origCreateObjectURL = globalThis.URL.createObjectURL;
    const origRevokeObjectURL = globalThis.URL.revokeObjectURL;
    let exportedUrlCreated = false;
    globalThis.URL.createObjectURL = () => { exportedUrlCreated = true; return 'blob:mock-export'; };
    globalThis.URL.revokeObjectURL = () => {};
    try {
      shadow.getElementById('upp-backup-btn').click();
      await flushAsync();
      shadow.getElementById('upp-export-json-btn').click();
      await flushAsync();
      assert.equal(exportedUrlCreated, true, 'Export backup should create downloadable JSON blob');
    } finally {
      globalThis.URL.createObjectURL = origCreateObjectURL;
      globalThis.URL.revokeObjectURL = origRevokeObjectURL;
    }

    assert.equal(dom.outerScrollCalls.length, 0, 'Entire multi-step workflow must cause 0 outer ST scroll calls');
    assert.equal(dom.scrollIntoViewCalls.length, 0, 'Entire multi-step workflow must cause 0 scrollIntoView calls');
  } finally {
    cleanup();
  }
});

test('M4b: floating ball keeps its drop point, filters by group, and saves without the main panel', async () => {
  const snap = (id, group, preset) => ({
    id, name: id, group, note: 'Fixture note', updatedAt: Date.now(),
    scope: { persona: true, preset: true, worldbooks: true, regex: true },
    persona: { avatarId: 'u_main.png', name: 'Fixture User' },
    preset: { name: preset, prompts: {} },
    worldbooks: { global: ['BookGlobal'], entries: {} },
    regex: { global: { sample: true } },
  });
  const { dom, shadow, cleanup } = await mountExtension({
    hostOverrides: {
      loadedPresetName: 'PresetA',
      extension_settings: { user_persona_snapshot: {
        version: 7, settings: {}, personaVersions: {},
        snapshots: [snap('Other', 'Group B', 'PresetB'), snap('Preset match', 'Group A', 'PresetA'), snap('Bound', 'Group A', 'PresetB')],
        bindings: { chats: {}, characters: { 'CharAlpha.png': 'Bound' } },
      } },
    },
  });
  try {
    const ball = shadow.getElementById('upp-fab-btn');
    const pointer = (type, x, y) => ball.dispatchEvent(new dom.MockEvent(type, {
      bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', pointerId: 1, clientX: x, clientY: y,
    }));
    pointer('pointerdown', 350, 500);
    pointer('pointermove', 260, 440);
    const drop = [ball.style.left, ball.style.top];
    pointer('pointerup', 260, 440);
    assert.deepEqual([ball.style.left, ball.style.top], drop);
    pointer('pointerdown', 260, 440);
    pointer('pointerup', 260, 440);
    const pop = shadow.getElementById('upp-fab-pop');
    assert.equal(pop.hidden, false);
    let rows = [...pop.querySelectorAll('[data-fab-apply]')];
    assert.deepEqual(rows.map(el => el.getAttribute('data-fab-apply')), ['Bound', 'Preset match', 'Other']);
    assert.match(pop.textContent, /Fixture User/);
    assert.match(pop.textContent, /PresetA/);
    assert.match(pop.textContent, /BookGlobal/);
    assert.match(pop.textContent, /Fixture note/);
    assert.doesNotMatch(pop.textContent, /正则|完整面板/);
    assert.equal(globalThis.document.getElementById('user-persona-picker-ext-settings'), null);

    const groups = shadow.getElementById('upp-fab-group');
    groups.value = 'Group B';
    groups.dispatchEvent(new dom.MockEvent('change', { bubbles: true }));
    assert.equal(pop.querySelectorAll('[data-fab-apply]').length, 1);
    assert.equal(shadow.getElementById('upp-fab-group'), groups);

    shadow.getElementById('upp-fab-save-btn').click();
    const name = shadow.getElementById('upp-fab-save-name');
    assert.ok(name);
    const original = name.value;
    pop.querySelector('[data-snapshot-route="高中线"]').click();
    assert.equal(name.value, original + ' · 高中线');
    pop.querySelector('[data-snapshot-route="if线"]').click();
    assert.equal(name.value, original + ' · if线');
    pop.querySelector('[data-snapshot-route="if线"]').click();
    assert.equal(name.value, original);
    const group = shadow.getElementById('upp-fab-save-group');
    group.value = 'CharAlpha';
    group.dispatchEvent(new dom.MockEvent('input', { bubbles: true }));
    assert.doesNotMatch(name.value, /CharAlpha/);
    name.value = '';
    shadow.getElementById('upp-fab-save-confirm').click();
    await flushAsync();
    const saved = mockHost.extension_settings.user_persona_snapshot.snapshots[0];
    assert.equal(saved.group, 'CharAlpha');
    assert.ok(saved.name);
    assert.doesNotMatch(saved.name, /CharAlpha/);
    assert.equal(shadow.querySelector('.upp-backdrop').hidden, true);
    assert.equal(pop.hidden, false);
  } finally {
    cleanup();
  }
});

// ============================================================================
// 8. D4 — 查看不切宿主（预设 / User）+ 提示条层级
// ============================================================================

test('D4 [Preset View]: 下拉查看预设不切换宿主、查看态只读、显式确认后才真正切换', async () => {
  const { dom, shadow, openModal, cleanup } = await mountExtension();
  try {
    await openModal();
    shadow.querySelector('[data-tab="preset"]').click();
    await flushAsync();

    const sel = shadow.getElementById('upp-preset-select');
    assert.ok(sel, '预设下拉必须渲染');
    const hostPresetBefore = mockHost.loadedPresetName;
    const target = [...sel.options].map((o) => o.value).find((v) => v && v !== hostPresetBefore);
    assert.ok(target, '测试夹具必须提供第二个预设');

    sel.value = target;
    sel.dispatchEvent(new dom.MockEvent('change', { bubbles: true }));
    await flushAsync();

    // 查看 = 只读：宿主预设不变，且拿不到任何切换副作用
    assert.equal(mockHost.loadedPresetName, hostPresetBefore, 'D4: 查看预设不得切换酒馆当前预设');
    assert.ok(shadow.querySelector('[data-preset-view-strip]'), 'D4: 查看态必须有“未切换”状态条');
    assert.ok(shadow.getElementById('upp-preset-use-btn'), 'D4: 查看态必须提供「设为当前使用」');
    assert.ok(shadow.getElementById('upp-preset-view-back-btn'), 'D4: 查看态必须能「看回当前」');
    assert.equal(shadow.getElementById('upp-preset-save-disk-btn')?.getAttribute('disabled') !== null, true, 'D4: 查看非当前预设时禁用「保存预设」');
    assert.equal(shadow.getElementById('upp-preset-sync-btn')?.getAttribute('disabled') !== null, true, 'D4: 查看非当前预设时禁用「同步到快照」');

    // 查看态下点条目开关：不写宿主，只给只读提示
    const presetsSnapshot = JSON.stringify(mockHost.presetsStore);
    const prToggle = shadow.querySelector('[data-pr-toggle]');
    assert.ok(prToggle, '查看态仍应列出被查看预设的条目');
    prToggle.click();
    await flushAsync();
    assert.equal(JSON.stringify(mockHost.presetsStore), presetsSnapshot, 'D4: 查看态点开关不得写任何预设文件');
    assert.equal(mockHost.loadedPresetName, hostPresetBefore, 'D4: 查看态点开关不得切换预设');
    assert.match(shadow.getElementById('upp-toast-layer')?.textContent || '', /只读/, 'D4: 查看态点开关必须提示只读');

    // 设为当前使用 → 先要确认，点一次不切
    shadow.getElementById('upp-preset-use-btn').click();
    await flushAsync();
    assert.equal(mockHost.loadedPresetName, hostPresetBefore, 'D4: 点「设为当前使用」只是展开确认，不能直接切换');
    assert.ok(shadow.getElementById('upp-preset-use-confirm'), 'D4: 必须出现确认按钮');
    shadow.getElementById('upp-preset-use-confirm').click();
    await flushAsync();
    assert.equal(mockHost.loadedPresetName, target, 'D4: 确认后才切换酒馆预设');
    assert.equal(shadow.querySelector('[data-preset-view-strip]'), null, 'D4: 切换后退出查看态');

    // 「保存预设」写的是酒馆原生预设文件：必须先确认，点一次不落盘（意见 #7）
    const storeBefore = JSON.stringify(mockHost.presetsStore);
    shadow.getElementById('upp-preset-save-disk-btn').click();
    await flushAsync();
    assert.equal(JSON.stringify(mockHost.presetsStore), storeBefore, 'D4/#7: 「保存预设」点一次不得写盘');
    assert.ok(shadow.getElementById('upp-preset-disk-save-confirm'), 'D4/#7: 「保存预设」必须出现覆盖确认');
    shadow.getElementById('upp-preset-disk-save-cancel').click();
    await flushAsync();
    assert.equal(JSON.stringify(mockHost.presetsStore), storeBefore, 'D4/#7: 取消后不得写盘');
    assert.equal(shadow.getElementById('upp-preset-disk-save-confirm'), null, 'D4/#7: 取消后确认条消失');
  } finally {
    cleanup();
  }
});

test('D4 [Persona View]: 列表里的「切换」先进入查看+确认，绝不浏览即切宿主', async () => {
  const { dom, shadow, openModal, cleanup } = await mountExtension();
  try {
    await openModal();
    shadow.querySelector('[data-tab="user"]').click();
    await flushAsync();
    const curAvatar = mockHost.user_avatar;

    // 用搜索把 User 列表拉出来，再点列表行的「切换」
    const search = shadow.getElementById('upp-user-search');
    search.value = '';
    search.dispatchEvent(new dom.MockEvent('input', { bubbles: true }));
    const switchesBefore = mockHost.setUserAvatarCalls.length;
    const altId = mockHost.power_user.personas ? Object.keys(mockHost.power_user.personas).find((id) => id !== curAvatar) : null;
    assert.ok(altId, '测试夹具必须提供第二个 User');
    shadow.getElementById('upp-persona-select').value = altId;
    shadow.getElementById('upp-persona-select').dispatchEvent(new dom.MockEvent('change', { bubbles: true }));
    await flushAsync();
    assert.equal(mockHost.user_avatar, curAvatar, 'D4: 查看 User 不得切换宿主');
    assert.equal(mockHost.setUserAvatarCalls.length, switchesBefore, 'D4: 查看 User 不得调用 setUserAvatar');

    // 查看态只读：编辑类按钮必须禁用，正文以只读方式呈现
    assert.equal(shadow.getElementById('upp-persona-edit-btn')?.getAttribute('disabled') !== null, true, 'D4: 查看态禁用「编辑正文」');
    assert.equal(shadow.getElementById('upp-persona-rename-btn')?.getAttribute('disabled') !== null, true, 'D4: 查看态禁用「改名」');
    const bodyEl = shadow.getElementById('upp-body');
    assert.match(String(bodyEl && bodyEl.textContent), /正在查看「.*」.*尚未切换/, 'D4: 查看态必须明确写出“尚未切换”');
    assert.ok(shadow.getElementById('upp-persona-use-btn'), 'D4: 查看态必须提供「设为当前使用」');
    assert.ok(shadow.getElementById('upp-persona-view-back-btn'), 'D4: 查看态必须能退回当前 User');
    // 确认后才切换
    shadow.getElementById('upp-persona-use-btn').click();
    await flushAsync();
    assert.equal(mockHost.user_avatar, curAvatar, 'D4: 第一次点只展开确认');
    shadow.getElementById('upp-persona-use-confirm').click();
    await flushAsync();
    assert.equal(mockHost.user_avatar, altId, 'D4: 确认后才切换酒馆当前 User');
  } finally {
    cleanup();
  }
});

test('D4 [Toast Layer]: 提示条画在影子树内且压在面板之上，不再依赖宿主 toast 容器', async () => {
  const { shadow, openModal, cleanup } = await mountExtension();
  try {
    await openModal();
    shadow.querySelector('[data-tab="worldbook"]').click();
    await flushAsync();
    const jump = shadow.getElementById('upp-wb-jump-hygiene-btn');
    assert.ok(jump, '未闭合标签条目应渲染定位徽章');
    jump.click();
    await flushAsync();

    const layer = shadow.getElementById('upp-toast-layer');
    assert.ok(layer, 'D4: 提示条容器必须存在于影子树内');
    assert.match(layer.className, /upp-toast-layer/);
    assert.match(layer.textContent, /已定位到/, '提示内容必须真的渲染出来');
    assert.equal(mockHost.toasts.length, 0, 'D4: 不得再写宿主 toastr（宿主层级低于面板，会被压住）');

    // 面板层级最高 30002；提示层必须更高，才能在面板打开时可见
    const styleText = shadow.querySelector('style')?.textContent || '';
    const toastZ = Number((styleText.match(/\.upp-toast-layer\s*\{[^}]*z-index:\s*(\d+)/) || [])[1] || 0);
    assert.ok(toastZ > 30002, `D4: 提示层 z-index(${toastZ}) 必须高于面板层（30002）`);
    assert.ok(toastZ < 999999, 'D4: 提示层 z-index 仍需低于宿主 toast 容器层级上限');
  } finally {
    cleanup();
  }
});

// ============================================================================
// 9. 意见 #6 / #9 / #22 — 预设只看已开的折叠、世界书选择器分组胶囊与吸顶
// ============================================================================

test('意见 #6 [Preset Fold]: 只看已开时「全部展开/折叠」照常生效', async () => {
  const { shadow, openModal, cleanup } = await mountExtension();
  try {
    await openModal();
    shadow.querySelector('[data-tab="preset"]').click();
    await flushAsync();

    const foldBtn = () => shadow.getElementById('upp-preset-fold-all-btn');
    const boxes = () => [...shadow.querySelectorAll('.upp-group-box')];
    const allCollapsed = () => boxes().length > 0 && boxes().every((b) => b.className.includes('is-collapsed'));
    const anyCollapsed = () => boxes().some((b) => b.className.includes('is-collapsed'));

    assert.ok(foldBtn(), '有分组时必须提供「全部折叠 / 全部展开」');
    if (foldBtn().textContent.includes('全部展开')) { foldBtn().click(); await flushAsync(); }
    assert.equal(anyCollapsed(), false, '全部展开后不应还有折叠的分组');

    // 只看已开：仍要能折叠
    shadow.getElementById('upp-preset-only-on-btn').click();
    await flushAsync();
    assert.ok(boxes().length >= 1, '只看已开后仍应显示有开启条目的分组');
    assert.equal(foldBtn().textContent.includes('全部折叠'), true, '此时应显示「全部折叠」');
    foldBtn().click();
    await flushAsync();
    assert.equal(allCollapsed(), true, '意见 #6：只看已开时「全部折叠」必须生效');

    foldBtn().click();
    await flushAsync();
    assert.equal(anyCollapsed(), false, '意见 #6：只看已开时「全部展开」必须生效');

    // 选中态可辨认：按钮 aria-pressed 且带已开数量
    const onlyBtn = shadow.getElementById('upp-preset-only-on-btn');
    assert.equal(onlyBtn.getAttribute('aria-pressed'), 'true');
    assert.match(onlyBtn.textContent, /只看已开 · \d+/, '只看已开开启后必须给出明确的数量提示');
  } finally {
    cleanup();
  }
});

test('意见 #9/#22 [Book Picker]: 分组胶囊置顶、点胶囊只看该组、分组栏吸顶可随时折叠', async () => {
  const { shadow, openModal, cleanup } = await mountExtension();
  try {
    await openModal();
    shadow.querySelector('[data-tab="worldbook"]').click();
    await flushAsync();
    shadow.getElementById('upp-book-picker-btn').click();
    await flushAsync();

    const chips = shadow.getElementById('upp-book-picker-chips');
    assert.ok(chips, '选择世界书必须渲染分组胶囊栏');
    const chipList = [...chips.querySelectorAll('[data-bp-group]')];
    assert.ok(chipList.length >= 2, '至少要有「全部」+ 一个分组胶囊');
    assert.equal(chipList[0].getAttribute('data-bp-group'), '', '第一个胶囊是「全部」');
    assert.ok(shadow.querySelectorAll('[data-bp-section]').length >= 1, '胶囊下方要分组渲染世界书');

    // 点分组胶囊：只看该组，且该胶囊高亮
    const targetChip = chipList.find((c) => c.getAttribute('data-bp-group'));
    const gid = targetChip.getAttribute('data-bp-group');
    targetChip.click();
    await flushAsync();
    const boxesAfter = [...shadow.querySelectorAll('[data-bp-section]')];
    assert.equal(boxesAfter.length, 1, '点分组胶囊后只显示该组');
    assert.equal(boxesAfter[0].getAttribute('data-bp-section'), gid);
    assert.match(shadow.querySelector(`[data-bp-group="${gid}"]`).className, /active/, '选中的分组胶囊必须高亮');

    // 分组栏折叠可用
    const foldBtn = shadow.querySelector('[data-bp-fold]');
    assert.ok(foldBtn, '分组栏必须有折叠按钮');
    foldBtn.click();
    await flushAsync();
    assert.match(shadow.querySelector('[data-bp-section]').className, /is-collapsed/, '点分组栏必须能折叠');

    // 回看全部
    shadow.querySelector('[data-bp-group=""]').click();
    await flushAsync();
    assert.ok(shadow.querySelectorAll('[data-bp-section]').length >= 1, '「全部」必须恢复完整列表');

    // 吸顶：分组栏 position:sticky，且外层不剪裁（否则 sticky 失效）
    const css = shadow.querySelector('style').textContent;
    assert.match(css, /\.upp-bp-head\s*\{[^}]*position:\s*sticky/, '分组栏必须吸顶');
    assert.match(css, /\.upp-bp-head\s*\{[^}]*z-index:\s*\d+/, '吸顶分组栏需要层级，避免被条目压住');
    assert.match(css, /\.upp-bp-box\s*\{[^}]*overflow:\s*visible/, '吸顶祖先不能 overflow:hidden');
  } finally {
    cleanup();
  }
});
