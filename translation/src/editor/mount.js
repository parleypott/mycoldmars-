import { render, h } from 'preact';
import { TranscriptEditor } from './Editor.jsx';

let currentUnmount = null;

/**
 * Mount the Tiptap editor into a DOM container.
 * Returns an object with methods to interact with the mounted editor.
 */
export function mountEditor(container, { initialContent, projectId, onUpdate, onAskAI }) {
  // Unmount previous if any
  if (currentUnmount) {
    currentUnmount();
    currentUnmount = null;
  }

  render(
    h(TranscriptEditor, {
      initialContent,
      projectId,
      onUpdate,
      onAskAI,
    }),
    container
  );

  currentUnmount = () => render(null, container);

  return {
    unmount: () => {
      render(null, container);
      currentUnmount = null;
    },
  };
}
