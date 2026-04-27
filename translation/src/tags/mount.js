import { render, h } from 'preact';
import { TagSearch } from './TagSearch.jsx';

export function mountTagSearch(container, { onNavigate, onClose }) {
  render(h(TagSearch, { onNavigate, onClose }), container);
  return {
    unmount: () => render(null, container),
  };
}
