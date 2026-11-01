// 行内 PPT 引用：文字里提到「PPT 第 3 张」时，就地显示缩略图 + 悬停浮出大图 + 点击放大
import { useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { pptSrc } from '../utils.js';

export default function SlideRef({ n, slides, onOpen }) {
  const slide = slides?.[n - 1];
  const [hover, setHover] = useState(false);
  if (!slide) {
    // 没匹配到图片（AI 引用了超出范围的编号）→ 退化成普通文字标记
    return <span className="slide-ref-plain">PPT 第 {n} 张</span>;
  }
  return (
    <span
      className="slide-ref"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button className="slide-ref-chip" onClick={() => onOpen?.(slide)} title="点击放大">
        <img src={pptSrc(slide.url)} alt={slide.idx} loading="lazy" />
        <span className="slide-ref-label"><ImageIcon size={11} /> PPT {n}</span>
      </button>

      {hover && (
        <span className="slide-ref-pop">
          <img src={pptSrc(slide.url)} alt={slide.idx} />
          <span className="slide-ref-cap">
            <b>{slide.idx}</b> {slide.date} 第{slide.leti}节
            {slide.comment && <span className="slide-ref-comment">{slide.comment}</span>}
          </span>
        </span>
      )}
    </span>
  );
}
