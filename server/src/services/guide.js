// 办事导航：把"我想做某事"映射到"该去哪个系统/页面"
// 目录为人工整理的常用事项（URL 均为实测或公开入口）

export const SERVICES = [
  // ===== 教务 i.sjtu.edu.cn =====
  { id: 'jw-kb', cat: '教务', name: '我的课表', url: 'https://i.sjtu.edu.cn/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151', kw: ['课表', '上课', '今天有课', '明天有课', '教室'], login: true, tip: '教务系统 → 个人课表查询' },
  { id: 'jw-cj', cat: '教务', name: '成绩查询', url: 'https://i.sjtu.edu.cn/cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005', kw: ['成绩', '分数', '绩点', 'GPA', '考了多少', '挂科'], login: true, tip: '教务系统 → 学生成绩查询' },
  { id: 'jw-py', cat: '教务', name: '培养方案 / 学分要求', url: 'https://i.sjtu.edu.cn/xspyfagl/xspyfaxxwh_cxXsPyfaxxwhIndex.html?gnmkdm=N1532', kw: ['培养方案', '培养计划', '学分要求', '毕业要求', '修业'], login: true, tip: '教务系统 → 个人培养方案' },
  { id: 'jw-ks', cat: '教务', name: '考试安排查询', url: 'https://i.sjtu.edu.cn/kwgl/kscx_cxXsksxxIndex.html?gnmkdm=N358105', kw: ['考试', '考试时间', '考试安排', '考场', '期末考'], login: true, tip: '教务系统 → 考试信息查询' },
  { id: 'jw-xk', cat: '教务', name: '自主选课', url: 'https://i.sjtu.edu.cn/xsxk/zzxkyzb_cxZzxkYzbIndex.html?gnmkdm=N253512', kw: ['选课', '抢课', '加课', '退课', '选修', '通识课'], login: true, tip: '教务系统 → 自主选课（注意选课时间窗口）' },
  { id: 'jw-cx', cat: '教务', name: '重修报名', url: 'https://i.sjtu.edu.cn/cxbm/cxbm_cxXscxbmIndex.html?gnmkdm=N1056', kw: ['重修', '补考', '重考'], login: true, tip: '教务系统 → 重修选课' },
  { id: 'jw-gr', cat: '教务', name: '个人信息 / 学籍', url: 'https://i.sjtu.edu.cn/xsxxxggl/xsgrxxwh_cxXsgrxx.html?gnmkdm=N100801', kw: ['学籍', '个人信息', '学号', '班级'], login: true, tip: '教务系统 → 查询个人信息' },

  // ===== Canvas =====
  { id: 'cv-home', cat: 'Canvas', name: 'Canvas 课程中心', url: 'https://oc.sjtu.edu.cn/courses', kw: ['canvas', '课程', '课件', '作业', '公告', '讨论'], login: true, tip: '所有课程、作业、公告、课件都在这' },
  { id: 'cv-cal', cat: 'Canvas', name: 'Canvas 日历（全部 DDL）', url: 'https://oc.sjtu.edu.cn/calendar', kw: ['日历', 'ddl', '截止', '什么时候交'], login: true, tip: 'Canvas → 日历，一次看全部截止时间' },
  { id: 'cv-video', cat: 'Canvas', name: '课堂视频（录播回放）', url: 'https://oc.sjtu.edu.cn/courses', kw: ['录播', '回放', '课堂视频', '看录像', '补课'], login: true, tip: '进任意课程 → 左侧「课堂视频新版」。⚠️ 别走 v.sjtu 门户，那里要申请' },

  // ===== 交我办 =====
  { id: 'my-home', cat: '交我办', name: '交我办（办事大厅）', url: 'https://my.sjtu.edu.cn/', kw: ['办事', '申请', '证明', '请假', '流程', '交我办'], login: true, tip: '请假、开证明、缴费、报修等都在交我办的办事大厅' },
  { id: 'my-task', cat: '交我办', name: '我的待办事项', url: 'https://my.sjtu.edu.cn/', kw: ['待办', '在办', '我的流程', '进度'], login: true, tip: '交我办 → 待办（工作台仪表盘也会显示）' },
  { id: 'my-fee', cat: '交我办', name: '缴费（学费/住宿费）', url: 'https://my.sjtu.edu.cn/', kw: ['缴费', '学费', '住宿费', '欠费', '交钱'], login: true, tip: '交我办 → 待办里点「待缴费用」，或搜财务缴费' },

  // ===== 图书馆 =====
  { id: 'lib-seat', cat: '图书馆', name: '图书馆选座', url: 'https://libseat.sjtu.edu.cn/', kw: ['选座', '座位', '自习', '图书馆位置', '有空位吗'], login: true, tip: '工作台仪表盘也能看实时空位（无需登录）' },
  { id: 'lib-space', cat: '图书馆', name: '研讨间 / 面试空间预约', url: 'https://libspace.sjtu.edu.cn/', kw: ['研讨间', '小组学习室', '面试间', '预约空间'], login: true, tip: 'libspace → 空间预约' },
  { id: 'lib-home', cat: '图书馆', name: '图书馆主页（借阅/续借/查资料）', url: 'https://www.lib.sjtu.edu.cn/', kw: ['借书', '续借', '还书', '文献', '数据库', '查论文'], login: false, tip: '借阅查询要点「我的图书馆」' },

  // ===== 学习与生活 =====
  { id: 'sea-home', cat: '生活', name: '宿舍电费查询 / 充值', url: 'https://elec.sjtu.edu.cn/', kw: ['电费', '电量', '宿舍电', '没电', '充电费'], login: true, tip: 'jAccount 登录后可看余额与充值' },
  { id: 'dekt-home', cat: '生活', name: '第二课堂成绩单', url: 'https://dektcjd.sjtu.edu.cn/', kw: ['第二课堂', '劳动教育', '志愿', '学时', '素拓'], login: true, tip: '劳动教育/志愿公益学时查询（毕业要求之一）' },
  { id: 'affairs-home', cat: '生活', name: '学生事务中心（奖助学金/资助）', url: 'https://affairs.sjtu.edu.cn/', kw: ['奖学金', '助学金', '资助', '困难认定', '补助', '勤工助学'], login: false, tip: '奖学金与资助通知都在这里，工作台「信息源」已订阅' },
  { id: 'job-home', cat: '生活', name: '就业信息网（实习/招聘/宣讲会）', url: 'https://www.job.sjtu.edu.cn/', kw: ['实习', '招聘', '找工作', '宣讲会', '就业', '简历投递'], login: false, tip: '大一也可以先看实习与宣讲会' },
  { id: 'soft-home', cat: '生活', name: '正版软件下载（Windows/Office/MATLAB…）', url: 'https://software.sjtu.edu.cn/', kw: ['软件', '正版', 'office', 'matlab', 'windows', 'matlab', '装软件'], login: false, tip: '交大免费正版软件，比找破解靠谱' },
  { id: 'lic-home', cat: '生活', name: '专业软件授权（Solidworks/LabVIEW 等）', url: 'https://lic.sjtu.edu.cn/', kw: ['授权', 'solidworks', 'labview', 'license', '激活'], login: false, tip: '学创软件授权中心公告与安装指南' },
  { id: 'net-home', cat: '生活', name: '网络信息中心（jAccount/网络报修/云盘）', url: 'https://net.sjtu.edu.cn/', kw: ['网络', 'jaccount', '校园网', '报修', 'vpn', '密码', '改密码'], login: false, tip: 'jAccount 密码、校园网、VPN、云盘服务目录' },
  { id: 'pan-home', cat: '生活', name: '交大云盘', url: 'https://pan.sjtu.edu.cn/', kw: ['云盘', '网盘', '存文件', '共享文件'], login: true, tip: '校内云盘，大文件传输方便' },
  { id: 'cet-home', cat: '考试', name: '四六级报名（CET）', url: 'https://cet-bm.neea.edu.cn/', kw: ['四六级', 'cet', '英语考试', '六级报名'], login: true, tip: '全国大学英语四六级报名官网' },
  { id: 'chsi-home', cat: '考试', name: '学信网（学籍自查/学历）', url: 'https://www.chsi.com.cn/', kw: ['学信网', '学籍查询', '学籍自查', '学历'], login: true, tip: '教务通知要求新生做学信网学籍自查' },

  // ===== 校园服务（实测可用） =====
  { id: 'global-home', cat: '发展', name: '国际合作与交流处（交换/海外项目）', url: 'https://global.sjtu.edu.cn/', kw: ['交换', '出国', '海外', '留学', '国际交流', '访学'], login: false, tip: '交换生与海外研修项目通知' },
  { id: 'sports-home', cat: '生活', name: '体育场馆预约（羽毛球/网球/游泳…）', url: 'https://sports.sjtu.edu.cn/pc/', kw: ['体育场馆', '球场', '羽毛球', '网球', '游泳', '健身', '预约场地', '运动'], login: true, tip: '交大体育场馆在线预约' },
  { id: 'hospital-home', cat: '生活', name: '校医院（挂号/就诊）', url: 'https://hospital.sjtu.edu.cn/web/index', kw: ['医院', '看病', '挂号', '体检', '生病', '医保'], login: true, tip: '校医院管理平台' },
  { id: 'ecard-home', cat: '生活', name: '校园一卡通（充值/消费/挂失）', url: 'https://ecard.sjtu.edu.cn/', kw: ['一卡通', '校园卡', '饭卡', '充值', '挂失', '消费记录'], login: true, tip: '校园卡充值、消费查询、挂失' },
  { id: 'icci-home', cat: '资讯', name: '文创学院 ICCI（南加州大学合办）', url: 'http://icci.sjtu.edu.cn/', kw: ['文创学院', 'icci', '南加州', '文化产业'], login: false, tip: '传播方向相关学院，可关注项目与讲座' },

  // ===== 校内信息 =====
  { id: 'news-sjtu', cat: '资讯', name: '交大新闻网', url: 'https://news.sjtu.edu.cn/', kw: ['校园新闻', '学校动态'], login: false, tip: '工作台「信息源」已订阅' },
  { id: 'jwc-home', cat: '资讯', name: '教务处通知通告', url: 'https://www.jwc.sjtu.edu.cn/xwtg/tztg.htm', kw: ['教务通知', '教务处', '教学通知'], login: false, tip: '选课、考试、学籍等重要通知来源' },
  { id: 'smc-home', cat: '资讯', name: '媒体与传播学院（本院）', url: 'https://smc.sjtu.edu.cn/', kw: ['学院', '媒传', '传播学院', '本院'], login: false, tip: '你的学院：媒体与传播学院' },
];

// 关键词匹配打分（中文关键词多为 2 字，权重给足，保证常见问题走本地零成本）
export function matchServices(query, limit = 5) {
  const q = String(query ?? '').toLowerCase().trim();
  if (!q) return [];
  const scored = SERVICES.map((s) => {
    let score = 0;
    const reasons = [];
    for (const k of s.kw) {
      const kk = k.toLowerCase();
      if (q.includes(kk)) {
        score += kk.length >= 3 ? 4 : 3;
        reasons.push(k);
      }
    }
    if (q.includes(s.name.toLowerCase())) { score += 6; reasons.push('名称命中'); }
    if (q.includes(s.cat.toLowerCase())) score += 2;
    return { ...s, score, reasons };
  }).filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export function suggestByCategory() {
  const out = {};
  for (const s of SERVICES) {
    out[s.cat] = out[s.cat] ?? [];
    out[s.cat].push({ id: s.id, name: s.name, url: s.url, tip: s.tip, login: s.login });
  }
  return out;
}
