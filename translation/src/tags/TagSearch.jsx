import { useState, useEffect } from 'preact/hooks';
import { listProjects, listTags, searchHighlights } from '../db.js';

export function TagSearch({ onNavigate, onClose }) {
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [tags, setTags] = useState([]);
  const [selectedTag, setSelectedTag] = useState(null);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (selectedProject) loadTags(selectedProject);
    else { setTags([]); setSelectedTag(null); }
  }, [selectedProject]);

  useEffect(() => {
    if (selectedProject) doSearch();
  }, [selectedProject, selectedTag]);

  async function loadProjects() {
    try {
      const data = await listProjects();
      setProjects(data || []);
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  }

  async function loadTags(projectId) {
    try {
      const data = await listTags(projectId);
      setTags(data || []);
    } catch (err) {
      console.error('Failed to load tags:', err);
    }
  }

  async function doSearch() {
    setLoading(true);
    try {
      const data = await searchHighlights({
        projectId: selectedProject,
        tagId: selectedTag,
      });
      setResults(data || []);
    } catch (err) {
      console.error('Search failed:', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="tag-search">
      <div className="tag-search-header">
        <h3>Search Highlights</h3>
        <button className="tag-picker-close" onClick={onClose}>&times;</button>
      </div>

      <div className="tag-search-filters">
        <select
          className="np-select"
          value={selectedProject || ''}
          onChange={e => { setSelectedProject(e.target.value || null); setSelectedTag(null); }}
        >
          <option value="">Select project...</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {tags.length > 0 && (
          <div className="tag-search-tags">
            <button
              className={`tag-filter-btn ${!selectedTag ? 'active' : ''}`}
              onClick={() => setSelectedTag(null)}
            >
              All
            </button>
            {tags.map(tag => (
              <button
                key={tag.id}
                className={`tag-filter-btn ${selectedTag === tag.id ? 'active' : ''}`}
                onClick={() => setSelectedTag(tag.id)}
                style={{ '--tag-color': tag.color }}
              >
                <span className="tag-picker-dot" style={{ background: tag.color }} />
                {tag.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="tag-search-results">
        {loading && <p className="tag-search-loading">Searching...</p>}
        {!loading && results.length === 0 && selectedProject && (
          <p className="tag-search-empty">No highlights found.</p>
        )}
        {results.map(r => (
          <div
            key={r.id}
            className="tag-search-result"
            onClick={() => onNavigate && onNavigate(r)}
          >
            <div className="tag-search-result-meta">
              <span className="tag-search-result-transcript">{r.transcripts?.name || 'Unknown'}</span>
              {r.tags && <span className="tag-search-result-tag" style={{ color: r.tags.color }}>{r.tags.name}</span>}
            </div>
            <p className="tag-search-result-text">{r.text_preview}</p>
            {r.original_text_preview && (
              <p className="tag-search-result-original">{r.original_text_preview}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
