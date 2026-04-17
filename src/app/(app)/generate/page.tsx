'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Copy, Check, Sparkles, Loader2, Send, User, Bot,
  RotateCcw, Paperclip, X, TableProperties, Pencil, Save,
} from 'lucide-react';
import type { ComplianceRow, ComplianceStatus } from '@/lib/compliance';

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = 'new' | 'feedback' | 'improve' | 'compliance';

interface TextMessage {
  id:          string;
  role:        'user' | 'assistant';
  type:        'text';
  content:     string;
  isStreaming?: boolean;
}

interface ComplianceMessage {
  id:             string;
  role:           'assistant';
  type:           'compliance';
  complianceData: ComplianceRow[];
  filename:       string;
}

type Message = TextMessage | ComplianceMessage;

// ─── Mode config ──────────────────────────────────────────────────────────────

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
  {
    key:         'compliance',
    label:       'Compliance Check',
    placeholder: 'Upload a requirements Excel file, or type requirements one per line…',
  },
];

const COMPLIANCE_STATUSES: ComplianceStatus[] = ['Yes', 'Partial', 'No', 'NA', '?'];

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Yes:     { bg: '#D1FAE5', color: '#065F46' },
  Partial: { bg: '#FEF3C7', color: '#92400E' },
  No:      { bg: '#FEE2E2', color: '#991B1B' },
  '?':     { bg: '#EDE9FE', color: '#5B21B6' },
  NA:      { bg: '#F3F4F6', color: '#374151' },
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Shared cell style helpers ────────────────────────────────────────────────

const TD: React.CSSProperties = {
  padding: '8px 10px', border: '1px solid #E5E7EB', verticalAlign: 'top',
};

const EDIT_TEXTAREA: React.CSSProperties = {
  width: '100%', minHeight: '64px', padding: '4px 6px',
  border: '1px solid #C7D2FE', borderRadius: '4px',
  fontSize: '12px', lineHeight: '1.5', resize: 'vertical',
  background: '#FAFAFE', fontFamily: 'inherit',
};

// ─── Compliance Table ─────────────────────────────────────────────────────────

interface ComplianceTableProps {
  rows:        ComplianceRow[];
  isEditing:   boolean;
  onRowChange: (idx: number, field: keyof ComplianceRow, value: string) => void;
}

function confidenceStyle(c: number): { color: string; bg: string; label: string } {
  if (c >= 80) return { color: '#065F46', bg: '#D1FAE5', label: 'High' };
  if (c >= 55) return { color: '#92400E', bg: '#FEF3C7', label: 'Medium' };
  return          { color: '#991B1B', bg: '#FEE2E2', label: 'Low' };
}

function ComplianceTable({ rows, isEditing, onRowChange }: ComplianceTableProps) {
  const needsReview = rows.filter(r => r.confidence < 55).length;

  return (
    <div style={{ overflowX: 'auto', marginTop: '8px' }}>
      {needsReview > 0 && !isEditing && (
        <div style={{
          marginBottom: '8px', padding: '6px 12px', borderRadius: '6px',
          background: '#FEF3C7', fontSize: '12px', fontWeight: 600, color: '#92400E',
          display: 'flex', alignItems: 'center', gap: '6px',
        }}>
          ⚠ {needsReview} row{needsReview !== 1 ? 's' : ''} flagged for manual review (confidence &lt; 55%)
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '44px' }} />
          <col style={{ width: '190px' }} />
          <col style={{ width: isEditing ? '130px' : '110px' }} />
          <col />
          <col />
          <col />
          <col style={{ width: '130px' }} />
        </colgroup>
        <thead>
          <tr style={{ background: '#1D3461', color: '#fff' }}>
            {['Req #', 'Requirement', 'Compliant? / Confidence', 'Response / Comments', 'Option 2', 'Option 3', 'Source(s)'].map(h => (
              <th key={h} style={{
                padding: '8px 10px', textAlign: 'left', fontWeight: 700,
                fontSize: '11px', border: '1px solid #B8933F', whiteSpace: 'nowrap',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const bg  = idx % 2 === 0 ? '#ffffff' : '#F9FAFB';
            const ss  = STATUS_STYLE[row.compliant] ?? STATUS_STYLE['?'];
            const cs  = confidenceStyle(row.confidence ?? 0);
            const lowConfidence = (row.confidence ?? 0) < 55;

            return (
              <tr key={row.reqNum} style={{
                background: bg,
                borderLeft: lowConfidence ? '3px solid #F59E0B' : '3px solid transparent',
              }}>
                {/* Req # — always read-only */}
                <td style={{ ...TD, fontWeight: 700, textAlign: 'center' }}>
                  {row.reqNum}
                </td>

                {/* Requirement — always read-only */}
                <td style={{ ...TD, wordBreak: 'break-word' }}>
                  {row.requirement}
                </td>

                {/* Compliant? + Confidence */}
                <td style={{ ...TD, textAlign: 'center', verticalAlign: 'middle' }}>
                  {isEditing ? (
                    <select
                      value={row.compliant}
                      onChange={e => onRowChange(idx, 'compliant', e.target.value)}
                      style={{
                        width: '100%', padding: '4px 6px', borderRadius: '4px',
                        border: '1px solid #C7D2FE', fontSize: '12px',
                        background: ss.bg, color: ss.color, fontWeight: 700,
                        cursor: 'pointer', marginBottom: '4px',
                      }}
                    >
                      {COMPLIANCE_STATUSES.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <span style={{
                        background: ss.bg, color: ss.color, fontWeight: 700,
                        fontSize: '11px', padding: '3px 10px', borderRadius: '4px',
                        display: 'inline-block', marginBottom: '5px',
                      }}>
                        {row.compliant}
                      </span>
                      <div style={{
                        fontSize: '10px', fontWeight: 700, color: cs.color,
                        background: cs.bg, borderRadius: '3px', padding: '1px 6px',
                        display: 'inline-block',
                      }}>
                        {row.confidence ?? 0}% · {cs.label}
                      </div>
                    </>
                  )}
                </td>

                {/* Response */}
                <td style={{ ...TD, wordBreak: 'break-word' }}>
                  {isEditing ? (
                    <textarea
                      value={row.response}
                      onChange={e => onRowChange(idx, 'response', e.target.value)}
                      style={EDIT_TEXTAREA}
                    />
                  ) : row.response}
                </td>

                {/* Option 2 */}
                <td style={{ ...TD, wordBreak: 'break-word', color: isEditing ? undefined : 'var(--text-secondary)' }}>
                  {isEditing ? (
                    <textarea
                      value={row.option2}
                      onChange={e => onRowChange(idx, 'option2', e.target.value)}
                      style={EDIT_TEXTAREA}
                      placeholder="Optional alternative response…"
                    />
                  ) : (row.option2 || '—')}
                </td>

                {/* Option 3 */}
                <td style={{ ...TD, wordBreak: 'break-word', color: isEditing ? undefined : 'var(--text-secondary)' }}>
                  {isEditing ? (
                    <textarea
                      value={row.option3}
                      onChange={e => onRowChange(idx, 'option3', e.target.value)}
                      style={EDIT_TEXTAREA}
                      placeholder="Optional alternative response…"
                    />
                  ) : (row.option3 || '—')}
                </td>

                {/* Sources */}
                <td style={{ ...TD, fontSize: '11px', color: 'var(--text-muted)', wordBreak: 'break-word' }}>
                  {isEditing ? (
                    <textarea
                      value={row.sources}
                      onChange={e => onRowChange(idx, 'sources', e.target.value)}
                      style={{ ...EDIT_TEXTAREA, minHeight: '48px', fontSize: '11px' }}
                    />
                  ) : (row.sources || '—')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Summary bar */}
      <div style={{
        marginTop: '10px', padding: '8px 12px', borderRadius: '6px',
        background: '#EEF2FF', fontSize: '12px', fontWeight: 600, color: '#1D3461',
        display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center',
      }}>
        <span>Total: {rows.length}</span>
        <span style={{ color: '#065F46' }}>Yes: {rows.filter(r => r.compliant === 'Yes').length}</span>
        <span style={{ color: '#92400E' }}>Partial: {rows.filter(r => r.compliant === 'Partial').length}</span>
        <span style={{ color: '#991B1B' }}>No: {rows.filter(r => r.compliant === 'No').length}</span>
        <span style={{ color: '#5B21B6' }}>Unknown: {rows.filter(r => r.compliant === '?').length}</span>
        {rows.filter(r => r.compliant === 'NA').length > 0 && (
          <span style={{ color: '#374151' }}>N/A: {rows.filter(r => r.compliant === 'NA').length}</span>
        )}
        {rows.filter(r => (r.confidence ?? 0) < 55).length > 0 && (
          <span style={{
            marginLeft: 'auto', color: '#92400E', background: '#FEF3C7',
            padding: '2px 8px', borderRadius: '4px',
          }}>
            ⚠ {rows.filter(r => (r.confidence ?? 0) < 55).length} need review
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GeneratePage() {
  const [messages, setMessages]             = useState<Message[]>([]);
  const [inputValue, setInputValue]         = useState('');
  const [mode, setMode]                     = useState<Mode>('new');
  const [isGenerating, setIsGenerating]     = useState(false);
  const [copied, setCopied]                 = useState(false);
  const [attachedFile, setAttachedFile]     = useState<File | null>(null);
  const [exportingExcel, setExportingExcel] = useState(false);

  // Edit state — one compliance message can be in edit mode at a time
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editDraft, setEditDraft]       = useState<ComplianceRow[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);
  const fileInputRef   = useRef<HTMLInputElement>(null);

  const hasConversation = messages.length > 0;
  const latestText      = [...messages].reverse().find(
    (m): m is TextMessage => m.role === 'assistant' && m.type === 'text',
  )?.content ?? '';
  const latestCompliance = [...messages].reverse().find(
    (m): m is ComplianceMessage => m.type === 'compliance',
  );
  const currentMode = MODES.find(m => m.key === mode)!;

  // Auto-scroll
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

  // ── Edit handlers ────────────────────────────────────────────────────────────

  const startEdit = useCallback((msg: ComplianceMessage) => {
    setEditingMsgId(msg.id);
    setEditDraft(msg.complianceData.map(r => ({ ...r })));
  }, []);

  const handleRowChange = useCallback(
    (idx: number, field: keyof ComplianceRow, value: string) => {
      setEditDraft(prev => prev.map((row, i) =>
        i === idx ? { ...row, [field]: value } : row,
      ));
    },
    [],
  );

  const saveEdit = useCallback(() => {
    setMessages(prev => prev.map(m =>
      m.id === editingMsgId && m.type === 'compliance'
        ? { ...m, complianceData: editDraft }
        : m,
    ));
    setEditingMsgId(null);
    setEditDraft([]);
  }, [editingMsgId, editDraft]);

  const cancelEdit = useCallback(() => {
    setEditingMsgId(null);
    setEditDraft([]);
  }, []);

  // ── Compliance submit ────────────────────────────────────────────────────────

  const sendCompliance = async () => {
    if (isGenerating) return;
    if (!attachedFile && !inputValue.trim()) return;

    const userContent = attachedFile
      ? `Compliance check: ${attachedFile.name}`
      : `Compliance check for:\n${inputValue.trim()}`;

    const userMsg: TextMessage = { id: uid(), role: 'user', type: 'text', content: userContent };
    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setIsGenerating(true);

    const assistantId = uid();
    const placeholder: TextMessage = {
      id: assistantId, role: 'assistant', type: 'text',
      content: 'Analysing requirements against knowledge base…', isStreaming: true,
    };
    setMessages(prev => [...prev, placeholder]);

    const capturedFile = attachedFile;
    setAttachedFile(null);

    try {
      let res: Response;

      if (capturedFile) {
        const form = new FormData();
        form.append('file', capturedFile);
        res = await fetch('/api/compliance', { method: 'POST', body: form });
      } else {
        res = await fetch('/api/compliance', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ text: inputValue.trim() }),
        });
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Compliance check failed.');

      const rows: ComplianceRow[] = data.rows;
      const filename = capturedFile
        ? capturedFile.name.replace(/\.[^.]+$/, '')
        : 'compliance-check';

      setMessages(prev =>
        prev
          .filter(m => m.id !== assistantId)
          .concat([{ id: uid(), role: 'assistant', type: 'compliance', complianceData: rows, filename }]),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, content: `**Error:** ${msg}`, isStreaming: false } as TextMessage
            : m,
        ),
      );
    } finally {
      setIsGenerating(false);
      textareaRef.current?.focus();
    }
  };

  // ── Text generation submit ───────────────────────────────────────────────────

  const sendMessage = async (overrideInput?: string) => {
    const text = (overrideInput ?? inputValue).trim();
    if (!text || isGenerating) return;

    const isRevision   = hasConversation;
    const userMsg: TextMessage = { id: uid(), role: 'user', type: 'text', content: text };
    const assistantId  = uid();
    const assistantMsg: TextMessage = { id: assistantId, role: 'assistant', type: 'text', content: '', isStreaming: true };

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
          currentProposal: isRevision ? latestText : undefined,
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
            m.id === assistantId && m.type === 'text'
              ? { ...m, content: m.content + chunk } : m,
          ),
        );
      }

      setMessages(prev =>
        prev.map(m => m.id === assistantId ? { ...m, isStreaming: false } : m),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, content: `**Error:** ${msg}`, isStreaming: false } as TextMessage
            : m,
        ),
      );
    } finally {
      setIsGenerating(false);
      textareaRef.current?.focus();
    }
  };

  const handleSend = () => {
    if (mode === 'compliance' || attachedFile) sendCompliance();
    else sendMessage();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // ── File attach ──────────────────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
      alert('Only Excel files (.xlsx, .xls) are supported for compliance checks.');
      return;
    }
    setAttachedFile(file);
    e.target.value = '';
  };

  // ── Copy / Export ────────────────────────────────────────────────────────────

  const copyLatest = () => {
    if (!latestText) return;
    navigator.clipboard.writeText(latestText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportExcel = async (rows: ComplianceRow[], filename: string) => {
    if (exportingExcel) return;
    setExportingExcel(true);
    try {
      const res = await fetch('/api/export/excel', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rows, filename }),
      });
      if (!res.ok) throw new Error(await res.text());

      const disposition = res.headers.get('Content-Disposition') ?? '';
      const nameMatch   = disposition.match(/filename="?([^"]+)"?/);
      const dlName      = nameMatch ? decodeURIComponent(nameMatch[1]) : `${filename}.xlsx`;

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = dlName; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Excel export failed:', err);
    } finally {
      setExportingExcel(false);
    }
  };

  // ── Reset ────────────────────────────────────────────────────────────────────

  const reset = () => {
    if (isGenerating) return;
    if (hasConversation && !confirm('Start a new session? Current conversation will be cleared.')) return;
    setMessages([]);
    setInputValue('');
    setMode('new');
    setAttachedFile(null);
    setEditingMsgId(null);
    setEditDraft([]);
  };

  const canSend = !isGenerating && (
    mode === 'compliance' || attachedFile
      ? !!attachedFile || inputValue.trim().length > 0
      : inputValue.trim().length > 0
  );

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <>
      <header className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Proposal Studio</h1>
          <p className="page-subtitle">
            {hasConversation
              ? `${messages.filter(m => m.role === 'user').length} message${messages.filter(m => m.role === 'user').length !== 1 ? 's' : ''} · Type below to continue`
              : "Start with a brief, then iterate until it's ready to export"}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {latestCompliance && (
            <button
              className="icon-btn"
              onClick={() => exportExcel(latestCompliance.complianceData, latestCompliance.filename)}
              disabled={exportingExcel}
            >
              {exportingExcel
                ? <Loader2 size={13} strokeWidth={2} style={{ animation: 'spin 0.65s linear infinite' }} />
                : <TableProperties size={13} strokeWidth={2} />
              }
              Export Excel
            </button>
          )}
          {latestText && (
            <button className="icon-btn" onClick={copyLatest}>
              {copied
                ? <><Check size={13} strokeWidth={2.5} style={{ color: 'var(--success)' }} /> Copied</>
                : <><Copy size={13} strokeWidth={2} /> Copy</>
              }
            </button>
          )}
          {/* Export Word disabled per spec */}
          {/* {latestText && <button className="icon-btn" onClick={exportWord}><FileDown size={13} /> Export Word</button>} */}
          {hasConversation && (
            <button className="secondary-btn" onClick={reset} title="New session">
              <RotateCcw size={13} strokeWidth={2} />
              New Session
            </button>
          )}
        </div>
      </header>

      <div className="chat-wrapper">
        <div className="chat-messages">
          {!hasConversation && (
            <div className="chat-welcome">
              <div className="chat-welcome-icon"><Sparkles size={28} strokeWidth={1.5} /></div>
              <h2 className="chat-welcome-title">How can I help you today?</h2>
              <p className="chat-welcome-sub">
                Write a new proposal, respond to client feedback, improve an existing draft,
                or run a <strong>Compliance Check</strong> against your knowledge base.
              </p>
            </div>
          )}

          {messages.map((msg) => {
            if (msg.type === 'compliance') {
              const isEditingThis = editingMsgId === msg.id;
              const displayRows   = isEditingThis ? editDraft : msg.complianceData;

              return (
                <div key={msg.id} className="chat-message chat-message--assistant">
                  <div className="chat-bubble--assistant" style={{ maxWidth: '100%', width: '100%' }}>
                    <div className="chat-bubble-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div className="chat-avatar chat-avatar--assistant">
                          <Bot size={14} strokeWidth={2} />
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
                          Compliance Report — {msg.complianceData.length} requirement{msg.complianceData.length !== 1 ? 's' : ''}
                          {isEditingThis && (
                            <span style={{
                              marginLeft: '8px', fontSize: '11px', fontWeight: 700,
                              color: '#4F46E5', background: '#EEF2FF',
                              padding: '2px 8px', borderRadius: '4px',
                            }}>
                              Editing
                            </span>
                          )}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {isEditingThis ? (
                          <>
                            <button
                              className="icon-btn"
                              style={{ fontSize: '11px', padding: '4px 10px', color: '#065F46', background: '#D1FAE5', border: '1px solid #A7F3D0' }}
                              onClick={saveEdit}
                            >
                              <Save size={11} strokeWidth={2} /> Save Changes
                            </button>
                            <button
                              className="icon-btn"
                              style={{ fontSize: '11px', padding: '4px 10px' }}
                              onClick={cancelEdit}
                            >
                              <X size={11} strokeWidth={2} /> Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="icon-btn"
                              style={{ fontSize: '11px', padding: '4px 10px' }}
                              onClick={() => startEdit(msg)}
                            >
                              <Pencil size={11} strokeWidth={2} /> Edit
                            </button>
                            <button
                              className="icon-btn"
                              style={{ fontSize: '11px', padding: '4px 10px' }}
                              onClick={() => exportExcel(msg.complianceData, msg.filename)}
                              disabled={exportingExcel}
                            >
                              <TableProperties size={11} strokeWidth={2} /> Export Excel
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <ComplianceTable
                      rows={displayRows}
                      isEditing={isEditingThis}
                      onRowChange={handleRowChange}
                    />
                  </div>
                </div>
              );
            }

            // TextMessage
            return (
              <div key={msg.id} className={`chat-message chat-message--${msg.role}`}>
                {msg.role === 'user' ? (
                  <>
                    <div className="chat-avatar chat-avatar--user"><User size={14} strokeWidth={2} /></div>
                    <div className="chat-bubble--user">{msg.content}</div>
                  </>
                ) : (
                  <div className="chat-bubble--assistant">
                    <div className="chat-bubble-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div className="chat-avatar chat-avatar--assistant"><Bot size={14} strokeWidth={2} /></div>
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
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                      {msg.isStreaming && <span className="streaming-cursor" />}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* ── Input bar ─────────────────────────────────────────────── */}
        <div className="chat-input-bar">
          {!hasConversation && (
            <div className="mode-tabs" style={{ marginBottom: '12px' }}>
              {MODES.map(m => (
                <button
                  key={m.key}
                  className={`mode-tab ${mode === m.key ? 'active' : ''}`}
                  onClick={() => { setMode(m.key); setAttachedFile(null); }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}

          {attachedFile && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              marginBottom: '8px', padding: '6px 10px', borderRadius: '6px',
              background: '#EEF2FF', fontSize: '12px', fontWeight: 600, color: '#1D3461',
              maxWidth: 'fit-content',
            }}>
              <TableProperties size={12} strokeWidth={2} />
              {attachedFile.name}
              <button
                onClick={() => setAttachedFile(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}
              >
                <X size={12} strokeWidth={2} style={{ color: '#6B7280' }} />
              </button>
            </div>
          )}

          <div className="chat-input-row">
            {mode === 'compliance' && (
              <>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".xlsx,.xls"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />
                <button
                  className="icon-btn"
                  style={{ padding: '8px', flexShrink: 0, borderRadius: '8px' }}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isGenerating}
                  title="Attach requirements Excel file"
                >
                  <Paperclip size={16} strokeWidth={2} />
                </button>
              </>
            )}

            <textarea
              ref={textareaRef}
              className="chat-textarea"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                hasConversation
                  ? 'Request a change — e.g. "Shorten the executive summary" or "Add a risk section"…'
                  : attachedFile
                    ? 'File attached — press Send to run the compliance check…'
                    : currentMode.placeholder
              }
              disabled={isGenerating}
              rows={1}
            />

            <button
              className="chat-send-btn"
              onClick={handleSend}
              disabled={!canSend}
              title="Send (Enter)"
            >
              {isGenerating
                ? <Loader2 size={18} strokeWidth={2} style={{ animation: 'spin 0.65s linear infinite' }} />
                : <Send size={18} strokeWidth={2} />
              }
            </button>
          </div>

          <p className="chat-hint">
            {mode === 'compliance' && !hasConversation
              ? 'Attach an Excel file or type requirements (one per line) · Enter to send'
              : hasConversation
                ? 'Enter to send · Shift+Enter for new line · Changes apply to the full proposal above'
                : 'Enter to send · Shift+Enter for new line'
            }
          </p>
        </div>
      </div>
    </>
  );
}
