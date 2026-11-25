import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APP_VERSION,
  THEME_MODES,
  analyzeEntryTags,
  analyzePresetMigration,
  applyPresetMigrationToSnapshots,
  buildCleanCopyText,
  buildPresetRenderNodes,
  buildSnapshotPresetInspectModel,
  computeLineDiff,
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
  markStoreOnWorldbookDeleted,
  migrateStoreOnWorldbookRename,
  normalizeNativePreset,
  normalizePresetLabel,
  normalizeText,
  parseImportJson,
  pickActivePromptOrder,
  resolveBindingForContext,
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
