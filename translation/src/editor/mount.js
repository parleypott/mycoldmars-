import { render, h } from 'preact';
import { TranscriptEditor } from './Editor.jsx';

let currentUnmount = null;

/**
 * Mount the Tiptap editor into a DOM container.
 */
export function mountEditor(container, props) {
  // Unmount previous if any
  if (currentUnmount) {
    currentUnmount();
    currentUnmount = null;
  }

  render(h(TranscriptEditor, props), container);

  currentUnmount = () => render(null, container);

  return {
    unmount: () => {
      render(null, container);
      currentUnmount = null;
    },
    update: (newProps) => {
      render(h(TranscriptEditor, newProps), container);
    },
  };
}
