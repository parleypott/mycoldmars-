/**
 * Hunter Script Copilot — Google Apps Script Sidebar
 * Lives inside Google Docs, calls Hunter API for analysis.
 *
 * Setup:
 *   1. Open Google Docs → Extensions → Apps Script
 *   2. Paste this file as Code.gs
 *   3. Paste sidebar.html
 *   4. Set HUNTER_API_URL in script properties
 */

// Configuration — set via File → Project Properties → Script Properties
function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    apiUrl: props.getProperty('HUNTER_API_URL') || 'https://mycoldmars.vercel.app/api/gemini',
    projectId: props.getProperty('HUNTER_PROJECT_ID') || '',
  };
}

/**
 * Show the sidebar when the doc is opened or from the menu.
 */
function onOpen() {
  DocumentApp.getUi()
    .createMenu('Hunter')
    .addItem('Open Script Copilot', 'showSidebar')
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('sidebar')
    .setTitle('Script Copilot')
    .setWidth(300);
  DocumentApp.getUi().showSidebar(html);
}

/**
 * Get current document info for the sidebar.
 */
function getDocInfo() {
  const doc = DocumentApp.getActiveDocument();
  return {
    docId: doc.getId(),
    title: doc.getName(),
    url: doc.getUrl(),
  };
}

/**
 * Get the currently selected text in the document.
 */
function getSelectedText() {
  const selection = DocumentApp.getActiveDocument().getSelection();
  if (!selection) return null;

  const elements = selection.getRangeElements();
  const texts = [];

  for (const element of elements) {
    const el = element.getElement();
    if (el.editAsText) {
      const text = el.editAsText();
      if (element.isPartial()) {
        texts.push(text.getText().substring(element.getStartOffset(), element.getEndOffsetInclusive() + 1));
      } else {
        texts.push(text.getText());
      }
    }
  }

  return texts.join('\n');
}

/**
 * Trigger a re-fetch and snapshot of the current doc.
 */
function syncDoc() {
  const config = getConfig();
  const doc = DocumentApp.getActiveDocument();

  const payload = {
    action: 'get_script_snapshot',
    mediaAssetId: null, // Will need to be mapped from docId
    docId: doc.getId(),
  };

  try {
    const response = UrlFetchApp.fetch(config.apiUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const result = JSON.parse(response.getContentText());
    return { success: true, snapshot: result.snapshot };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Chat with the Script Copilot about the current document.
 */
function chatWithCopilot(message, selectedText) {
  const config = getConfig();
  const doc = DocumentApp.getActiveDocument();

  const fullMessage = selectedText
    ? `[User has selected this text from the script: "${selectedText}"]\n\n${message}`
    : message;

  const payload = {
    action: 'script_copilot_chat',
    message: fullMessage,
    projectId: config.projectId,
    conversationHistory: [],
  };

  try {
    const response = UrlFetchApp.fetch(config.apiUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const result = JSON.parse(response.getContentText());
    return { success: true, reply: result.reply };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Run a quick pass on the selection or full doc.
 */
function runQuickPass(passType) {
  const config = getConfig();

  const payload = {
    action: 'run_script_pass',
    passType: passType,
    projectId: config.projectId,
    // snapshotId will be resolved server-side from projectId
  };

  try {
    const response = UrlFetchApp.fetch(config.apiUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const result = JSON.parse(response.getContentText());
    return { success: true, pass: result.pass };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
