#!/bin/bash
# Sacred Sequencer — Premiere Pro Extension Installer
# Run this once on Sam's machine, then restart Premiere Pro.

set -e

EXT_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)/SacredSequencer"

echo "Sacred Sequencer — Installing Premiere Pro Extension"
echo "──────────────────────────────────────────────────────"

# Create extensions dir if needed
mkdir -p "$EXT_DIR"

# Copy extension
if [ -d "$EXT_DIR/SacredSequencer" ]; then
    echo "Updating existing installation..."
    rm -rf "$EXT_DIR/SacredSequencer"
fi

cp -R "$SRC_DIR" "$EXT_DIR/SacredSequencer"
echo "✓ Extension installed to: $EXT_DIR/SacredSequencer"

# Enable debug mode for CEP (required for unsigned extensions)
# Try multiple CSXS versions to cover different Premiere Pro years
for v in 9 10 11 12 13 14; do
    defaults write com.adobe.CSXS.$v PlayerDebugMode 1 2>/dev/null || true
done
echo "✓ CEP debug mode enabled"

echo ""
echo "Done! Now:"
echo "  1. Restart Premiere Pro (fully quit and reopen)"
echo "  2. Open your project"
echo "  3. Go to Window > Extensions > Sacred Sequencer"
echo ""
