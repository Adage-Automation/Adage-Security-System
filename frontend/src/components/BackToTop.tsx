import { useEffect, useState } from 'react';
import { IconArrowUp } from './icons';

// Scroll-to-top button for pages whose "Load More" pattern can grow very
// tall (e.g. Employees with 200+ rows) — once scrolled a few screens
// down, getting back to the search/filter bar at the top otherwise means
// a long manual scroll. Found in the 2026-10-05 Employees-page request.
const SHOW_THRESHOLD_PX = 400;

export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SHOW_THRESHOLD_PX);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button type="button" className="back-to-top-btn" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Back to top">
      <IconArrowUp />
    </button>
  );
}
