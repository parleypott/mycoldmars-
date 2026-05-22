import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const interestPluginKey = new PluginKey('interestVotes');

export const InterestPlugin = Extension.create({
  name: 'interestPlugin',

  addProseMirrorPlugins() {
    // Same cache pattern as DeletedMark — decorations() runs on every
    // transaction (including selection-only). Cache against doc AND
    // votes identity so cursor moves on a 10k-segment transcript don't
    // rewalk descendants every keystroke.
    let cachedDoc = null;
    let cachedVotes = null;
    let cachedSet = DecorationSet.empty;
    return [
      new Plugin({
        key: interestPluginKey,
        state: {
          init() {
            return {};
          },
          apply(tr, value) {
            const meta = tr.getMeta(interestPluginKey);
            if (meta !== undefined) return meta;
            return value;
          },
        },
        props: {
          decorations(state) {
            const votes = interestPluginKey.getState(state);
            if (!votes || Object.keys(votes).length === 0) return DecorationSet.empty;

            const { doc } = state;
            if (doc === cachedDoc && votes === cachedVotes) return cachedSet;

            const decorations = [];
            doc.descendants((node, pos) => {
              if (!node.isText || !node.marks) return;
              const segMark = node.marks.find(m => m.type.name === 'segment');
              if (!segMark || segMark.attrs.number == null) return;

              const vote = votes[segMark.attrs.number];
              if (!vote) return;

              const cls = vote === 'interested' ? 'segment-interested' : 'segment-not-interested';
              decorations.push(
                Decoration.inline(pos, pos + node.nodeSize, { class: cls })
              );
            });

            cachedDoc = doc;
            cachedVotes = votes;
            cachedSet = DecorationSet.create(doc, decorations);
            return cachedSet;
          },
        },
      }),
    ];
  },
});

export { interestPluginKey };
