import { Link } from 'react-router-dom';
import '../wordmark.css';

export default function BrandWordmark() {
  return <Link to="/" className="focused-wordmark synkore-wordmark" aria-label="synkore·醒课 首页">
    <i className="synkore-lettering" aria-hidden="true">synk<img src="/assets/learning-mascot/mascot-smile.png" alt="" draggable="false" />re</i>
    <b className="synkore-chinese" aria-hidden="true">·醒课</b>
  </Link>;
}
