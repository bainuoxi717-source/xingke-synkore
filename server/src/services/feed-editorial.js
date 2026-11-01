import { hashContent, plainText, sourceTopic } from './learning-feed-core.js';

export const EDITORIAL_VERSION = 'voicebox-interest-v3';
export const INTEREST_CATALOG = [
  ...['薛之谦', '周杰伦', '林俊杰', '吕彦良'].map((label) => ({ label, kind: 'music' })),
  { label: '诺兰的电影', kind: 'cinema' }, { label: '情感片', kind: 'cinema' },
  ...['王者荣耀', '刺激战场', '三角洲'].map((label) => ({ label, kind: 'gaming' })),
];
export const FORMATS = [{ id: 'analysis', label: '换个角度解读' }, { id: 'rebuttal', label: '我想唱个反调' }, { id: 'poem', label: '把它写成诗' }, { id: 'lyrics', label: '写进一段副歌' }];
export const DEFAULT_INTERESTS = INTEREST_CATALOG.map((item) => item.label);
export function normalizePreferences(value = {}) {
  const interests = [...new Set((Array.isArray(value.interests) ? value.interests : DEFAULT_INTERESTS).map((item) => String(item).trim()).filter(Boolean))];
  if (!interests.length || interests.length > 18 || interests.some((item) => item.length > 30 || /[<>\n\r]/.test(item))) throw new Error('请保留1到18个兴趣，每个不超过30字');
  return { interests, defaultFormat: [...FORMATS.map((item) => item.id), 'mix'].includes(value.defaultFormat) ? value.defaultFormat : 'mix' };
}
export function interestKind(label) {
  return INTEREST_CATALOG.find((item) => item.label === label)?.kind || (/电影|影视|剧|诺兰/.test(label) ? 'cinema' : /游戏|荣耀|战场|三角洲|电竞/.test(label) ? 'gaming' : 'music');
}
export function editorialChoice(source, preferences, presentation = {}) {
  const prefs = normalizePreferences(preferences), salt = hashContent(source.key || source.title || source.body);
  const preferred = presentation.interest || source.editorialTopic?.interestMatches?.[0];
  const interest = preferred && prefs.interests.includes(preferred) ? preferred : prefs.interests[parseInt(salt.slice(0, 4), 16) % prefs.interests.length];
  const format = FORMATS.some((item) => item.id === presentation.format) ? presentation.format : prefs.defaultFormat !== 'mix' ? prefs.defaultFormat : FORMATS[parseInt(salt.slice(4, 6), 16) % FORMATS.length].id;
  return { interest, format, kind: interestKind(interest), variant: parseInt(salt.slice(6, 8), 16) % 4 };
}
const SCENES = {
  music: {
    lead: '凌晨，你把一句话打进对话框，删掉，又打回来。耳机里的歌唱完了，聊天框仍然没有动静。有人说，沉默已经是答案；也有人说，别替另一个人把台词写完。',
    question: '一句没回的消息，究竟能证明多少事？',
    counter: '对方不是冷淡，只是不知道怎样开口',
    verse: '把一句话留在门外，\n让停顿替我说完。\n我以为听见了答案，\n其实只听见自己的回响。',
    chorus: '别让沉默替你作答，\n别把靠近都叫抵达。\n如果故事还有别的走法，\n把没说完的条件留下。',
  },
  cinema: {
    lead: '假设有一部情感片：同一段争执，先从离开的人视角讲，再从留下的人视角讲。台词一字没改，观众却换了阵营。如果再把结局放到开头，你会不会又改变判断？',
    question: '你站的是一个人，还是镜头让你看见的那一面？',
    counter: '镜头切到另一个人，补上你之前没看见的条件',
    verse: '把结尾折回开场，\n让背影再走一次。\n银幕没有替谁作证，\n只是把缺失的一帧还给你。',
    chorus: '把镜头转向另一边，\n把答案留到下一帧。\n别让一个漂亮的结尾，\n替我们删去所有前提。',
  },
  gaming: {
    lead: '设想一局队内争论：有人坚持回头救队友，有人坚持保存自己。结算出来以后，赢的一边把自己的选择叫“意识”，输的一边把另一种选择叫“上头”。可结果出来之前，他们掌握的信息真的一样吗？',
    question: '一次结果，足够证明一次决策始终正确吗？',
    counter: '队伍掌握的信息或当时的目标变了',
    verse: '结算亮起之前，\n谁也没握着结局。\n把那一秒重新打开，\n先看见当时手里的地图。',
    chorus: '别让结算替我开口，\n把那一秒留到最后。\n我想赢，也想说清缘由，\n下一局把条件都带走。',
  },
};
function hookTitle(choice) {
  const { interest, kind, variant, format } = choice;
  const titles = kind === 'music' ? [
    `听${interest}时，最怕的不是想起前任`,
    `${interest}的歌停了，那句话还是没敢发`,
    '别把歌听成复合申请，先等等',
    '那句没回的消息，真有那么多潜台词？',
  ] : kind === 'cinema' ? [
    interest.includes('诺兰') ? '如果诺兰来剪这次分手，谁才是反派？' : '这段感情倒着放，你还会站他吗？',
    '把反派的镜头补上，你还骂得下去吗？',
    '你以为在等结局，其实早就选好了立场',
    '我不想跟你站同一边，除非再看一遍',
  ] : [
    `${interest}：这波你救队友，还是保自己？`,
    `${interest}输了以后，到底该怪谁？`,
    '别拿结算截图，证明你每一步都对',
    `${interest}里最上头的，真的是赢吗？`,
  ];
  const title = titles[variant];
  return format === 'poem' ? `${title.replace(/[？?]$/, '')}｜写成一首诗` : format === 'lyrics' ? `${title.replace(/[？?]$/, '')}｜留给副歌` : title;
}
function topicalTitle(topical, choice) {
  const clue = String(topical.title || '').trim();
  if (topical.kind === 'ranked' && clue.length <= 12) return hookTitle({ ...choice, interest: clue });
  const angles = {
    music: ['先别替沉默写答案', '这句话，我想唱个反调', '别急着把故事听成结论', '你听见的，真是同一句话吗？'],
    cinema: ['补上另一个镜头，你还这么想吗？', '先别替任何人写结局', '这一次，我不想跟着站队', '谁没被镜头看见？'],
    gaming: ['别急着拿结果算账', '这次，我想替另一边说句话', '当时还有另一种选择吗？', '结算以外，谁说清了理由？'],
  };
  return `${clue.slice(0, 24)}｜${angles[choice.kind][choice.variant]}`;
}
function applicationOf(material, kind) {
  if (/约哈里|开放区|隐私区|自我表露|自我披露/.test(material)) {
    return { point: '先问“谁知道什么”，再判断一句话该不该说。',
      take: { music: '没回消息是你看见的行为，“不在乎我”却是你补上的解释。把自己的期待说出来，是提供信息；把对方必须回应当成结论，是另一回事。自我表露也有边界，不意味着必须交出所有秘密。',
        cinema: '换一个镜头，能让观众看见更多信息，却不会自动让片中两个人互相理解。观众已经知道的事，角色也许还没告诉对方。讨论关系之前，先把这两层信息分开。',
        gaming: '救不救队友，不只取决于态度：你知道自己缺少资源，队友可能不知道。把关键状态和目标说清，才能让“你怎么不来”变成可讨论的选择。分享信息有助于判断，但不保证一定获胜。' }[kind],
      verse: '我留了一扇没有推开的门，\n却盼你读懂整间屋子的灯。\n把愿意说的慢慢递出去，\n也给不愿说的留一寸安静。',
      chorus: '别要我猜你没说的话，\n把误会放进能回答的问法。\n有些门可以慢慢打开，\n有些边界也值得留下。' };
  }
  if (/极限/.test(material) && /函数|趋近|定义/.test(material)) {
    return { point: '把“越来越接近”和“在那一点是什么”分开问。',
      take: { music: '一段关系正在靠近，不等于另一种关系已经成立。这里只借用“趋近与取到需要分开”的直觉：人的感情不是函数，不能拿一个数学结论替对方表态。回到原材料，确认极限与该点定义分别在回答什么。',
        cinema: '镜头不断暗示一种结局，与影片是否真的给出了那一幕，是两件事。这个理解性类比帮助区分“趋向”与“点上的定义”；它不能证明剧情必然如何发展。',
        gaming: '资源条接近阈值，与某一帧是否触发机制，不能混成一句话。游戏还要看离散判定规则，不能拿连续极限直接预测机制；这个类比只帮助你把两个问题拆开。' }[kind],
      verse: '一路靠近那一点留白，\n未必能把空白叫作抵达。\n把方向和终点分开问，\n才听见问题各自的回答。',
      chorus: '靠近不急着叫抵达，\n留白也别替我作答。\n把两道问题分别放下，\n再看条件把我们带去哪。' };
  }
  if (/议程设置/.test(material)) {
    return { point: '你正在争的答案之前，还藏着“为什么只争这个问题”。',
      take: { music: '假设歌单里反复出现同一种感情叙事，你可能会更频繁地注意这一类问题。但被注意的内容，不等于你必须接受的答案；别把“进入视野”和“改变立场”直接画等号。',
        cinema: '剪辑决定先让你看见哪些片段，也决定哪些问题更显眼。你仍然可以不同意人物；分析时要区分“影片把什么放到前台”和“观众最后相信什么”。',
        gaming: '如果复盘一直围着“谁背锅”转，其他问题就可能被挤到旁边：当时共享了多少信息，目标是否一致？换一个提问框架，不等于替任何人免除责任，而是把讨论遗漏的部分补回来。' }[kind],
      verse: '谁把一个问题放到正中央，\n谁让其余故事退到光的背后。\n我可以不同意那个答案，\n也想先问是谁选了问法。',
      chorus: '把没被照见的也照亮，\n别让一个问号占满广场。\n我还可以说不一样的答案，\n先把遗漏的条件放回桌上。' };
  }
  return { point: '把材料当成判断的尺子，不把一个顺耳的故事当成证明。', take: '先挑出原材料中的一个定义或适用条件，再回到这个场景：有哪些事实满足它，有哪些信息尚未出现？如果找不到对应关系，就应该保留这个疑问，而不是为了讲得好听硬套结论。' };
}
function focusQuote(material) {
  const sentences = String(material).split(/[。！？\n]/).map(plainText).filter((part) => part.length >= 18 && part.length <= 260);
  const score = (part) => (/(不等于|不是.+而|条件|定义|趋近|开放区|隐私区|议程|核心|是指)/.test(part) ? 3 : 0) - (/先给你|我们分|这个问题|我课上/.test(part) ? 2 : 0);
  return (sentences.sort((a, b) => score(b) - score(a))[0] || plainText(material).slice(0, 220)).slice(0, 260);
}
export function buildEditorialArticle(source, preferences, presentation, base) {
  const choice = editorialChoice(source, preferences, presentation), scene = SCENES[choice.kind];
  const material = String(source.body || '').trim(), topic = sourceTopic(source);
  if (!material) return { ...base, title: '有一段没说完的话，先替你留在这里', dek: '等这个片段回来，我们再继续聊。', interest: choice.interest, format: choice.format,
    coverImage: `/assets/voicebox/${choice.kind}.png`, coverAlt: `${choice.kind === 'music' ? '空录音室与话筒' : choice.kind === 'cinema' ? '空电影院与银幕' : '键盘前的双手'}，黑白主题配图`, editorialVersion: EDITORIAL_VERSION, seedComments: [] };
  const quote = focusQuote(material), application = applicationOf(material, choice.kind);
  const creative = choice.format === 'poem' ? `## 先写一首短诗\n\n${application.verse || scene.verse}\n\n*原创情境诗，并非艺人原作。*\n\n`
    : choice.format === 'lyrics' ? `## 先留一段副歌\n\n${application.chorus || scene.chorus}\n\n*原创歌词片段，不引用或仿写所选歌手的歌词。*\n\n` : '';
  const angle = choice.format === 'rebuttal' ? `## 我想反驳的，是太快的结论\n\n${scene.question}先别把感受当成证据，也别因为一个结局，就把所有前提省略。我们先保留对方可能成立的条件。`
    : `## 先别急着站队\n\n${scene.question}这个场景是为了讨论而虚构的；它不是某位歌手的经历、真实电影情节，也不是某一局比赛的复盘。`;
  const body = `${scene.lead}\n\n${creative}${angle}\n\n## 换一把尺子再看\n\n这次借来的视角是「${topic}」。先看原材料里真正说了什么：\n\n> ${quote}\n\n${application.point}\n\n${application.take}\n\n${scene.counter}，你的判断会不会变？这是一道迁移问题，不把类比当作理论的直接证明。\n\n## 把依据留在这里\n\n${material}\n\n## 这次轮到你来反驳\n\n不用急着赞同这篇。选一句你不认同的，把你的条件、依据或反例写进评论。也可以改写上面的场景、诗句或副歌，让它更准确地表达这次的知识。`;
  const ids = (source.sources || []).map((item) => item.id);
  const topical = source.editorialTopic;
  const standpoints = {
    music: ['我站“沉默也有分量”这边。没回话不等于一切，但无限替对方补理由也不公平。你会给等待设什么界限？怎样区分实际行为和脑补？', '我偏向先把期待说清。比起让一首歌替对方作答，我更相信能核对的沟通。但这不代表对方有义务交出所有私事；这个边界你怎么划？', '你们都在猜“他怎么想”。如果把问题换成“我需要什么沟通”，是在找回主动，还是绕开事实？欢迎用文章里的依据反驳我。'],
    cinema: ['我先替反方说话：换个视角不等于洗白，做过的选择不会因为多一个镜头就消失。你认为补上什么事实，才值得重新评价这个人？', '我愿意看完另一边再下判断。镜头没给出的信息，可能正是评价中缺的条件。不是人人都该被原谅，但哪些证据会让你改变态度？', '我暂时不站人物。观众知道、角色知道和事情真的发生，可能是三层。我们现在反驳的是哪一层？把一处具体片段或材料条件拿出来谈。'],
    gaming: ['这局我偏向保自己：资源和信息不确定时，冲回去也可能扩大损失。把“不救”直接说成自私，太省事了。什么条件会让你愿意冒这个风险？', '我更偏向救队友：太快撤离，也可能把本来能协作的机会丢掉。但“必须救”同样说过头了。把共享的信息和团队目标摆清楚，再拿材料里的依据说服我。', '我不同意先按结算站队。赢的一边，也可能没把理由说清。把当时的信息、目标和限制列出来，你能指出哪一个条件最值得争吗？'],
  }[choice.kind];
  const seedComments = [
    { role: 'challenger', name: '先别急着同意', stance: '我站反方', text: standpoints[0], sourceIds: ids.slice(0, 1) },
    { role: 'evidence', name: '把依据放桌上', stance: '另一边，也有理由', text: standpoints[1], sourceIds: ids.slice(0, 1) },
    { role: 'alternative', name: '换个座位再看', stance: '换个情境', text: standpoints[2], sourceIds: ids.slice(0, 1) },
  ];
  const topicIntro = topical ? `这次从「${topical.title}」聊起。${topical.kind === 'ranked' ? `它出现在${topical.sourceName}${topical.rank ? `第${topical.rank}位` : ''}，这是采集时的榜单记录。` : `线索来自${topical.sourceName}的近期报道摘要。`}\n\n${topical.summary ? `线索摘要：${topical.summary.slice(0, 160)}\n\n` : ''}下面的场景是本篇原创设定，不补写新闻人物的经历。\n\n` : '';
  return { ...base, title: topical ? topicalTitle(topical, choice) : hookTitle(choice), dek: [scene.question, '故事听着顺，不代表结论已经成立。', '这次不抄答案，想听你怎么反驳。', '换一个位置，有些话就不一样了。'][choice.variant],
    body: topicIntro + body, topic, topical: topical || null, interest: choice.interest, format: choice.format, category: FORMATS.find((item) => item.id === choice.format).label,
    coverImage: `/assets/voicebox/${choice.kind}.png`, coverAlt: `${choice.kind === 'music' ? '录音室里的话筒和耳机' : choice.kind === 'cinema' ? '银幕前的匿名背影' : '游戏键盘前的双手'}，AI生成的黑白主题配图`,
    sceneKind: choice.kind, editorialVersion: EDITORIAL_VERSION, seedComments, replies: [], mode: 'source-edit', sourceIds: ids };
}
export function validateEditorialFields(value, validIds, topic) {
  if (/知识点|课堂重点|课程笔记|微积分|函数极限|自我表露|自我披露|议程设置|洛必达|极限存在|函数定义/.test(value.title) || (topic?.length >= 6 && value.title.includes(topic))) throw new Error('标题仍在直接展示知识点，请用兴趣场景重新组织');
  const seeds = value.seedComments;
  if (!Array.isArray(seeds) || seeds.length !== 3) throw new Error('请生成三个不同立场的智能体评论');
  if (new Set(seeds.map((item) => String(item.text || '').trim())).size !== 3) throw new Error('三个立场的评论不能重复');
  const roles = ['challenger', 'evidence', 'alternative'];
  return { seedComments: seeds.map((item, index) => {
    if (typeof item.text !== 'string' || item.text.trim().length < 15 || item.text.length > 1500 || !Array.isArray(item.sourceIds) || !item.sourceIds.length || item.sourceIds.some((id) => !validIds.includes(id))) throw new Error('智能体评论缺少有效观点或材料来源');
    return { role: roles[index], name: ['先别急着同意', '把依据放桌上', '换个座位再看'][index], stance: ['我站反方', '另一边，也有理由', '换个情境'][index], text: item.text.trim(), sourceIds: [...new Set(item.sourceIds)] };
  }), editorialVersion: EDITORIAL_VERSION };
}
export const articleFingerprint = (post) => hashContent({ source: post.sourceHash, title: post.title, body: post.body, editorial: post.editorialVersion });
export function localGuidance(text, post) {
  const quote = text.trim().slice(0, 120), hasReason = /因为|所以|如果|比如|例如|依据|假设|条件|反例/.test(text);
  return { text: hasReason ? `你已经开始给出推理了：「${quote}」。接着挑出其中最依赖条件的一步：如果把这个条件反过来，结论还成立吗？请对照文章的一段材料说明。` : `我先接住你的立场：「${quote}」。先别急着换答案：你最想反驳的是文章的哪一句？补一个依据或反例，我们再看这个判断站不站得住。`,
    sourceIds: (post.sourceIds || []).slice(0, 1), assessment: { stage: hasReason ? '开始建立论证' : '等待展开理由', observation: hasReason ? '这条回复出现了理由或条件，还需要核对它与原材料的联系。' : '这条回复表达了看法，仅凭立场还不能判断是否理解。', evidenceQuote: quote, nextStep: hasReason ? '找一个会让原结论失效的反例，并指出它改变的前提。' : '选一句原材料，说明它如何支持你的看法。', evaluatedBy: 'local-guidance' } };
}
export function validateCoachReply(value, validIds, userText) {
  if (!value || typeof value.text !== 'string' || value.text.trim().length < 10 || value.text.length > 4000) throw new Error('追问内容不完整');
  if (!Array.isArray(value.sourceIds) || !value.sourceIds.length || value.sourceIds.some((id) => !validIds.includes(id))) throw new Error('追问未关联有效的学习材料');
  const assessment = value.assessment;
  if (!assessment || typeof assessment.observation !== 'string' || typeof assessment.nextStep !== 'string' || typeof assessment.evidenceQuote !== 'string' || (assessment.evidenceQuote && !userText.includes(assessment.evidenceQuote))) throw new Error('学习观察必须依据你的真实回复');
  const stages = ['立场已表达', '概念联系待核对', '已提出依据', '迁移待验证'];
  return { text: value.text.trim(), sourceIds: [...new Set(value.sourceIds)], assessment: { stage: stages.includes(assessment.stage) ? assessment.stage : '概念联系待核对', observation: assessment.observation.slice(0, 1000), evidenceQuote: assessment.evidenceQuote.slice(0, 1000), nextStep: assessment.nextStep.slice(0, 1000), evaluatedBy: 'model' } };
}
