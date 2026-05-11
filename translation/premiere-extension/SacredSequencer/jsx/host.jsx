/**
 * Sacred Sequencer — Premiere Pro ExtendScript Host
 *
 * This runs inside Premiere's ExtendScript engine.
 * Called from the CEP panel via CSInterface.evalScript().
 */

var TICKS_PER_SECOND = 254016000000;

function secToTicks(sec) {
    return String(Math.round(sec * TICKS_PER_SECOND));
}

/**
 * Remove every clip from every track in a sequence. Used right after
 * createNewSequence() to neutralize Premiere's tendency to clone the
 * active sequence's contents into the "empty" new sequence.
 */
function scrubSequence(seq) {
    if (!seq) return;
    try {
        if (seq.videoTracks) {
            for (var v = 0; v < seq.videoTracks.numTracks; v++) {
                var vt = seq.videoTracks[v];
                if (!vt || !vt.clips) continue;
                for (var i = vt.clips.numItems - 1; i >= 0; i--) {
                    try { vt.clips[i].remove(false, false); } catch (e) {}
                }
            }
        }
        if (seq.audioTracks) {
            for (var a = 0; a < seq.audioTracks.numTracks; a++) {
                var at = seq.audioTracks[a];
                if (!at || !at.clips) continue;
                for (var j = at.clips.numItems - 1; j >= 0; j--) {
                    try { at.clips[j].remove(false, false); } catch (e) {}
                }
            }
        }
    } catch (e) {}
}

/**
 * Diagnostic: confirm the host script is loaded and tell us what we have.
 */
function ssPing() {
    try {
        var info = {
            hasApp: typeof app !== 'undefined',
            hasProject: typeof app !== 'undefined' && !!app.project,
            projectName: (typeof app !== 'undefined' && app.project && app.project.name) ? app.project.name : null,
            hasSequences: typeof app !== 'undefined' && !!app.project && !!app.project.sequences,
            numSequences: null,
            keys: []
        };
        if (info.hasSequences) {
            try { info.numSequences = app.project.sequences.numSequences; } catch (e1) { info.numSequences = 'err: ' + e1.message; }
        }
        return JSON.stringify(info);
    } catch (e) {
        return JSON.stringify({ error: e.message });
    }
}

/**
 * List all sequences in the current project.
 * Returns JSON array of { name, index }, or { error } string.
 */
function listSequences() {
    try {
        if (typeof app === 'undefined' || !app.project) {
            return JSON.stringify({ error: 'No project open in Premiere.' });
        }

        var seqs = app.project.sequences;
        var result = [];

        // Path A: classic numSequences + numeric indexer
        if (seqs && typeof seqs.numSequences === 'number') {
            for (var i = 0; i < seqs.numSequences; i++) {
                var s = seqs[i];
                if (s && s.name) result.push({ name: s.name, index: i });
            }
            return JSON.stringify(result);
        }

        // Path B: array-like .length
        if (seqs && typeof seqs.length === 'number') {
            for (var j = 0; j < seqs.length; j++) {
                var s2 = seqs[j];
                if (s2 && s2.name) result.push({ name: s2.name, index: j });
            }
            return JSON.stringify(result);
        }

        // Path C: walk projectItems looking for sequences
        if (app.project.rootItem) {
            walkSequences(app.project.rootItem, result);
            return JSON.stringify(result);
        }

        return JSON.stringify({ error: 'Could not enumerate sequences (unknown API shape).' });
    } catch (e) {
        return JSON.stringify({ error: 'listSequences threw: ' + e.message });
    }
}

function walkSequences(item, out) {
    try {
        if (!item || !item.children) return;
        for (var i = 0; i < item.children.numItems; i++) {
            var child = item.children[i];
            if (!child) continue;
            // SEQUENCE type detection: project items where .isSequence() is true (Premiere 14+)
            try {
                if (typeof child.isSequence === 'function' && child.isSequence()) {
                    out.push({ name: child.name, index: out.length });
                    continue;
                }
            } catch (e1) {}
            // Recurse into bins
            if (child.type === 2 /* BIN */ || (child.children && child.children.numItems > 0)) {
                walkSequences(child, out);
            }
        }
    } catch (e) {}
}

/**
 * Build the selects sequence from nested clips of the sacred sequence.
 *
 * @param {string} jsonStr — JSON string with shape:
 *   {
 *     sacredSequenceName: string,
 *     outputName: string,
 *     gapSeconds: number,
 *     soundbites: [{ inSec: number, outSec: number, name: string }]
 *   }
 */
function buildSacredSelects(jsonStr) {
    try {
        var data = JSON.parse(jsonStr);
    } catch (e) {
        return JSON.stringify({ ok: false, error: 'Invalid JSON: ' + e.message });
    }

    var sacredName = data.sacredSequenceName;
    var outputName = data.outputName;
    var gapSeconds = data.gapSeconds || 0.5;
    var soundbites = data.soundbites || [];

    if (!sacredName) {
        return JSON.stringify({ ok: false, error: 'No sacred sequence name provided.' });
    }

    if (soundbites.length === 0) {
        return JSON.stringify({ ok: false, error: 'No soundbites provided.' });
    }

    // ── Find the sacred sequence ──

    var sacredSeq = null;
    var sacredItem = null;

    for (var i = 0; i < app.project.sequences.numSequences; i++) {
        var seq = app.project.sequences[i];
        if (seq.name === sacredName) {
            sacredSeq = seq;
            sacredItem = seq.projectItem;
            break;
        }
    }

    if (!sacredSeq || !sacredItem) {
        return JSON.stringify({
            ok: false,
            error: 'Could not find sequence "' + sacredName + '" in this project.'
        });
    }

    // ── Create the output sequence ──
    //
    // createNewSequence() can silently clone the active sequence's contents
    // when its preset arg isn't a real .sqpreset path. If the sacred sequence
    // is currently active, that fallback effectively duplicates it into the
    // new sequence — which is exactly the bug we're guarding against here.
    // After creation we (a) assert the active sequence is the new one, and
    // (b) scrub every clip off every track before inserting our nests.

    app.project.createNewSequence(outputName, 'sacred-selects-' + Date.now());
    var newSeq = app.project.activeSequence;

    if (!newSeq) {
        return JSON.stringify({ ok: false, error: 'Failed to create new sequence.' });
    }
    if (newSeq.name !== outputName) {
        return JSON.stringify({
            ok: false,
            error: 'createNewSequence did not switch active sequence (got: "' + newSeq.name + '"). Aborting to avoid editing the wrong sequence.'
        });
    }
    scrubSequence(newSeq);

    // ── Insert soundbites as nested clips ──

    var insertTimeSec = 0;
    var inserted = 0;
    var errors = [];

    for (var i = 0; i < soundbites.length; i++) {
        var bite = soundbites[i];
        var durationSec = bite.outSec - bite.inSec;

        if (durationSec <= 0) {
            errors.push('Soundbite ' + (i + 1) + ': zero/negative duration, skipped.');
            continue;
        }

        try {
            // Set source in/out on the sacred sequence
            sacredItem.setInPoint(bite.inSec, 4);
            sacredItem.setOutPoint(bite.outSec, 4);

            // Insert at current timeline position
            newSeq.insertClip(sacredItem, secToTicks(insertTimeSec), 0, 0);

            insertTimeSec += durationSec + gapSeconds;
            inserted++;
        } catch (e) {
            errors.push('Soundbite ' + (i + 1) + ': ' + e.message);
        }
    }

    // ── Restore source state ──

    try {
        sacredItem.clearInPoint(4);
        sacredItem.clearOutPoint(4);
    } catch (e) {
        // Non-critical — in/out marks on source just stay set
    }

    return JSON.stringify({
        ok: true,
        inserted: inserted,
        total: soundbites.length,
        errors: errors,
        outputName: outputName,
        sacredName: sacredName
    });
}

/**
 * ORIGINAL MEDIA mode (v2.5).
 *
 * Same inputs as buildSacredSelects, but instead of inserting the sacred
 * sequence as a NEST, walks the sacred sequence's tracks at each [inSec,
 * outSec] range, resolves the underlying source projectItems for each
 * overlapping clip, computes the matching source-TC slice, and inserts
 * those source clips into the new sequence.
 *
 * Why: a nest hides the source media. The result is editable but only at
 * the cut level. Original-media mode hands the editor real source clips
 * with proper in/out marks — Premiere will relink to the same media bins
 * the sacred sequence references, dual-system audio comes along on its
 * own audio tracks, and the editor can trim/replace cleanly.
 *
 * Intentional limits in v1:
 *   • No effects, transitions, or speed ramps are preserved (cuts only).
 *   • Track structure is preserved per-bite (V1 stays V1, A2 stays A2).
 *   • Linked A/V is inserted by walking the video track and letting the
 *     audio come along automatically; the audio walk dedupes against
 *     projectItems already inserted in this bite to avoid doubles.
 */
function buildOriginalMediaSelects(jsonStr) {
    try {
        var data = JSON.parse(jsonStr);
    } catch (e) {
        return JSON.stringify({ ok: false, error: 'Invalid JSON: ' + e.message });
    }

    var sacredName = data.sacredSequenceName;
    var outputName = data.outputName;
    var gapSeconds = (typeof data.gapSeconds === 'number') ? data.gapSeconds : 0.5;
    var soundbites = data.soundbites || [];

    if (!sacredName) return JSON.stringify({ ok: false, error: 'No sacred sequence name provided.' });
    if (soundbites.length === 0) return JSON.stringify({ ok: false, error: 'No soundbites provided.' });

    // ── Find the sacred sequence ──
    var sacredSeq = null;
    for (var i = 0; i < app.project.sequences.numSequences; i++) {
        if (app.project.sequences[i].name === sacredName) {
            sacredSeq = app.project.sequences[i];
            break;
        }
    }
    if (!sacredSeq) {
        return JSON.stringify({ ok: false, error: 'Could not find sequence "' + sacredName + '" in this project.' });
    }

    // ── Create the output sequence (same scrub-empty pattern as nest mode) ──
    app.project.createNewSequence(outputName, 'original-media-' + Date.now());
    var newSeq = app.project.activeSequence;
    if (!newSeq) return JSON.stringify({ ok: false, error: 'Failed to create new sequence.' });
    if (newSeq.name !== outputName) {
        return JSON.stringify({
            ok: false,
            error: 'createNewSequence did not switch active sequence (got: "' + newSeq.name + '").'
        });
    }
    scrubSequence(newSeq);

    // ── Resolve + insert each soundbite ──
    var insertSec = 0;
    var inserted = 0;
    var skippedBites = 0;
    var clipsInserted = 0;
    var errors = [];
    var touched = {};   // projectItem nodeId → projectItem (so we can clear in/out marks at the end)

    for (var bi = 0; bi < soundbites.length; bi++) {
        var bite = soundbites[bi];
        var biteIn  = bite.inSec;
        var biteOut = bite.outSec;
        var biteDur = biteOut - biteIn;
        if (biteDur <= 0) {
            errors.push('Soundbite ' + (bi + 1) + ': zero/negative duration.');
            skippedBites++;
            continue;
        }

        var insertedThisBite = 0;
        var seenInBite = {};   // projectItem nodeId → true (dedupe linked A/V across video + audio walks)

        var pieces = collectClipPieces(sacredSeq, biteIn, biteOut);
        for (var pi = 0; pi < pieces.length; pi++) {
            var piece = pieces[pi];

            // Skip if the same source projectItem already inserted in this bite
            // at the same timeline offset (linked A/V case — the video walk
            // already brought the audio with it).
            var dedupeKey = piece.itemNodeId + '@' + piece.localOffset.toFixed(4);
            if (seenInBite[dedupeKey]) continue;

            try {
                piece.item.setInPoint(piece.sourceIn, 4);
                piece.item.setOutPoint(piece.sourceOut, 4);
                var timelinePosSec = insertSec + piece.localOffset;
                newSeq.insertClip(
                    piece.item,
                    secToTicks(timelinePosSec),
                    piece.vTrackIdx,
                    piece.aTrackIdx
                );
                seenInBite[dedupeKey] = true;
                touched[piece.itemNodeId] = piece.item;
                insertedThisBite++;
                clipsInserted++;
            } catch (e) {
                errors.push('Soundbite ' + (bi + 1) + ' / track ' + piece.label + ': ' + e.message);
            }
        }

        if (insertedThisBite === 0) {
            // No underlying clips found at this TC range — sequence may be empty here.
            errors.push('Soundbite ' + (bi + 1) + ' (' + biteIn.toFixed(2) + '→' + biteOut.toFixed(2) + 's): no source clips overlap this range.');
            skippedBites++;
            continue;
        }

        insertSec += biteDur + gapSeconds;
        inserted++;
    }

    // ── Clear in/out marks on every projectItem we touched ──
    for (var tk in touched) {
        if (Object.prototype.hasOwnProperty.call(touched, tk)) {
            try { touched[tk].clearInPoint(4);  } catch (e) {}
            try { touched[tk].clearOutPoint(4); } catch (e) {}
        }
    }

    return JSON.stringify({
        ok: true,
        mode: 'original-media',
        inserted: inserted,
        skipped: skippedBites,
        total: soundbites.length,
        clipsInserted: clipsInserted,
        errors: errors,
        outputName: outputName,
        sacredName: sacredName
    });
}

/**
 * For a given [biteIn, biteOut] range on `sacredSeq`, walk every video
 * track and audio track and return the list of "pieces" — one per clip
 * that overlaps the range. Each piece carries the source projectItem,
 * the source-TC in/out for the slice, the timeline offset relative to
 * the start of the bite (so multi-clip bites stay sync'd), and the
 * track indices for re-insertion.
 */
function collectClipPieces(sacredSeq, biteIn, biteOut) {
    var pieces = [];
    var trk, t, ci, c, cStart, cEnd, overlapStart, overlapEnd, offIntoClip, sourceIn, sourceOut, item;

    function pushPiece(c, vIdx, aIdx, label) {
        cStart = c.start.seconds;
        cEnd   = c.end.seconds;
        // Only clips that actually overlap the bite.
        if (cEnd <= biteIn) return;
        if (cStart >= biteOut) return;

        overlapStart = (cStart > biteIn)  ? cStart : biteIn;
        overlapEnd   = (cEnd   < biteOut) ? cEnd   : biteOut;
        if (overlapEnd <= overlapStart) return;

        offIntoClip = overlapStart - cStart;                 // master-timeline seconds into the clip
        sourceIn    = c.inPoint.seconds + offIntoClip;
        sourceOut   = sourceIn + (overlapEnd - overlapStart);

        item = c.projectItem;
        if (!item) return;
        var nodeId;
        try { nodeId = item.nodeId; } catch (eId) { nodeId = item.name + ':' + sourceIn; }

        pieces.push({
            item: item,
            itemNodeId: nodeId,
            sourceIn: sourceIn,
            sourceOut: sourceOut,
            localOffset: overlapStart - biteIn,   // where this slice lands within the bite
            vTrackIdx: vIdx,
            aTrackIdx: aIdx,
            label: label
        });
    }

    // Walk video tracks. Pass aTrackIdx=0 by default so linked audio lands on A1.
    if (sacredSeq.videoTracks) {
        for (t = 0; t < sacredSeq.videoTracks.numTracks; t++) {
            trk = sacredSeq.videoTracks[t];
            if (!trk || !trk.clips) continue;
            for (ci = 0; ci < trk.clips.numItems; ci++) {
                c = trk.clips[ci];
                if (!c) continue;
                pushPiece(c, t, 0, 'V' + (t + 1));
            }
        }
    }

    // Walk audio tracks. The dedupe step in the caller will skip ones
    // already inserted via linked-from-video; standalone dual-system
    // audio (no linked video) lands here.
    if (sacredSeq.audioTracks) {
        for (t = 0; t < sacredSeq.audioTracks.numTracks; t++) {
            trk = sacredSeq.audioTracks[t];
            if (!trk || !trk.clips) continue;
            for (ci = 0; ci < trk.clips.numItems; ci++) {
                c = trk.clips[ci];
                if (!c) continue;
                pushPiece(c, 0, t, 'A' + (t + 1));
            }
        }
    }

    // Order pieces by their local offset so insertion is left-to-right
    // along the timeline (helps Premiere place cleanly when multi-clip).
    pieces.sort(function(a, b) {
        if (a.localOffset !== b.localOffset) return a.localOffset - b.localOffset;
        return a.vTrackIdx - b.vTrackIdx;
    });

    return pieces;
}
