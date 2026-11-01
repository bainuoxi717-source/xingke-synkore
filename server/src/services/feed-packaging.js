import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashContent, parseJSON } from './learning-feed-core.js';
export const PACKAGING_VERSION = 'distinct-headlines-photos-v1';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web/public');
const manifestPath = path.join(root, 'assets/feed-covers/manifest.json');
const catalog = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')).assets || [] : [];
const cleanKey = (value) => String(value).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function cleanHeadline(value) {
  let title = String(value || '').split('\n').find((s) => s.trim()) || '';
  title = title.replace(/^\s*#{1,6}\s*/, '').replace(/^[「“]|[」”]$/g, '').trim();
  for (let n = 0; n < 3; n++) title = title.replace(/^(?:换个角度解读|我想唱个反调|把它写成诗|写进一段副歌|标题|推文|知识解读)[：:｜|\s]+/, '');
  title = title.replace(/[｜|]\s*(?:写成一首诗|留给副歌|原创歌词|诗文创作|换个角度解读).*$/, '');
  const pieces = title.split(/[｜|]/).map((s) => s.trim()).filter(Boolean);
  if (pieces.length > 1) title = [...new Map(pieces.map((s) => [cleanKey(s), s])).values()].join('，');
  return title.replace(/[，,]{2,}/g, '，').trim();
}
export function similarHeadline(left, right) {
  const a = cleanKey(left), b = cleanKey(right); if (a === b) return true;
  if (Math.min(a.length, b.length) < 8) return false;
  const grams = (s) => new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
  const x = grams(a), y = grams(b), intersection = [...x].filter((g) => y.has(g)).length;
  return 2 * intersection / (x.size + y.size) > .64 || ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) / Math.max(a.length, b.length) > .67);
}
const HEADLINES = {
  music: ['这首歌放完，我还是没按发送', '耳机摘下来以后，那句话终于说清了', '歌单越循环，误会怎么越深了', '散场时没回头，就能算不在乎吗', '前奏一响，聊天框里的勇气全没了', '别急着替那句晚安写结局', '这次不等副歌，我想先把话说完', '明明听着同一首歌，我们却想起不同的人', '把耳机分你一半，不代表我读懂了你', '那晚我删掉的，真的只是一条消息吗', '唱得越深情，越能证明认真吗', '一张空座位，为什么能让我想这么久', '你以为听懂了，其实只认出了自己的故事', '歌里的人没开口，评论区已经判完了', '如果把那段独白删掉，你还会站他吗', '演唱会结束了，我才开始听见自己', '一句好听的话，能替沉默解释多久', '原来最难的不是合唱，是把期待说清', '这段关系要重播，还是该换一个问法', '喜欢一首歌，需要和唱歌的人想得一样吗', '凌晨的歌单，装不下白天没说的条件', '那句很想你，到底在问什么', '同一句歌词，我怎么听出了两种答案', '别让一段前奏，替整段关系作证', '你期待的回应，也许根本没说出口', '在耳机里勇敢，为什么开口却退了一步', '把故事听成自己的，究竟错过了什么', '那次没去赴约，真的能用一首歌解释吗', '有些话适合唱出来，有些话得当面问', '别用一句没事，把所有问题都收掉'],
  cinema: ['最后一镜换个人，弹幕怎么全倒戈了', '把分手倒着放，你还会先骂他吗', '如果故事从她离开以后才开始', '结尾没有反转，反转的是我自己', '导演只少给一帧，我们就吵了一整晚', '那张空椅子，比台词更让我坐不住', '删掉配乐，这场告别还那么动人吗', '同一场争执，谁的镜头被剪掉了', '我想替那个没机会解释的人重看一次', '反派转过身以后，你还确定自己看全了吗', '如果先看到结局，你还愿意相信开场吗', '那句台词明明没变，怎么突然换了意思', '银幕暗下来的时候，问题才刚亮起来', '观众知道的秘密，凭什么要求角色也知道', '这段爱情没有输家，真的不是漂亮话吗', '换个座位再看，我不敢那么快下判断', '这次重看，我想盯住没被拍到的那一边', '一个拥抱，就能补回被剪掉的前提吗', '明明没看过结局，为什么早就选好了阵营', '离开电影院以后，我开始反驳那个好结局', '镜头替你靠近了谁，又把谁留在了门外', '只看见背影，就知道他为什么离开了吗', '故事里的沉默，到底是谁替谁写的', '再放一次开场，答案可能没那么简单', '我想给那个被略过的停顿，多留十秒', '如果没有旁白，你还知道该相信谁吗', '那场雨停了以后，谁的理由还站得住', '有些结局看着圆满，只是问题被剪走了', '为什么镜头一切，我们就急着换立场', '这次不猜反转，先看看谁没被允许开口'],
  gaming: ['救队友前不开麦，救完怎么还会吵起来', '活着撤出来，就能证明刚才每一步都对吗', '这波团赢了，我却不想替那个决定鼓掌', '先别甩结算图，把当时的信息说清楚', '队友说我怂，我想让他重看那十秒', '如果那时多报一句位置，争吵还会发生吗', '输一局以后，最容易丢的是什么', '回头救人那一刻，你到底在赌什么', '分数很好看，理由却经不起一句追问', '这次复盘，我想先关掉谁背锅的弹幕', '背包快满了，怎么反而更不敢走了', '打同一波团，我们真的看见同一张地图吗', '一句跟我走，够不够让所有人一起冒险', '把那一秒重开，信息还会站在你这边吗', '你说这叫意识，我想先问依据在哪里', '如果目标换了，最优解还会是同一个吗', '那次没回头，我真的该一直道歉吗', '别拿最后一名，替整场判断写总结', '开局说好一起，撤退时谁改了条件', '这局不急着站队，先把时间拨回开火前', '差一点就赢了，到底差在哪一点', '有人把队友叫累赘，也有人把沉默叫配合', '为什么最笃定的人，总爱跳过当时的限制', '战绩越亮眼，就越不需要解释过程吗', '同一个信号，为什么大家跑向不同方向', '有些翻盘靠的，也许不是你记住的那一招', '报点说晚三秒，责任就全算在那三秒吗', '先别争谁够义气，谁知道当时还能选什么', '把赢法抄下来，下一局就一定能赢吗', '这次我想复盘的，是那句没说清楚的话'],
};
export function headlineCandidates(post) {
  const kind = post.sceneKind || 'music', pool = HEADLINES[kind] || HEADLINES.music;
  const start = parseInt(hashContent(post.id || post.source?.key).slice(0, 6), 16) % pool.length;
  const rotated = [...pool.slice(start), ...pool.slice(0, start)];
  const topic = String(post.topical?.title || '');
  const leading = post.mode === 'ai-edit' ? [cleanHeadline(post.title)] : [];
  if (topic && topic.length <= 9) leading.push(kind === 'gaming' ? `${topic}那一局，谁把最关键的信息藏住了` : kind === 'cinema' ? `聊到${topic}，我想先替另一边留个镜头` : `听${topic}的时候，你替谁补完了没说的话`);
  return [...leading, ...rotated];
}
export function loadFeedCoverAssets() {
  return catalog.filter((asset) => /^\/assets\/feed-covers\/pexels-\d+\.jpg$/.test(asset.src) && fs.existsSync(path.join(root, asset.src.slice(1))));
}
export function createFeedPackaging({ q, q1, run, nowISO, assets = loadFeedCoverAssets() }) {
  const normalizeCover = (cover) => cover?.type === 'searched' && cover.src ? { ...cover, type: 'photo' } : cover;
  function initialize() {
    run(`CREATE TABLE IF NOT EXISTS learning_feed_packaging(post_id TEXT PRIMARY KEY REFERENCES learning_feed_posts(id) ON DELETE CASCADE,ordinal INTEGER NOT NULL,title TEXT NOT NULL,title_key TEXT NOT NULL UNIQUE,revision TEXT NOT NULL,cover_json TEXT NOT NULL,updated_at TEXT NOT NULL)`);
    run('CREATE TABLE IF NOT EXISTS learning_feed_media_usage(asset_hash TEXT PRIMARY KEY,post_id TEXT NOT NULL,asset_id TEXT NOT NULL)');
  }
  function decorate(post) {
    if (post.pending) return { ...post, cover: { type: 'text', style: 'paper', intendedType: 'text' } };
    const existing = q1('SELECT * FROM learning_feed_packaging WHERE post_id=?', post.id), revision = hashContent({ source: post.sourceHash, interest: post.interest, format: post.format, title: post.mode === 'ai-edit' ? post.title : '', pending: post.pending, style: PACKAGING_VERSION });
    if (existing?.revision === revision) {
      const cover = normalizeCover(parseJSON(existing.cover_json));
      if (cover?.type === 'photo' && parseJSON(existing.cover_json)?.type !== 'photo') run('UPDATE learning_feed_packaging SET cover_json=? WHERE post_id=?', JSON.stringify(cover), post.id);
      return { ...post, originalTitle: post.title, title: existing.title, cover };
    }
    const used = q('SELECT post_id,title FROM learning_feed_packaging WHERE post_id!=?', post.id), available = (title) => title.length >= 8 && title.length <= 42 && !used.some((row) => similarHeadline(row.title, title));
    let title = headlineCandidates(post).find(available);
    if (!title) {
      const scenes = post.sceneKind === 'gaming' ? ['结算之前', '开麦以后', '撤退路上', '下一次组队时', '地图暗下来的时候'] : post.sceneKind === 'cinema' ? ['最后一排', '电影散场以后', '镜头之外', '下一次重看时', '那段被剪掉的停顿'] : ['耳机摘下来以后', '散场路上', '歌单跳到下一首时', '那条草稿消息里', '没亮起来的手机屏上'];
      const questions = ['我想先问清那个没说完的条件', '这次，别急着替另一个人作答', '有个问题值得再停一下', '把没看见的那一边也放进来', '一个好听的结论，还差多少依据', '那句肯定，能经得起一个反例吗', '先别急着替沉默编一个理由', '我们是不是漏掉了另一个选项', '如果只许问一句，你会先问什么', '让你改口的，会是哪条新消息', '谁在替一个没发生的结局生气', '这一次，把当时的限制也说出来', '少掉那句话，还会有同样的误会吗', '你最笃定的地方，也许值得重看', '这次站队之前，我想多等一个回答', '能不能把那个例外也讲清楚', '不是所有沉默，都有相同的理由', '我们一直在吵的，会是同一个问题吗', '让故事慢一点，答案会不会不同', '为什么越着急，越容易跳过那一步'];
      scenes.push('回去的地铁上', '下一次聊天前', '那条很长的留言里', '朋友挂断电话以后', '当大家同时点头时', '那个没有答案的晚上', '另一个人开口以前', '争论停下来的时候', '那次重逢以后', '把时间再拨回去');
      const candidates = scenes.flatMap((scene) => questions.map((question) => `${scene}，${question}`)).filter((candidate) => candidate.length <= 42);
      title = candidates.find(available) || candidates.find((candidate) => !used.some((row) => cleanKey(row.title) === cleanKey(candidate)));
      if (!title) throw new Error('本轮标题素材已用完，请先成篇一部分文章，再更新推荐。');
    }
    const ordinal = existing?.ordinal ?? Number(q1('SELECT COALESCE(MAX(ordinal),-1)+1 AS n FROM learning_feed_packaging')?.n || 0);
    let cover = { type: 'text', style: ordinal % 2 ? 'ink' : 'paper', intendedType: [1, 4, 8].includes(ordinal % 10) ? 'text' : 'photo' };
    const previous = normalizeCover(parseJSON(existing?.cover_json));
    if (cover.intendedType === 'photo') {
      if (previous?.type === 'photo' && assets.some((asset) => asset.id === previous.id && asset.kind === post.sceneKind)) cover = previous;
      else {
        const candidates = assets.filter((asset) => asset.kind === post.sceneKind && !q1('SELECT asset_hash FROM learning_feed_media_usage WHERE asset_hash=?', asset.sha256));
        const words = [[/耳机/, /headphone/i], [/开麦|开口|独白|唱|副歌|前奏/, /microphone|guitar|musician|music/i], [/散场|演唱会/, /stage|concert|crowd/i], [/银幕|结尾|镜头|电影/, /cinema|theater|screen|film|camera/i], [/开麦|队友|地图|团|撤|结算/, /gam(e|ing)|controller|computer|keyboard/i]];
        const relevance = (asset) => words.reduce((score, [query, match]) => score + (query.test(title) && match.test(asset.alt || asset.title) ? 1 : 0), 0);
        candidates.sort((a, b) => relevance(b) - relevance(a) || hashContent(`${post.id}:${a.id}`).localeCompare(hashContent(`${post.id}:${b.id}`)));
        const asset = candidates[0];
        if (asset) { cover = { ...asset, type: 'photo', caption: '情境摄影，非艺人照片或事件现场' }; run('INSERT INTO learning_feed_media_usage(asset_hash,post_id,asset_id) VALUES(?,?,?)', asset.sha256, post.id, asset.id); }
      }
    }
    run('INSERT INTO learning_feed_packaging(post_id,ordinal,title,title_key,revision,cover_json,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(post_id) DO UPDATE SET title=excluded.title,title_key=excluded.title_key,revision=excluded.revision,cover_json=excluded.cover_json,updated_at=excluded.updated_at', post.id, ordinal, title, cleanKey(title), revision, JSON.stringify(cover), nowISO());
    return { ...post, originalTitle: post.title, title, cover };
  }
  function recentTitles(except, limit = 25) { return q('SELECT title FROM learning_feed_packaging WHERE post_id!=? ORDER BY updated_at DESC LIMIT ?', except || '', limit).map((row) => row.title); }
  const status = () => ({ availablePhotos: assets.length, usedPhotos: Number(q1('SELECT COUNT(*) AS n FROM learning_feed_media_usage')?.n || 0), textRatio: .3, source: '已检索并缓存的授权摄影图库' });
  function removePost(id) { run('DELETE FROM learning_feed_packaging WHERE post_id=?', id); run("UPDATE learning_feed_media_usage SET post_id='' WHERE post_id=?", id); }
  return { initialize, decorate, recentTitles, status, removePost };
}
