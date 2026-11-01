import { useEffect, useRef, useState } from 'react';
import { Link, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from './api.js';
import AgentHome from './pages/AgentHome.jsx';
import Assistant from './pages/Assistant.jsx';
import LearningFeed from './components/LearningFeed.jsx';
import QA from './pages/QA.jsx';
import Restyle from './pages/Restyle.jsx';
import LectureNotes from './pages/LectureNotes.jsx';
import Videos from './pages/Videos.jsx';
import Notes from './pages/Notes.jsx';
import Materials from './pages/Materials.jsx';
import Plan from './pages/Plan.jsx';
import SettingsPage from './pages/Settings.jsx';
import CustomPersona from './pages/CustomPersona.jsx';
import ReplayDemo from './pages/ReplayDemo.jsx';
import BrandWordmark from './components/BrandWordmark.jsx';

// Existing pages remain available by their original URLs while their entrances
// are hidden pending the user's decisions about which capabilities to keep.
export default function App() {
  const [connection, setConnection] = useState('loading');
  const mainRef = useRef(null);
  const location = useLocation();
  useEffect(() => {
    let active = true;
    api.get('/health').then(() => { if (active) setConnection('ready'); }).catch(() => { if (active) setConnection('error'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (['#listening-space', '#learning-feed'].includes(location.hash)) {
      const frame = requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' }));
      return () => cancelAnimationFrame(frame);
    }
    mainRef.current?.scrollTo({ top: 0 });
  }, [location.pathname, location.hash]);
  return (
    <div className="agent-layout agent-layout-focused">
      <a className="skip-link" href="#agent-main">跳到主要内容</a>
      <div className="agent-shell">
        <header className="agent-topbar">
          <BrandWordmark />
          <div className="topbar-actions">
            {location.pathname !== '/' && <Link className="back-home" to="/"><ArrowLeft size={15} /> 返回首页</Link>}
            <span className={`connection-status ${connection}`} title={import.meta.env.VITE_PUBLIC_DEMO === '1' ? '公开示例课程与预设讲解，不调用在线模型；互动保存在当前浏览器。' : undefined}><i />{import.meta.env.VITE_PUBLIC_DEMO === '1' ? '公开演示 · 预设内容' : connection === 'ready' ? '本地空间已连接' : connection === 'error' ? '本地空间未连接' : '正在连接'}</span>
          </div>
        </header>
        <main className="agent-main" id="agent-main" ref={mainRef}>
          <Routes>
            <Route path="/" element={<HomeRoute />} />
            <Route path="/assistant" element={<Assistant />} />
            <Route path="/learning-feed" element={<div className="feed-page"><LearningFeed /></div>} />
            <Route path="/replay-demo" element={<Workspace><ReplayDemo /></Workspace>} />
            <Route path="/qa" element={<Workspace><QA /></Workspace>} />
            <Route path="/restyle" element={<Workspace><Restyle /></Workspace>} />
            <Route path="/personas/custom" element={<Workspace>{import.meta.env.VITE_PUBLIC_DEMO === '1' ? <PublicDemoInfo /> : <CustomPersona />}</Workspace>} />
            <Route path="/lecture-notes" element={<Workspace><LectureNotes /></Workspace>} />
            <Route path="/videos" element={<Workspace><Videos /></Workspace>} />
            <Route path="/notes" element={<Workspace><Notes /></Workspace>} />
            <Route path="/materials" element={<Workspace><Materials /></Workspace>} />
            <Route path="/plan" element={<Workspace><Plan /></Workspace>} />
            <Route path="/settings" element={<Workspace>{import.meta.env.VITE_PUBLIC_DEMO === '1' ? <PublicDemoInfo /> : <SettingsPage />}</Workspace>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
function Workspace({ children }) { return <div className="workspace-page">{children}</div>; }
function PublicDemoInfo() { return <section className="panel"><h1>公开演示说明</h1><p>这里提供人工编写的示例课程、预设讲解与浏览器内互动。没有接入在线模型或私人课程。</p><p>人物调研、资料上传、真人音色和 USB 开发板连接，请从 GitHub 下载完整本地版并使用自己的授权配置。</p><p><Link to="/qa">体验学习问答</Link> · <Link to="/replay-demo">五分钟随堂伴学</Link> · <a href="https://github.com/bainuoxi717-source/xingke-synkore" target="_blank" rel="noreferrer">完整源码与运行说明 ↗</a></p></section>; }
function HomeRoute() {
  const location = useLocation(), params = new URLSearchParams(location.search);
  if (location.hash === '#learning-feed' || params.has('post')) return <Navigate to={{ pathname: '/learning-feed', search: location.search }} replace />;
  if (params.has('personaId')) return <Navigate to={{ pathname: '/qa', search: location.search }} replace />;
  return <AgentHome />;
}
