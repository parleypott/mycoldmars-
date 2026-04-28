import { render, h } from 'preact';
import { TranscriptEditor } from './Editor.jsx';

let currentUnmount = null;
let currentProps = null;

/**
 * Mount the Tiptap editor into a DOM container.
 */
export function mountEditor(container, props) {
  // Unmount previous if any
  if (currentUnmount) {
    currentUnmount();
    currentUnmount = null;
  }

  currentProps = { ...props };
  render(h(TranscriptEditor, currentProps), container);

  currentUnmount = () => render(null, container);

  return {
    unmount: () => {
      render(null, container);
      currentUnmount = null;
      currentProps = null;
    },
    update: (newProps) => {
      // Merge partial updates into existing props
      currentProps = { ...currentProps, ...newProps };
      render(h(TranscriptEditor, currentProps), container);
    },
  };
}
