import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pause, Play } from 'lucide-react';
import '../focused-home.css';
import LearningMascot from '../components/LearningMascot.jsx';
import ListeningSpace from '../components/ListeningSpace.jsx';
export default function AgentHome() {
  const navigate = useNavigate();
  const [motion, setMotion] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = (event) => setMotion(!event.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return <div className="agent-home focused-home">
    <section className="agent-hero" aria-labelledby="hero-title">
      <div className="hero-eyebrow"><span /> YOUR PERSONAL LEARNING SPACE</div>
      <h1 id="hero-title">built for <em>your learning</em></h1>
      <div className="hero-art mascot-hero-art"><LearningMascot motion={motion} onAssistant={() => navigate('/qa')} onFeed={() => navigate('/learning-feed')} onClassroom={() => navigate('/replay-demo')} /></div>
      <button className="motion-toggle" onClick={() => setMotion(!motion)} aria-pressed={!motion} aria-label={motion ? '暂停卡通动画' : '播放卡通动画'}>{motion ? <Pause size={12} /> : <Play size={12} />}</button>
    </section>
    <ListeningSpace motion={motion} />
  </div>;
}
