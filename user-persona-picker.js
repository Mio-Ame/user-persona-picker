;(function () {
  'use strict';

  const APP_VERSION = '5.1.0';
  const APP_ID = 'user-persona-picker-host';
  const MENU_ENTRY_ID = 'user-persona-picker-menu-entry';
  const DISPOSE_EVENT = 'user-persona-picker-dispose';
  const BUTTON_NAME = 'User人设';
  const VAR_KEY = 'user_picker';
  const LIB_BOOK = '__lib__';
  const OPENING_BOOK = 'User·总控入口';
  const STORE_KEY = 'userPersonaPicker.v5';
  const LEGACY_STORE_KEY = 'userPersonaPicker.v4';
  const KEY_SEP = '\u0000';

  const BUILTIN_LIBRARY = [{"cat":"外貌与发色","title":"清冷美人","content":"五官清隽疏朗，眉眼线条干净利落，不笑时自带淡然疏离的距离感，笑起来反差格外明显。"},{"cat":"外貌与发色","title":"浓颜明艳","content":"五官立体深邃、眉眼浓郁有神，红唇雪肤对比鲜明，在人群里第一眼就很抓人视线。"},{"cat":"外貌与发色","title":"邻家甜妹","content":"脸型柔和讨喜，眼尾微圆，笑起来眉眼弯弯带软意，气质亲近自然、让人不自觉放软语气。"},{"cat":"外貌与发色","title":"元气少女","content":"神态鲜活明快，眼神清亮有光，情绪外露而真诚，举手投足带着轻盈的朝气。"},{"cat":"外貌与发色","title":"冷艳御姐","content":"骨相利落大气，眼型偏长带几分凌厉感，气质从容笃定，气场沉稳压得住场。"},{"cat":"外貌与发色","title":"清俊少年感","content":"轮廓清爽舒展，眉骨清晰，身材修长匀称，带着干净坦荡、不加修饰的少年气息。"},{"cat":"外貌与发色","title":"娇小纤细","content":"个子偏娇小，骨架纤细单薄，肩颈与腕骨线条秀气，在对方身边显得很需要照顾。"},{"cat":"外貌与发色","title":"高挑修长","content":"身材高挑匀称，肩背舒展、腿型笔直修长，站姿挺拔有存在感。"},{"cat":"外貌与发色","title":"黑长直","content":"留着一头顺滑乌黑的长直发，垂落肩背，衬得肤色更显白皙干净。"},{"cat":"外貌与发色","title":"波浪长卷发","content":"留着蓬松柔顺的长卷发，发尾自然垂卷，低头或转身时带着柔和的慵懒氛围。"},{"cat":"外貌与发色","title":"利落短发","content":"留着干净利落的短发，露出清晰的下颌线与颈侧线条，显得清爽有精神。"},{"cat":"外貌与发色","title":"浅色长发","content":"留着浅金、浅棕或银白系长发，光线照过时发丝泛着柔和光泽，视觉辨识度很高。"},{"cat":"穿搭与气质","title":"简约日常风","content":"穿衣偏爱剪裁利落的纯色基础款，注重版型与舒适度，干净清爽不过度堆砌配饰。"},{"cat":"穿搭与气质","title":"温柔知性风","content":"常穿针织、衬衫与柔和低饱和色系，举止从容得体，自带沉静温和的书卷气。"},{"cat":"穿搭与气质","title":"甜酷辣妹风","content":"擅长把明快剪裁与利落配饰混搭，既有精致明艳的一面，也带着随性洒脱的锋芒。"},{"cat":"穿搭与气质","title":"精致大小姐风","content":"衣着面料考究、细节精致，举止自带优渥教养养出的从容感，但不刻意炫耀。"},{"cat":"穿搭与气质","title":"松弛学院风","content":"偏爱卫衣、针织开衫、百褶裙或直筒裤等轻便单品，自然减龄、没有紧绷感。"},{"cat":"穿搭与气质","title":"古风雅致风","content":"衣袂飘逸、配色清雅，佩饰克制而有细节，行止间合乎古韵礼度而不失灵气。"},{"cat":"性格底色","title":"温柔体贴","content":"性格温和细腻，能敏锐察觉他人情绪并照顾分寸，说话轻声但心里有主见，不是无底线迁就。"},{"cat":"性格底色","title":"娇气爱撒娇","content":"有点小娇气，面对亲近的人习惯软声撒娇、求抱求哄，受委屈会眼眶泛红，顺毛哄两句就会心软。"},{"cat":"性格底色","title":"傲娇嘴硬","content":"嘴上爱逞强拌嘴、不肯轻易服软，其实心软护短，被直球夸奖或靠近时容易耳根发红。"},{"cat":"性格底色","title":"独立清醒","content":"情绪稳定、边界清晰，遇事冷静有判断力，不内耗也不轻易被言语画饼或道德绑架。"},{"cat":"性格底色","title":"呆萌迷糊","content":"日常偶尔慢半拍、带点天然的迷糊感，对弯弯绕绕反应不敏锐，但对在乎的事格外执着认真。"},{"cat":"性格底色","title":"社恐慢热","content":"面对陌生人拘谨话少、不喜多余寒暄，混熟并确认安全感后才会卸下防备露出柔软或话痨一面。"},{"cat":"性格底色","title":"活泼直球","content":"性格外向坦率，喜欢和不满都直接摆在明面上，不藏弯弯绕绕，聊天节奏明快自然。"},{"cat":"性格底色","title":"腹黑绿茶","content":"表面软糯无辜、很懂示弱拿捏情绪，心里却精明通透，擅长不动声色地把主动权握在手里。"},{"cat":"性格底色","title":"高冷少言","content":"平时话不多、表情克制，习惯用眼神和动作代替废话，只在真正在意的人面前展露细微偏爱。"},{"cat":"性格底色","title":"咸鱼摆烂","content":"随性松弛、能躺绝不站，对琐事佛系不内卷，人生最高优先级是吃好睡好和舒服自在。"},{"cat":"性格底色","title":"猫系若即若离","content":"像猫一样看心情亲近，需要空间时不爱被步步紧逼，放松时又会主动贴过来蹭一蹭。"},{"cat":"性格底色","title":"犬系粘人热情","content":"情绪热忱真诚，对喜欢的人藏不住开心，习惯主动贴近、分享日常和求夸求回应。"},{"cat":"性格底色","title":"毒舌心软","content":"嘴上吐槽犀利一针见血，真遇上事却总是第一个帮忙兜底，属于刀子嘴豆腐心。"},{"cat":"性格底色","title":"理智克制","content":"习惯先观察再表态，哪怕心动也会保持体面与分寸，情绪很少失控，越克制越显张力。"},{"cat":"恋爱与依恋","title":"粘人恋爱脑","content":"确认喜欢后会把对方放在很靠前的位置，喜欢频繁贴贴、报备日常，很吃偏爱与回应。"},{"cat":"恋爱与依恋","title":"慢热观察型","content":"不会因一时冲动交出真心，需要通过长期细节观察对方是否可靠，动心后反而极其长情。"},{"cat":"恋爱与依恋","title":"口是心非","content":"心里明明在意得要命，嘴上偏说“随便”“无所谓”，细微眼神和小动作却总会露馅。"},{"cat":"恋爱与依恋","title":"护短偏爱","content":"对外客气有礼，对认定的人极其护短，哪怕对方嘴硬也会不动声色地站在同一边。"},{"cat":"恋爱与依恋","title":"回避试探型","content":"害怕受伤与落空，关系一升温就容易下意识退半步试探，需要坚定而耐心的确认才敢靠近。"},{"cat":"恋爱与依恋","title":"占有欲偏强","content":"表面不动声色，心里却极在意唯一性，看到对方和旁人过近会安静吃醋或暗暗宣示存在感。"},{"cat":"恋爱与依恋","title":"情感洁癖","content":"对待感情纯粹认真，容不得含糊不清的暧昧与欺瞒，爱则全心投入，越界则干脆抽身。"},{"cat":"恋爱与依恋","title":"直球偏爱","content":"不玩推拉猜心，喜欢就会大方夸奖和靠近，用坦荡的态度把安全感直接递到对方手里。"},{"cat":"表达方式","title":"语气温软","content":"说话尾音偏轻偏软，即使生气也不大吼大叫，更像轻声控诉或冷着脸憋着不理人。"},{"cat":"表达方式","title":"话少精简","content":"开口言简意赅，不爱长篇大论解释，很多态度藏在停顿、目光和短句里。"},{"cat":"表达方式","title":"爱吐槽接梗","content":"反应快、有幽默感，擅长在紧张或暧昧气氛里冷不丁接一句俏皮吐槽打破僵局。"},{"cat":"表达方式","title":"爱撒娇拖尾音","content":"和熟人说话时偶尔会拖长尾音或软声喊人，自然娇憨而不做作。"},{"cat":"表达方式","title":"克制礼貌","content":"对不熟的人措辞客气周全，哪怕拒绝也带着礼貌的疏离，让人挑不出错却难再进一步。"},{"cat":"表达方式","title":"脑回路清奇","content":"思考角度偶尔跳脱出人意料，常在严肃场景里冒出认真又荒诞的直白结论。"},{"cat":"关系阶段","title":"初见陌生","content":"与{{char}}刚刚相识，彼此还停留在礼貌试探阶段，尚未建立亲密信任与越界习惯。"},{"cat":"关系阶段","title":"熟人暗恋","content":"与{{char}}原本相熟，关系里藏着尚未挑明的心动与试探，日常互动带着微妙的克制。"},{"cat":"关系阶段","title":"暧昧拉扯","content":"与{{char}}处于心照不宣的暧昧期，言语和肢体都在试探边界，谁都还没正式捅破那层纸。"},{"cat":"关系阶段","title":"热恋交往","content":"已与{{char}}正式确定恋爱关系，相处自然亲密，习惯彼此的陪伴、偏爱与日常小腻歪。"},{"cat":"关系阶段","title":"欢喜冤家","content":"与{{char}}平时见面就爱互相斗嘴拆台，表面针锋相对，真遇上事却最护着对方。"},{"cat":"关系阶段","title":"冷战僵持","content":"与{{char}}因误会或分歧正在冷战，表面各自端着架子不肯先低头，暗地里却都在意对方动静。"},{"cat":"关系阶段","title":"分手前任","content":"曾与{{char}}有过一段认真感情但已分手，再次照面时熟悉感与疏离感并存，旧账未清。"},{"cat":"关系阶段","title":"破镜重圆","content":"与{{char}}分开一段时间后再度重逢，彼此都有成长与未尽的情意，旧情与心结交织拉扯。"},{"cat":"关系阶段","title":"契约关系","content":"与{{char}}因约定或利益结成契约关系，台面上按协议各取所需，私下界限却在悄然松动。"},{"cat":"关系阶段","title":"已婚同居","content":"已与{{char}}领证结婚并同居生活，熟悉彼此生活习惯，兼具琐碎烟火气与亲密默契。"},{"cat":"背景身份","title":"在校学生","content":"当前身份为在校大学生或研究生，生活围绕校园、学业、社团与年轻人的日常展开。"},{"cat":"背景身份","title":"职场新人","content":"初入职场不久，经济独立、努力适应社会节奏，偶尔会因工作疲惫但仍保留鲜活劲头。"},{"cat":"背景身份","title":"独立从业者","content":"从事自由职业、设计、创作或独立经营，时间相对灵活，有自己的专业底气与生活秩序。"},{"cat":"背景身份","title":"豪门世家","content":"出身优渥的豪门家庭，自小受过良好教养，见识开阔、处事从容，低调但不缺底气。"},{"cat":"背景身份","title":"普通温馨家庭","content":"成长于普通和睦的家庭，三观端正、内心有底气，懂得珍惜日常烟火与真诚待人。"},{"cat":"背景身份","title":"古风世家","content":"身处古代背景，出身书香或勋贵之家，知礼守度却不迂腐，言行藏着自己的玲珑心思。"},{"cat":"背景身份","title":"西幻冒险者","content":"身处剑与魔法的奇幻世界，具备一定自保与探索能力，游历于城镇、学院或秘境之间。"},{"cat":"背景身份","title":"修仙宗门","content":"身处修真世界，为宗门弟子或散修，日常修行历练，兼顾道心、师门与红尘因果。"},{"cat":"互动规则","title":"禁止代写User言行","isRule":true,"content":"严格禁止替{{user}}描写对话、动作、神态、心理活动或擅自替{{user}}做决定，所有反应留给{{user}}本人。"},{"cat":"互动规则","title":"尊重User自主权","isRule":true,"content":"{{char}}不得无视{{user}}的拒绝或单方面包办剧情走向，关键节点必须留出回应与选择空间。"},{"cat":"互动规则","title":"称呼自然少喊全名","isRule":true,"content":"关系亲近后称呼自然贴合语境，非严肃、生疏或生气场合不频繁生硬地连名带姓喊全名。"},{"cat":"互动规则","title":"保持角色本色","isRule":true,"content":"{{char}}始终保持原有性格、立场与说话习惯，不因迎合{{user}}而突然变得谄媚或失去个性。"},{"cat":"互动规则","title":"不擅自推进亲密进度","isRule":true,"content":"感情与肢体亲密须随剧情自然铺垫，未经{{user}}回应或默许不突然跳过阶段强行升级。"},{"cat":"互动规则","title":"重动作与细节描写","isRule":true,"content":"多通过具体动作、微表情、语气停顿与环境细节展现情绪，少用空洞抽象的心理总结。"},{"cat":"互动规则","title":"允许自然拉扯与分歧","isRule":true,"content":"互动中允许存在观念差异、轻微试探与情绪拉扯，不必每句话都顺着说或强行圆场。"},{"cat":"互动规则","title":"避免说教与总结腔","isRule":true,"content":"对话与叙述保持自然生活感，避免结尾升华总结、人生道理说教或反复复述前文。"}];
  const CONFLICT_GROUPS = [{"id":"body_size","label":"体型身高","items":["娇小纤细","高挑修长"]},{"id":"hair_len","label":"发型冲突","items":["黑长直","波浪长卷发","利落短发"]},{"id":"hair_color","label":"发色冲突","items":["黑长直","浅色长发"]},{"id":"vibe","label":"外貌气质","items":["清冷美人","邻家甜妹","元气少女","冷艳御姐","清俊少年感"]},{"id":"social","label":"社交性格","items":["社恐慢热","活泼直球"]},{"id":"talk","label":"话量冲突","items":["高冷少言","活泼直球"]},{"id":"speech","label":"表达冲突","items":["话少精简","爱吐槽接梗"]},{"id":"love_style","label":"恋爱态度","items":["直球偏爱","口是心非","回避试探型"]},{"id":"stage_core","label":"关系阶段","items":["初见陌生","熟人暗恋","暧昧拉扯","热恋交往","分手前任","已婚同居"]},{"id":"era","label":"时代世界观","items":["在校学生","职场新人","古风世家","西幻冒险者","修仙宗门"]}];

  // Worldbook EJS renders pre-formatted text if provided, or pulls live worldbook entries cleanly
  const OPENING_BODY_EJS = [
    '<%_',
    'const _getPick = function () {',
    '  let raw = null;',
    "  try { if (typeof getLocalVar === 'function') raw = getLocalVar('user_picker'); } catch (e) {}",
    '  if (raw == null) {',
    "    try { if (typeof getvar === 'function') raw = getvar('user_picker', { scope: 'local' }); } catch (e) {}",
    '  }',
    "  if (typeof raw === 'string') {",
    '    try { raw = JSON.parse(raw); } catch (e) { raw = {}; }',
    '  }',
    "  return (raw && typeof raw === 'object') ? raw : {};",
    '};',
    'const _fmtBlock = function (title, content) {',
    "  const c = String(content || '').trim();",
    '  if (!c) return "";',
    '  const first = c.split(/\r?\n/)[0].trim();',
    '  if (/^#/.test(first) || /^【.+】/.test(first) || /^[^\s:#]+:\s*$/.test(first)) return c;',
    '  return title ? ("【" + title + "】\n" + c) : c;',
    '};',
    'const _pk = _getPick();',
    'const _list = Array.isArray(_pk.wi) ? _pk.wi : [];',
    'const _body = [], _rules = [];',
    "if (typeof _pk.profileText === 'string' && _pk.profileText.trim()) _body.push(_pk.profileText.trim());",
    'for (let _i = 0; _i < _list.length; _i++) {',
    '  const _it = _list[_i] || {};',
    "  if (_it.title === '红线') continue;",
    '  let _c = "";',
    "  if (typeof _it.text === 'string' && _it.text.trim()) _c = _it.text;",
    '  else if (_it.book && _it.title) _c = await getwi(_it.book, _it.title);',
    '  if (!_c) continue;',
    "  if (_c.indexOf('[未找到') >= 0 || _c.indexOf('〔未找到') >= 0) continue;",
    '  const _block = _fmtBlock(_it.title, _c);',
    '  if (_it.isRule || /^(写作约束|演绎准则)/.test(_it.title || "")) _rules.push(_block); else _body.push(_block);',
    '}',
    '_%><% if (_body.length) { %><USER人设>',
    '以下是 {{user}} 的设定，只属于 {{user}}，禁止混淆 {{user}} 与 {{char}}。',
    "<%- _body.join('\n\n') %>",
    '</USER人设>',
    '<% } %><% if (_rules.length) { %><USER写作规则>',
    "<%- _rules.join('\n\n') %>",
    '</USER写作规则>',
    '<% } %>',
  ].join('\n');

  const OPENING_REDLINE_EJS = [
    '<%_',
    'const _pk2 = (function () {',
    '  let raw = null;',
    "  try { if (typeof getLocalVar === 'function') raw = getLocalVar('user_picker'); } catch (e) {}",
    '  if (raw == null) {',
    "    try { if (typeof getvar === 'function') raw = getvar('user_picker', { scope: 'local' }); } catch (e) {}",
    '  }',
    "  if (typeof raw === 'string') {",
    '    try { raw = JSON.parse(raw); } catch (e) { raw = {}; }',
    '  }',
    "  return (raw && typeof raw === 'object') ? raw : {};",
    '})();',
    'const _l2 = Array.isArray(_pk2.wi) ? _pk2.wi : [];',
    'let _hit = null;',
    "for (let _j = 0; _j < _l2.length; _j++) { if (_l2[_j] && _l2[_j].title === '红线') { _hit = _l2[_j]; break; } }",
    'let _red = "";',
    "if (_hit) { _red = _hit.text || (_hit.book ? await getwi(_hit.book, '红线') : ''); }",
    "const _redSafe = (_red && _red.indexOf('[未找到') < 0 && _red.indexOf('〔未找到') < 0) ? _red : '';",
    '_%><%- _redSafe %>',
  ].join('\n');

  // =========================
  // Pure Core (Testable)
  // =========================

  function itemKey(book, title) {
    return String(book || '') + KEY_SEP + String(title || '');
  }

  function parseKey(key) {
    const str = String(key || '');
    const idx = str.indexOf(KEY_SEP);
    if (idx < 0) return { book: '', title: str };
    return { book: str.slice(0, idx), title: str.slice(idx + 1) };
  }

  function normalizeName(name) {
    return String(name ?? '').normalize('NFKC').trim();
  }

  function sanitizeCharName(name) {
    const clean = normalizeName(name);
    if (!clean) return '';
    if (/^SillyTavern\s+System$/i.test(clean) || /^System$/i.test(clean)) return '';
    return clean;
  }

  function stripTrailingDigits(name) {
    return normalizeName(name).replace(/\d+$/, '').trim();
  }

  function parseBracketTitle(title) {
    const m = String(title || '').match(/^(?:【([^】]+)】|\[([^\]]+)\])(.*)$/);
    if (!m) return null;
    return { tag: (m[1] || m[2] || '').trim(), shortTitle: (m[3] || '').trim(), fullTitle: String(title) };
  }

  function matchesChar(title, currentChar) {
    const c = sanitizeCharName(currentChar);
    if (!c) return false;
    const bracket = parseBracketTitle(title);
    if (bracket) {
      const t = normalizeName(bracket.tag);
      if (!t || t === '通用' || t === '模板') return false;
      if (t === c) return true;
      const tb = stripTrailingDigits(t);
      const cb = stripTrailingDigits(c);
      if (tb && cb && tb === cb) return true;
      if (tb.length >= 2 && cb.length >= 2 && (cb.startsWith(tb) || tb.startsWith(cb))) return true;
      return false;
    }
    const nt = normalizeName(title);
    const cb = stripTrailingDigits(c);
    return nt.includes(c) || (cb.length >= 2 && nt.includes(cb));
  }

  // Smart unit completion for structured basic profile fields (e.g. "20" -> "20岁", "162" -> "162cm")
  function formatAge(raw) {
    const s = normalizeName(raw);
    if (!s) return '';
    if (/^\d+(?:\.\d+)?$/.test(s)) return s + '岁';
    return s;
  }

  function formatHeight(raw) {
    const s = normalizeName(raw);
    if (!s) return '';
    if (/^\d{2,3}(?:\.\d+)?$/.test(s)) return s + 'cm';
    if (/^1\.\d{1,2}$/.test(s)) return Math.round(Number(s) * 100) + 'cm';
    return s;
  }

  function createEmptyProfile() {
    return { name: '', gender: '', age: '', height: '', role: '', traits: '' };
  }

  function normalizeProfile(raw) {
    const base = createEmptyProfile();
    if (!raw || typeof raw !== 'object') return base;
    for (const k of Object.keys(base)) {
      if (typeof raw[k] === 'string') base[k] = raw[k].trim();
    }
    return base;
  }

  function hasProfileData(profile) {
    if (!profile) return false;
    return Object.values(profile).some(v => typeof v === 'string' && v.trim().length > 0);
  }

  function formatProfileBlock(profile, outputFormat) {
    const p = normalizeProfile(profile);
    const age = formatAge(p.age);
    const height = formatHeight(p.height);
    const fields = [];
    if (p.name) fields.push(['姓名', p.name]);
    if (p.gender) fields.push(['性别', p.gender]);
    if (age) fields.push(['年龄', age]);
    if (height) fields.push(['身高', height]);
    if (p.role) fields.push(['身份', p.role]);
    if (p.traits) fields.push(['外貌与特征', p.traits]);
    if (!fields.length) return '';

    if (outputFormat === 'prose') {
      const parts = [];
      if (p.name) parts.push('姓名' + p.name);
      if (p.gender) parts.push(p.gender);
      if (age) parts.push(age);
      if (height) parts.push('身高' + height);
      if (p.role) parts.push('身份为' + p.role);
      const head = parts.length ? parts.join('，') + '。' : '';
      const tail = p.traits ? (head ? '\n' : '') + '特征：' + p.traits : '';
      return '【基础信息】\n' + head + tail;
    }

    // Both 'yaml' and 'hybrid' use clean YAML for structured basic info
    return '基础信息:\n' + fields.map(([k, v]) => '  ' + k + ': ' + v).join('\n');
  }

  function isYamlLike(content) {
    const first = String(content || '').trim().split(/\r?\n/)[0].trim();
    return /^[^\s:#]+:\s*$/.test(first) || /^[^\s:#]+:\s+\S/.test(first);
  }

  function formatEntryForStyle(title, content, outputFormat) {
    const c = String(content || '').trim();
    if (!c) return '';
    const first = c.split(/\r?\n/)[0].trim();
    const alreadyStructured = /^#/.test(first) || /^【.+】/.test(first) || /^[^\s:#]+:\s*$/.test(first);

    if (outputFormat === 'yaml') {
      if (isYamlLike(c)) return c;
      const lines = c.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length === 1) return title + ': ' + lines[0];
      return title + ':\n' + lines.map(l => '  - ' + l).join('\n');
    }

    if (outputFormat === 'prose') {
      if (alreadyStructured) return c;
      return '【' + title + '】\n' + c;
    }

    // 'hybrid': preserve YAML/heading entries verbatim; cleanly format plain prose with bracket header
    if (alreadyStructured) return c;
    return '【' + title + '】\n' + c;
  }

  // Detect conflicts among selected entries (returns [{ id, label, keys, titles }])
  function detectConflicts(selectedSet) {
    const selectedOrder = [...selectedSet];
    const titleToKeys = new Map();
    for (const k of selectedOrder) {
      const { title } = parseKey(k);
      if (!titleToKeys.has(title)) titleToKeys.set(title, []);
      titleToKeys.get(title).push(k);
    }

    const conflicts = [];
    for (const g of CONFLICT_GROUPS) {
      const matched = [];
      for (const t of g.items) {
        const ks = titleToKeys.get(t);
        if (ks && ks.length) {
          for (const k of ks) matched.push({ key: k, title: t, order: selectedOrder.indexOf(k) });
        }
      }
      if (matched.length >= 2) {
        matched.sort((a, b) => a.order - b.order);
        conflicts.push({
          id: g.id,
          label: g.label,
          keys: matched.map(m => m.key),
          titles: matched.map(m => m.title),
          latestKey: matched[matched.length - 1].key,
        });
      }
    }
    return conflicts;
  }

  function resolveConflictsKeepLatest(selectedSet) {
    const conflicts = detectConflicts(selectedSet);
    const next = new Set(selectedSet);
    for (const c of conflicts) {
      for (const k of c.keys) {
        if (k !== c.latestKey) next.delete(k);
      }
    }
    return next;
  }

  function parseRgb(colorStr) {
    const s = String(colorStr || '').trim();
    let m = s.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      const hex = m[1];
      if (hex.length === 3) {
        return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16)];
      }
      return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    }
    return null;
  }

  function inferThemeFromTextColor(colorStr, hasLightGlassTokens) {
    if (hasLightGlassTokens) return 'light';
    const rgb = parseRgb(colorStr);
    if (!rgb) return 'light';
    const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    return lum < 0.55 ? 'light' : 'dark';
  }

  function createDefaultStore() {
    return {
      v: 5,
      outputFormat: 'hybrid', // 'hybrid' | 'yaml' | 'prose'
      defaultPresetId: '',
      recentBooks: [],
      customCategories: ['我的自定义'],
      customEntries: [], // [{ id, cat, title, content, isRule? }]
      builtinEdits: {},
      profile: createEmptyProfile(),
      presets: [], // [{ id, label, items, profile, outputFormat }]
      lastItems: [],
      personaBackup: null,
    };
  }

  function normalizeStore(raw) {
    const base = createDefaultStore();
    if (!raw || typeof raw !== 'object') return base;
    if (raw.outputFormat === 'yaml' || raw.outputFormat === 'prose' || raw.outputFormat === 'hybrid') {
      base.outputFormat = raw.outputFormat;
    }
    if (typeof raw.defaultPresetId === 'string') base.defaultPresetId = raw.defaultPresetId;
    if (Array.isArray(raw.recentBooks)) {
      base.recentBooks = [...new Set(raw.recentBooks.filter(x => typeof x === 'string' && x.trim()))].slice(0, 12);
    }
    if (Array.isArray(raw.customCategories)) {
      const cats = [...new Set(raw.customCategories.map(x => String(x || '').trim()).filter(Boolean))];
      base.customCategories = cats.length ? cats : ['我的自定义'];
    }
    if (Array.isArray(raw.customEntries)) {
      const seen = new Set();
      for (const e of raw.customEntries) {
        if (!e || typeof e.title !== 'string' || !e.title.trim()) continue;
        const title = e.title.trim();
        if (seen.has(title)) continue;
        seen.add(title);
        const cat = typeof e.cat === 'string' && e.cat.trim() ? e.cat.trim() : base.customCategories[0];
        if (!base.customCategories.includes(cat)) base.customCategories.push(cat);
        base.customEntries.push({
          id: typeof e.id === 'string' && e.id ? e.id : 'c_' + Date.now().toString(36) + '_' + seen.size,
          cat,
          title,
          content: typeof e.content === 'string' ? e.content : '',
          isRule: Boolean(e.isRule),
        });
      }
    }
    if (raw.builtinEdits && typeof raw.builtinEdits === 'object') {
      for (const [k, v] of Object.entries(raw.builtinEdits)) {
        if (typeof k === 'string' && typeof v === 'string') base.builtinEdits[k] = v;
      }
    }
    if (raw.profile) base.profile = normalizeProfile(raw.profile);
    if (Array.isArray(raw.presets)) {
      for (let i = 0; i < raw.presets.length; i++) {
        const p = raw.presets[i];
        if (!p || typeof p !== 'object' || !Array.isArray(p.items)) continue;
        const items = p.items
          .filter(it => it && typeof it.book === 'string' && typeof it.title === 'string' && it.book && it.title)
          .map(it => ({ book: it.book, title: it.title }));
        base.presets.push({
          id: typeof p.id === 'string' && p.id ? p.id : 'p_' + Date.now().toString(36) + '_' + i,
          label: typeof p.label === 'string' && p.label.trim() ? p.label.trim() : '方案 ' + (i + 1),
          items,
          profile: p.profile ? normalizeProfile(p.profile) : createEmptyProfile(),
          outputFormat: (p.outputFormat === 'yaml' || p.outputFormat === 'prose' || p.outputFormat === 'hybrid') ? p.outputFormat : 'hybrid',
        });
      }
    }
    const lastSrc = Array.isArray(raw.lastItems) ? raw.lastItems : raw.lastPersonaItems;
    if (Array.isArray(lastSrc)) {
      base.lastItems = lastSrc
        .filter(it => it && typeof it.book === 'string' && typeof it.title === 'string' && it.book && it.title)
        .map(it => ({ book: it.book, title: it.title }));
    }
    if (raw.personaBackup && typeof raw.personaBackup === 'object' && typeof raw.personaBackup.description === 'string') {
      base.personaBackup = {
        name: String(raw.personaBackup.name || ''),
        description: raw.personaBackup.description,
        savedAt: Number(raw.personaBackup.savedAt) || 0,
      };
    }
    return base;
  }

  function getBuiltinCategories() {
    const cats = [];
    for (const item of BUILTIN_LIBRARY) {
      if (!cats.includes(item.cat)) cats.push(item.cat);
    }
    return cats;
  }

  function getAllCategories(store) {
    const builtin = getBuiltinCategories();
    const custom = (store.customCategories || []).filter(c => !builtin.includes(c));
    return [...builtin, ...custom];
  }

  function getEntriesForCategory(store, cat) {
    const out = [];
    for (const item of BUILTIN_LIBRARY) {
      if (item.cat !== cat) continue;
      const content = Object.prototype.hasOwnProperty.call(store.builtinEdits, item.title)
        ? store.builtinEdits[item.title]
        : item.content;
      out.push({ book: LIB_BOOK, cat, title: item.title, content, isRule: Boolean(item.isRule), isCustom: false });
    }
    for (const e of store.customEntries || []) {
      if (e.cat !== cat) continue;
      out.push({ book: LIB_BOOK, cat, title: e.title, content: e.content, isRule: Boolean(e.isRule), isCustom: true });
    }
    return out;
  }

  function searchAllLibraryEntries(store, query) {
    const q = normalizeName(query).toLocaleLowerCase();
    if (!q) return [];
    const out = [];
    for (const cat of getAllCategories(store)) {
      for (const item of getEntriesForCategory(store, cat)) {
        if (normalizeName(item.title).toLocaleLowerCase().includes(q) || normalizeName(item.content).toLocaleLowerCase().includes(q)) {
          out.push(item);
        }
      }
    }
    return out;
  }

  function findLibraryEntry(store, title) {
    for (const e of store.customEntries || []) {
      if (e.title === title) return { cat: e.cat, title: e.title, content: e.content, isRule: Boolean(e.isRule), isCustom: true };
    }
    for (const item of BUILTIN_LIBRARY) {
      if (item.title === title) {
        const content = Object.prototype.hasOwnProperty.call(store.builtinEdits, item.title)
          ? store.builtinEdits[item.title]
          : item.content;
        return { cat: item.cat, title: item.title, content, isRule: Boolean(item.isRule), isCustom: false };
      }
    }
    return null;
  }

  function filterWorldbookNames(bookNames, query) {
    const q = normalizeName(query).toLocaleLowerCase();
    if (!q) return bookNames;
    return bookNames.filter(name => normalizeName(name).toLocaleLowerCase().includes(q));
  }

  function organizeWorldbookEntries(entries, currentChar, showAllChars, query) {
    const q = normalizeName(query).toLocaleLowerCase();
    const list = (entries || [])
      .filter(e => e && typeof e.name === 'string' && e.name.trim())
      .filter(e => !q || normalizeName(e.name).toLocaleLowerCase().includes(q) || normalizeName(e.content || '').toLocaleLowerCase().includes(q));

    const bracketCount = list.filter(e => Boolean(parseBracketTitle(e.name))).length;
    if (list.length >= 3 && bracketCount / list.length >= 0.4) {
      const current = [], common = [], others = [];
      for (const e of list) {
        const b = parseBracketTitle(e.name);
        if (b && b.tag === '模板') continue;
        if (matchesChar(e.name, currentChar)) current.push(e);
        else if ((b && b.tag === '通用') || /^通用[·\-\s_:：/]/.test(e.name)) common.push(e);
        else others.push(e);
      }
      const sections = [];
      if (current.length) sections.push({ cat: sanitizeCharName(currentChar) || '当前角色', stripBracket: true, items: current });
      if (common.length) sections.push({ cat: '通用', stripBracket: true, items: common });
      if (showAllChars && others.length) sections.push({ cat: '其他角色', stripBracket: false, items: others });
      return { kind: 'if', hasHiddenOthers: !showAllChars && others.length > 0, hiddenCount: others.length, sections };
    }

    const prefixCounts = new Map();
    for (const e of list) {
      const m = e.name.match(/^([^·]{1,10})·(.+)$/);
      if (m) prefixCounts.set(m[1].trim(), (prefixCounts.get(m[1].trim()) || 0) + 1);
    }
    let groupedHits = 0;
    for (const c of prefixCounts.values()) if (c >= 2) groupedHits += c;

    if (groupedHits >= 4) {
      const buckets = new Map();
      for (const e of list) {
        const m = e.name.match(/^([^·]{1,10})·(.+)$/);
        const cat = (m && (prefixCounts.get(m[1].trim()) || 0) >= 2) ? m[1].trim() : '其他';
        if (!buckets.has(cat)) buckets.set(cat, []);
        buckets.get(cat).push(e);
      }
      const sections = [];
      for (const [cat, items] of buckets.entries()) {
        if (cat !== '其他') sections.push({ cat, stripPrefix: true, items });
      }
      if (buckets.has('其他')) sections.push({ cat: '其他', stripPrefix: false, items: buckets.get('其他') });
      return { kind: 'prefix', hasHiddenOthers: false, hiddenCount: 0, sections };
    }

    return { kind: 'flat', hasHiddenOthers: false, hiddenCount: 0, sections: list.length ? [{ cat: '', stripPrefix: false, items: list }] : [] };
  }

  function displayEntryLabel(name, section) {
    if (section?.stripBracket) {
      const b = parseBracketTitle(name);
      if (b && b.shortTitle) return b.shortTitle;
    }
    if (section?.stripPrefix && section.cat && name.startsWith(section.cat + '·')) {
      const s = name.slice(section.cat.length + 1).trim();
      if (s) return s;
    }
    return name;
  }

  function assembleOutput(selectedSet, store, wbContentMap, outputFormatOverride) {
    const fmt = outputFormatOverride || store.outputFormat || 'hybrid';
    const body = [];
    const rules = [];
    const redlines = [];
    const wiPayload = [];

    const profileBlock = formatProfileBlock(store.profile, fmt);
    if (profileBlock) body.push(profileBlock);

    for (const k of selectedSet) {
      const { book, title } = parseKey(k);
      if (!book || !title) continue;
      if (book === LIB_BOOK) {
        const entry = findLibraryEntry(store, title);
        if (!entry) continue;
        const text = String(entry.content || '').trim();
        if (!text) continue;
        const formatted = formatEntryForStyle(title, text, fmt);
        wiPayload.push({ book: LIB_BOOK, title, text: formatted, isRule: entry.isRule });
        if (entry.isRule) rules.push(formatted);
        else body.push(formatted);
      } else {
        const text = String(wbContentMap?.[book]?.[title] || '').trim();
        wiPayload.push({ book, title });
        if (!text) continue;
        const formatted = formatEntryForStyle(title, text, fmt);
        if (title === '红线') redlines.push(formatted);
        else if (/^(写作约束|演绎准则)/.test(title)) rules.push(formatted);
        else body.push(formatted);
      }
    }

    const blocks = [];
    if (body.length) blocks.push('<USER人设>\n' + body.join('\n\n') + '\n</USER人设>');
    if (rules.length) blocks.push('<USER写作规则>\n' + rules.join('\n\n') + '\n</USER写作规则>');
    if (redlines.length) blocks.push('<USER红线>\n' + redlines.join('\n\n') + '\n</USER红线>');

    return {
      text: blocks.join('\n\n'),
      profileText: profileBlock,
      wi: wiPayload,
      count: wiPayload.length + (profileBlock ? 1 : 0),
    };
  }

  function mergeIntoPersonaDescription(existingDesc, generatedBlock, replaceAll) {
    const block = String(generatedBlock || '').trim();
    if (replaceAll) return block;
    const cleaned = String(existingDesc || '')
      .replace(/\n*<USER人设>[\s\S]*?<\/USER人设>/g, '')
      .replace(/\n*<USER写作规则>[\s\S]*?<\/USER写作规则>/g, '')
      .replace(/\n*<USER红线>[\s\S]*?<\/USER红线>/g, '')
      .trim();
    if (!block) return cleaned;
    if (!cleaned) return block;
    return cleaned + '\n\n' + block;
  }

  function parseSavedChatPicker(raw) {
    let obj = raw;
    if (typeof obj === 'string') {
      try { obj = JSON.parse(obj); } catch (_) { obj = null; }
    }
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.wi)) {
      return { hasSaved: false, items: [], profile: null };
    }
    const items = [];
    const seen = new Set();
    for (const it of obj.wi) {
      if (!it || typeof it !== 'object') continue;
      const book = typeof it.book === 'string' && it.book ? it.book : (typeof it.text === 'string' ? LIB_BOOK : '');
      const title = typeof it.title === 'string' ? it.title : '';
      if (!book || !title) continue;
      const k = itemKey(book, title);
      if (seen.has(k)) continue;
      seen.add(k);
      items.push({ book, title });
    }
    return { hasSaved: true, items, profile: obj.profile ? normalizeProfile(obj.profile) : null };
  }

  function buildWorldbookEntry(name, content) {
    return {
      name,
      enabled: true,
      content,
      strategy: {
        type: 'selective',
        keys: [],
        keys_secondary: { logic: 'and_any', keys: [] },
        scan_depth: 'same_as_global',
      },
      position: { type: 'after_character_definition', role: 'system', depth: 4, order: 100 },
      probability: 100,
      recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
      effect: { sticky: null, cooldown: null, delay: null },
    };
  }

  function buildOpeningWorldbookEntries() {
    return [
      {
        uid: 0,
        name: '【常开】User人设总控',
        enabled: true,
        content: OPENING_BODY_EJS,
        strategy: {
          type: 'constant',
          keys: [],
          keys_secondary: { logic: 'and_any', keys: [] },
          scan_depth: 'same_as_global',
        },
        // order: 99999 stays cleanly outside author worldbook wrappers (even those ending at 999 or 9999)
        position: { type: 'after_character_definition', role: 'system', depth: 4, order: 99999 },
        probability: 100,
        recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
        effect: { sticky: null, cooldown: null, delay: null },
      },
      {
        uid: 1,
        name: '【常开】User红线',
        enabled: true,
        content: OPENING_REDLINE_EJS,
        strategy: {
          type: 'constant',
          keys: [],
          keys_secondary: { logic: 'and_any', keys: [] },
          scan_depth: 'same_as_global',
        },
        position: { type: 'at_depth', role: 'system', depth: 1, order: 1 },
        probability: 100,
        recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
        effect: { sticky: null, cooldown: null, delay: null },
      },
    ];
  }

  const Core = {
    APP_VERSION,
    LIB_BOOK,
    BUILTIN_LIBRARY,
    CONFLICT_GROUPS,
    itemKey,
    parseKey,
    normalizeName,
    sanitizeCharName,
    matchesChar,
    formatAge,
    formatHeight,
    createEmptyProfile,
    normalizeProfile,
    hasProfileData,
    formatProfileBlock,
    formatEntryForStyle,
    detectConflicts,
    resolveConflictsKeepLatest,
    inferThemeFromTextColor,
    createDefaultStore,
    normalizeStore,
    getBuiltinCategories,
    getAllCategories,
    getEntriesForCategory,
    searchAllLibraryEntries,
    findLibraryEntry,
    filterWorldbookNames,
    organizeWorldbookEntries,
    displayEntryLabel,
    assembleOutput,
    mergeIntoPersonaDescription,
    parseSavedChatPicker,
    buildWorldbookEntry,
    buildOpeningWorldbookEntries,
  };

  if (typeof globalThis.__UPP_EXPORT__ === 'function') {
    globalThis.__UPP_EXPORT__(Core);
    return;
  }

  // =========================
  // Host Runtime Wiring
  // =========================

  const Env = (function () {
    let pwin = window;
    let pdoc = document;
    try {
      if (window.parent && window.parent.document) { pwin = window.parent; pdoc = pwin.document; }
    } catch (_) {}
    return { win: window, pwin, pdoc };
  })();

  function getApi(name) {
    const owners = [window, globalThis, Env.pwin, window.TavernHelper, Env.pwin.TavernHelper, window.SillyTavern, Env.pwin.SillyTavern];
    for (const owner of owners) {
      try { if (owner && owner[name] != null) return { value: owner[name], owner }; } catch (_) {}
    }
    return null;
  }

  function getFn(name) {
    const api = getApi(name);
    return api && typeof api.value === 'function' ? api.value.bind(api.owner) : null;
  }

  function getStContext() {
    try { return getApi('SillyTavern')?.value?.getContext?.() || null; } catch (_) { return null; }
  }

  function notify(msg, type) {
    const t = Env.pwin.toastr || window.toastr;
    const level = type || 'info';
    if (t && typeof t[level] === 'function') {
      try { t[level](msg); return; } catch (_) {}
    }
    console.log('[User人设]', msg);
  }

  function copyToClipboard(text) {
    const copyFn = getApi('builtin')?.value?.copyText;
    if (typeof copyFn === 'function') {
      try { copyFn(text); return Promise.resolve(true); } catch (_) {}
    }
    if (Env.pwin.navigator?.clipboard?.writeText) {
      return Env.pwin.navigator.clipboard.writeText(text).then(() => true, () => false);
    }
    return Promise.resolve(false);
  }

  function loadStore() {
    try {
      const raw = Env.pwin.localStorage?.getItem(STORE_KEY) || Env.pwin.localStorage?.getItem(LEGACY_STORE_KEY);
      if (raw) return normalizeStore(JSON.parse(raw));
    } catch (_) {}
    return createDefaultStore();
  }

  function saveStore(store) {
    try { Env.pwin.localStorage?.setItem(STORE_KEY, JSON.stringify(store)); } catch (_) {}
  }

  function detectHostTheme() {
    try {
      const rootStyle = Env.pwin.getComputedStyle(Env.pdoc.documentElement);
      const hasIgLight = Boolean(rootStyle.getPropertyValue('--ig-panel-bg').trim());
      const bodyColor = Env.pwin.getComputedStyle(Env.pdoc.body || Env.pdoc.documentElement).color;
      const smartColor = rootStyle.getPropertyValue('--SmartThemeBodyColor').trim();
      return inferThemeFromTextColor(bodyColor || smartColor, hasIgLight);
    } catch (_) {
      return 'light';
    }
  }

  function readCurrentCharName() {
    const ctx = getStContext();
    if (ctx && (ctx.characterId === undefined || ctx.characterId === null) && !ctx.groupId) return '';
    const fn = getFn('getCurrentCharacterName');
    if (fn) {
      try { const n = sanitizeCharName(fn()); if (n) return n; } catch (_) {}
    }
    if (ctx && ctx.characterId != null && typeof ctx.name2 === 'string') return sanitizeCharName(ctx.name2);
    return '';
  }

  function readCurrentPersona() {
    const fn = getFn('getPersona');
    if (!fn) return null;
    try { return fn('current') || null; } catch (_) { return null; }
  }

  function listPersonaNames() {
    const fn = getFn('getPersonaNames');
    if (!fn) return [];
    try { const r = fn(); return Array.isArray(r) ? r : []; } catch (_) { return []; }
  }

  async function replaceCurrentPersonaDesc(nextDesc) {
    const fn = getFn('replacePersona');
    if (!fn) throw new Error('当前酒馆助手版本不支持写入用户人设');
    await Promise.resolve(fn('current', { description: nextDesc }, { render: 'immediate' }));
  }

  async function createNewPersonaWithDesc(name, desc) {
    const fn = getFn('createPersona');
    if (!fn) throw new Error('当前酒馆助手版本不支持新建用户人设');
    const ok = await Promise.resolve(fn(name, { description: desc }, { render: 'immediate' }));
    if (!ok) throw new Error('新建失败（可能已存在同名用户人设）');
  }

  function hasActiveChat() {
    const ctx = getStContext();
    if (!ctx) return true;
    return Boolean(ctx.chatId || ctx.groupId || ctx.characterId != null);
  }

  function readChatPickerVar() {
    const fn = getFn('getVariables');
    if (fn) {
      try { const v = fn({ type: 'chat' }); if (v && typeof v === 'object') return v[VAR_KEY]; } catch (_) {}
    }
    return getStContext()?.chatMetadata?.variables?.[VAR_KEY];
  }

  async function writeChatPickerVar(payload) {
    const insertFn = getFn('insertOrAssignVariables');
    if (insertFn) {
      await Promise.resolve(insertFn({ [VAR_KEY]: payload }, { type: 'chat' }));
      return;
    }
    const updateFn = getFn('updateVariablesWith');
    if (updateFn) {
      await Promise.resolve(updateFn(vars => ({ ...(vars || {}), [VAR_KEY]: payload }), { type: 'chat' }));
      return;
    }
    throw new Error('未找到聊天变量接口');
  }

  async function listHostWorldbooks() {
    const fn = getFn('getWorldbookNames');
    if (!fn) return [];
    try {
      const names = await Promise.resolve(fn());
      return Array.isArray(names) ? names.filter(n => typeof n === 'string' && n && n !== OPENING_BOOK) : [];
    } catch (_) {
      return [];
    }
  }

  async function listGlobalWorldbooks() {
    const fn = getFn('getGlobalWorldbookNames');
    if (!fn) return [];
    try {
      const names = await Promise.resolve(fn());
      return Array.isArray(names) ? names : [];
    } catch (_) {
      return [];
    }
  }

  async function loadWorldbookEntries(bookName) {
    const fn = getFn('getWorldbook');
    if (!fn) return [];
    try {
      const entries = await Promise.resolve(fn(bookName));
      return Array.isArray(entries) ? entries : [];
    } catch (_) {
      return [];
    }
  }

  async function ensureOpeningBookSilent() {
    const namesFn = getFn('getWorldbookNames');
    const createFn = getFn('createWorldbook');
    const globalFn = getFn('getGlobalWorldbookNames');
    const rebindFn = getFn('rebindGlobalWorldbooks');
    if (!namesFn || !createFn || !globalFn || !rebindFn) return;
    try {
      const all = await Promise.resolve(namesFn());
      if (Array.isArray(all) && !all.includes(OPENING_BOOK)) {
        await Promise.resolve(createFn(OPENING_BOOK, buildOpeningWorldbookEntries()));
      }
      const globals = await Promise.resolve(globalFn());
      if (Array.isArray(globals) && !globals.includes(OPENING_BOOK)) {
        await Promise.resolve(rebindFn([...globals, OPENING_BOOK]));
      }
    } catch (err) {
      console.warn('[User人设] 自动启用总控世界书跳过', err);
    }
  }

  async function createEntryInWorldbook(bookName, entry) {
    const fn = getFn('createWorldbookEntries');
    if (!fn) throw new Error('缺少写入世界书接口');
    await Promise.resolve(fn(bookName, [entry], { render: 'debounced' }));
  }

  async function updateEntryInWorldbook(bookName, oldTitle, newTitle, newContent) {
    const fn = getFn('updateWorldbookWith');
    if (!fn) throw new Error('缺少更新世界书接口');
    await Promise.resolve(fn(bookName, entries => entries.map(e => (e && e.name === oldTitle ? { ...e, name: newTitle, content: newContent } : e)), { render: 'debounced' }));
  }

  // =========================
  // Cleanup Previous Instance
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

  function listen(target, eventName, handler, options) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(eventName, handler, options);
    cleanup.push(() => { try { target.removeEventListener(eventName, handler, options); } catch (_) {} });
  }

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  // =========================
  // Adaptive iOS Liquid Glass UI
  // =========================

  const host = Env.pdoc.createElement('div');
  host.id = APP_ID;
  host.dataset.version = APP_VERSION;
  const shadow = host.attachShadow({ mode: 'open' });

  const STYLE = `
    :host {
      all: initial;
      font-family: "PingFang SC", "PingFang TC", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Microsoft YaHei", system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
      --upp-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

    .upp-backdrop[data-theme="light"] {
      --upp-veil: rgba(18, 24, 38, 0.26);
      --upp-shell-bg: linear-gradient(165deg, rgba(255, 255, 255, 0.94) 0%, rgba(244, 247, 252, 0.90) 100%);
      --upp-shell-border: rgba(255, 255, 255, 0.90);
      --upp-shell-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.96), 0 24px 64px rgba(15, 23, 42, 0.18), 0 4px 16px rgba(15, 23, 42, 0.06);
      --upp-divider: rgba(27, 30, 40, 0.08);
      --upp-card-bg: rgba(255, 255, 255, 0.68);
      --upp-card-border: rgba(255, 255, 255, 0.88);
      --upp-card-shadow: 0 2px 10px rgba(15, 23, 42, 0.03), inset 0 1px 0 rgba(255, 255, 255, 0.90);
      --upp-tx: #1b1e28;
      --upp-tx2: rgba(27, 30, 40, 0.62);
      --upp-tx3: rgba(27, 30, 40, 0.45);
      --upp-track-bg: rgba(27, 30, 40, 0.055);
      --upp-seg-active-bg: #ffffff;
      --upp-seg-active-shadow: 0 2px 8px rgba(15, 23, 42, 0.09), 0 0.5px 1px rgba(15, 23, 42, 0.05);
      --upp-chip-bg: rgba(255, 255, 255, 0.88);
      --upp-chip-hover: #ffffff;
      --upp-chip-border: rgba(27, 30, 40, 0.10);
      --upp-chip-tx: #262b38;
      --upp-accent: #3a7bd5;
      --upp-accent-bg: rgba(58, 123, 213, 0.13);
      --upp-accent-border: rgba(58, 123, 213, 0.46);
      --upp-accent-tx: #1b52a4;
      --upp-badge-bg: rgba(58, 123, 213, 0.12);
      --upp-badge-tx: #245db3;
      --upp-btn-bg: rgba(27, 30, 40, 0.055);
      --upp-btn-hover: rgba(27, 30, 40, 0.10);
      --upp-btn-border: rgba(27, 30, 40, 0.08);
      --upp-btn-tx: #2c3140;
      --upp-primary-bg: linear-gradient(180deg, #4b8ae2 0%, #3472cb 100%);
      --upp-primary-hover: linear-gradient(180deg, #5793e8 0%, #3d7bd4 100%);
      --upp-primary-shadow: 0 4px 14px rgba(58, 123, 213, 0.30), inset 0 1px 0 rgba(255, 255, 255, 0.30);
      --upp-foot-bg: rgba(255, 255, 255, 0.70);
      --upp-inspect-bg: rgba(247, 250, 255, 0.94);
      --upp-input-bg: rgba(255, 255, 255, 0.92);
      --upp-input-border: rgba(27, 30, 40, 0.14);
      --upp-warn-bg: rgba(217, 130, 43, 0.11);
      --upp-warn-border: rgba(217, 130, 43, 0.50);
      --upp-warn-tx: #94510c;
      --upp-danger-tx: #b52b2b;
      --upp-scroll: rgba(27, 30, 40, 0.16);
      --upp-handle: rgba(27, 30, 40, 0.16);
    }

    .upp-backdrop[data-theme="dark"] {
      --upp-veil: rgba(6, 8, 14, 0.62);
      --upp-shell-bg: linear-gradient(165deg, rgba(28, 31, 41, 0.94) 0%, rgba(20, 22, 30, 0.96) 100%);
      --upp-shell-border: rgba(255, 255, 255, 0.13);
      --upp-shell-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 24px 64px rgba(0, 0, 0, 0.52);
      --upp-divider: rgba(255, 255, 255, 0.08);
      --upp-card-bg: rgba(255, 255, 255, 0.045);
      --upp-card-border: rgba(255, 255, 255, 0.08);
      --upp-card-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
      --upp-tx: #eff2f8;
      --upp-tx2: rgba(239, 242, 248, 0.64);
      --upp-tx3: rgba(239, 242, 248, 0.45);
      --upp-track-bg: rgba(255, 255, 255, 0.06);
      --upp-seg-active-bg: rgba(255, 255, 255, 0.13);
      --upp-seg-active-shadow: 0 2px 8px rgba(0, 0, 0, 0.26), inset 0 1px 0 rgba(255, 255, 255, 0.14);
      --upp-chip-bg: rgba(255, 255, 255, 0.06);
      --upp-chip-hover: rgba(255, 255, 255, 0.11);
      --upp-chip-border: rgba(255, 255, 255, 0.10);
      --upp-chip-tx: #e3e7f0;
      --upp-accent: #6ea2f8;
      --upp-accent-bg: rgba(110, 162, 248, 0.18);
      --upp-accent-border: rgba(124, 174, 255, 0.56);
      --upp-accent-tx: #eaf2ff;
      --upp-badge-bg: rgba(110, 162, 248, 0.18);
      --upp-badge-tx: #b8d3ff;
      --upp-btn-bg: rgba(255, 255, 255, 0.07);
      --upp-btn-hover: rgba(255, 255, 255, 0.13);
      --upp-btn-border: rgba(255, 255, 255, 0.10);
      --upp-btn-tx: #e5e9f2;
      --upp-primary-bg: linear-gradient(180deg, #5691eb 0%, #3d79d6 100%);
      --upp-primary-hover: linear-gradient(180deg, #649cf0 0%, #4984df 100%);
      --upp-primary-shadow: 0 4px 16px rgba(61, 121, 214, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.22);
      --upp-foot-bg: rgba(255, 255, 255, 0.04);
      --upp-inspect-bg: rgba(32, 36, 48, 0.96);
      --upp-input-bg: rgba(0, 0, 0, 0.28);
      --upp-input-border: rgba(255, 255, 255, 0.12);
      --upp-warn-bg: rgba(234, 169, 79, 0.15);
      --upp-warn-border: rgba(234, 169, 79, 0.55);
      --upp-warn-tx: #f6d19a;
      --upp-danger-tx: #fbb8b8;
      --upp-scroll: rgba(255, 255, 255, 0.16);
      --upp-handle: rgba(255, 255, 255, 0.22);
    }

    @keyframes upp-fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes upp-pop-in { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
    @keyframes upp-sheet-up { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: translateY(0); } }

    .upp-backdrop {
      position: fixed; inset: 0; z-index: 2147483000;
      background: var(--upp-veil);
      display: flex; align-items: center; justify-content: center; padding: 16px;
      color: var(--upp-tx); animation: upp-fade-in 0.14s var(--upp-ease);
    }
    .upp-backdrop[hidden] { display: none; }

    .upp-modal {
      width: min(590px, calc(100vw - 32px));
      height: min(650px, 84dvh);
      background: var(--upp-shell-bg);
      backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      contain: layout paint;
      color: var(--upp-tx); border: 1px solid var(--upp-shell-border); border-radius: 22px;
      box-shadow: var(--upp-shell-shadow); display: flex; flex-direction: column; overflow: hidden;
      animation: upp-pop-in 0.16s var(--upp-ease);
    }

    .upp-grab { display: none; width: 36px; height: 4px; border-radius: 999px; background: var(--upp-handle); margin: 8px auto 0; flex-shrink: 0; }

    .upp-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 16px 10px; flex-shrink: 0; }
    .upp-head-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .upp-title { font-size: 16px; font-weight: 600; color: var(--upp-tx); white-space: nowrap; }
    .upp-char-tag {
      font-size: 12px; font-weight: 500; line-height: 1; padding: 5px 10px; border-radius: 999px;
      background: var(--upp-badge-bg); color: var(--upp-badge-tx);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;
    }
    .upp-char-tag[hidden] { display: none; }
    .upp-close-btn {
      width: 30px; height: 30px; border-radius: 999px;
      border: 1px solid var(--upp-btn-border); background: var(--upp-btn-bg); color: var(--upp-tx2);
      font-size: 17px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0;
    }
    .upp-close-btn:hover { background: var(--upp-btn-hover); color: var(--upp-tx); }

    .upp-tabs-wrap { padding: 0 16px 10px; flex-shrink: 0; border-bottom: 1px solid var(--upp-divider); }
    .upp-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; padding: 3px; border-radius: 13px; background: var(--upp-track-bg); }
    .upp-tab {
      height: 33px; border-radius: 10px; border: none; background: transparent; color: var(--upp-tx2);
      font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
      cursor: pointer; white-space: nowrap;
      transition: background 0.16s var(--upp-ease), color 0.16s ease, box-shadow 0.16s var(--upp-ease);
    }
    .upp-tab:hover { color: var(--upp-tx); }
    .upp-tab.is-active { background: var(--upp-seg-active-bg); color: var(--upp-tx); font-weight: 600; box-shadow: var(--upp-seg-active-shadow); }
    .upp-tab-count { font-size: 11px; font-weight: 600; line-height: 1; padding: 2px 6px; border-radius: 999px; background: var(--upp-badge-bg); color: var(--upp-badge-tx); }

    .upp-toolbar {
      padding: 10px 16px 9px; border-bottom: 1px solid var(--upp-divider);
      display: flex; flex-direction: column; gap: 8px; flex-shrink: 0;
    }
    .upp-toolbar:empty { display: none; }
    .upp-toolbar-row { display: flex; align-items: center; gap: 7px; }

    .upp-cat-strip {
      display: flex; align-items: center; gap: 6px; overflow-x: auto; scrollbar-width: none; padding-bottom: 1px;
    }
    .upp-cat-strip::-webkit-scrollbar { display: none; }
    .upp-cat-pill {
      height: 29px; padding: 0 11px; border-radius: 999px; flex-shrink: 0;
      border: 1px solid var(--upp-chip-border); background: var(--upp-chip-bg); color: var(--upp-tx2);
      font-size: 12px; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;
    }
    .upp-cat-pill:hover { background: var(--upp-chip-hover); color: var(--upp-tx); }
    .upp-cat-pill.is-active { background: var(--upp-accent-bg); border-color: var(--upp-accent-border); color: var(--upp-accent-tx); font-weight: 600; }

    .upp-body {
      flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
      padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 10px;
      scrollbar-width: thin; scrollbar-color: var(--upp-scroll) transparent;
    }
    .upp-body > * { flex-shrink: 0; }
    .upp-body::-webkit-scrollbar { width: 5px; }
    .upp-body::-webkit-scrollbar-track { background: transparent; }
    .upp-body::-webkit-scrollbar-thumb { background: var(--upp-scroll); border-radius: 999px; }

    .upp-select, .upp-search-input, .upp-input, .upp-textarea {
      width: 100%; border: 1px solid var(--upp-input-border); background: var(--upp-input-bg); color: var(--upp-tx);
      border-radius: 10px; font: inherit; font-size: 13px; outline: none;
    }
    .upp-select { height: 34px; padding: 0 10px; flex: 1 1 auto; min-width: 0; cursor: pointer; }
    .upp-search-input { height: 34px; padding: 0 11px; flex: 1 1 auto; min-width: 0; }
    .upp-input { padding: 8px 11px; }
    .upp-textarea { padding: 8px 11px; resize: vertical; min-height: 84px; line-height: 1.5; }
    .upp-textarea.is-tall { min-height: 140px; }
    .upp-search-input::placeholder, .upp-input::placeholder, .upp-textarea::placeholder { color: var(--upp-tx3); }
    .upp-select:focus, .upp-search-input:focus, .upp-input:focus, .upp-textarea:focus {
      border-color: var(--upp-accent-border); box-shadow: 0 0 0 3px var(--upp-accent-bg);
    }

    .upp-warn-strip {
      border: 1px solid var(--upp-warn-border); background: var(--upp-warn-bg); color: var(--upp-warn-tx);
      border-radius: 11px; padding: 7px 11px; font-size: 12px; line-height: 1.4;
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }

    .upp-group {
      background: var(--upp-card-bg); border: 1px solid var(--upp-card-border);
      box-shadow: var(--upp-card-shadow); border-radius: 15px; padding: 11px 12px;
      display: flex; flex-direction: column; gap: 9px;
    }
    .upp-group-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .upp-group-title { font-size: 13px; font-weight: 600; color: var(--upp-tx); display: inline-flex; align-items: center; gap: 6px; }
    .upp-group-badge { font-size: 11px; font-weight: 600; color: var(--upp-badge-tx); background: var(--upp-badge-bg); border-radius: 999px; padding: 1px 7px; }

    /* Dual-zone Chip: tap text to READ content, tap right circle to CHECK! */
    .upp-chips { display: flex; flex-wrap: wrap; gap: 7px; }
    .upp-chip-wrap {
      display: inline-flex; align-items: center; border-radius: 11px; overflow: hidden;
      border: 1px solid var(--upp-chip-border); background: var(--upp-chip-bg);
      transition: background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
    }
    .upp-chip-wrap:hover { background: var(--upp-chip-hover); }
    .upp-chip-wrap.is-selected { background: var(--upp-accent-bg); border-color: var(--upp-accent-border); }
    .upp-chip-wrap.is-conflict { background: var(--upp-warn-bg); border-color: var(--upp-warn-border); }
    .upp-chip-wrap.is-inspected { box-shadow: 0 0 0 2px var(--upp-accent-border); }

    .upp-chip-read {
      min-height: 34px; padding: 6px 4px 6px 11px; border: none; background: transparent;
      color: var(--upp-chip-tx); font: inherit; font-size: 13px; line-height: 1.25;
      cursor: pointer; text-align: left; word-break: break-word;
    }
    .upp-chip-wrap.is-selected .upp-chip-read { color: var(--upp-accent-tx); font-weight: 500; }
    .upp-chip-wrap.is-conflict .upp-chip-read { color: var(--upp-warn-tx); }

    .upp-chip-check {
      width: 30px; min-height: 34px; padding-right: 4px; border: none;
      background: transparent; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .upp-chip-circle {
      width: 18px; height: 18px; border-radius: 999px; border: 1.5px solid var(--upp-chip-border);
      background: rgba(127, 136, 154, 0.06);
      display: inline-flex; align-items: center; justify-content: center; color: transparent;
      transition: background 0.12s ease, border-color 0.12s ease, transform 0.10s ease;
    }
    .upp-chip-circle svg { opacity: 0; transform: scale(0.65); transition: opacity 0.12s ease, transform 0.12s var(--upp-ease); }
    .upp-chip-check:hover .upp-chip-circle { border-color: var(--upp-accent-border); }
    .upp-chip-wrap.is-selected .upp-chip-circle { border-color: var(--upp-accent); background: var(--upp-accent); color: #ffffff; }
    .upp-chip-wrap.is-selected .upp-chip-circle svg { opacity: 1; transform: scale(1); }
    .upp-chip-wrap.is-conflict .upp-chip-circle { border-color: #d9822b; background: #d9822b; color: #ffffff; }

    /* Structured Profile Form */
    .upp-profile-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
    .upp-field { display: flex; flex-direction: column; gap: 5px; }
    .upp-field.is-full { grid-column: 1 / -1; }
    .upp-label { font-size: 12px; font-weight: 500; color: var(--upp-tx2); display: flex; justify-content: space-between; }
    .upp-quick-row { display: flex; flex-wrap: wrap; gap: 5px; }
    .upp-qpill {
      height: 24px; padding: 0 9px; border-radius: 999px; border: 1px solid var(--upp-chip-border);
      background: var(--upp-chip-bg); color: var(--upp-tx2); font-size: 11px; cursor: pointer;
    }
    .upp-qpill.is-active { background: var(--upp-accent-bg); border-color: var(--upp-accent-border); color: var(--upp-accent-tx); font-weight: 600; }

    .upp-mini-btn {
      height: 28px; padding: 0 11px; border-radius: 999px; border: 1px solid var(--upp-btn-border);
      background: var(--upp-btn-bg); color: var(--upp-tx2); font-size: 12px; font-weight: 500;
      display: inline-flex; align-items: center; justify-content: center; cursor: pointer; white-space: nowrap; flex-shrink: 0;
    }
    .upp-mini-btn:hover { background: var(--upp-btn-hover); color: var(--upp-tx); }
    .upp-mini-btn.is-active { background: var(--upp-accent-bg); border-color: var(--upp-accent-border); color: var(--upp-accent-tx); }
    .upp-mini-btn.is-danger { color: var(--upp-danger-tx); }

    .upp-inspector {
      flex-shrink: 0; border-top: 1px solid var(--upp-divider); background: var(--upp-inspect-bg);
      padding: 10px 16px; display: flex; flex-direction: column; gap: 6px;
    }
    .upp-inspector[hidden] { display: none; }
    .upp-inspector-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .upp-inspector-title { font-size: 13px; font-weight: 600; color: var(--upp-tx); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .upp-inspector-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .upp-inspector-body {
      font-size: 12px; line-height: 1.5; color: var(--upp-tx2); white-space: pre-wrap; word-break: break-word;
      max-height: 96px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--upp-scroll) transparent;
    }

    .upp-conflicts { flex-shrink: 0; padding: 8px 16px 0; }
    .upp-conflicts:empty { display: none; }

    .upp-inline-save { display: flex; gap: 7px; }
    .upp-form {
      background: var(--upp-card-bg); border: 1px solid var(--upp-card-border);
      box-shadow: var(--upp-card-shadow); border-radius: 15px; padding: 13px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .upp-form-error { font-size: 12px; color: var(--upp-danger-tx); }
    .upp-form-actions { display: flex; justify-content: flex-end; gap: 8px; }

    .upp-row-list { display: flex; flex-direction: column; gap: 7px; }
    .upp-row-item {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 9px 11px; border-radius: 12px; border: 1px solid var(--upp-chip-border); background: var(--upp-chip-bg);
    }
    .upp-row-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto; }
    .upp-star-btn {
      width: 26px; height: 26px; border-radius: 999px; border: none; background: transparent;
      color: var(--upp-tx3); font-size: 15px; cursor: pointer; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .upp-star-btn.is-default { color: #e2a024; }
    .upp-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .upp-row-title { font-size: 13px; font-weight: 500; color: var(--upp-tx); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .upp-row-sub { font-size: 11px; color: var(--upp-tx3); }
    .upp-row-btns { display: flex; align-items: center; gap: 5px; flex-shrink: 0; }

    .upp-seg-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; padding: 3px; border-radius: 11px; background: var(--upp-track-bg); }
    .upp-seg-btn {
      height: 28px; border-radius: 8px; border: none; background: transparent; color: var(--upp-tx2);
      font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap;
    }
    .upp-seg-btn.is-active { background: var(--upp-seg-active-bg); color: var(--upp-tx); font-weight: 600; box-shadow: var(--upp-seg-active-shadow); }

    .upp-radio-group { display: flex; flex-direction: column; gap: 6px; }
    .upp-radio-opt {
      display: flex; align-items: center; gap: 8px; padding: 8px 11px; border-radius: 10px;
      border: 1px solid var(--upp-chip-border); background: var(--upp-chip-bg); font-size: 12px; color: var(--upp-tx); cursor: pointer; text-align: left;
    }
    .upp-radio-opt.is-active { border-color: var(--upp-accent-border); background: var(--upp-accent-bg); color: var(--upp-accent-tx); font-weight: 500; }

    .upp-preview-pre {
      margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.55;
      color: var(--upp-tx); background: var(--upp-input-bg); border: 1px solid var(--upp-input-border);
      border-radius: 12px; padding: 11px; max-height: 36dvh; overflow-y: auto;
    }

    .upp-empty { font-size: 12px; color: var(--upp-tx3); padding: 4px 0; }

    .upp-foot {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 10px 16px 12px; border-top: 1px solid var(--upp-divider); background: var(--upp-foot-bg); flex-shrink: 0;
    }
    .upp-action-left, .upp-action-right { display: flex; align-items: center; gap: 8px; }
    .upp-total { font-size: 12px; font-weight: 500; color: var(--upp-tx2); white-space: nowrap; }

    .upp-btn {
      height: 36px; min-width: 66px; padding: 0 14px; border-radius: 999px;
      border: 1px solid var(--upp-btn-border); background: var(--upp-btn-bg); color: var(--upp-btn-tx);
      font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; white-space: nowrap;
    }
    .upp-btn:hover { background: var(--upp-btn-hover); }
    .upp-btn:disabled { opacity: 0.52; cursor: not-allowed; }
    .upp-btn-primary { background: var(--upp-primary-bg); border-color: transparent; color: #ffffff; font-weight: 600; box-shadow: var(--upp-primary-shadow); }
    .upp-btn-primary:hover { background: var(--upp-primary-hover); }

    @media (max-width: 640px) {
      .upp-backdrop { padding: 0; align-items: flex-end; }
      .upp-modal { width: 100%; height: 84dvh; border-radius: 24px 24px 0 0; border-left: none; border-right: none; border-bottom: none; animation: upp-sheet-up 0.18s var(--upp-ease); }
      .upp-grab { display: block; }
      .upp-head { padding: 10px 16px 8px; }
      .upp-foot { padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px)); }
      .upp-profile-grid { grid-template-columns: 1fr; }
    }
  `;

  shadow.innerHTML = `
    <style>${STYLE}</style>
    <div class="upp-backdrop" data-theme="light" hidden>
      <div class="upp-modal" role="dialog" aria-modal="true" aria-label="User 人设">
        <div class="upp-grab" aria-hidden="true"></div>
        <div class="upp-head">
          <div class="upp-head-left">
            <span class="upp-title">User 人设</span>
            <span class="upp-char-tag" hidden></span>
          </div>
          <button type="button" class="upp-close-btn" data-act="close" aria-label="关闭">×</button>
        </div>
        <div class="upp-tabs-wrap">
          <div class="upp-tabs" role="tablist">
            <button type="button" class="upp-tab is-active" data-tab="lib" role="tab">条目库</button>
            <button type="button" class="upp-tab" data-tab="wb" role="tab">世界书</button>
            <button type="button" class="upp-tab" data-tab="presets" role="tab">方案</button>
          </div>
        </div>
        <div class="upp-toolbar"></div>
        <div class="upp-body"></div>
        <div class="upp-conflicts"></div>
        <div class="upp-inspector" hidden></div>
        <div class="upp-foot">
          <div class="upp-action-left">
            <button type="button" class="upp-btn" data-act="clear">取消全选</button>
            <button type="button" class="upp-btn" data-act="quick-copy">复制文本</button>
          </div>
          <div class="upp-action-right">
            <span class="upp-total">已选 0</span>
            <button type="button" class="upp-btn upp-btn-primary" data-act="open-apply">应用 / 保存</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const $ = sel => shadow.querySelector(sel);
  const elBackdrop = $('.upp-backdrop');
  const elCharTag = $('.upp-char-tag');
  const elTabs = $('.upp-tabs');
  const elToolbar = $('.upp-toolbar');
  const elBody = $('.upp-body');
  const elConflicts = $('.upp-conflicts');
  const elInspector = $('.upp-inspector');
  const elTotal = $('.upp-total');
  const elClearBtn = $('[data-act="clear"]');
  const elApplyBtn = $('[data-act="open-apply"]');
  const elFoot = $('.upp-foot');

  const state = {
    open: false,
    loading: false,
    saving: false,
    tab: 'lib', // 'lib' | 'wb' | 'presets'
    activeCat: '__profile__', // '__profile__' | '__selected__' | <category name>
    subView: '', // '' | 'edit' | 'new' | 'new_cat' | 'apply'
    charName: '',
    store: loadStore(),
    selected: new Set(),
    inspected: null, // { book, title }
    hostBooks: [],
    globalBooks: [],
    activeWb: '',
    wbBookSearch: '',
    wbEntrySearch: '',
    wbCache: Object.create(null),
    libSearch: '',
    showAllChars: false,
    presetNameInput: '',
    newCatName: '',
    importOpen: false,
    importText: '',
    draft: { book: '', cat: '', oldTitle: '', title: '', content: '', isCustom: false, error: '', busy: false },
    applyCfg: { target: 'persona_update', replaceAll: false, newPersonaName: '', currentPersonaName: '', existingDesc: '', error: '' },
  };

  function countSelectedBySource() {
    let lib = 0, wb = 0;
    for (const k of state.selected) {
      if (parseKey(k).book === LIB_BOOK) lib++;
      else wb++;
    }
    if (hasProfileData(state.store.profile)) lib++;
    return { lib, wb };
  }

  function buildWbContentMap() {
    const map = Object.create(null);
    for (const [book, entries] of Object.entries(state.wbCache)) {
      map[book] = Object.create(null);
      for (const e of entries || []) if (e && e.name) map[book][e.name] = e.content || '';
    }
    return map;
  }

  async function ensureWbLoaded(bookName) {
    if (!bookName || bookName === LIB_BOOK) return;
    if (Array.isArray(state.wbCache[bookName])) return;
    state.wbCache[bookName] = await loadWorldbookEntries(bookName);
  }

  async function ensureSelectedWbsLoaded() {
    const needed = new Set();
    for (const k of state.selected) {
      const b = parseKey(k).book;
      if (b && b !== LIB_BOOK && !Array.isArray(state.wbCache[b])) needed.add(b);
    }
    await Promise.all([...needed].map(b => ensureWbLoaded(b)));
  }

  function getOrderedHostBooks() {
    const recentSet = new Set(state.store.recentBooks);
    return [
      ...state.store.recentBooks.filter(b => state.hostBooks.includes(b)),
      ...state.hostBooks.filter(b => !recentSet.has(b)),
    ];
  }

  function getConflictKeySet() {
    const set = new Set();
    for (const c of detectConflicts(state.selected)) {
      for (const k of c.keys) set.add(k);
    }
    return set;
  }

  const CHECK_SVG = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.2 6.2 4.8 8.8 9.8 3.4"/></svg>';

  function renderChip(book, title, label, conflictKeySet) {
    const k = itemKey(book, title);
    const isSel = state.selected.has(k);
    const isConflict = isSel && conflictKeySet.has(k);
    const isIns = state.inspected && state.inspected.book === book && state.inspected.title === title;
    return '<span class="upp-chip-wrap' +
      (isSel ? ' is-selected' : '') +
      (isConflict ? ' is-conflict' : '') +
      (isIns ? ' is-inspected' : '') + '" data-chip-book="' + esc(book) + '" data-chip-title="' + esc(title) + '">' +
      '<button type="button" class="upp-chip-read" data-read-book="' + esc(book) + '" data-read-title="' + esc(title) + '" title="点击查看正文">' + esc(label) + '</button>' +
      '<button type="button" class="upp-chip-check" data-toggle-book="' + esc(book) + '" data-toggle-title="' + esc(title) + '" title="' + (isSel ? '取消勾选' : '勾选') + '" aria-label="' + (isSel ? '取消勾选' : '勾选') + '">' +
        '<span class="upp-chip-circle">' + CHECK_SVG + '</span>' +
      '</button>' +
    '</span>';
  }

  // Fast surgical DOM updates (avoids rebuilding 100+ DOM nodes on every click!)
  function syncInspectedInPlace() {
    elBody.querySelectorAll('.upp-chip-wrap.is-inspected').forEach(el => el.classList.remove('is-inspected'));
    if (!state.inspected) return;
    elBody.querySelectorAll('.upp-chip-wrap').forEach(el => {
      if (el.dataset.chipBook === state.inspected.book && el.dataset.chipTitle === state.inspected.title) {
        el.classList.add('is-inspected');
      }
    });
  }

  function syncChipStatesInPlace() {
    const conflictSet = getConflictKeySet();
    elBody.querySelectorAll('.upp-chip-wrap').forEach(el => {
      const b = el.dataset.chipBook;
      const t = el.dataset.chipTitle;
      const k = itemKey(b, t);
      const isSel = state.selected.has(k);
      const isConflict = isSel && conflictSet.has(k);
      const isIns = Boolean(state.inspected && state.inspected.book === b && state.inspected.title === t);
      el.classList.toggle('is-selected', isSel);
      el.classList.toggle('is-conflict', isConflict);
      el.classList.toggle('is-inspected', isIns);
      const chk = el.querySelector('.upp-chip-check');
      if (chk) {
        chk.title = isSel ? '取消勾选' : '勾选';
        chk.setAttribute('aria-label', chk.title);
      }
    });
    // Refresh category pill counts in place without rebuilding search inputs
    if (state.tab === 'lib') {
      elToolbar.querySelectorAll('.upp-cat-pill').forEach(pill => {
        const c = pill.dataset.cat;
        if (!c || c === '__profile__') return;
        if (c === '__selected__') { pill.textContent = '已选 ' + state.selected.size; return; }
        let sel = 0;
        for (const it of getEntriesForCategory(state.store, c)) {
          if (state.selected.has(itemKey(LIB_BOOK, it.title))) sel++;
        }
        pill.textContent = sel > 0 ? (c + ' ' + sel) : c;
      });
    }
  }

  function renderTabs() {
    const counts = countSelectedBySource();
    const map = { lib: ['条目库', counts.lib], wb: ['世界书', counts.wb], presets: ['方案', state.store.presets.length] };
    elTabs.querySelectorAll('.upp-tab').forEach(btn => {
      const t = btn.dataset.tab;
      btn.classList.toggle('is-active', state.tab === t && !state.subView);
      const [label, n] = map[t];
      btn.innerHTML = esc(label) + (n > 0 ? '<span class="upp-tab-count">' + n + '</span>' : '');
    });
  }

  function renderToolbar() {
    if (state.subView || state.loading || state.tab === 'presets') {
      elToolbar.innerHTML = '';
      return;
    }

    if (state.tab === 'lib') {
      const allCats = getAllCategories(state.store);
      const profFilled = hasProfileData(state.store.profile);
      const catPills = [
        '<button type="button" class="upp-cat-pill' + (state.activeCat === '__profile__' && !state.libSearch ? ' is-active' : '') + '" data-cat="__profile__">基础资料' + (profFilled ? ' · 已填' : '') + '</button>',
        '<button type="button" class="upp-cat-pill' + (state.activeCat === '__selected__' && !state.libSearch ? ' is-active' : '') + '" data-cat="__selected__">已选 ' + state.selected.size + '</button>',
      ];
      for (const cat of allCats) {
        let sel = 0;
        for (const it of getEntriesForCategory(state.store, cat)) {
          if (state.selected.has(itemKey(LIB_BOOK, it.title))) sel++;
        }
        catPills.push(
          '<button type="button" class="upp-cat-pill' + (state.activeCat === cat && !state.libSearch ? ' is-active' : '') +
            '" data-cat="' + esc(cat) + '">' + esc(cat) + (sel > 0 ? ' ' + sel : '') + '</button>'
        );
      }
      catPills.push('<button type="button" class="upp-cat-pill" data-act="open-new-cat">+ 分类</button>');

      elToolbar.innerHTML =
        '<div class="upp-toolbar-row">' +
          '<input type="text" class="upp-search-input" data-lib-search="1" value="' + esc(state.libSearch) + '" placeholder="搜条目名称或正文（点文字看内容，点圆圈勾选）" />' +
          '<button type="button" class="upp-mini-btn" data-act="open-new-lib">+ 新建</button>' +
        '</div>' +
        '<div class="upp-cat-strip">' + catPills.join('') + '</div>';
      return;
    }

    // Worldbook tab: search worldbooks + select + search entries
    const ordered = getOrderedHostBooks();
    if (!ordered.length) { elToolbar.innerHTML = ''; return; }
    const filteredBooks = filterWorldbookNames(ordered, state.wbBookSearch);
    if (filteredBooks.length && !filteredBooks.includes(state.activeWb)) {
      state.activeWb = filteredBooks[0];
    }

    const opts = filteredBooks.length
      ? filteredBooks.map(name => {
          let sel = 0;
          for (const k of state.selected) if (parseKey(k).book === name) sel++;
          return '<option value="' + esc(name) + '"' + (state.activeWb === name ? ' selected' : '') + '>' + esc(name + (sel > 0 ? '（已选 ' + sel + '）' : '')) + '</option>';
        }).join('')
      : '<option value="">无匹配世界书</option>';

    const isGlobalOn = state.activeWb && state.globalBooks.includes(state.activeWb);
    elToolbar.innerHTML =
      '<div class="upp-toolbar-row">' +
        '<input type="text" class="upp-search-input" style="max-width:165px" data-wb-book-search="1" value="' + esc(state.wbBookSearch) + '" placeholder="搜世界书名" />' +
        '<select class="upp-select" data-wb-select="1">' + opts + '</select>' +
        '<button type="button" class="upp-mini-btn" data-act="open-new-wb">+ 新建</button>' +
      '</div>' +
      '<div class="upp-toolbar-row">' +
        '<input type="text" class="upp-search-input" data-wb-entry-search="1" value="' + esc(state.wbEntrySearch) + '" placeholder="搜当前世界书内条目标题或正文" />' +
      '</div>' +
      (isGlobalOn ? '<div class="upp-warn-strip"><span>该世界书当前已全局开启，勾选后可能重复注入</span></div>' : '');
  }

  function renderConflicts() {
    if (state.subView) { elConflicts.innerHTML = ''; return; }
    const list = detectConflicts(state.selected);
    if (!list.length) { elConflicts.innerHTML = ''; return; }
    const first = list[0];
    const summary = list.length === 1
      ? '检测到冲突：' + first.label + '（' + first.titles.join(' / ') + '）'
      : '检测到 ' + list.length + ' 处冲突：' + list.map(c => c.label).join('、');
    elConflicts.innerHTML =
      '<div class="upp-warn-strip">' +
        '<span>' + esc(summary) + '</span>' +
        '<button type="button" class="upp-mini-btn" data-act="resolve-conflicts">只留最新</button>' +
      '</div>';
  }

  function renderInspector() {
    if (state.subView || !state.inspected) {
      elInspector.hidden = true;
      elInspector.innerHTML = '';
      return;
    }
    const { book, title } = state.inspected;
    let content = '';
    if (book === LIB_BOOK) {
      const entry = findLibraryEntry(state.store, title);
      if (!entry) { elInspector.hidden = true; return; }
      content = entry.content;
    } else {
      content = buildWbContentMap()[book]?.[title] || '';
    }
    const isSel = state.selected.has(itemKey(book, title));
    elInspector.hidden = false;
    elInspector.innerHTML =
      '<div class="upp-inspector-head">' +
        '<span class="upp-inspector-title">' + esc(title) + '</span>' +
        '<div class="upp-inspector-actions">' +
          '<button type="button" class="upp-mini-btn' + (isSel ? ' is-active' : '') + '" data-inspect-toggle="1">' + (isSel ? '取消勾选' : '勾选此条') + '</button>' +
          '<button type="button" class="upp-mini-btn" data-inspect-edit="1">编辑</button>' +
          '<button type="button" class="upp-mini-btn" data-inspect-close="1">×</button>' +
        '</div>' +
      '</div>' +
      '<div class="upp-inspector-body">' + esc(content || '（正文为空）') + '</div>';
  }

  function renderFooter() {
    elFoot.style.display = state.subView === 'apply' ? 'none' : '';
    const total = state.selected.size + (hasProfileData(state.store.profile) ? 1 : 0);
    elTotal.textContent = '已选 ' + total;
    elClearBtn.disabled = state.selected.size === 0;
    elApplyBtn.disabled = state.loading || state.saving;
  }

  function renderProfileForm() {
    const p = state.store.profile;
    const qp = (field, values) => '<div class="upp-quick-row">' + values.map(v =>
      '<button type="button" class="upp-qpill' + (p[field] === v ? ' is-active' : '') + '" data-prof-quick="' + field + '" data-prof-val="' + esc(v) + '">' + esc(v) + '</button>'
    ).join('') + '</div>';

    const agePreview = formatAge(p.age);
    const heightPreview = formatHeight(p.height);

    return '<section class="upp-group">' +
      '<div class="upp-group-head">' +
        '<span class="upp-group-title">基础资料</span>' +
        (hasProfileData(p) ? '<button type="button" class="upp-mini-btn" data-act="clear-profile">清空资料</button>' : '') +
      '</div>' +
      '<div class="upp-profile-grid">' +
        '<div class="upp-field">' +
          '<label class="upp-label"><span>姓名</span></label>' +
          '<input type="text" class="upp-input" data-prof-field="name" value="' + esc(p.name) + '" placeholder="留空默认 {{user}}" />' +
        '</div>' +
        '<div class="upp-field">' +
          '<label class="upp-label"><span>性别</span></label>' +
          '<input type="text" class="upp-input" data-prof-field="gender" value="' + esc(p.gender) + '" placeholder="选填" />' +
          qp('gender', ['女', '男', '双性']) +
        '</div>' +
        '<div class="upp-field">' +
          '<label class="upp-label"><span>年龄</span><span>' + esc(agePreview) + '</span></label>' +
          '<input type="text" class="upp-input" data-prof-field="age" value="' + esc(p.age) + '" placeholder="输数字自动补「岁」" />' +
          qp('age', ['18', '20', '22', '25']) +
        '</div>' +
        '<div class="upp-field">' +
          '<label class="upp-label"><span>身高</span><span>' + esc(heightPreview) + '</span></label>' +
          '<input type="text" class="upp-input" data-prof-field="height" value="' + esc(p.height) + '" placeholder="输数字自动补「cm」" />' +
          qp('height', ['158', '163', '168', '175']) +
        '</div>' +
        '<div class="upp-field is-full">' +
          '<label class="upp-label"><span>身份 / 职业</span></label>' +
          '<input type="text" class="upp-input" data-prof-field="role" value="' + esc(p.role) + '" placeholder="例如：大三美术生、插画师" />' +
          qp('role', ['在校大学生', '职场上班族', '自由职业', '豪门千金']) +
        '</div>' +
        '<div class="upp-field is-full">' +
          '<label class="upp-label"><span>外貌特征补充</span></label>' +
          '<input type="text" class="upp-input" data-prof-field="traits" value="' + esc(p.traits) + '" placeholder="例如：黑发红瞳，左眼下有颗小泪痣" />' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  function renderLibTab() {
    const conflictSet = getConflictKeySet();

    if (state.libSearch.trim()) {
      const hits = searchAllLibraryEntries(state.store, state.libSearch);
      if (!hits.length) return '<section class="upp-group"><div class="upp-empty">没有找到匹配条目</div></section>';
      return '<section class="upp-group">' +
        '<div class="upp-group-head"><span class="upp-group-title">搜索结果<span class="upp-group-badge">' + hits.length + '</span></span></div>' +
        '<div class="upp-chips">' + hits.map(it => renderChip(LIB_BOOK, it.title, it.title, conflictSet)).join('') + '</div>' +
      '</section>';
    }

    if (state.activeCat === '__profile__') return renderProfileForm();

    if (state.activeCat === '__selected__') {
      const items = [...state.selected].map(parseKey);
      if (!items.length && !hasProfileData(state.store.profile)) {
        return '<section class="upp-group"><div class="upp-empty">还没勾选任何条目，切换上方分类即可点选</div></section>';
      }
      const parts = [];
      if (hasProfileData(state.store.profile)) {
        parts.push('<section class="upp-group"><div class="upp-group-head"><span class="upp-group-title">已填基础资料</span><button type="button" class="upp-mini-btn" data-cat="__profile__">去修改</button></div><pre class="upp-preview-pre">' + esc(formatProfileBlock(state.store.profile, state.store.outputFormat)) + '</pre></section>');
      }
      if (items.length) {
        parts.push(
          '<section class="upp-group">' +
            '<div class="upp-group-head">' +
              '<span class="upp-group-title">已勾选条目<span class="upp-group-badge">' + items.length + '</span></span>' +
              '<button type="button" class="upp-mini-btn is-danger" data-act="clear">取消全选</button>' +
            '</div>' +
            '<div class="upp-chips">' + items.map(it => renderChip(it.book, it.title, it.title, conflictSet)).join('') + '</div>' +
          '</section>'
        );
      }
      return parts.join('');
    }

    const cat = state.activeCat;
    const isCustomCat = !getBuiltinCategories().includes(cat);
    const items = getEntriesForCategory(state.store, cat);
    return '<section class="upp-group">' +
      '<div class="upp-group-head">' +
        '<span class="upp-group-title">' + esc(cat) + '<span class="upp-group-badge">' + items.length + ' 条</span></span>' +
        '<div class="upp-row-btns">' +
          (isCustomCat ? '<button type="button" class="upp-mini-btn is-danger" data-del-cat="' + esc(cat) + '">删分类</button>' : '') +
          '<button type="button" class="upp-mini-btn" data-act="open-new-lib">+ 加到此分类</button>' +
        '</div>' +
      '</div>' +
      (items.length
        ? '<div class="upp-chips">' + items.map(it => renderChip(LIB_BOOK, it.title, it.title, conflictSet)).join('') + '</div>'
        : '<div class="upp-empty">该分类暂无条目，点右上角「+ 加到此分类」新建</div>') +
    '</section>';
  }

  function renderWbTab() {
    if (!state.hostBooks.length) {
      return '<section class="upp-group"><div class="upp-empty">当前酒馆里没有可用的世界书，可直接用「条目库」。</div></section>';
    }
    if (!state.activeWb) {
      return '<section class="upp-group"><div class="upp-empty">没有匹配的世界书</div></section>';
    }
    const entries = state.wbCache[state.activeWb];
    if (!Array.isArray(entries)) return '<div class="upp-empty">加载世界书…</div>';

    const conflictSet = getConflictKeySet();
    const org = organizeWorldbookEntries(entries, state.charName, state.showAllChars, state.wbEntrySearch);
    const parts = [];
    if (!org.sections.length) {
      parts.push('<section class="upp-group"><div class="upp-empty">' + (state.wbEntrySearch ? '没有找到匹配条目' : '这本书暂无条目') + '</div></section>');
    } else {
      for (const sec of org.sections) {
        let selCount = 0;
        for (const e of sec.items) if (state.selected.has(itemKey(state.activeWb, e.name))) selCount++;
        const chips = sec.items.map(e => renderChip(state.activeWb, e.name, displayEntryLabel(e.name, sec), conflictSet)).join('');
        parts.push(
          '<section class="upp-group">' +
            (sec.cat ? '<div class="upp-group-head"><span class="upp-group-title">' + esc(sec.cat) + (selCount > 0 ? '<span class="upp-group-badge">' + selCount + '</span>' : '') + '</span></div>' : '') +
            '<div class="upp-chips">' + chips + '</div>' +
          '</section>'
        );
      }
    }
    if (org.hasHiddenOthers) {
      parts.push('<button type="button" class="upp-mini-btn" data-act="show-all-chars">显示其余 ' + org.hiddenCount + ' 条其他角色路线</button>');
    }
    return parts.join('');
  }

  function renderPresetsTab() {
    const rows = (state.store.presets || []).map(p => {
      const isDef = p.id === state.store.defaultPresetId;
      return '<div class="upp-row-item">' +
        '<div class="upp-row-left">' +
          '<button type="button" class="upp-star-btn' + (isDef ? ' is-default' : '') + '" data-preset-def="' + esc(p.id) + '" title="设为新聊天默认">' + (isDef ? '★' : '☆') + '</button>' +
          '<div class="upp-row-main">' +
            '<span class="upp-row-title">' + esc(p.label) + '</span>' +
            '<span class="upp-row-sub">' + p.items.length + ' 条' + (hasProfileData(p.profile) ? ' + 基础资料' : '') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="upp-row-btns">' +
          '<button type="button" class="upp-mini-btn is-active" data-preset-apply="' + esc(p.id) + '">套用</button>' +
          '<button type="button" class="upp-mini-btn" data-preset-overwrite="' + esc(p.id) + '">覆盖</button>' +
          '<button type="button" class="upp-mini-btn is-danger" data-preset-del="' + esc(p.id) + '">删</button>' +
        '</div>' +
      '</div>';
    }).join('');

    const backupRow = state.store.personaBackup
      ? '<section class="upp-group">' +
          '<div class="upp-group-head">' +
            '<span class="upp-group-title">上次写入前备份</span>' +
            '<button type="button" class="upp-mini-btn" data-act="restore-persona-backup">恢复原文</button>' +
          '</div>' +
          '<div class="upp-empty">已备份「' + esc(state.store.personaBackup.name || '当前人设') + '」原有描述</div>' +
        '</section>'
      : '';

    return '<section class="upp-group">' +
      '<div class="upp-group-head"><span class="upp-group-title">把当前设定存成方案</span><span class="upp-row-sub">含基础资料与已选条目</span></div>' +
      '<div class="upp-inline-save">' +
        '<input type="text" class="upp-input" data-preset-input="1" value="' + esc(state.presetNameInput) + '" placeholder="输入方案名，如：甜妹日常" />' +
        '<button type="button" class="upp-btn upp-btn-primary" data-act="create-preset">保存</button>' +
      '</div>' +
    '</section>' +
    '<section class="upp-group">' +
      '<div class="upp-group-head"><span class="upp-group-title">已存方案</span></div>' +
      '<div class="upp-row-list">' + (rows || '<div class="upp-empty">选好设定后在上方输个名字，下次就能一键套用</div>') + '</div>' +
    '</section>' +
    backupRow +
    '<section class="upp-group">' +
      '<div class="upp-group-head">' +
        '<span class="upp-group-title">换设备同步</span>' +
        '<div class="upp-row-btns">' +
          '<button type="button" class="upp-mini-btn" data-act="export-store">导出</button>' +
          '<button type="button" class="upp-mini-btn" data-act="toggle-import">导入</button>' +
        '</div>' +
      '</div>' +
      (state.importOpen
        ? '<textarea class="upp-textarea" data-import-text="1" placeholder="粘贴导出的 JSON">' + esc(state.importText) + '</textarea>' +
          '<div class="upp-form-actions"><button type="button" class="upp-mini-btn is-active" data-act="confirm-import">确认导入</button></div>'
        : '') +
    '</section>';
  }

  function renderSubView() {
    if (state.subView === 'new_cat') {
      return '<div class="upp-form">' +
        '<div class="upp-group-head"><span class="upp-group-title">新建条目分类</span></div>' +
        '<input type="text" class="upp-input" data-new-cat-input="1" value="' + esc(state.newCatName) + '" placeholder="例如：古风设定、常用XP" />' +
        '<div class="upp-form-actions">' +
          '<button type="button" class="upp-btn" data-act="close-sub">取消</button>' +
          '<button type="button" class="upp-btn upp-btn-primary" data-act="confirm-new-cat">创建分类</button>' +
        '</div>' +
      '</div>';
    }

    if (state.subView === 'apply') {
      const ac = state.applyCfg;
      const fmt = state.store.outputFormat;
      const out = assembleOutput(state.selected, state.store, buildWbContentMap(), fmt);
      const previewText = ac.target === 'persona_update'
        ? mergeIntoPersonaDescription(ac.existingDesc, out.text, ac.replaceAll)
        : out.text;

      return '<div class="upp-form">' +
        '<div class="upp-group-head">' +
          '<span class="upp-group-title">预览与应用</span>' +
          '<span class="upp-row-sub">' + out.count + ' 项 · ' + previewText.length + ' 字</span>' +
        '</div>' +
        '<div class="upp-field">' +
          '<label class="upp-label"><span>输出格式</span></label>' +
          '<div class="upp-seg-3">' +
            '<button type="button" class="upp-seg-btn' + (fmt === 'hybrid' ? ' is-active' : '') + '" data-fmt="hybrid">YAML+自然语言</button>' +
            '<button type="button" class="upp-seg-btn' + (fmt === 'yaml' ? ' is-active' : '') + '" data-fmt="yaml">纯 YAML</button>' +
            '<button type="button" class="upp-seg-btn' + (fmt === 'prose' ? ' is-active' : '') + '" data-fmt="prose">自然语言</button>' +
          '</div>' +
        '</div>' +
        '<div class="upp-field">' +
          '<label class="upp-label"><span>写入目标</span></label>' +
          '<div class="upp-radio-group">' +
            '<button type="button" class="upp-radio-opt' + (ac.target === 'persona_update' ? ' is-active' : '') + '" data-apply-target="persona_update">更新当前用户人设「' + esc(ac.currentPersonaName || '未检测到') + '」</button>' +
            '<button type="button" class="upp-radio-opt' + (ac.target === 'persona_new' ? ' is-active' : '') + '" data-apply-target="persona_new">另存为新的用户人设（不改原人设）</button>' +
            '<button type="button" class="upp-radio-opt' + (ac.target === 'chat' ? ' is-active' : '') + '" data-apply-target="chat">仅当前聊天生效（按聊天隔离）</button>' +
          '</div>' +
        '</div>' +
        (ac.target === 'persona_update'
          ? '<div class="upp-quick-row">' +
              '<button type="button" class="upp-qpill' + (!ac.replaceAll ? ' is-active' : '') + '" data-merge-mode="keep">保留原有简介，仅更新人设块</button>' +
              '<button type="button" class="upp-qpill' + (ac.replaceAll ? ' is-active' : '') + '" data-merge-mode="replace">完整替换整份描述</button>' +
            '</div>'
          : '') +
        (ac.target === 'persona_new'
          ? '<input type="text" class="upp-input" data-new-persona-name="1" value="' + esc(ac.newPersonaName) + '" placeholder="输入新用户人设的名称，如：林栀·古风版" />'
          : '') +
        '<pre class="upp-preview-pre">' + esc(previewText || '（暂无内容）') + '</pre>' +
        (ac.error ? '<div class="upp-form-error">' + esc(ac.error) + '</div>' : '') +
        '<div class="upp-form-actions">' +
          '<button type="button" class="upp-btn" data-act="close-sub">返回</button>' +
          '<button type="button" class="upp-btn" data-act="copy-apply-preview">复制文本</button>' +
          '<button type="button" class="upp-btn upp-btn-primary" data-act="execute-apply"' + (state.saving ? ' disabled' : '') + '>确认执行</button>' +
        '</div>' +
      '</div>';
    }

    // Edit or New Entry
    const d = state.draft;
    const isNew = state.subView === 'new';
    const canRename = isNew || d.book !== LIB_BOOK || d.isCustom;
    const allCats = getAllCategories(state.store);
    const catSelect = d.book === LIB_BOOK && (isNew || d.isCustom)
      ? '<div class="upp-field"><label class="upp-label"><span>所属分类</span></label><select class="upp-select" data-draft-field="cat">' +
          allCats.map(c => '<option value="' + esc(c) + '"' + (d.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
        '</select></div>'
      : '';

    return '<div class="upp-form">' +
      '<div class="upp-group-head">' +
        '<span class="upp-group-title">' + (isNew ? '新建条目' : '修改条目') + '</span>' +
        (d.book !== LIB_BOOK ? '<span class="upp-row-sub">' + esc(d.book) + '</span>' : '') +
      '</div>' +
      catSelect +
      '<input type="text" class="upp-input" data-draft-field="title" value="' + esc(d.title) + '"' + (canRename ? '' : ' disabled') + ' placeholder="标题" />' +
      '<textarea class="upp-textarea is-tall" data-draft-field="content" placeholder="写这条人设的具体描述">' + esc(d.content) + '</textarea>' +
      (d.error ? '<div class="upp-form-error">' + esc(d.error) + '</div>' : '') +
      '<div class="upp-form-actions">' +
        (!isNew && d.book === LIB_BOOK && d.isCustom ? '<button type="button" class="upp-btn" style="color:var(--upp-danger-tx)" data-act="delete-custom">删除</button>' : '') +
        '<button type="button" class="upp-btn" data-act="close-sub">取消</button>' +
        '<button type="button" class="upp-btn upp-btn-primary" data-act="save-draft"' + (d.busy ? ' disabled' : '') + '>保存</button>' +
      '</div>' +
    '</div>';
  }

  function renderBody() {
    if (state.loading) { elBody.innerHTML = '<div class="upp-empty">加载中…</div>'; return; }
    const prevScroll = elBody.scrollTop;
    if (state.subView) elBody.innerHTML = renderSubView();
    else if (state.tab === 'wb') elBody.innerHTML = renderWbTab();
    else if (state.tab === 'presets') elBody.innerHTML = renderPresetsTab();
    else elBody.innerHTML = renderLibTab();
    elBody.scrollTop = prevScroll;
  }

  function renderAll() {
    if (state.charName) { elCharTag.textContent = state.charName; elCharTag.hidden = false; }
    else elCharTag.hidden = true;
    renderTabs();
    renderToolbar();
    renderBody();
    renderConflicts();
    renderInspector();
    renderFooter();
  }

  async function refreshState() {
    elBackdrop.dataset.theme = detectHostTheme();
    state.loading = true;
    state.charName = readCurrentCharName();
    state.store = loadStore();
    renderAll();

    const [books, globals] = await Promise.all([listHostWorldbooks(), listGlobalWorldbooks()]);
    if (dead) return;
    state.hostBooks = books;
    state.globalBooks = globals;

    // Prefer chat saved state if present, otherwise lastItems or defaultPreset
    const savedChat = parseSavedChatPicker(readChatPickerVar());
    const nextSel = new Set();
    if (savedChat.hasSaved) {
      for (const it of savedChat.items) nextSel.add(itemKey(it.book, it.title));
      if (savedChat.profile && hasProfileData(savedChat.profile)) state.store.profile = savedChat.profile;
    } else if (state.store.lastItems.length) {
      for (const it of state.store.lastItems) nextSel.add(itemKey(it.book, it.title));
    } else if (state.store.defaultPresetId) {
      const def = state.store.presets.find(p => p.id === state.store.defaultPresetId);
      if (def) {
        for (const it of def.items) nextSel.add(itemKey(it.book, it.title));
        if (def.profile) state.store.profile = normalizeProfile(def.profile);
      }
    }
    state.selected = nextSel;

    if (state.tab === 'wb') {
      const ordered = getOrderedHostBooks();
      if (!state.activeWb || !state.hostBooks.includes(state.activeWb)) state.activeWb = ordered[0] || '';
      if (state.activeWb) await ensureWbLoaded(state.activeWb);
    }
    state.loading = false;
    renderAll();
  }

  function openModal() {
    if (dead) return;
    elBackdrop.dataset.theme = detectHostTheme();
    state.open = true;
    state.subView = '';
    state.inspected = null;
    state.libSearch = '';
    state.wbBookSearch = '';
    state.wbEntrySearch = '';
    elBackdrop.hidden = false;
    syncMenuExpanded();
    void refreshState();
  }

  function closeModal() {
    state.open = false;
    state.subView = '';
    state.inspected = null;
    elBackdrop.hidden = true;
    syncMenuExpanded();
  }

  async function openApplyView() {
    await ensureSelectedWbsLoaded();
    const cur = readCurrentPersona();
    state.applyCfg = {
      target: 'persona_update',
      replaceAll: false,
      newPersonaName: state.store.profile.name ? state.store.profile.name + '·人设' : '',
      currentPersonaName: cur?.name || '',
      existingDesc: String(cur?.description || ''),
      error: '',
    };
    state.subView = 'apply';
    renderAll();
  }

  async function executeApply() {
    if (state.saving) return;
    const ac = state.applyCfg;
    ac.error = '';
    state.saving = true;
    renderBody();
    try {
      await ensureSelectedWbsLoaded();
      const out = assembleOutput(state.selected, state.store, buildWbContentMap(), state.store.outputFormat);
      state.store.lastItems = out.wi.map(({ book, title }) => ({ book, title }));

      if (ac.target === 'persona_update') {
        if (!ac.currentPersonaName) throw new Error('未检测到当前启用的用户人设');
        const nextDesc = mergeIntoPersonaDescription(ac.existingDesc, out.text, ac.replaceAll);
        state.store.personaBackup = { name: ac.currentPersonaName, description: ac.existingDesc, savedAt: Date.now() };
        await replaceCurrentPersonaDesc(nextDesc);
        saveStore(state.store);
        closeModal();
        notify('已更新用户人设「' + ac.currentPersonaName + '」', 'success');
        return;
      }

      if (ac.target === 'persona_new') {
        const newName = String(ac.newPersonaName || '').trim();
        if (!newName) { ac.error = '请填写新用户人设名称'; state.saving = false; renderBody(); return; }
        if (listPersonaNames().includes(newName)) { ac.error = '已存在同名用户人设'; state.saving = false; renderBody(); return; }
        await createNewPersonaWithDesc(newName, out.text);
        saveStore(state.store);
        closeModal();
        notify('已新建用户人设「' + newName + '」', 'success');
        return;
      }

      if (!hasActiveChat()) { ac.error = '请先打开一个聊天'; state.saving = false; renderBody(); return; }
      await ensureOpeningBookSilent();
      await writeChatPickerVar({
        v: 1,
        char: state.charName,
        profile: state.store.profile,
        profileText: out.profileText,
        wi: out.wi,
      });
      saveStore(state.store);
      closeModal();
      notify('已保存到当前聊天（' + out.count + ' 项）', 'success');
    } catch (err) {
      ac.error = err?.message || String(err);
      renderBody();
    } finally {
      state.saving = false;
      renderBody();
    }
  }

  async function handleSaveDraft() {
    const d = state.draft;
    if (d.busy) return;
    const title = String(d.title || '').trim();
    const content = String(d.content || '').trim();
    if (!title) { d.error = '请填写标题'; renderBody(); return; }
    if (!content) { d.error = '请填写正文'; renderBody(); return; }

    if (d.book === LIB_BOOK) {
      const targetCat = d.cat || state.store.customCategories[0] || '我的自定义';
      if (state.subView === 'new') {
        if (findLibraryEntry(state.store, title)) { d.error = '已有同名条目'; renderBody(); return; }
        state.store.customEntries.push({ id: 'c_' + Date.now().toString(36), cat: targetCat, title, content, isRule: targetCat === '互动规则' });
        state.selected.add(itemKey(LIB_BOOK, title));
        state.activeCat = targetCat;
      } else if (d.isCustom) {
        const item = state.store.customEntries.find(e => e.title === d.oldTitle);
        if (item) {
          item.cat = targetCat;
          item.title = title;
          item.content = content;
          if (title !== d.oldTitle && state.selected.has(itemKey(LIB_BOOK, d.oldTitle))) {
            state.selected.delete(itemKey(LIB_BOOK, d.oldTitle));
            state.selected.add(itemKey(LIB_BOOK, title));
          }
        }
      } else {
        state.store.builtinEdits[d.oldTitle] = content;
      }
      saveStore(state.store);
      state.inspected = { book: LIB_BOOK, title };
      state.subView = '';
      notify('已保存', 'success');
      renderAll();
      return;
    }

    d.busy = true;
    d.error = '';
    renderBody();
    try {
      if (state.subView === 'new') {
        await createEntryInWorldbook(d.book, buildWorldbookEntry(title, content));
        state.selected.add(itemKey(d.book, title));
      } else {
        await updateEntryInWorldbook(d.book, d.oldTitle, title, content);
        if (title !== d.oldTitle && state.selected.has(itemKey(d.book, d.oldTitle))) {
          state.selected.delete(itemKey(d.book, d.oldTitle));
          state.selected.add(itemKey(d.book, title));
        }
      }
      state.wbCache[d.book] = await loadWorldbookEntries(d.book);
      state.inspected = { book: d.book, title };
      state.subView = '';
      notify('已写入世界书', 'success');
      renderAll();
    } catch (err) {
      d.busy = false;
      d.error = '写入失败：' + (err?.message || String(err));
      renderBody();
    }
  }

  // =========================
  // Events
  // =========================

  listen(elBackdrop, 'click', ev => { if (ev.target === elBackdrop) closeModal(); });

  listen(shadow, 'change', ev => {
    const el = ev.target;
    if (el?.dataset?.wbSelect) {
      const name = el.value;
      if (!name) return;
      state.activeWb = name;
      state.wbEntrySearch = '';
      state.showAllChars = false;
      state.inspected = null;
      state.store.recentBooks = [name, ...state.store.recentBooks.filter(x => x !== name)].slice(0, 12);
      saveStore(state.store);
      renderAll();
      void ensureWbLoaded(name).then(() => renderAll());
    } else if (el?.dataset?.draftField) {
      state.draft[el.dataset.draftField] = el.value;
    }
  });

  listen(shadow, 'input', ev => {
    const el = ev.target;
    if (el?.dataset?.libSearch) {
      state.libSearch = el.value;
      renderBody();
    } else if (el?.dataset?.wbBookSearch) {
      state.wbBookSearch = el.value;
      const ordered = getOrderedHostBooks();
      const filtered = filterWorldbookNames(ordered, state.wbBookSearch);
      const prevWb = state.activeWb;
      state.activeWb = filtered.includes(prevWb) ? prevWb : (filtered[0] || '');
      // Re-render only select options + body without losing focus on book search input
      const selEl = shadow.querySelector('[data-wb-select]');
      if (selEl) {
        selEl.innerHTML = filtered.length
          ? filtered.map(name => '<option value="' + esc(name) + '"' + (state.activeWb === name ? ' selected' : '') + '>' + esc(name) + '</option>').join('')
          : '<option value="">无匹配世界书</option>';
      }
      renderBody();
      if (state.activeWb && !Array.isArray(state.wbCache[state.activeWb])) {
        void ensureWbLoaded(state.activeWb).then(() => renderBody());
      }
    } else if (el?.dataset?.wbEntrySearch) {
      state.wbEntrySearch = el.value;
      renderBody();
    } else if (el?.dataset?.profField) {
      state.store.profile[el.dataset.profField] = el.value;
      saveStore(state.store);
      renderTabs();
      renderFooter();
      // Live unit preview update
      if (el.dataset.profField === 'age' || el.dataset.profField === 'height') {
        const previewSpan = el.closest('.upp-field')?.querySelector('.upp-label span:last-child');
        if (previewSpan) {
          previewSpan.textContent = el.dataset.profField === 'age' ? formatAge(el.value) : formatHeight(el.value);
        }
      }
    } else if (el?.dataset?.presetInput) {
      state.presetNameInput = el.value;
    } else if (el?.dataset?.newCatInput) {
      state.newCatName = el.value;
    } else if (el?.dataset?.newPersonaName) {
      state.applyCfg.newPersonaName = el.value;
    } else if (el?.dataset?.importText) {
      state.importText = el.value;
    } else if (el?.dataset?.draftField) {
      state.draft[el.dataset.draftField] = el.value;
      if (state.draft.error) { state.draft.error = ''; shadow.querySelector('.upp-form-error')?.remove(); }
    }
  });

  listen(shadow, 'click', ev => {
    const btn = ev.target.closest('button');
    if (!btn) return;

    const act = btn.dataset.act;
    if (act === 'close') { closeModal(); return; }
    if (act === 'close-sub') { state.subView = ''; renderAll(); return; }
    if (act === 'clear') {
      if (state.selected.size === 0) return;
      state.selected = new Set();
      renderAll();
      notify('已取消全部勾选', 'info');
      return;
    }
    if (act === 'clear-profile') { state.store.profile = createEmptyProfile(); saveStore(state.store); renderAll(); return; }
    if (act === 'show-all-chars') { state.showAllChars = true; renderBody(); return; }
    if (act === 'open-apply') { void openApplyView(); return; }
    if (act === 'execute-apply') { void executeApply(); return; }

    if (act === 'resolve-conflicts') {
      state.selected = resolveConflictsKeepLatest(state.selected);
      renderAll();
      notify('已自动解决冲突，保留最新勾选项', 'success');
      return;
    }

    if (act === 'quick-copy' || act === 'copy-apply-preview') {
      void ensureSelectedWbsLoaded().then(async () => {
        const out = assembleOutput(state.selected, state.store, buildWbContentMap(), state.store.outputFormat);
        if (!out.text) { notify('当前没有可复制的内容', 'warning'); return; }
        const ok = await copyToClipboard(out.text);
        notify(ok ? '已复制人设文本（' + out.text.length + ' 字）' : '复制失败，请在预览框手动复制', ok ? 'success' : 'warning');
      });
      return;
    }

    if (act === 'open-new-cat') { state.newCatName = ''; state.subView = 'new_cat'; renderAll(); return; }
    if (act === 'confirm-new-cat') {
      const name = String(state.newCatName || '').trim();
      if (!name) { notify('请输入分类名称', 'warning'); return; }
      if (!getAllCategories(state.store).includes(name)) {
        state.store.customCategories.push(name);
        saveStore(state.store);
      }
      state.activeCat = name;
      state.subView = '';
      renderAll();
      return;
    }

    if (btn.dataset.delCat) {
      const cat = btn.dataset.delCat;
      state.store.customCategories = state.store.customCategories.filter(c => c !== cat);
      for (const e of state.store.customEntries) {
        if (e.cat === cat) e.cat = state.store.customCategories[0] || '我的自定义';
      }
      if (!state.store.customCategories.length) state.store.customCategories = ['我的自定义'];
      saveStore(state.store);
      state.activeCat = '__profile__';
      renderAll();
      return;
    }

    if (act === 'open-new-lib') {
      const defaultCat = getAllCategories(state.store).includes(state.activeCat) ? state.activeCat : (state.store.customCategories[0] || '我的自定义');
      state.draft = { book: LIB_BOOK, cat: defaultCat, oldTitle: '', title: '', content: '', isCustom: true, error: '', busy: false };
      state.subView = 'new';
      renderAll();
      return;
    }
    if (act === 'open-new-wb') {
      if (!state.activeWb) return;
      state.draft = { book: state.activeWb, cat: '', oldTitle: '', title: '', content: '', isCustom: false, error: '', busy: false };
      state.subView = 'new';
      renderAll();
      return;
    }
    if (act === 'save-draft') { void handleSaveDraft(); return; }
    if (act === 'delete-custom') {
      const t = state.draft.oldTitle;
      state.store.customEntries = state.store.customEntries.filter(e => e.title !== t);
      state.selected.delete(itemKey(LIB_BOOK, t));
      if (state.inspected?.title === t) state.inspected = null;
      saveStore(state.store);
      state.subView = '';
      renderAll();
      return;
    }

    if (act === 'restore-persona-backup') {
      const bk = state.store.personaBackup;
      if (!bk) return;
      void replaceCurrentPersonaDesc(bk.description).then(() => notify('已恢复写入前的原有描述', 'success'))
        .catch(err => notify('恢复失败：' + (err?.message || String(err)), 'error'));
      return;
    }

    if (act === 'create-preset') {
      const label = String(state.presetNameInput || '').trim();
      if (!label) { notify('先输个方案名', 'warning'); return; }
      const items = [...state.selected].map(parseKey).filter(x => x.book && x.title);
      state.store.presets.unshift({
        id: 'p_' + Date.now().toString(36),
        label,
        items,
        profile: normalizeProfile(state.store.profile),
        outputFormat: state.store.outputFormat,
      });
      state.presetNameInput = '';
      saveStore(state.store);
      notify('已存为方案：' + label, 'success');
      renderAll();
      return;
    }

    if (act === 'export-store') {
      const txt = JSON.stringify({
        presets: state.store.presets,
        customCategories: state.store.customCategories,
        customEntries: state.store.customEntries,
        profile: state.store.profile,
        defaultPresetId: state.store.defaultPresetId,
      }, null, 2);
      void copyToClipboard(txt).then(ok => notify(ok ? '已复制同步 JSON' : '复制失败', ok ? 'success' : 'warning'));
      return;
    }
    if (act === 'toggle-import') { state.importOpen = !state.importOpen; renderBody(); return; }
    if (act === 'confirm-import') {
      try {
        const data = JSON.parse(state.importText || '');
        const merged = normalizeStore({ ...state.store, ...data });
        state.store = merged;
        saveStore(state.store);
        state.importOpen = false;
        state.importText = '';
        notify('导入成功', 'success');
        renderAll();
      } catch (_) {
        notify('JSON 格式不对', 'error');
      }
      return;
    }

    if (btn.dataset.fmt) {
      state.store.outputFormat = btn.dataset.fmt;
      saveStore(state.store);
      renderBody();
      return;
    }
    if (btn.dataset.applyTarget) {
      state.applyCfg.target = btn.dataset.applyTarget;
      state.applyCfg.error = '';
      renderBody();
      return;
    }
    if (btn.dataset.mergeMode) {
      state.applyCfg.replaceAll = btn.dataset.mergeMode === 'replace';
      renderBody();
      return;
    }

    if (btn.dataset.profQuick) {
      const f = btn.dataset.profQuick;
      const v = btn.dataset.profVal;
      state.store.profile[f] = state.store.profile[f] === v ? '' : v;
      saveStore(state.store);
      renderAll();
      return;
    }

    if (btn.dataset.cat) {
      state.activeCat = btn.dataset.cat;
      state.libSearch = '';
      elBody.scrollTop = 0;
      renderToolbar();
      renderBody();
      return;
    }

    if (btn.dataset.tab) {
      state.tab = btn.dataset.tab;
      state.subView = '';
      state.inspected = null;
      elBody.scrollTop = 0;
      if (state.tab === 'wb' && state.hostBooks.length) {
        const ordered = getOrderedHostBooks();
        if (!state.activeWb || !state.hostBooks.includes(state.activeWb)) state.activeWb = ordered[0] || '';
        renderAll();
        if (state.activeWb) void ensureWbLoaded(state.activeWb).then(() => renderAll());
      } else {
        renderAll();
      }
      return;
    }

    if (btn.dataset.presetApply) {
      const p = state.store.presets.find(x => x.id === btn.dataset.presetApply);
      if (p) {
        state.selected = new Set(p.items.map(it => itemKey(it.book, it.title)));
        if (p.profile) state.store.profile = normalizeProfile(p.profile);
        if (p.outputFormat) state.store.outputFormat = p.outputFormat;
        saveStore(state.store);
        notify('已套用「' + p.label + '」', 'info');
        renderAll();
      }
      return;
    }
    if (btn.dataset.presetOverwrite) {
      const p = state.store.presets.find(x => x.id === btn.dataset.presetOverwrite);
      if (p) {
        p.items = [...state.selected].map(parseKey).filter(x => x.book && x.title);
        p.profile = normalizeProfile(state.store.profile);
        p.outputFormat = state.store.outputFormat;
        saveStore(state.store);
        notify('已更新「' + p.label + '」', 'success');
        renderAll();
      }
      return;
    }
    if (btn.dataset.presetDel) {
      const id = btn.dataset.presetDel;
      state.store.presets = state.store.presets.filter(x => x.id !== id);
      if (state.store.defaultPresetId === id) state.store.defaultPresetId = '';
      saveStore(state.store);
      renderAll();
      return;
    }
    if (btn.dataset.presetDef) {
      const id = btn.dataset.presetDef;
      state.store.defaultPresetId = state.store.defaultPresetId === id ? '' : id;
      saveStore(state.store);
      renderAll();
      return;
    }

    if (btn.dataset.inspectClose) { state.inspected = null; renderInspector(); syncInspectedInPlace(); return; }
    if (btn.dataset.inspectToggle && state.inspected) {
      const k = itemKey(state.inspected.book, state.inspected.title);
      if (state.selected.has(k)) state.selected.delete(k);
      else state.selected.add(k);
      renderTabs();
      if (state.tab === 'lib' && state.activeCat === '__selected__') renderBody();
      else syncChipStatesInPlace();
      renderConflicts();
      renderInspector();
      renderFooter();
      return;
    }
    if (btn.dataset.inspectEdit && state.inspected) {
      const { book, title } = state.inspected;
      if (book === LIB_BOOK) {
        const entry = findLibraryEntry(state.store, title);
        if (entry) {
          state.draft = { book: LIB_BOOK, cat: entry.cat, oldTitle: title, title: entry.title, content: entry.content, isCustom: entry.isCustom, error: '', busy: false };
          state.subView = 'edit';
          renderAll();
        }
      } else {
        const content = buildWbContentMap()[book]?.[title] || '';
        state.draft = { book, cat: '', oldTitle: title, title, content, isCustom: false, error: '', busy: false };
        state.subView = 'edit';
        renderAll();
      }
      return;
    }

    // Separate READ click vs CHECK toggle (zero full-body DOM rebuild!)
    if (btn.dataset.readBook && btn.dataset.readTitle) {
      state.inspected = { book: btn.dataset.readBook, title: btn.dataset.readTitle };
      syncInspectedInPlace();
      renderInspector();
      return;
    }

    if (btn.dataset.toggleBook && btn.dataset.toggleTitle) {
      const book = btn.dataset.toggleBook;
      const title = btn.dataset.toggleTitle;
      const k = itemKey(book, title);
      if (state.selected.has(k)) state.selected.delete(k);
      else state.selected.add(k);
      state.inspected = { book, title };
      renderTabs();
      if (state.tab === 'lib' && state.activeCat === '__selected__') {
        renderToolbar();
        renderBody();
      } else {
        syncChipStatesInPlace();
      }
      renderConflicts();
      renderInspector();
      renderFooter();
    }
  });

  listen(Env.pdoc, 'keydown', ev => {
    if (!state.open || ev.key !== 'Escape') return;
    ev.stopPropagation();
    if (state.subView) { state.subView = ''; renderAll(); }
    else if (state.inspected) { state.inspected = null; renderInspector(); syncInspectedInPlace(); }
    else closeModal();
  });

  // =========================
  // Native Menu & Button Entry
  // =========================

  const menuEntry = Env.pdoc.createElement('div');
  menuEntry.id = MENU_ENTRY_ID;
  menuEntry.className = 'list-group-item flex-container flexGap5 interactable';
  menuEntry.setAttribute('role', 'button');
  menuEntry.tabIndex = 0;
  menuEntry.setAttribute('aria-label', '打开 User 人设');
  menuEntry.setAttribute('aria-controls', APP_ID);
  menuEntry.setAttribute('aria-expanded', 'false');
  menuEntry.title = 'User 人设';
  menuEntry.innerHTML =
    '<span class="extensionsMenuExtensionButton" aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' +
      '</svg>' +
    '</span><span>User 人设</span>';

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

  // Lightweight mount without expensive document-wide subtree MutationObserver
  const eventOnFn = getFn('eventOn');
  const getBtnEvtFn = getFn('getButtonEvent');
  const tavernEvents = getApi('tavern_events')?.value;

  if (eventOnFn && tavernEvents?.APP_READY) {
    try { const s = eventOnFn(tavernEvents.APP_READY, () => mountExtensionMenu()); if (s?.stop) cleanup.push(() => s.stop()); } catch (_) {}
  }
  if (eventOnFn && tavernEvents?.EXTENSIONS_FIRST_LOAD) {
    try { const s = eventOnFn(tavernEvents.EXTENSIONS_FIRST_LOAD, () => mountExtensionMenu()); if (s?.stop) cleanup.push(() => s.stop()); } catch (_) {}
  }
  if (!mountExtensionMenu()) {
    later(() => mountExtensionMenu(), 800);
    later(() => mountExtensionMenu(), 2500);
  }

  if (eventOnFn && getBtnEvtFn) {
    try {
      const sub = eventOnFn(getBtnEvtFn(BUTTON_NAME), () => { if (state.open) closeModal(); else openModal(); });
      if (sub?.stop) cleanup.push(() => sub.stop());
    } catch (_) {}
  }

  if (eventOnFn && tavernEvents?.CHAT_CHANGED) {
    try {
      const sub = eventOnFn(tavernEvents.CHAT_CHANGED, () => { if (state.open) void refreshState(); });
      if (sub?.stop) cleanup.push(() => sub.stop());
    } catch (_) {}
  }

  function dispose() {
    if (dead) return;
    dead = true;
    timers.forEach(id => Env.pwin.clearTimeout(id));
    timers.clear();
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
