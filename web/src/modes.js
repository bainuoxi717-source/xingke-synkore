// 导航配置（深度学习模块 · 独立版：单一模式，无生活模式）
// 想加新栏目：① 在这里加一行 ② 在 App.jsx 加一条 <Route>
import {
  MessageCircle, Mic2, BookMarked, Video, NotebookPen, ListChecks, Settings, Library,
} from 'lucide-react';

export const APP = {
  name: '深度学习',
  icon: '🎓',
  desc: '问老师 · 换讲法 · 内化课堂',
  version: '1.0.0',
};

// core: true 的栏目算核心能力（可用来做首页快捷入口）
export const NAV_ITEMS = [
  { to: '/qa', label: '学习问答', icon: MessageCircle, core: true, hint: '用老师的口吻问答，附真实 PPT' },
  { to: '/restyle', label: '换讲法', icon: Mic2, core: true, hint: '用你听得进去的讲法，重讲必须学的课' },
  { to: '/lecture-notes', label: '课次笔记', icon: BookMarked, core: true, hint: '课后自动蒸馏的结构化笔记' },
  { to: '/videos', label: '视频内化', icon: Video, hint: '课堂录播 → 字幕 / 总结 / PPT' },
  { to: '/notes', label: '资料笔记', icon: NotebookPen, hint: '我的笔记' },
  { to: '/materials', label: '课程资料', icon: Library, hint: '课件与文件' },
  { to: '/plan', label: '学习计划', icon: ListChecks, hint: '按周次排学习计划' },
  { to: '/settings', label: '导入与设置', icon: Settings, hint: 'API Key / 学校接入 / 老师音色' },
];
