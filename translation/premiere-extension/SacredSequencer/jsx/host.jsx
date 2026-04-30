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

    app.project.createNewSequence(outputName, 'sacred-selects-' + Date.now());
    var newSeq = app.project.activeSequence;

    if (!newSeq) {
        return JSON.stringify({ ok: false, error: 'Failed to create new sequence.' });
    }

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
