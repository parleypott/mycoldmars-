import { useState, useEffect, useRef } from 'preact/hooks';
import { buildCopilotSystemPrompt, buildPassagePrompt, buildSummaryPrompt, QUICK_ACTIONS } from './copilot-prompts.js';
import { SummaryView } from './SummaryView.jsx';

export function CopilotPanel({ selection, segments, translations, speakerMap, highlights, editorialFocus, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [summaryContent, setSummaryContent] = useState(null);
  const [showSummary, setShowSummary] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  async function sendMessage(question) {
    if (!question.trim()) return;

    const systemPrompt = buildCopilotSystemPrompt(segments, translations, speakerMap);
    const userMessage = selection
      ? buildPassagePrompt(selection, question)
      : question;

    const newMessages = [...messages, { role: 'user', content: question }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          stream: true,
          system: systemPrompt,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const event = JSON.parse(data);
            if (event.type === 'content_block_delta' && event.delta?.text) {
              assistantText += event.delta.text;
              setMessages([...newMessages, { role: 'assistant', content: assistantText }]);
            }
          } catch {}
        }
      }

      setMessages([...newMessages, { role: 'assistant', content: assistantText }]);
    } catch (err) {
      setMessages([...newMessages, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  async function generateSummary() {
    setLoading(true);
    setShowSummary(true);

    const systemPrompt = buildCopilotSystemPrompt(segments, translations, speakerMap);
    const userMessage = buildSummaryPrompt(highlights || [], [], editorialFocus);

    try {
      const res = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          stream: true,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        }),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const event = JSON.parse(data);
            if (event.type === 'content_block_delta' && event.delta?.text) {
              text += event.delta.text;
              setSummaryContent(text);
            }
          } catch {}
        }
      }

      setSummaryContent(text);
    } catch (err) {
      setSummaryContent(`Error generating summary: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  if (showSummary) {
    return (
      <div className="copilot-inner">
        <div className="copilot-header">
          <span className="np-eyebrow np-eyebrow--red">Summary</span>
          <div className="copilot-header-actions">
            <button className="copilot-back" onClick={() => setShowSummary(false)}>Back</button>
            <button className="tag-picker-close" onClick={onClose}>&times;</button>
          </div>
        </div>
        <SummaryView content={summaryContent} loading={loading} />
      </div>
    );
  }

  return (
    <div className="copilot-inner">
      <div className="copilot-header">
        <span className="np-eyebrow np-eyebrow--red">AI Copilot</span>
        <div className="copilot-header-actions">
          <button className="copilot-summary-btn" onClick={generateSummary}>Summary</button>
          <button className="tag-picker-close" onClick={onClose}>&times;</button>
        </div>
      </div>

      {selection && (
        <div className="copilot-context">
          <div className="copilot-context-label">Selected passage:</div>
          <p className="copilot-context-text">{selection.text}</p>
          {selection.originalText && (
            <p className="copilot-context-original">{selection.originalText}</p>
          )}
        </div>
      )}

      {selection && (
        <div className="copilot-quick-actions">
          {QUICK_ACTIONS.map(action => (
            <button
              key={action.label}
              className="copilot-quick-btn"
              onClick={() => sendMessage(action.prompt)}
              disabled={loading}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      <div className="copilot-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`copilot-msg copilot-msg--${msg.role}`}>
            <div className="copilot-msg-content">{msg.content}</div>
          </div>
        ))}
        {loading && <div className="copilot-typing">Thinking...</div>}
        <div ref={messagesEndRef} />
      </div>

      <div className="copilot-input">
        <textarea
          value={input}
          onInput={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this passage..."
          disabled={loading}
          rows={2}
        />
        <button
          className="copilot-send"
          onClick={() => sendMessage(input)}
          disabled={loading || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
