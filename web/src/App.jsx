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
            <span className={`connection-status ${connection}`}><i />{connection === 'ready' ? '本地空间已连接' : connection === 'error' ? '本地空间未连接' : '正在连接'}</span>
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
            <Route path="/personas/custom" element={<Workspace><CustomPersona /></Workspace>} />
            <Route path="/lecture-notes" element={<Workspace><LectureNotes /></Workspace>} />
            <Route path="/videos" element={<Workspace><Videos /></Workspace>} />
            <Route path="/notes" element={<Workspace><Notes /></Workspace>} />
            <Route path="/materials" element={<Workspace><Materials /></Workspace>} />
            <Route path="/plan" element={<Workspace><Plan /></Workspace>} />
            <Route path="/settings" element={<Workspace><SettingsPage /></Workspace>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
function Workspace({ children }) { return <div className="workspace-page">{children}</div>; }
function HomeRoute() {
  const location = useLocation(), params = new URLSearchParams(location.search);
  if (location.hash === '#learning-feed' || params.has('post')) return <Navigate to={{ pathname: '/learning-feed', search: location.search }} replace />;
  if (params.has('personaId')) return <Navigate to={{ pathname: '/qa', search: location.search }} replace />;
  return <AgentHome />;
}
