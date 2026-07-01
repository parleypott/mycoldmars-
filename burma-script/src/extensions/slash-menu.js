import { Extension, nodeInputRule } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { isReadOnly } from '../read-mode.js';
import { DirectionChip, directionChipCommand } from './direction-chip.js';

function el(tag, cls, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

function insertDirectionBreak(editor) {
  return editor.chain().focus().insertContent({ type: 'directionBreak' }).run();
}

function makeItem(title, aliases, run) {
  const aliasList = aliases || [];
  const haystack = [title, ...aliasList].map((s) => String(s).toLowerCase());
  return {
    title,
    aliases: aliasList,
    run,
    match(query) {
      const q = String(query || '').trim().toLowerCase();
      if (!q) return true;
      return haystack.some((value) => value.startsWith(q));
    },
  };
}

export const SLASH_ITEMS = [
  makeItem('archive', [], (editor) => directionChipCommand(editor, 'archive')),
  makeItem('factcheck', ['fc', 'source'], (editor) => directionChipCommand(editor, 'factcheck')),
  makeItem('animation', ['anim'], (editor) => directionChipCommand(editor, 'animation')),
  makeItem('broll', [], (editor) => directionChipCommand(editor, 'broll')),
  makeItem('direction', [], (editor) => directionChipCommand(editor, 'direction')),
  makeItem('break', [], (editor) => insertDirectionBreak(editor)),
];

function createSlashRenderer() {
  let menu = null;
  let items = [];
  let activeIndex = 0;
  let latestProps = null;

  const destroy = () => {
    if (!menu) return;
    menu.remove();
    menu = null;
    items = [];
    activeIndex = 0;
    latestProps = null;
  };

  const place = () => {
    if (!menu || !latestProps?.clientRect) return;
    const rect = latestProps.clientRect();
    if (!rect) return;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.left}px`;
    const box = menu.getBoundingClientRect();
    if (box.right > window.innerWidth - 8) menu.style.left = `${Math.max(8, window.innerWidth - box.width - 8)}px`;
    if (box.bottom > window.innerHeight - 8) menu.style.top = `${Math.max(8, rect.top - box.height - 4)}px`;
  };

  const choose = (index) => {
    if (!latestProps) return;
    const item = items[index];
    if (!item) return;
    latestProps.command(item);
  };

  const render = (props) => {
    latestProps = props;
    items = Array.isArray(props.items) ? props.items : [];
    if (!items.length) {
      destroy();
      return;
    }
    if (!menu) {
      menu = el('div', 'wp-slash-menu', { contenteditable: 'false' });
      document.body.appendChild(menu);
    }
    if (activeIndex >= items.length) activeIndex = 0;
    menu.textContent = '';
    items.forEach((item, index) => {
      const button = el('button', 'wp-slash-item' + (index === activeIndex ? ' is-active' : ''), {
        type: 'button',
      });
      button.textContent = item.title;
      button.addEventListener('mouseenter', () => {
        activeIndex = index;
        render(props);
      });
      button.addEventListener('mousedown', (e) => {
        e.preventDefault();
        activeIndex = index;
        choose(index);
      });
      menu.appendChild(button);
    });
    place();
  };

  return {
    onStart(props) {
      if (isReadOnly()) return;
      activeIndex = 0;
      render(props);
    },
    onUpdate(props) {
      if (isReadOnly()) return;
      render(props);
    },
    onKeyDown(props) {
      if (!items.length) return false;
      if (props.event.key === 'ArrowDown') {
        props.event.preventDefault();
        activeIndex = (activeIndex + 1) % items.length;
        render(latestProps);
        return true;
      }
      if (props.event.key === 'ArrowUp') {
        props.event.preventDefault();
        activeIndex = (activeIndex - 1 + items.length) % items.length;
        render(latestProps);
        return true;
      }
      if (props.event.key === 'Enter') {
        props.event.preventDefault();
        choose(activeIndex);
        return true;
      }
      if (props.event.key === 'Escape') {
        props.event.preventDefault();
        destroy();
        return true;
      }
      return false;
    },
    onExit() {
      destroy();
    },
  };
}

export const SlashMenu = Extension.create({
  name: 'slashMenu',
  addInputRules() {
    const directionBreak = this.editor.schema.nodes.directionBreak;
    if (!directionBreak) return [];
    return [nodeInputRule({ find: /^---$/, type: directionBreak })];
  },
  addProseMirrorPlugins() {
    if (isReadOnly()) return [];
    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        allowedPrefixes: null,
        allowSpaces: false,
        allow: () => !isReadOnly(),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          props.run(editor);
        },
        items: ({ query }) => SLASH_ITEMS.filter((item) => item.match(query)),
        render: () => createSlashRenderer(),
      }),
    ];
  },
});
