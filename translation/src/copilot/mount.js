import { render, h } from 'preact';
import { CopilotPanel } from './CopilotPanel.jsx';

let mounted = false;

export function mountCopilot(container, props) {
  render(h(CopilotPanel, props), container);
  mounted = true;
  return {
    update: (newProps) => render(h(CopilotPanel, newProps), container),
    unmount: () => { render(null, container); mounted = false; },
  };
}

export function isCopilotMounted() {
  return mounted;
}
