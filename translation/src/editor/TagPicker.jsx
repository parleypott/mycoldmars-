import { useState, useEffect } from 'preact/hooks';
import { listTags, createTag } from '../db.js';

const TAG_COLORS = ['#DD2C1E', '#004CFF', '#0D5921', '#FFBF00', '#520004', '#6B5CE7', '#E85D04', '#412C27'];

export function TagPicker({ projectId, onSelect, onClose }) {
  const [tags, setTags] = useState([]);
  const [newTagName, setNewTagName] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (projectId) {
      setLoading(true);
      loadTags();
    }
  }, [projectId]);

  async function loadTags() {
    try {
      const data = await listTags(projectId);
      setTags(data || []);
    } catch (err) {
      console.error('Failed to load tags:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleCreate() {
    const name = newTagName.trim();
    if (!name) return;
    const color = TAG_COLORS[tags.length % TAG_COLORS.length];

    if (projectId) {
      // Save to DB
      createTag({ projectId, name, color })
        .then(tag => {
          setTags([...tags, tag]);
          setNewTagName('');
          onSelect(tag);
        })
        .catch(err => console.error('Failed to create tag:', err));
    } else {
      // Local-only tag — no DB needed
      const localTag = {
        id: `local-${Date.now()}`,
        name,
        color,
      };
      setTags([...tags, localTag]);
      setNewTagName('');
      onSelect(localTag);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreate();
    }
    if (e.key === 'Escape') onClose();
  }

  return (
    <div className="tag-picker-overlay" onClick={onClose}>
      <div className="tag-picker" onClick={e => e.stopPropagation()}>
        <div className="tag-picker-header">
          <span className="np-eyebrow">Tag</span>
          <button className="tag-picker-close" onClick={onClose}>&times;</button>
        </div>
        {loading ? (
          <div className="tag-picker-loading">Loading...</div>
        ) : (
          <>
            <div className="tag-picker-list">
              {tags.map(tag => (
                <button
                  key={tag.id}
                  className="tag-picker-item"
                  onClick={() => onSelect(tag)}
                >
                  <span className="tag-picker-dot" style={{ background: tag.color }} />
                  {tag.name}
                </button>
              ))}
            </div>
            <div className="tag-picker-create">
              <input
                type="text"
                placeholder="New tag..."
                value={newTagName}
                onInput={e => setNewTagName(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
              />
              <button onClick={handleCreate}>+</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
