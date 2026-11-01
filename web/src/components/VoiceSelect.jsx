import { Volume2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { displayTeacher } from '../utils/showcasePrivacy.js';

export default function VoiceSelect({ readout }) {
  const voices = (readout.catalog?.teachers || []).filter((item) => item.hasVoice);
  return <>
    <label className="persona-select"><Volume2 size={14} /><span>声音</span><select aria-label="选择朗读音色" value={readout.voice} onChange={(event) => readout.setVoice(event.target.value)}>
      <option value="">系统声音</option>
      {!!voices.length && <optgroup label="已克隆音色">{voices.map((item) => <option key={item.teacher} value={item.teacher}>{displayTeacher(item.teacher)} · 已克隆</option>)}</optgroup>}
      {readout.voice && !voices.some((item) => item.teacher === readout.voice) && <option value={readout.voice}>所选音色暂不可用</option>}
    </select></label>
    {readout.voice && readout.catalog && (!readout.catalog.enabled || !readout.catalog.hasKey) && <Link className="btn sm ghost" to="/settings?focus=minimaxKey">配置语音服务</Link>}
    {readout.error && <span role="alert" style={{ fontSize: 12, color: 'var(--warn)', flexBasis: '100%' }}>{readout.error}</span>}
  </>;
}
