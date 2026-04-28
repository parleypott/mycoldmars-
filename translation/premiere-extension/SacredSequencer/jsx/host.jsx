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
 * List all sequences in the current project.
 * Returns JSON array of { name, index }.
 */
function listSequences() {
    var result = [];
    for (var i = 0; i < app.project.sequences.numSequences; i++) {
        var seq = app.project.sequences[i];
        result.push({ name: seq.name, index: i });
    }
    return JSON.stringify(result);
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
            error: 'Could not find sequence "' + sacredName + '" in this project.',
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
        sacredName: sacredName,
    });
}
