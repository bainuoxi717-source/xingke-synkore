import { Navigate, useLocation } from 'react-router-dom';

// Keep old links and persona return URLs working without another input page.
export default function Assistant() {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: '/qa', search, hash }} replace />;
}
