import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APP_VERSION,
  THEME_MODES,
  analyzeEntryTags,
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
  computeMiniWindowRect,
  computeResizedModalRect,
  computeRestorePillPosition,
  createEmptyStore,
  detectProliferatedPersonas,
  escapeHtml,
  exportStoreJson,
  extractPersonaBaseName,
  extractPresetGroups,
  formatTimeShort,
  formatWorldbookDisplay,
  groupWorldbooksByOrganizer,
  inferThemeFromTextColor,
  inspectSnapshotHealth,
  inspectTagHygiene,
  isBuiltinModuleEnabled,
  isExtensionEnabled,
  markStoreOnWorldbookDeleted,
  migrateStoreOnWorldbookRename,
  normalizeNativePreset,
  normalizePresetLabel,
  normalizeText,
  parseImportJson,
  pickActivePromptOrder,
  resolveBindingForContext,
  restorePersonaMergeVersions,
  sanitizeBoolMap,
  sanitizePlainMap,
  sanitizeStore,
  sanitizeStringMap,
  suggestSnapshotNames,
  toOpaqueColor,
  uid,
} from '../core.js';

test('constants & basic text utilities (APP_VERSION, THEME_MODES, uid, normalizeText, escapeHtml)', () => {
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+/);
  assert.deepEqual(THEME_MODES, ['paper', 'ink', 'warm', 'sakura', 'host', 'glass-dark']);

  const id1 = uid();
  const id2 = uid('snap');
  assert.ok(id1.startsWith('id_'));
  assert.ok(id2.startsWith('snap_'));
  assert.notEqual(id1, id2);

  assert.equal(normalizeText(null), '');
  assert.equal(normalizeText(undefined), '');
  assert.equal(normalizeText('ＡＢＣ\u200B\uFEFFDef'), 'abcdef');

  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(`<div a="1" b='2'>&</div>`), '&lt;div a=&quot;1&quot; b=&#39;2&#39;&gt;&amp;&lt;/div&gt;');
});

test('createEmptyStore & map sanitizers prevent prototype pollution', () => {
  const empty = createEmptyStore();
  assert.equal(empty.version, 7);
  assert.equal(empty.settings.themeMode, 'paper');
  assert.equal(empty.settings.fabSide, 'right');
  assert.equal(empty.settings.fabY, 0.68);
  assert.deepEqual(empty.settings.defaultSnapshotScope, {
    persona: true,
    worldbooks: true,
    preset: true,
    regex: true,
    api: true,
  });
  assert.deepEqual(empty.snapshots, []);

  assert.deepEqual(sanitizePlainMap(null), {});
  assert.deepEqual(sanitizePlainMap(['a']), {});
  const malicious = JSON.parse('{"__proto__":{"polluted":true},"constructor":"bad","prototype":"bad","ok":123}');
  const plain = sanitizePlainMap(malicious);
  assert.equal(Object.getOwnPropertyDescriptor(plain, '__proto__'), undefined);
  assert.equal(Object.getOwnPropertyDescriptor(plain, 'constructor'), undefined);
  assert.equal(Object.getOwnPropertyDescriptor(plain, 'prototype'), undefined);
  assert.equal(plain.ok, 123);

  const bools = sanitizeBoolMap(JSON.parse('{"__proto__":true,"a":true,"b":false,"c":"true","d":1,"e":null}'));
  assert.deepEqual(bools, { a: true, b: false });

  const strs = sanitizeStringMap(JSON.parse('{"__proto__":"x","a":"  世界书A  ","b":"","c":123,"long":"123456"}'), 4);
  assert.deepEqual(strs, { a: '世界书A', long: '1234' });
});

test('sanitizeStore, exportStoreJson & parseImportJson validate, clamp, prune & round-trip', () => {
  const invalidStore = sanitizeStore('not-an-object');
  assert.equal(invalidStore.version, 7);
  assert.equal(invalidStore.snapshots.length, 0);

  const raw = {
    settings: {
      autoApplyBindings: false,
      showFloatingBall: false,
      presetGroupsDefaultCollapsed: false,
      themeMode: 'invalid-theme',
      fabSide: 'left',
      fabY: 9.9,
      pinnedWorldbooks: [' 世界书A ', '', '世界书A', '世界书B'],
    },
    personaVersions: {
      'user1.png': [{ id: 'pv1', name: 'A'.repeat(80), displayName: ' 主角甲 ', description: '设定', lorebook: '世界书A', updatedAt: 100 }],
    },
    snapshots: [
      {
        id: 'snap_1',
        name: 'N'.repeat(80),
        group: 'G'.repeat(50),
        note: 'M'.repeat(160),
        scope: { persona: true, worldbooks: true, preset: true, regex: true, api: true },
        persona: { avatarId: 'user1.png', name: '主角甲', description: '正文', lorebook: '世界书A' },
        worldbooks: {
          global: ['世界书A'],
          char: { primary: '世界书B', additional: ['世界书C'] },
          chat: '世界书D',
          entries: { 世界书A: { '0': true, bad: 'x' } },
          deletedBooks: ['已删书', '已删书', ''],
        },
        preset: {
          name: '预设V1',
          prompts: { p1: true },
          groups: { g1: false },
          promptNames: { p1: '开场设定' },
          groupNames: { g1: '核心组' },
        },
        regex: { global: { r1: true }, character: {}, preset: {} },
        api: { profileId: 'prof_1', profileName: '配置甲', source: 'openai', model: 'model-1', customUrl: 'U'.repeat(300) },
      },
    ],
    bindings: {
      chats: { chat_1: 'snap_1', chat_orphan: 'snap_missing' },
      characters: { 'char_a.png': 'snap_1', 'char_b.png': 'snap_missing' },
    },
  };

  const clean = sanitizeStore(raw);
  assert.equal(clean.settings.themeMode, 'paper');
  assert.equal(clean.settings.fabSide, 'left');
  assert.equal(clean.settings.fabY, 0.92);
  assert.deepEqual(clean.settings.pinnedWorldbooks, ['世界书A', '世界书B']);
  assert.equal(clean.personaVersions['user1.png'][0].name.length, 60);
  assert.equal(clean.snapshots[0].name.length, 60);
  assert.equal(clean.snapshots[0].group.length, 30);
  assert.equal(clean.snapshots[0].note.length, 120);
  assert.equal(clean.snapshots[0].api.customUrl.length, 240);
  assert.deepEqual(clean.snapshots[0].worldbooks.entries, { 世界书A: { '0': true } });
  assert.deepEqual(clean.snapshots[0].worldbooks.deletedBooks, ['已删书']);
  assert.deepEqual(clean.bindings.chats, { chat_1: 'snap_1' });
  assert.deepEqual(clean.bindings.characters, { 'char_a.png': 'snap_1' });

  const json = exportStoreJson(clean);
  const parsed = JSON.parse(json);
  assert.equal(parsed.format, 'user-persona-snapshot-v7');
  assert.equal(parsed.version, 7);

  const reimported = parseImportJson(json);
  assert.equal(reimported.snapshots[0].id, 'snap_1');

  const v6Raw = JSON.stringify({ version: 6, snapshots: [{ id: 's6', name: '旧快照' }] });
  assert.equal(parseImportJson(v6Raw).snapshots[0].id, 's6');

  assert.throws(() => parseImportJson('{bad'), /JSON 格式无效/);
  assert.throws(() => parseImportJson('[]'), /结构无效/);
  assert.throws(() => parseImportJson('{"foo":1}'), /不是本插件导出/);
});

test('pickActivePromptOrder, extractPresetGroups & normalizeNativePreset handle generic extensions and markers', () => {
  assert.deepEqual(pickActivePromptOrder(null), []);
  const order = pickActivePromptOrder([
    { character_id: 100000, order: [{ identifier: 'old', enabled: false }] },
    { character_id: 100001, order: [{ identifier: 'p1', enabled: true }, { identifier: 'p2', enabled: false }] },
  ]);
  assert.equal(order[0].identifier, 'p1');

  const preset = {
    prompts: [
      { identifier: 'p1', name: '系统设定', role: 'system', content: '规则正文' },
      { identifier: 'p2', name: '聊天记录占位', role: 'system', marker: true, content: 'ignored' },
      { identifier: 'p3', name: '用户提示', role: 'user', content: '补充' },
    ],
    prompt_order: [
      {
        character_id: 100001,
        order: [
          { identifier: 'p1', enabled: true },
          { identifier: 'p2', enabled: true },
          { identifier: 'p2', enabled: false }, // duplicate skipped
          { identifier: 'p3', enabled: false },
          { identifier: 'missing_def', enabled: true },
        ],
      },
    ],
    extensions: {
      customGroupPlugin: {
        presetPromptGroups: {
          groups: [
            { id: 'g1', name: '核心规则组', enabled: true, collapsed: false },
            { id: '', name: '无效组' },
          ],
          prompts: {
            p1: { groupId: 'g1' },
            p3: { groupId: 'missing_group' },
          },
        },
      },
    },
  };

  const extracted = extractPresetGroups(preset, null, null);
  assert.equal(extracted.groups.length, 1);
  assert.equal(extracted.groups[0].collapsed, false);
  assert.deepEqual(extracted.promptGroupMap, { p1: 'g1' });

  // runtimeState takes precedence over preset extensions & fallbackPreset
  const runtimeOverride = {
    groups: [{ id: 'g_rt', name: '运行时组', enabled: false }],
    prompts: { p3: { groupId: 'g_rt' } },
  };
  const rtExtracted = extractPresetGroups(preset, runtimeOverride, null);
  assert.equal(rtExtracted.groups[0].id, 'g_rt');
  assert.equal(rtExtracted.groups[0].enabled, false);
  assert.equal(rtExtracted.groups[0].collapsed, false);
  assert.deepEqual(rtExtracted.promptGroupMap, { p3: 'g_rt' });

  const norm = normalizeNativePreset(preset, null, null);
  assert.equal(norm.prompts.length, 3);
  assert.equal(norm.prompts[1].marker, true);
  assert.equal(norm.prompts[1].content, undefined);

  // Fallback to rawPreset.prompts when prompt_order is empty
  const noOrderNorm = normalizeNativePreset({
    prompts: [{ identifier: 'x1', name: '直读项', content: 'hello' }],
    extensions: { presetPromptGroups: { groups: [{ id: 'gx', name: '直属组', collapsed: true }], prompts: { x1: { groupId: 'gx' } } } },
  });
  assert.equal(noOrderNorm.prompts.length, 1);
  assert.equal(noOrderNorm.prompts[0].enabled, true);
  assert.equal(noOrderNorm.groups[0].collapsed, true);
  assert.equal(normalizeNativePreset(null).prompts.length, 0);
});

test('buildPresetRenderNodes & buildSnapshotPresetInspectModel overlay groups and effective state', () => {
  const norm = {
    prompts: [
      { id: 'p1', name: '主线规则', enabled: true, role: 'system', marker: false, content: '详细设定' },
      { id: 'p2', name: '补充规则', enabled: false, role: 'system', marker: false, content: '次要内容' },
      { id: 'p3', name: '独立项', enabled: true, role: 'user', marker: false, content: '独立正文' },
      { id: 'p4', name: '新加条目', enabled: true, role: 'system', marker: false, content: '新增' },
    ],
    groups: [
      { id: 'g1', name: '核心分组', enabled: true, collapsed: true },
    ],
    groupsById: {
      g1: { id: 'g1', name: '核心分组', enabled: true, collapsed: true },
    },
    promptGroupMap: { p1: 'g1', p2: 'g1' },
  };

  const renderedAll = buildPresetRenderNodes(norm, {});
  assert.equal(renderedAll.hasGroups, true);
  assert.equal(renderedAll.nodes.length, 3);
  assert.equal(renderedAll.nodes[0].type, 'group');
  assert.equal(renderedAll.nodes[0].enabledCount, 1);

  const byGroupName = buildPresetRenderNodes(norm, { search: '核心分组' });
  assert.equal(byGroupName.nodes.length, 1);
  assert.equal(byGroupName.nodes[0].items.length, 2);
  assert.equal(byGroupName.nodes[0].forceExpand, true);

  const onlyOn = buildPresetRenderNodes(norm, { onlyOn: true });
  assert.equal(onlyOn.nodes[0].items.length, 1);

  const inspect = buildSnapshotPresetInspectModel(
    {
      prompts: { p1: true, p2: false, p3: true, deleted_p: true },
      groups: { g1: false },
    },
    norm,
    {},
  );
  assert.deepEqual(inspect.missingIds, ['deleted_p']);
  assert.equal(inspect.powerOffGroupCount, 1);
  // p3 (on) + p4 (unrecorded, live enabled=true) are effectiveOn; p1 selfOn=true but group g1=false -> effectiveOn=false
  assert.equal(inspect.effectiveOnTotal, 2);
  const g1Node = inspect.nodes.find(n => n.type === 'group');
  assert.equal(g1Node.items[0].effectiveOn, false);
  assert.equal(g1Node.items[0].statusNote, '整组已关');
  const p4Node = inspect.nodes.find(n => n.type === 'prompt' && n.prompt.id === 'p4');
  assert.equal(p4Node.prompt.statusNote, '新增未记录');

  const inspectOnlyOn = buildSnapshotPresetInspectModel(
    { prompts: { p1: true, p2: false, p3: true }, groups: { g1: false } },
    norm,
    { onlyOn: true },
  );
  assert.equal(inspectOnlyOn.nodes.some(n => n.type === 'group'), false);
});

test('analyzeEntryTags & inspectTagHygiene ignore EJS/comments/void tags and flag unclosed/duplicate wrappers', () => {
  const tags = analyzeEntryTags('<!-- <unclosed> --><% if (x) { %><br><hr/><img src="x"><角色设定><状态>ok</角色设定>');
  assert.deepEqual(tags.unclosed, ['状态']);
  assert.deepEqual(tags.topWrappers, ['角色设定']);

  const stray = analyzeEntryTags('<a>ok</a></多余>');
  assert.deepEqual(stray.unclosed, ['/多余']);

  assert.deepEqual(analyzeEntryTags('<div data-x="a/>b">unclosed'), {
    unclosed: ['div'],
    topWrappers: ['div'],
  });
  assert.deepEqual(analyzeEntryTags('<tag attr=">"/>'), {
    unclosed: [],
    topWrappers: [],
  });
  assert.deepEqual(analyzeEntryTags('<自定义 />'), {
    unclosed: [],
    topWrappers: [],
  });
  assert.deepEqual(analyzeEntryTags('a < b && c > d'), {
    unclosed: [],
    topWrappers: [],
  });
  assert.deepEqual(analyzeEntryTags('好感度 < 50 && 进度 > 10'), {
    unclosed: [],
    topWrappers: [],
  });

  const hygiene = inspectTagHygiene([
    { uid: 1, enabled: true, content: '<设定块>甲</设定块>' },
    { uid: 2, enabled: true, content: '<设定块><未闭合>乙</设定块>' },
    { uid: 3, enabled: false, content: '<设定块><忽略关闭>' },
  ]);
  assert.equal(hygiene.unclosedCount, 1);
  assert.equal(hygiene.duplicateTags.length, 1);
  assert.equal(hygiene.duplicateTags[0].count, 2);
  assert.deepEqual(hygiene.byUid['2'].unclosed, ['未闭合']);
  assert.equal(hygiene.byUid['3'], undefined);
});

test('computeLineDiff handles empty, identical, edits, CRLF & large-input linear fallback', () => {
  assert.deepEqual(computeLineDiff('', ''), []);
  assert.deepEqual(computeLineDiff('甲\r\n乙', '甲\n丙'), [
    { type: 'same', text: '甲' },
    { type: 'del', text: '乙' },
    { type: 'add', text: '丙' },
  ]);

  const bigA = Array.from({ length: 420 }, (_, i) => `row-${i}`).join('\n');
  const bigB = Array.from({ length: 420 }, (_, i) => (i === 10 ? 'row-changed' : `row-${i}`)).join('\n');
  const bigDiff = computeLineDiff(bigA, bigB);
  assert.ok(bigDiff.some(d => d.type === 'del' && d.text === 'row-10'));
  assert.ok(bigDiff.some(d => d.type === 'add' && d.text === 'row-changed'));
});

test('extractPersonaBaseName & detectProliferatedPersonas group suffix variants and surname-swap pairs', () => {
  assert.equal(extractPersonaBaseName(''), '');
  assert.equal(extractPersonaBaseName('主角甲 (测试)'), '主角甲');
  assert.equal(extractPersonaBaseName('主角甲_现代版'), '主角甲');
  assert.equal(extractPersonaBaseName('主角甲2'), '主角甲');
  assert.equal(extractPersonaBaseName('123'), '123');

  const groups = detectProliferatedPersonas([
    { avatar_id: 'a1.png', name: '主角甲' },
    { avatar_id: 'a2.png', name: '主角甲_校园' },
    { avatar_id: 'b1.png', name: '林清晏' },
    { avatar_id: 'b2.png', name: '顾清晏' },
    { avatar_id: 'c1.png', name: '路人丙' },
    { name: '缺ID项' },
  ]);
  assert.equal(groups.length, 2);
  assert.ok(groups.some(g => g.baseName === '清晏' && g.items.length === 2));
  assert.ok(groups.some(g => g.baseName === '主角甲' && g.items.length === 2));
});

test('resolveBindingForContext, buildCleanCopyText, formatTimeShort, toOpaqueColor & inferThemeFromTextColor', () => {
  const bindings = { chats: { chat_1: 'snap_chat' }, characters: { 'char_a.png': 'snap_char' } };
  assert.equal(resolveBindingForContext(null, 'chat_1', 'char_a.png'), null);
  assert.deepEqual(resolveBindingForContext(bindings, 'chat_1', 'char_a.png'), { snapshotId: 'snap_chat', source: 'chat' });
  assert.deepEqual(resolveBindingForContext(bindings, 'chat_2', 'char_a.png'), { snapshotId: 'snap_char', source: 'character' });
  assert.equal(resolveBindingForContext(bindings, 'chat_2', 'char_b.png'), null);

  assert.equal(
    buildCleanCopyText([
      { enabled: true, content: '  第一条  ' },
      { enabled: false, content: '关闭条' },
      { enabled: true, content: '   ' },
      { enabled: true, content: '第二条' },
    ]),
    '第一条\n\n第二条',
  );

  assert.equal(formatTimeShort(0), '');
  assert.equal(formatTimeShort(NaN), '');
  const ts = new Date(2026, 2, 5, 8, 7).getTime();
  assert.equal(formatTimeShort(ts), '03-05 08:07');

  assert.equal(toOpaqueColor('rgba(20, 26, 40, 0.5)', '#191a1d'), 'rgb(23, 26, 35)');
  assert.equal(toOpaqueColor('transparent', '#f6f6f3'), 'rgb(246, 246, 243)');
  assert.equal(toOpaqueColor('#ffffff', '#191a1d'), 'rgb(255, 255, 255)');

  assert.equal(inferThemeFromTextColor('rgb(230, 230, 230)', true), 'light');
  assert.equal(inferThemeFromTextColor('rgb(230, 230, 230)', 'rgba(240, 240, 240, 0.8)'), 'light');
  assert.equal(inferThemeFromTextColor('rgb(30, 30, 30)', 'rgba(20, 20, 20, 0.8)'), 'dark');
  assert.equal(inferThemeFromTextColor('rgb(20, 20, 20)'), 'light');
  assert.equal(inferThemeFromTextColor('rgb(240, 240, 240)'), 'dark');
  assert.equal(inferThemeFromTextColor('unknown'), 'light');
});

test('formatWorldbookDisplay & groupWorldbooksByOrganizer honor organizer settings & fallbacks', () => {
  const org = {
    groups: [
      { id: 'g1', name: '常用设定', color: '#4d856b' },
      { id: 'g_hide', name: '归档设定', color: '#888888' },
    ],
    assignments: {
      世界书A: 'g1',
      世界书B: 'g_hide',
    },
    aliases: {
      世界书A: '主线世界观',
    },
    cachedCharBindings: {
      'char_a.png': { name: '角色甲', primary: '世界书C', extra: ['世界书D'] },
    },
    globalHiddenGroupIds: ['g_hide'],
    editorHiddenGroupIds: [],
    charBookTitleMode: 'char_with_sub',
    aliasTitleMode: 'alias_with_sub',
  };

  const map = new Map([['世界书C', ['角色甲']]]);
  assert.deepEqual(formatWorldbookDisplay('世界书A', org, map), {
    primary: '主线世界观',
    subtitle: '世界书A',
    isCharLabel: false,
  });
  assert.deepEqual(formatWorldbookDisplay('世界书C', org, map), {
    primary: '角色甲',
    subtitle: '世界书C',
    isCharLabel: true,
  });
  assert.deepEqual(formatWorldbookDisplay('世界书C', { charBookTitleMode: 'char_only' }, map), {
    primary: '角色甲',
    subtitle: '',
    isCharLabel: true,
  });
  assert.deepEqual(formatWorldbookDisplay('世界书E', org, map), {
    primary: '世界书E',
    subtitle: '',
    isCharLabel: false,
  });

  const grouped = groupWorldbooksByOrganizer(
    ['世界书A', '世界书B', '世界书C', '世界书E'],
    org,
    {
      pinned: ['世界书E'],
      globals: ['世界书A'],
      charBooks: ['世界书C'],
      liveCharBookMap: { 世界书E: ['角色乙'] },
    },
  );
  assert.equal(grouped.hasOrganizer, true);
  assert.equal(grouped.sections[0].id, '__pinned__');
  const hiddenSec = grouped.sections.find(s => s.id === 'g_hide');
  assert.equal(hiddenSec.isExcluded, true);
  assert.equal(hiddenSec.defaultCollapsed, true);
  assert.ok(grouped.sections.some(s => s.id === '__char__'));
});

test('migrateStoreOnWorldbookRename, markStoreOnWorldbookDeleted & inspectSnapshotHealth (including char & chat)', () => {
  const store = {
    settings: { pinnedWorldbooks: ['世界书A', '世界书B'] },
    personaVersions: { 'u1.png': [{ id: 'pv1', lorebook: '世界书A' }] },
    snapshots: [
      {
        id: 's1',
        name: '快照1',
        scope: { persona: true, worldbooks: true, preset: true, api: true },
        persona: { avatarId: 'u1.png', name: '主角甲', lorebook: '世界书A' },
        worldbooks: {
          global: ['世界书A'],
          char: { primary: '世界书C', additional: ['世界书A', '世界书D'] },
          chat: '世界书E',
          entries: { 世界书A: { '1': true } },
          deletedBooks: ['世界书A'],
        },
        preset: { name: '预设V1', prompts: { p1: true } },
        api: { profileId: 'api1', profileName: '接口甲' },
      },
    ],
  };

  const renRes = migrateStoreOnWorldbookRename(store, '世界书A', '世界书A新');
  assert.deepEqual(renRes, { changed: true, affectedSnapshots: 1 });
  assert.deepEqual(store.settings.pinnedWorldbooks, ['世界书A新', '世界书B']);
  assert.equal(store.personaVersions['u1.png'][0].lorebook, '世界书A新');
  assert.equal(store.snapshots[0].persona.lorebook, '世界书A新');
  assert.deepEqual(store.snapshots[0].worldbooks.global, ['世界书A新']);
  assert.deepEqual(store.snapshots[0].worldbooks.char.additional, ['世界书A新', '世界书D']);
  assert.ok(store.snapshots[0].worldbooks.entries['世界书A新']);
  assert.deepEqual(store.snapshots[0].worldbooks.deletedBooks, []);

  const delRes = markStoreOnWorldbookDeleted(store, ['世界书A新', '世界书E']);
  assert.deepEqual(delRes, { changed: true, affectedSnapshots: 1 });
  assert.deepEqual(store.settings.pinnedWorldbooks, ['世界书B']);
  assert.deepEqual(store.snapshots[0].worldbooks.deletedBooks, ['世界书A新', '世界书E']);

  const health = inspectSnapshotHealth(store.snapshots[0], {
    personas: [],
    worldbooks: ['世界书D'], // missing 世界书A新, 世界书C (char.primary), 世界书E (chat)
    presets: ['预设V1'],
    presetNorm: { prompts: [{ id: 'p2', enabled: true }] },
    apiProfiles: [],
  });
  assert.equal(health.hasBlockingIssues, true);
  assert.equal(health.missingPersona.name, '主角甲');
  assert.deepEqual(health.missingWorldbooks.sort(), ['世界书A新', '世界书C', '世界书E'].sort());
  assert.equal(health.presetDrift.removedPromptCount, 1);
  assert.equal(health.presetDrift.newPromptCount, 1);
  assert.equal(health.missingApiProfile.profileName, '接口甲');
});

test('suggestSnapshotNames, normalizePresetLabel, analyzePresetMigration & applyPresetMigrationToSnapshots', () => {
  const suggested = suggestSnapshotNames({
    charName: '角色甲',
    personaName: '主角甲',
    presetName: '预设V1测试',
    existingNames: ['角色甲 · 主角甲'],
  });
  assert.equal(suggested.primary, '角色甲 · 主角甲 #2');
  assert.ok(suggested.suggestions.length >= 2);
  assert.ok(suggestSnapshotNames({}).primary.startsWith('快照 '));

  assert.equal(normalizePresetLabel('【测试】核心规则 v1.2.3 (V1)'), '核心规则');

  const snaps = [
    {
      id: 's1',
      scope: { preset: true },
      preset: {
        name: '预设V1',
        prompts: { old_1: true, old_2: false, old_orphan: true },
        groups: { g_old: true },
        promptNames: { old_1: '核心规则 v1.0', old_2: '文风约束', old_orphan: '旧独有条目' },
        groupNames: { g_old: '基础设定组' },
      },
    },
    {
      id: 's_no_preset',
      scope: { preset: false },
      preset: null,
    },
  ];
  const targetNorm = {
    prompts: [
      { id: 'old_1', name: '核心规则', enabled: false, role: 'system', marker: false },
      { id: 'new_2', name: '文风约束 (新版)', enabled: true, role: 'system', marker: false },
      { id: 'brand_new', name: '全新条目', enabled: true, role: 'system', marker: false },
    ],
    groups: [
      { id: 'g_new', name: '基础设定组', enabled: false },
      { id: 'g_added', name: '新增分组', enabled: true },
    ],
  };

  const analysis = analyzePresetMigration(snaps, null, targetNorm);
  assert.equal(analysis.matchedById.length, 1);
  assert.equal(analysis.matchedByName.length, 1);
  assert.equal(analysis.matchedByName[0].targetId, 'new_2');
  assert.equal(analysis.newPrompts.length, 1);
  assert.equal(analysis.newPrompts[0].id, 'brand_new');
  assert.equal(analysis.unmatchedOldPrompts.length, 1);
  assert.equal(analysis.matchedGroups.length, 1);
  assert.equal(analysis.newGroups.length, 1);

  const migrated = applyPresetMigrationToSnapshots(snaps, {
    targetPresetName: '预设V2',
    targetPresetNorm: targetNorm,
    analysis,
    newPromptDecisions: { brand_new: { include: true, inheritFromOldId: 'old_orphan' } },
    forceOverridePrompts: { old_1: false },
    forceOverrideGroups: {},
    syncNewGroups: true,
    cleanRemovedIds: true,
  });

  assert.equal(snaps[0].preset.name, '预设V1'); // non-mutating
  assert.equal(migrated[0].preset.name, '预设V2');
  assert.equal(migrated[0].preset.prompts.old_1, false); // forced override
  assert.equal(migrated[0].preset.prompts.new_2, false); // matchedByName preserved from old_2
  assert.equal(migrated[0].preset.prompts.brand_new, true); // inherited from old_orphan
  assert.equal(migrated[0].preset.prompts.old_orphan, undefined); // cleaned
  assert.equal(migrated[0].preset.groups.g_new, true); // matched group preserved
  assert.equal(migrated[0].preset.groups.g_added, true); // synced new group
  assert.equal(migrated[1].preset, null);
});

test('regression: self-closing space tags, empty extension group bucket, duplicate worldbook rename & null sanitization', () => {
  // 1. Self-closing tags with space before />
  assert.deepEqual(analyzeEntryTags('<自定义 />').unclosed, []);
  assert.deepEqual(analyzeEntryTags('<tag />').unclosed, []);
  assert.deepEqual(analyzeEntryTags('<div data-x="1" />').unclosed, []);
  assert.deepEqual(analyzeEntryTags('<div data-x="a/b">ok</div>').unclosed, []);

  // 2. Empty groups: [] bucket before non-empty custom extension bucket
  const shadowedPreset = {
    extensions: {
      emptyBucket: { presetPromptGroups: { groups: [], prompts: {} } },
      customBucket: {
        presetPromptGroups: {
          groups: [{ id: 'g1', name: '有效组', enabled: true }],
          prompts: { p1: { groupId: 'g1' } },
        },
      },
    },
  };
  const extracted = extractPresetGroups(shadowedPreset, null, null);
  assert.equal(extracted.groups.length, 1);
  assert.equal(extracted.groups[0].id, 'g1');
  assert.deepEqual(extracted.promptGroupMap, { p1: 'g1' });

  // 3. Duplicate entries in migrateStoreOnWorldbookRename
  const dupStore = {
    settings: { pinnedWorldbooks: ['OldBook', 'Other', 'OldBook'] },
    personaVersions: {},
    snapshots: [
      {
        id: 's_dup',
        worldbooks: {
          global: ['OldBook', 'Other', 'OldBook'],
          char: { primary: 'OldBook', additional: ['OldBook', 'Extra', 'OldBook'] },
          chat: 'OldBook',
          entries: { OldBook: { '1': true } },
          deletedBooks: [],
        },
      },
    ],
  };
  const renDup = migrateStoreOnWorldbookRename(dupStore, 'OldBook', 'NewBook');
  assert.deepEqual(renDup, { changed: true, affectedSnapshots: 1 });
  assert.deepEqual(dupStore.settings.pinnedWorldbooks, ['NewBook', 'Other']);
  assert.deepEqual(dupStore.snapshots[0].worldbooks.global, ['NewBook', 'Other']);
  assert.equal(dupStore.snapshots[0].worldbooks.char.primary, 'NewBook');
  assert.deepEqual(dupStore.snapshots[0].worldbooks.char.additional, ['NewBook', 'Extra']);
  assert.equal(dupStore.snapshots[0].worldbooks.chat, 'NewBook');

  // 4. Null/undefined items in sanitizeStore worldbook arrays
  const sanitized = sanitizeStore({
    snapshots: [
      {
        id: 's_null',
        name: '空值清洗',
        worldbooks: {
          global: [null, undefined, '  ', 'BookA', 'BookA'],
          char: { primary: null, additional: [null, undefined, 'BookB'] },
          deletedBooks: [null, undefined, '', 'BookC'],
        },
      },
    ],
  });
  assert.deepEqual(sanitized.snapshots[0].worldbooks.global, ['BookA']);
  assert.deepEqual(sanitized.snapshots[0].worldbooks.char.additional, ['BookB']);
  assert.deepEqual(sanitized.snapshots[0].worldbooks.deletedBooks, ['BookC']);
});

test('clampModalSize enforces desktop, mobile, max bounds, and ultra-small viewport guards', () => {
  // Desktop 1280x800: min 340x280, max floor(0.96*1280)=1228 x floor(800)=800 (100dvh)
  const dMin = clampModalSize({ width: 100, height: 100, viewportWidth: 1280, viewportHeight: 800 });
  assert.deepEqual(dMin, {
    width: 340,
    height: 280,
    minWidth: 340,
    maxWidth: 1228,
    minHeight: 280,
    maxHeight: 800,
    isMobile: false,
  });

  const dMax = clampModalSize({ width: 2000, height: 1500, viewportWidth: 1280, viewportHeight: 800 });
  assert.equal(dMax.width, 1228);
  assert.equal(dMax.height, 800);

  const dMid = clampModalSize({ width: 360, height: 420, viewportWidth: 1280, viewportHeight: 800 });
  assert.equal(dMid.width, 360);
  assert.equal(dMid.height, 420);

  // Mobile 390x844: min min(310, 390-16)=310 x 250, max 374 x 844
  const mMin = clampModalSize({ width: 200, height: 120, viewportWidth: 390, viewportHeight: 844 });
  assert.deepEqual(mMin, {
    width: 310,
    height: 250,
    minWidth: 310,
    maxWidth: 374,
    minHeight: 250,
    maxHeight: 844,
    isMobile: true,
  });

  // Boundary vw=680 is still mobile
  const m680 = clampModalSize({ width: 200, height: 200, viewportWidth: 680, viewportHeight: 800 });
  assert.equal(m680.minWidth, 310);
  assert.equal(m680.minHeight, 250);
  assert.equal(m680.isMobile, true);

  // Boundary vw=681 is desktop
  const d681 = clampModalSize({ width: 200, height: 200, viewportWidth: 681, viewportHeight: 800 });
  assert.equal(d681.minWidth, 340);
  assert.equal(d681.minHeight, 280);
  assert.equal(d681.isMobile, false);

  // Supports 2-arg (rect, viewport) form cleanly
  const twoArg = clampModalSize({ width: 500, height: 900 }, { viewportWidth: 1280, viewportHeight: 800 });
  assert.equal(twoArg.width, 500);
  assert.equal(twoArg.height, 800);
  assert.equal(twoArg.maxHeight, 800);
  assert.equal(twoArg.isMobile, false);

  const twoArgShort = clampModalSize({ width: 320, height: 900 }, { width: 680, height: 700 });
  assert.equal(twoArgShort.height, 700);
  assert.equal(twoArgShort.maxHeight, 700);
  assert.equal(twoArgShort.isMobile, true);

  const twoArgNull = clampModalSize(null, { viewportWidth: 1280, viewportHeight: 800 });
  assert.equal(twoArgNull.width, 340);
  assert.equal(twoArgNull.height, 280);
  assert.equal(twoArgNull.isMobile, false);

  // Ultra-small viewports: minWidth <= maxWidth and minHeight <= maxHeight always hold
  const tinyW = clampModalSize({ width: 300, height: 300, viewportWidth: 280, viewportHeight: 500 });
  assert.equal(tinyW.minWidth, 264);
  assert.equal(tinyW.maxWidth, 268);
  assert.ok(tinyW.minWidth <= tinyW.maxWidth);

  const tinyH = clampModalSize({ width: 300, height: 300, viewportWidth: 390, viewportHeight: 200 });
  assert.equal(tinyH.minHeight, 200);
  assert.equal(tinyH.maxHeight, 200);
  assert.ok(tinyH.minHeight <= tinyH.maxHeight);

  // Non-finite inputs fall back safely
  const bad = clampModalSize({ width: NaN, height: Infinity, viewportWidth: -10, viewportHeight: NaN });
  assert.ok(Number.isFinite(bad.width) && bad.width >= bad.minWidth && bad.width <= bad.maxWidth);
  assert.ok(Number.isFinite(bad.height) && bad.height >= bad.minHeight && bad.height <= bad.maxHeight);

  // Tiny positive float viewport (< 0.5) rounds to 1 consistently across clampModalSize and clampModalRect
  const subOneSize = clampModalSize({ width: 100, height: 100, viewportWidth: 0.4, viewportHeight: 0.4 });
  assert.deepEqual({ width: subOneSize.width, height: subOneSize.height, maxWidth: subOneSize.maxWidth, maxHeight: subOneSize.maxHeight }, {
    width: 1,
    height: 1,
    maxWidth: 1,
    maxHeight: 1,
  });
  const subOneRect = clampModalRect({ left: 0, top: 0, width: 100, height: 100, viewportWidth: 0.4, viewportHeight: 0.4 });
  assert.deepEqual(subOneRect, { left: 0, top: 0, width: 1, height: 1 });
});

test('clampModalRect & computeDraggedModalPosition clamp all edges and reclamp across viewport changes', () => {
  const clamped = clampModalRect({
    left: -200,
    top: 9999,
    width: 500,
    height: 400,
    viewportWidth: 1280,
    viewportHeight: 800,
  });
  assert.deepEqual(clamped, { left: 8, top: 392, width: 500, height: 400 });

  // Dragging beyond right/top edges stops inside margin
  const dragged = computeDraggedModalPosition({
    origLeft: 500,
    origTop: 200,
    dx: 1200,
    dy: -500,
    width: 400,
    height: 360,
    viewportWidth: 1280,
    viewportHeight: 800,
  });
  assert.deepEqual(dragged, { left: 872, top: 8 });

  // Viewport shrink (desktop -> 390x844 mobile rotation/resize) reclamps cleanly with 0px overflow
  const reclamped = clampModalRect({
    left: 500,
    top: 100,
    width: 780,
    height: 690,
    viewportWidth: 390,
    viewportHeight: 844,
  });
  assert.deepEqual(reclamped, { left: 8, top: 100, width: 374, height: 690 });
  assert.ok(reclamped.left >= 0 && reclamped.left + reclamped.width <= 390);
});

test('computeResizedModalRect enforces desktop/mobile bounds and viewport containment', () => {
  // Shrink desktop modal to 360x420
  const narrow = computeResizedModalRect({
    origLeft: 250,
    origTop: 55,
    origWidth: 780,
    origHeight: 690,
    dx: -420,
    dy: -270,
    handle: 'se',
    viewportWidth: 1280,
    viewportHeight: 800,
  });
  assert.deepEqual(narrow, { left: 250, top: 55, width: 360, height: 420 });

  // Shrink below desktop minimum clamps at 340x280
  const dFloor = computeResizedModalRect({
    origLeft: 100,
    origTop: 100,
    origWidth: 400,
    origHeight: 400,
    dx: -200,
    dy: -250,
    handle: 'se',
    viewportWidth: 1280,
    viewportHeight: 800,
  });
  assert.deepEqual(dFloor, { left: 100, top: 100, width: 340, height: 280 });

  // Expand beyond viewport right/bottom edges stops inside margins and max bounds
  const dCap = computeResizedModalRect({
    origLeft: 200,
    origTop: 150,
    origWidth: 500,
    origHeight: 400,
    dx: 2000,
    dy: 2000,
    handle: 'se',
    viewportWidth: 1280,
    viewportHeight: 800,
  });
  assert.equal(dCap.left, 200);
  assert.equal(dCap.top, 150);
  assert.equal(dCap.width, 1072); // 1280 - 8 - 200
  assert.equal(dCap.height, 642); // 800 - 8 - 150

  // Mobile 390x844 resize clamps to min(310, 390-16)=310 x 250 .. 374 x 844
  const mFloor = computeResizedModalRect({
    origLeft: 8,
    origTop: 446,
    origWidth: 374,
    origHeight: 388,
    dx: -200,
    dy: -300,
    handle: 'se',
    viewportWidth: 390,
    viewportHeight: 844,
  });
  assert.equal(mFloor.width, 310);
  assert.equal(mFloor.height, 250);
  assert.ok(mFloor.left + mFloor.width <= 390 - 8);
});

test('computeMiniWindowRect & computeRestorePillPosition compute safe floating rects', () => {
  // Mobile 390x844 mini-window: ~46dvh x (vw - 16)
  const mMini = computeMiniWindowRect({ viewportWidth: 390, viewportHeight: 844 });
  assert.equal(mMini.width, 374);
  assert.equal(mMini.height, Math.round(844 * 0.46)); // 388
  assert.equal(mMini.left, 8);
  assert.ok(mMini.top >= 400 && mMini.top + mMini.height <= 844 - 8);

  // Desktop 1280x800 mini-window: ~48%-50% height
  const dMini = computeMiniWindowRect({ viewportWidth: 1280, viewportHeight: 800 });
  assert.equal(dMini.width, 640);
  assert.ok(dMini.height >= Math.round(800 * 0.46) && dMini.height <= Math.round(800 * 0.52));
  assert.equal(dMini.left, 320);
  assert.ok(dMini.top >= 350 && dMini.top + dMini.height <= 800 - 8);

  // Clamps out-of-range heightRatio into [0.46, 0.52]
  const clampedRatio = computeMiniWindowRect({ viewportWidth: 390, viewportHeight: 844, heightRatio: 0.9 });
  assert.equal(clampedRatio.height, Math.round(844 * 0.52));

  // Restore pill avoids FAB when FAB sits in bottom-left
  const pillRightAvoid = computeRestorePillPosition({
    pillWidth: 148,
    pillHeight: 34,
    viewportWidth: 390,
    viewportHeight: 844,
    fabSide: 'left',
    fabY: 0.9,
    fabVisible: true,
    safeBottom: 20,
  });
  assert.equal(pillRightAvoid.left, 390 - 148 - 12);
  assert.equal(pillRightAvoid.top, 844 - 20 - 34 - 12);

  // Restore pill defaults to bottom-left when FAB is on right
  const pillLeft = computeRestorePillPosition({
    pillWidth: 148,
    pillHeight: 34,
    viewportWidth: 390,
    viewportHeight: 844,
    fabSide: 'right',
    fabY: 0.88,
    fabVisible: true,
  });
  assert.equal(pillLeft.left, 12);
  assert.equal(pillLeft.top, 844 - 34 - 12);

  // computeMiniWindowRect uses unified 680px mobile threshold
  const mini680 = computeMiniWindowRect({ viewportWidth: 680, viewportHeight: 800 });
  assert.equal(mini680.width, Math.floor(680 * 0.96)); // 652 (mobile target 664 clamped to maxWidth)
  assert.equal(mini680.height, Math.round(800 * 0.46)); // mobile defaultRatio 0.46
  const mini681 = computeMiniWindowRect({ viewportWidth: 681, viewportHeight: 800 });
  assert.equal(mini681.width, Math.min(640, Math.floor(681 * 0.92))); // desktop: 626
  assert.equal(mini681.height, Math.round(800 * 0.49)); // desktop defaultRatio 0.49
});

test('F2: buildPersonaMergePlan, applyPersonaMergeToVersions, restorePersonaMergeVersions & buildReleaseVersionToNativePayload', () => {
  const personas = [
    { avatar_id: 'main.png', name: '主角甲', description: '原主设定正文', lorebook: '世界书A', title: '称呼' },
    { avatar_id: 'c1.png', name: '主角甲_现代版', description: '现代设定', lorebook: '世界书B' },
    { avatar_id: 'c2.png', name: '主角甲 (校园)', description: '校园设定' },
    { avatar_id: 'c3.png', name: '测试乙', description: '异名保留' },
    { avatar_id: 'c4.png', name: '主角甲_现代版', description: '重复名字分身' },
    { avatar_id: 'c5.png', name: '   ', description: '空白名字分身' },
  ];
  const existingVersions = [
    { id: 'pv_old', name: '现代版', displayName: '主角甲_现代版', description: '旧现代', lorebook: '', updatedAt: 100 },
  ];
  const candIds = ['main.png', 'c1.png', 'c1.png', 'c2.png', 'c3.png', 'c4.png', 'c5.png', 'not_exist.png'];

  const personasBefore = structuredClone(personas);
  const candIdsBefore = structuredClone(candIds);
  const existingBefore = structuredClone(existingVersions);

  const plan = buildPersonaMergePlan(personas, 'main.png', candIds, existingVersions);
  assert.ok(plan.planId.startsWith('merge_'));
  assert.equal(plan.keepPersona.avatar_id, 'main.png');
  assert.equal(plan.keepPersona.name, '主角甲');

  // Self-exclusion, deduplication & missing ID filtering
  assert.deepEqual(plan.candidates.map(c => c.avatar_id), ['c1.png', 'c2.png', 'c3.png', 'c4.png', 'c5.png']);
  // Prefix stripping & collision-safe unique versionName
  assert.equal(plan.candidates[0].versionName, '现代版 (2)');
  assert.equal(plan.candidates[0].displayName, '主角甲_现代版');
  assert.equal(plan.candidates[1].versionName, '校园');
  assert.equal(plan.candidates[2].versionName, '测试乙');
  assert.equal(plan.candidates[3].versionName, '现代版 (3)');
  assert.equal(plan.candidates[4].displayName, '');
  assert.equal(plan.candidates[4].versionName, 'c5.png');

  // previewVersions prepends 原主描述 backup + preserves existing + appends candidates
  assert.equal(plan.previewVersions[0].name, '原主描述');
  assert.equal(plan.previewVersions[0].displayName, '主角甲');
  assert.equal(plan.previewVersions[0].description, '原主设定正文');
  assert.equal(plan.previewVersions[1].id, 'pv_old');
  assert.equal(plan.previewVersions.length, 7);

  // Strict immutability
  assert.deepEqual(personas, personasBefore);
  assert.deepEqual(candIds, candIdsBefore);
  assert.deepEqual(existingVersions, existingBefore);

  // Long >60-char name collision stays <= 60 chars and unique
  const longBase = '长'.repeat(65);
  const longPlan = buildPersonaMergePlan(
    [
      { avatar_id: 'm.png', name: '主号', description: '' },
      { avatar_id: 'l1.png', name: longBase, description: '1' },
      { avatar_id: 'l2.png', name: longBase, description: '2' },
    ],
    'm.png',
    ['l1.png', 'l2.png'],
    [{ id: 'pv_l', name: longBase.slice(0, 60), displayName: '', description: '0', updatedAt: 1 }],
  );
  assert.equal(longPlan.candidates[0].versionName.length <= 60, true);
  assert.equal(longPlan.candidates[1].versionName.length <= 60, true);
  assert.notEqual(longPlan.candidates[0].versionName, longPlan.candidates[1].versionName);
  assert.equal(longPlan.previewVersions.some(v => v.name === '原主描述'), false); // empty keep description skips backup

  // Missing/invalid keepAvatarId returns null keepPersona and safe cloned existing versions
  const badPlan = buildPersonaMergePlan(personas, 'missing.png', ['c1.png'], existingVersions);
  assert.equal(badPlan.keepPersona, null);
  assert.deepEqual(badPlan.candidates, []);
  assert.equal(badPlan.previewVersions.length, 1);
  assert.notEqual(badPlan.previewVersions[0], existingVersions[0]);

  // applyPersonaMergeToVersions deduplicates even when called directly without buildPersonaMergePlan
  const directNext = applyPersonaMergeToVersions(
    existingVersions,
    [{ name: '现代版', description: '新1' }, { name: '现代版', description: '新2' }],
    { keepPersona: { name: '主角甲', description: '主描述' }, now: 555 },
  );
  assert.deepEqual(directNext.map(v => v.name), ['原主描述', '现代版', '现代版 (2)', '现代版 (3)']);
  assert.equal(directNext[0].updatedAt, 555);
  assert.deepEqual(existingVersions, existingBefore);

  // restorePersonaMergeVersions deep-clones from array, object wrappers, or null/undefined
  const undoObj = { versionsBackup: [{ id: 'u1', name: '备份A', displayName: '主角甲', description: 'd', lorebook: 'wb', updatedAt: 42 }] };
  const restored = restorePersonaMergeVersions(undoObj);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].name, '备份A');
  restored[0].name = '篡改测试';
  assert.equal(undoObj.versionsBackup[0].name, '备份A');
  assert.deepEqual(restorePersonaMergeVersions({ previousVersions: [{ id: 'p', name: 'x' }] }).map(x => x.id), ['p']);
  assert.deepEqual(restorePersonaMergeVersions({ versions: [{ id: 'v', name: 'y' }] }).map(x => x.id), ['v']);
  assert.deepEqual(restorePersonaMergeVersions(null), []);
  assert.deepEqual(restorePersonaMergeVersions(undefined), []);

  // buildReleaseVersionToNativePayload prefers displayName, deduplicates name & suggestedAvatarId
  const release1 = buildReleaseVersionToNativePayload(
    { name: '版本别名', displayName: '主角甲', description: '设定1', lorebook: '世界书A' },
    [
      { avatar_id: '主角甲.png', name: '主角甲' },
      { avatar_id: '主角甲_2.png', name: '主角甲 (2)' },
    ],
  );
  assert.deepEqual(release1, {
    name: '主角甲 (3)',
    description: '设定1',
    lorebook: '世界书A',
    overwriteName: false,
    suggestedAvatarId: '主角甲_(3).png',
  });

  // Falls back to version name, then '恢复的 User', sanitizing unsafe filename chars
  const releaseFallbackName = buildReleaseVersionToNativePayload(
    { name: '版本/名称:*?', displayName: '   ', description: '正文' },
    [],
  );
  assert.equal(releaseFallbackName.name, '版本/名称:*?');
  assert.equal(releaseFallbackName.suggestedAvatarId, '版本_名称.png');
  assert.equal(releaseFallbackName.overwriteName, false);

  const releaseEmpty = buildReleaseVersionToNativePayload({ name: ' ', displayName: '' }, []);
  assert.equal(releaseEmpty.name, '恢复的 User');
  assert.equal(releaseEmpty.suggestedAvatarId, '恢复的_User.png');

  // Avatar ID collision suffixing when name differs from existing avatar_id
  const releaseAvatarCollide = buildReleaseVersionToNativePayload(
    { displayName: '新名字', description: '' },
    [{ avatar_id: '新名字.png', name: '别的名字' }],
  );
  assert.equal(releaseAvatarCollide.name, '新名字');
  assert.equal(releaseAvatarCollide.suggestedAvatarId, '新名字_2.png');
});

test('F3: isExtensionEnabled, canUseExternalOrganizer & isBuiltinModuleEnabled handle arrays, sets, paths & null guards', () => {
  // Empty / non-iterable / string disabledList -> enabled
  assert.equal(isExtensionEnabled(null, 'regex'), true);
  assert.equal(isExtensionEnabled(undefined, 'regex'), true);
  assert.equal(isExtensionEnabled([], 'regex'), true);
  assert.equal(isExtensionEnabled(new Set(), 'regex'), true);
  assert.equal(isExtensionEnabled({}, 'regex'), true);
  assert.equal(isExtensionEnabled('regex', 'regex'), true); // never iterates string chars
  assert.equal(isExtensionEnabled(new String('regex'), 'r'), true); // boxed String must not iterate chars
  assert.equal(isExtensionEnabled(new String('regex'), 'regex'), true);

  // Empty/null extKey -> false
  assert.equal(isExtensionEnabled([], ''), false);
  assert.equal(isExtensionEnabled([], null), false);

  // Exact, path-prefixed, case, trailing slash, underscore normalization
  assert.equal(isExtensionEnabled(['connection-manager'], 'connection-manager'), false);
  assert.equal(isExtensionEnabled(['third-party/worldbook-organizer'], 'worldbook-organizer'), false);
  assert.equal(isExtensionEnabled(['third-party\\worldbook-organizer/'], 'worldbook-organizer'), false);
  assert.equal(isExtensionEnabled(new Set(['Worldbook_Organizer ']), 'worldbook-organizer'), false);
  assert.equal(isExtensionEnabled(['builtin/regex'], 'regex'), false);

  // Substring non-match must NOT false-positive
  assert.equal(isExtensionEnabled(['my-regex-helper'], 'regex'), true);
  assert.equal(isExtensionEnabled(['worldbook-organizer-extra'], 'worldbook-organizer'), true);

  // canUseExternalOrganizer requires valid orgSettings object, enabled extension, AND active runtime
  assert.equal(canUseExternalOrganizer({ orgSettings: { groups: [] }, disabledExtensions: [], hasActiveRuntime: true }), true);
  assert.equal(canUseExternalOrganizer({ orgSettings: { groups: [] }, disabledExtensions: [], hasActiveRuntime: false }), false);
  assert.equal(canUseExternalOrganizer({ orgSettings: { groups: [] }, disabledExtensions: [] }), false);
  assert.equal(canUseExternalOrganizer({ orgSettings: { groups: [] }, disabledExtensions: ['third-party/worldbook-organizer'], hasActiveRuntime: true }), false);
  assert.equal(canUseExternalOrganizer({ orgSettings: null, disabledExtensions: [], hasActiveRuntime: true }), false);
  assert.equal(canUseExternalOrganizer({ orgSettings: [], disabledExtensions: [], hasActiveRuntime: true }), false);
  assert.equal(canUseExternalOrganizer(null), false);
  assert.equal(canUseExternalOrganizer(), false);

  // isBuiltinModuleEnabled
  assert.equal(isBuiltinModuleEnabled([], 'connection-manager'), true);
  assert.equal(isBuiltinModuleEnabled(['connection-manager'], 'connection-manager'), false);
  assert.equal(isBuiltinModuleEnabled(new Set(['builtin/regex']), 'regex'), false);
  assert.equal(isBuiltinModuleEnabled(['my-regex'], 'regex'), true);
  assert.equal(isBuiltinModuleEnabled([], ''), false);
  assert.equal(isBuiltinModuleEnabled([], null), false);
});

test('F4: buildPresetSyncOverrideTree & hardened applyPresetMigrationToSnapshots', () => {
  const norm = {
    prompts: [
      { id: 'p_top', name: '顶部独立条目', enabled: true, content: 'top' },
      { id: 'p_g1_1', name: '分组甲条1', enabled: true, content: 'alpha' },
      { id: 'p_g1_new', name: '分组甲新条', enabled: false, content: 'brandnew' },
      { id: 'p_g1_2', name: '分组甲条2', enabled: false, content: 'beta' },
      { id: 'p_mid', name: '中间独立条目', enabled: false, content: 'mid' },
      { id: 'p_g2_only_new', name: '全是新条目的组', enabled: true, content: 'onlynew' },
    ],
    groups: [
      { id: 'g1', name: '分组甲', enabled: true, collapsed: false },
      { id: 'g2', name: '全是新条目的组', enabled: true, collapsed: false },
      { id: 'g_empty', name: '空分组', enabled: true, collapsed: false },
    ],
    promptGroupMap: {
      p_g1_1: 'g1',
      p_g1_new: 'g1',
      p_g1_2: 'g1',
      p_g2_only_new: 'g2',
    },
  };

  // Excludes newPromptIds (Set / Array / [{id}]), preserves preset order, omits empty & all-new groups while keeping hasGroups=true
  const treeSet = buildPresetSyncOverrideTree(norm, new Set(['p_g1_new', 'p_g2_only_new']));
  assert.equal(treeSet.hasGroups, true);
  assert.equal(treeSet.matchedCount, 4);
  assert.deepEqual(treeSet.nodes.map(n => n.type), ['prompt', 'group', 'prompt']);
  assert.equal(treeSet.nodes[0].prompt.id, 'p_top');
  assert.equal(treeSet.nodes[1].group.id, 'g1');
  assert.equal(treeSet.nodes[1].totalCount, 2);
  assert.equal(treeSet.nodes[1].enabledCount, 1);
  assert.equal(treeSet.nodes[1].forceExpand, false);
  assert.deepEqual(treeSet.nodes[1].items.map(i => i.id), ['p_g1_1', 'p_g1_2']);
  assert.equal(treeSet.nodes[2].prompt.id, 'p_mid');

  const treeObjArr = buildPresetSyncOverrideTree(norm, [{ id: 'p_g1_new' }, { id: 'p_g2_only_new' }], { forceExpand: true });
  assert.equal(treeObjArr.nodes[1].forceExpand, true);

  // Search by group name shows all existing members of that group and sets forceExpand
  const byGroup = buildPresetSyncOverrideTree(norm, ['p_g1_new', 'p_g2_only_new'], { search: '分组甲' });
  assert.equal(byGroup.matchedCount, 2);
  assert.equal(byGroup.nodes.length, 1);
  assert.equal(byGroup.nodes[0].items.length, 2);
  assert.equal(byGroup.nodes[0].forceExpand, true);

  // Search by member prompt name filters items while preserving totalCount & enabledCount
  const byMember = buildPresetSyncOverrideTree(norm, ['p_g1_new', 'p_g2_only_new'], { search: 'beta' });
  assert.equal(byMember.matchedCount, 1);
  assert.equal(byMember.nodes[0].items.length, 1);
  assert.equal(byMember.nodes[0].items[0].id, 'p_g1_2');
  assert.equal(byMember.nodes[0].totalCount, 2);
  assert.equal(byMember.nodes[0].enabledCount, 1);
  assert.equal(byMember.nodes[0].forceExpand, true);

  // Search matching nothing
  const noHit = buildPresetSyncOverrideTree(norm, [], { search: '不存在的词' });
  assert.equal(noHit.matchedCount, 0);
  assert.deepEqual(noHit.nodes, []);
  assert.equal(noHit.hasGroups, true);

  // Null / missing targetPresetNorm / null opts safety
  assert.deepEqual(buildPresetSyncOverrideTree(null, null, null), { nodes: [], hasGroups: false, matchedCount: 0 });

  // Hardened applyPresetMigrationToSnapshots edge cases
  const baseSnaps = [
    null,
    {
      id: 's_keep',
      scope: { preset: true },
      preset: {
        name: '预设V1',
        prompts: { p_a: true, p_b: false, p_removed: true },
        groups: { g_keep: false, g_removed: true },
        promptNames: { p_a: '条目A', p_b: '条目B', p_removed: '旧残留条目' },
        groupNames: { g_keep: '保留组', g_removed: '旧残留组' },
      },
    },
  ];
  const baseTarget = {
    prompts: [
      { id: 'p_a', name: '条目A新', enabled: false },
      { id: 'p_b', name: '条目B', enabled: true },
    ],
    groups: [
      { id: 'g_keep', name: '保留组', enabled: true },
      { id: 'g_new', name: '全新组', enabled: true },
    ],
  };

  // 1) Null analysis + syncNewGroups: false + cleanRemovedIds: false + forceOverride interplay + null newPromptDecisions
  const res = applyPresetMigrationToSnapshots(baseSnaps, {
    targetPresetName: '预设V2',
    targetPresetNorm: baseTarget,
    analysis: null,
    newPromptDecisions: null,
    forceOverridePrompts: { p_b: true },
    forceOverrideGroups: { g_keep: true },
    syncNewGroups: false,
    cleanRemovedIds: false,
  });
  assert.equal(res[0], null);
  assert.equal(res[1].preset.prompts.p_a, true); // not clobbered by group override
  assert.equal(res[1].preset.prompts.p_b, true); // overridden to true
  assert.equal(res[1].preset.prompts.p_removed, true); // retained
  assert.equal(res[1].preset.promptNames.p_removed, '旧残留条目'); // retained name
  assert.equal(res[1].preset.promptNames.p_a, '条目A新'); // updated target name
  assert.equal(res[1].preset.groups.g_keep, true); // overridden
  assert.equal(res[1].preset.groups.g_removed, true); // retained
  assert.equal(res[1].preset.groupNames.g_removed, '旧残留组'); // retained group name
  assert.equal(res[1].preset.groups.g_new, undefined); // syncNewGroups: false skipped brand new group

  // 2) Null analysis + syncNewGroups: false carries over existing oldGroups[tg.id] when NOT overridden
  const carryRes = applyPresetMigrationToSnapshots([baseSnaps[1]], {
    targetPresetName: '预设V2',
    targetPresetNorm: baseTarget,
    analysis: null,
    forceOverridePrompts: null,
    forceOverrideGroups: null,
    syncNewGroups: false,
    cleanRemovedIds: true,
  });
  assert.equal(carryRes[0].preset.groups.g_keep, false); // carried over from oldGroups even without analysis
  assert.equal(carryRes[0].preset.groups.g_new, undefined);
  assert.equal(carryRes[0].preset.prompts.p_removed, undefined);
  assert.equal(carryRes[0].preset.promptNames.p_removed, undefined);

  // 3) Null opts does not throw
  assert.equal(applyPresetMigrationToSnapshots([baseSnaps[1]], null).length, 1);
});

test('F4 regression: Object.prototype keys and non-plain-object map guards across preset tree & migration helpers', () => {
  // 1) Direct buildPresetSyncOverrideTree with Object.prototype keys in promptGroupMap / groups
  const directMissingGroup = buildPresetSyncOverrideTree(
    {
      prompts: [
        { id: 'p1', name: 'Normal', enabled: true },
        { id: 'toString', name: 'ToStringPrompt', enabled: false },
      ],
      groups: [{ id: 'g1', name: 'Group1', enabled: true }],
      promptGroupMap: { p1: 'toString', constructor: 'valueOf' },
    },
    [],
  );
  assert.equal(directMissingGroup.hasGroups, true);
  assert.equal(directMissingGroup.matchedCount, 2);
  assert.deepEqual(directMissingGroup.nodes.map(n => n.type), ['prompt', 'prompt']);

  // Group actually named 'toString' or '__proto__' or 'constructor' works cleanly
  const directRealProtoGroup = buildPresetSyncOverrideTree(
    {
      prompts: [
        { id: 'p_ts', name: 'TS Member', enabled: true },
        { id: 'p_pr', name: 'Proto Member', enabled: false },
      ],
      groups: [
        { id: 'toString', name: 'TS Group', enabled: true },
        { id: '__proto__', name: 'Proto Group', enabled: true },
      ],
      promptGroupMap: { p_ts: 'toString', p_pr: '__proto__' },
    },
    [],
  );
  assert.equal(directRealProtoGroup.matchedCount, 2);
  assert.deepEqual(directRealProtoGroup.nodes.map(n => n.group.id), ['toString', '__proto__']);

  // 2) End-to-end normalizeNativePreset -> buildPresetSyncOverrideTree / buildPresetRenderNodes / buildSnapshotPresetInspectModel
  //    when extensions metadata points a prompt to non-existent 'toString' or 'constructor' group
  const normFromNative = normalizeNativePreset({
    prompts: [
      { identifier: 'p1', name: 'Entry 1', content: 'body 1' },
      { identifier: 'toString', name: 'Entry TS', content: 'body 2' },
    ],
    prompt_order: [
      {
        character_id: 100001,
        order: [
          { identifier: 'p1', enabled: true },
          { identifier: 'toString', enabled: false },
        ],
      },
    ],
    extensions: {
      presetPromptGroups: {
        groups: [{ id: 'g1', name: 'Valid Group', enabled: true }],
        prompts: { p1: { groupId: 'toString' } },
      },
    },
  });
  assert.deepEqual(normFromNative.promptGroupMap, {});
  const treeFromNative = buildPresetSyncOverrideTree(normFromNative, []);
  assert.equal(treeFromNative.matchedCount, 2);
  assert.deepEqual(treeFromNative.nodes.map(n => n.type), ['prompt', 'prompt']);

  // buildPresetRenderNodes & buildSnapshotPresetInspectModel also survive unmapped Object.prototype keys
  const renderProto = buildPresetRenderNodes({
    prompts: [{ id: 'toString', name: 'TS', enabled: true }],
    groups: [{ id: 'g1', name: 'G1', enabled: true }],
    groupsById: { g1: { id: 'g1', name: 'G1', enabled: true } },
    promptGroupMap: { p_other: 'constructor' },
  });
  assert.equal(renderProto.nodes.length, 1);
  assert.equal(renderProto.nodes[0].type, 'prompt');

  const inspectProto = buildSnapshotPresetInspectModel(
    { prompts: { toString: true }, groups: {} },
    {
      prompts: [{ id: 'toString', name: 'TS', enabled: false }],
      groups: [{ id: 'g1', name: 'G1', enabled: true }],
      groupsById: { g1: { id: 'g1', name: 'G1', enabled: true } },
      promptGroupMap: {},
    },
  );
  assert.equal(inspectProto.nodes.length, 1);
  assert.equal(inspectProto.nodes[0].prompt.selfOn, true);

  // 3) analyzePresetMigration does not pull Object.prototype.toString into oldPromptNameById when promptNames lacks own key
  const protoAnalysis = analyzePresetMigration(
    [
      {
        id: 's_proto',
        scope: { preset: true },
        preset: { name: 'Old', prompts: { toString: true }, groups: { constructor: true }, promptNames: {}, groupNames: {} },
      },
    ],
    null,
    { prompts: [{ id: 'new_p', name: 'New', enabled: true }], groups: [] },
  );
  assert.equal(protoAnalysis.unmatchedOldPrompts[0].name, '未命名旧条目');
  assert.equal(protoAnalysis.unmatchedOldGroups[0].name, '未命名旧分组');

  // 4) applyPresetMigrationToSnapshots with cleanRemovedIds: true preserves own 'toString'/'constructor' prompt switches
  const migratedProto = applyPresetMigrationToSnapshots(
    [
      {
        id: 's_ts',
        scope: { preset: true },
        preset: {
          name: 'Old',
          prompts: { toString: true, constructor: false, '0': true },
          groups: { toString: false, '0': true },
        },
      },
    ],
    {
      targetPresetNorm: {
        prompts: [
          { id: 'toString', name: 'TS', enabled: false },
          { id: 'constructor', name: 'Ctor', enabled: true },
          { id: '0', name: 'Zero', enabled: false },
          { id: 'length', name: 'Len', enabled: true },
        ],
        groups: [
          { id: 'toString', name: 'TS Group', enabled: true },
          { id: '0', name: 'Zero Group', enabled: false },
        ],
      },
      analysis: null,
      // Pass Arrays intentionally for decision/override maps: must be ignored safely
      newPromptDecisions: [{ include: true, enabled: false }],
      forceOverridePrompts: [false],
      forceOverrideGroups: [true],
      cleanRemovedIds: true,
    },
  );
  assert.equal(Object.prototype.hasOwnProperty.call(migratedProto[0].preset.prompts, 'toString'), true);
  assert.equal(migratedProto[0].preset.prompts.toString, true);
  assert.equal(Object.prototype.hasOwnProperty.call(migratedProto[0].preset.prompts, 'constructor'), true);
  assert.equal(migratedProto[0].preset.prompts.constructor, false);
  assert.equal(migratedProto[0].preset.prompts['0'], true); // Array forceOverridePrompts[0] was ignored
  assert.equal(Object.prototype.hasOwnProperty.call(migratedProto[0].preset.prompts, 'length'), false); // Array.length ignored
  assert.equal(migratedProto[0].preset.groups.toString, false);
  assert.equal(migratedProto[0].preset.groups['0'], true); // Array forceOverrideGroups[0] was ignored

  // Array passed as opts falls back safely without throwing
  assert.equal(applyPresetMigrationToSnapshots([{ id: 's1', scope: { preset: true }, preset: { name: 'P', prompts: {}, groups: {} } }], []).length, 1);
});

test('F4 regression: string/boxed-String opts trap (T2.6) and null/non-object groupsById entries (T2.5)', () => {
  const norm = {
    prompts: [{ id: 'p1', name: 'P1', enabled: true, content: 'abc' }],
    groups: [{ id: 'g1', name: 'G1', enabled: true }],
    groupsById: { g1: { id: 'g1', name: 'G1', enabled: true } },
    promptGroupMap: { p1: 'g1' },
  };
  const snapPreset = { prompts: { p1: true }, groups: {} };

  // T2.6: string primitive, non-empty string, boxed String, and non-string search must not hit String.prototype.search
  for (const weirdOpts of ['', 'str', new String('abc'), { search: 123 }]) {
    const renderRes = buildPresetRenderNodes(norm, weirdOpts);
    assert.equal(renderRes.nodes.length, 1);
    assert.equal(renderRes.nodes[0].type, 'group');
    assert.equal(renderRes.nodes[0].items.length, 1);
    assert.equal(renderRes.nodes[0].forceExpand, false);

    const inspectRes = buildSnapshotPresetInspectModel(snapPreset, norm, weirdOpts);
    assert.equal(inspectRes.nodes.length, 1);
    assert.equal(inspectRes.nodes[0].type, 'group');
    assert.equal(inspectRes.nodes[0].items.length, 1);
    assert.equal(inspectRes.nodes[0].forceExpand, false);

    const syncRes = buildPresetSyncOverrideTree(norm, [], weirdOpts);
    assert.equal(syncRes.matchedCount, 1);
    assert.equal(syncRes.nodes.length, 1);
    assert.equal(syncRes.nodes[0].type, 'group');
    assert.equal(syncRes.nodes[0].items.length, 1);
    assert.equal(syncRes.nodes[0].forceExpand, false);
  }

  // Normal plain-object search still filters accurately
  assert.equal(buildPresetRenderNodes(norm, { search: 'abc' }).nodes.length, 1);
  assert.equal(buildPresetRenderNodes(norm, { search: 'nope' }).nodes.length, 0);

  // T2.5: groupsById entries mapped to null/undefined/non-plain-object degrade cleanly to ungrouped prompts
  const normBadGroups = {
    prompts: [
      { id: 'p1', name: 'Alpha', enabled: true, content: 'abc' },
      { id: 'p2', name: 'Beta', enabled: false, content: 'abc' },
      { id: 'p3', name: 'Gamma', enabled: true, content: 'xyz' },
    ],
    groups: [
      { id: 'g1', name: 'G1', enabled: true },
      { id: 'g2', name: 'G2', enabled: true },
      { id: 'g3', name: 'G3', enabled: true },
    ],
    groupsById: { g1: null, g2: undefined, g3: ['bad'] },
    promptGroupMap: { p1: 'g1', p2: 'g2', p3: 'g3' },
  };

  const renderBadOnlyOn = buildPresetRenderNodes(normBadGroups, { search: 'abc', onlyOn: true });
  assert.equal(renderBadOnlyOn.nodes.length, 1);
  assert.equal(renderBadOnlyOn.nodes[0].type, 'prompt');
  assert.equal(renderBadOnlyOn.nodes[0].prompt.id, 'p1');

  const renderBadSearch = buildPresetRenderNodes(normBadGroups, { search: 'xyz' });
  assert.equal(renderBadSearch.nodes.length, 1);
  assert.equal(renderBadSearch.nodes[0].type, 'prompt');
  assert.equal(renderBadSearch.nodes[0].prompt.id, 'p3');

  const inspectBadOnlyOn = buildSnapshotPresetInspectModel(
    { prompts: { p1: true, p2: false, p3: true }, groups: {} },
    normBadGroups,
    { search: 'abc', onlyOn: true },
  );
  assert.equal(inspectBadOnlyOn.nodes.length, 1);
  assert.equal(inspectBadOnlyOn.nodes[0].type, 'prompt');
  assert.equal(inspectBadOnlyOn.nodes[0].prompt.id, 'p1');
  assert.equal(inspectBadOnlyOn.nodes[0].prompt.effectiveOn, true);

  const inspectBadAll = buildSnapshotPresetInspectModel(
    { prompts: { p1: true, p2: false, p3: true }, groups: {} },
    normBadGroups,
    {},
  );
  assert.deepEqual(inspectBadAll.nodes.map(n => n.type), ['prompt', 'prompt', 'prompt']);

  const syncBadSearch = buildPresetSyncOverrideTree(normBadGroups, [], { search: 'abc' });
  assert.equal(syncBadSearch.matchedCount, 2);
  assert.deepEqual(syncBadSearch.nodes.map(n => n.type), ['prompt', 'prompt']);
  assert.deepEqual(syncBadSearch.nodes.map(n => n.prompt.id), ['p1', 'p2']);
});
