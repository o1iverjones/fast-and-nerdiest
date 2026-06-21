import { useEffect, useRef, useState } from 'react';

export default function ArticleView({ title, onNavigate, disabled }) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const containerRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!title) return;

    setLoading(true);
    setError('');
    setHtml('');

    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const encoded = encodeURIComponent(title);
    fetch(`/api/wiki/article/${encoded}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); return; }
        setHtml(data.html);
        // Scroll to top on new article
        if (containerRef.current) containerRef.current.scrollTop = 0;
      })
      .catch(err => {
        if (err.name !== 'AbortError') setError('Failed to load article.');
      })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [title]);

  function handleClick(e) {
    if (disabled) return;
    const link = e.target.closest('[data-wiki-link]');
    if (!link) return;
    e.preventDefault();
    const target = link.getAttribute('data-wiki-link');
    if (target) onNavigate(target);
  }

  return (
    <div className="article-view" ref={containerRef}>
      {loading && (
        <div className="article-loading">
          <div className="spinner" />
          <span>Loading article…</span>
        </div>
      )}
      {error && (
        <div className="article-error">
          <p>Could not load article: <strong>{title}</strong></p>
          <p className="hint">{error}</p>
        </div>
      )}
      {!loading && !error && (
        <div
          className="article-body"
          onClick={handleClick}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
