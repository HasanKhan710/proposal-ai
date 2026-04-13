'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, FileDown, Check, Sparkles, Loader2, Send, User, Bot, RotateCcw } from 'lucide-react';

type Mode = 'new' | 'feedback' | 'improve';

interface Message {
  id:        string;
  role:      'user' | 'assistant';
  content:   string;
  isStreaming?: boolean;
}

const MODES: { key: Mode; label: string; placeholder: string }[] = [
  {
    key:         'new',
    label:       'New Proposal',
    placeholder: 'Describe the opportunity, client, scope and services being proposed…',
  },
  {
    key:         'feedback',
    label:       'Respond to Feedback',
    placeholder: 'Paste the client feedback or questions and any notes on how you want to respond…',
  },
  {
    key:         'improve',
    label:       'Improve Draft',
    placeholder: 'Paste your existing draft to have it polished using the knowledge base…',
  },
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function GeneratePage() {
  const [messages, setMessages]       = useState<Message[]>([]);
  const [inputValue, setInputValue]   = useState('');
  const [mode, setMode]               = useState<Mode>('new');
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied]           = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);

  const hasConversation = messages.length > 0;
  const latestProposal  = [...messages].reverse().find(m => m.role === 'assistant')?.content ?? '';
  const currentMode     = MODES.find(m => m.key === mode)!;

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [inputValue]);

  const sendMessage = async (overrideInput?: string) => {
    const text = (overrideInput ?? inputValue).trim();
    if (!text || isGenerating) return;

    const isRevision = hasConversation;

    // Add user message
    const userMsg: Message = { id: uid(), role: 'user', content: text };
    const assistantId      = uid();
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', isStreaming: true };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInputValue('');
    setIsGenerating(true);

    try {
      const res = await fetch('/api/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          prompt:          text,
          mode:            isRevision ? 'revise' : mode,
          currentProposal: isRevision ? latestProposal : undefined,
        }),
      });

      if (!res.ok) throw new Error(await res.text() || 'Generation failed');
      if (!res.body) throw new Error('No response body');

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? { ...m, content: m.content + chunk }
              : m,
          ),
        );
      }

      // Mark streaming done
      setMessages(prev =>
        prev.map(m => m.id === assistantId ? { ...m, isStreaming: false } : m),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, content: `**Error:** ${msg}`, isStreaming: false }
            : m,
        ),
      );
    } finally {
      setIsGenerating(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const copyLatest = () => {
    if (!latestProposal) return;
    navigator.clipboard.writeText(latestProposal);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportWord = async () => {
    if (!latestProposal) return;
    try {
      const res = await fetch('/api/export', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ markdown: latestProposal }),
      });
      if (!res.ok) throw new Error(await res.text());

      // Derive filename from Content-Disposition header or fallback
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const nameMatch   = disposition.match(/filename="?([^"]+)"?/);
      const filename    = nameMatch ? decodeURIComponent(nameMatch[1]) : 'proposal.docx';

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  const reset = () => {
    if (isGenerating) return;
    if (hasConversation && !confirm('Start a new session? Current conversation will be cleared.')) return;
    setMessages([]);
    setInputValue('');
    setMode('new');
  };

  return (
    <>
      <header className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Proposal Studio</h1>
          <p className="page-subtitle">
            {hasConversation
              ? `${messages.filter(m => m.role === 'user').length} message${messages.filter(m => m.role === 'user').length !== 1 ? 's' : ''} · Type below to refine the proposal`
              : 'Start with a brief, then iterate until it\'s ready to export'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {latestProposal && (
            <>
              <button className="icon-btn" onClick={copyLatest}>
                {copied
                  ? <><Check size={13} strokeWidth={2.5} style={{ color: 'var(--success)' }} /> Copied</>
                  : <><Copy size={13} strokeWidth={2} /> Copy</>
                }
              </button>
              <button className="icon-btn" onClick={exportWord}>
                <FileDown size={13} strokeWidth={2} />
                Export Word
              </button>
            </>
          )}
          {hasConversation && (
            <button className="secondary-btn" onClick={reset} title="New session">
              <RotateCcw size={13} strokeWidth={2} />
              New Session
            </button>
          )}
        </div>
      </header>

      <div className="chat-wrapper">
        {/* ── Message list ─────────────────────────────────────────── */}
        <div className="chat-messages">
          {!hasConversation && (
            <div className="chat-welcome">
              <div className="chat-welcome-icon">
                <Sparkles size={28} strokeWidth={1.5} />
              </div>
              <h2 className="chat-welcome-title">How can I help you today?</h2>
              <p className="chat-welcome-sub">
                Write a new proposal, respond to client feedback, or improve an existing draft.
                After the first response you can ask for any changes — I&apos;ll update the full proposal each time.
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`chat-message chat-message--${msg.role}`}>
              {msg.role === 'user' ? (
                <>
                  <div className="chat-avatar chat-avatar--user">
                    <User size={14} strokeWidth={2} />
                  </div>
                  <div className="chat-bubble--user">{msg.content}</div>
                </>
              ) : (
                <div className="chat-bubble--assistant">
                  <div className="chat-bubble-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div className="chat-avatar chat-avatar--assistant">
                        <Bot size={14} strokeWidth={2} />
                      </div>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
                        Gravity One BD Studio
                      </span>
                    </div>
                    {!msg.isStreaming && msg.content && (
                      <button
                        className="icon-btn"
                        style={{ fontSize: '11px', padding: '4px 10px' }}
                        onClick={() => navigator.clipboard.writeText(msg.content)}
                      >
                        <Copy size={11} strokeWidth={2} /> Copy
                      </button>
                    )}
                  </div>
                  <div className="markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                    {msg.isStreaming && <span className="streaming-cursor" />}
                  </div>
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* ── Input bar ─────────────────────────────────────────────── */}
        <div className="chat-input-bar">
          {/* Mode tabs — only before first message */}
          {!hasConversation && (
            <div className="mode-tabs" style={{ marginBottom: '12px' }}>
              {MODES.map(m => (
                <button
                  key={m.key}
                  className={`mode-tab ${mode === m.key ? 'active' : ''}`}
                  onClick={() => setMode(m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}

          <div className="chat-input-row">
            <textarea
              ref={textareaRef}
              className="chat-textarea"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                hasConversation
                  ? 'Request a change — e.g. "Shorten the executive summary" or "Add a risk section"…'
                  : currentMode.placeholder
              }
              disabled={isGenerating}
              rows={1}
            />
            <button
              className="chat-send-btn"
              onClick={() => sendMessage()}
              disabled={isGenerating || !inputValue.trim()}
              title="Send (Enter)"
            >
              {isGenerating
                ? <Loader2 size={18} strokeWidth={2} style={{ animation: 'spin 0.65s linear infinite' }} />
                : <Send size={18} strokeWidth={2} />
              }
            </button>
          </div>

          <p className="chat-hint">
            {hasConversation
              ? 'Enter to send · Shift+Enter for new line · Changes apply to the full proposal above'
              : 'Enter to send · Shift+Enter for new line'
            }
          </p>
        </div>
      </div>
    </>
  );
}
