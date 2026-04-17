'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload, FileText, Layers, Trash2, AlertCircle, CheckCircle2,
  AlertTriangle, Loader2, Clock, X,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type QueueStatus = 'pending' | 'processing' | 'done' | 'error' | 'duplicate';

interface QueueItem {
  id:      string;
  file:    File;
  status:  QueueStatus;
  chunks:  number;
  retries: number;
  message: string;
}

const VALID_EXTS = ['.pdf', '.docx', '.xlsx', '.xls', '.pptx', '.ppt'];
const VALID_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
];

function isValidFile(f: File) {
  const name = f.name.toLowerCase();
  return VALID_TYPES.includes(f.type) || VALID_EXTS.some(e => name.endsWith(e));
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let _idCounter = 0;
function uid() { return `q-${++_idCounter}`; }

// ─── Component ────────────────────────────────────────────────────────────────

export default function KnowledgeBasePage() {
  const [documents,    setDocuments]    = useState<any[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [dragOver,     setDragOver]     = useState(false);
  const [queue,        setQueue]        = useState<QueueItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchDone,    setBatchDone]    = useState(false);
  const [selectedIds,  setSelectedIds]  = useState<Set<string>>(new Set());
  const [globalMsg,    setGlobalMsg]    = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/knowledge-base');
      if (res.ok) setDocuments(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

  // ── Queue management ────────────────────────────────────────────────────────

  function addFilesToQueue(files: FileList | File[]) {
    const arr = Array.from(files);
    const items: QueueItem[] = arr.map(file => {
      const duplicate = documents.some(d => d.name === file.name);
      const invalid   = !isValidFile(file);
      return {
        id:      uid(),
        file,
        status:  invalid ? 'error' : duplicate ? 'duplicate' : 'pending',
        chunks:  0,
        retries: 0,
        message: invalid
          ? 'Unsupported file type.'
          : duplicate
            ? 'Already indexed — delete first to re-ingest.'
            : 'Pending',
      };
    });
    setQueue(prev => [...prev, ...items]);
    setBatchDone(false);
    setGlobalMsg(null);
  }

  function updateItem(id: string, patch: Partial<QueueItem>) {
    setQueue(prev => prev.map(q => q.id === id ? { ...q, ...patch } : q));
  }

  function clearQueue() {
    if (batchRunning) return;
    setQueue([]);
    setBatchDone(false);
  }

  async function runQueue() {
    const pending = queue.filter(q => q.status === 'pending');
    if (pending.length === 0) return;

    setBatchRunning(true);
    setBatchDone(false);
    let totalChunks = 0;

    for (const item of pending) {
      updateItem(item.id, { status: 'processing', message: 'Uploading and vectorising…' });

      const formData = new FormData();
      formData.append('file', item.file);

      try {
        const res  = await fetch('/api/knowledge-base/upload', { method: 'POST', body: formData });
        const data = await res.json();

        if (res.ok) {
          const chunks  = data.chunks  ?? 0;
          const retries = data.retries ?? 0;
          totalChunks += chunks;
          updateItem(item.id, {
            status:  'done',
            chunks,
            retries,
            message: `${chunks} chunk${chunks !== 1 ? 's' : ''} added${retries > 0 ? ` · ${retries} rate-limit retr${retries === 1 ? 'y' : 'ies'}` : ''}`,
          });
        } else {
          updateItem(item.id, { status: 'error', message: data.error || 'Upload failed.' });
        }
      } catch {
        updateItem(item.id, { status: 'error', message: 'Network error during upload.' });
      }
    }

    setBatchRunning(false);
    setBatchDone(true);
    await fetchDocuments();
  }

  // ── File selection ──────────────────────────────────────────────────────────

  function onFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFilesToQueue(e.dataTransfer.files);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) {
      addFilesToQueue(e.target.files);
      e.target.value = '';
    }
  }

  // ── Document selection ──────────────────────────────────────────────────────

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === documents.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(documents.map((d: any) => d.id)));
    }
  }

  // ── Delete actions ──────────────────────────────────────────────────────────

  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected document${selectedIds.size !== 1 ? 's' : ''}? All associated chunks will be removed.`)) return;

    let failed = 0;
    for (const id of selectedIds) {
      const res = await fetch(`/api/admin/knowledge-base?id=${id}`, { method: 'DELETE' });
      if (!res.ok) failed++;
    }

    setSelectedIds(new Set());
    if (failed > 0) setGlobalMsg({ type: 'error', text: `${failed} deletion(s) failed.` });
    else setGlobalMsg({ type: 'success', text: 'Selected documents deleted.' });
    await fetchDocuments();
  }

  async function deleteAll() {
    if (documents.length === 0) return;
    if (!confirm(`Delete ALL ${documents.length} documents and clear the entire knowledge base? This cannot be undone.`)) return;

    const res = await fetch('/api/admin/knowledge-base?all=true', { method: 'DELETE' });
    if (res.ok) {
      setSelectedIds(new Set());
      setGlobalMsg({ type: 'success', text: 'Knowledge base cleared.' });
      await fetchDocuments();
    } else {
      setGlobalMsg({ type: 'error', text: 'Failed to clear knowledge base.' });
    }
  }

  async function deleteOne(id: string) {
    if (!confirm('Delete this document? All associated chunks will be removed.')) return;
    const res = await fetch(`/api/admin/knowledge-base?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      setDocuments(prev => prev.filter((d: any) => d.id !== id));
      setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    } else {
      setGlobalMsg({ type: 'error', text: 'Failed to delete document.' });
    }
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const totalChunks    = documents.reduce((a: number, d: any) => a + d.chunk_count, 0);
  const pendingCount   = queue.filter(q => q.status === 'pending').length;
  const doneCount      = queue.filter(q => q.status === 'done').length;
  const totalAdded     = queue.filter(q => q.status === 'done').reduce((a, q) => a + q.chunks, 0);
  const allChecked     = documents.length > 0 && selectedIds.size === documents.length;
  const someChecked    = selectedIds.size > 0 && !allChecked;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <header className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Knowledge Base</h1>
          <p className="page-subtitle">Upload past proposals and response documents to build the AI knowledge base.</p>
        </div>
        {documents.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {selectedIds.size > 0 && (
              <button
                className="btn-secondary"
                onClick={deleteSelected}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#991B1B', borderColor: '#FCA5A5' }}
              >
                <Trash2 size={13} strokeWidth={2} />
                Delete Selected ({selectedIds.size})
              </button>
            )}
            <button
              className="btn-secondary"
              onClick={deleteAll}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#991B1B', borderColor: '#FCA5A5' }}
            >
              <Trash2 size={13} strokeWidth={2} />
              Delete All
            </button>
          </div>
        )}
      </header>

      <div className="page-body">

        {/* Global status message */}
        {globalMsg && (
          <div
            className={globalMsg.type === 'error' ? 'error-message' : 'success-message'}
            style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            {globalMsg.type === 'error'
              ? <AlertCircle size={14} strokeWidth={2} />
              : <CheckCircle2 size={14} strokeWidth={2} />}
            {globalMsg.text}
            <button onClick={() => setGlobalMsg(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}>
              <X size={13} />
            </button>
          </div>
        )}

        {/* Stats */}
        <div className="card-grid" style={{ marginBottom: '24px' }}>
          <div className="card stat-card">
            <div className="stat-card-top"><div className="stat-icon-wrap"><FileText size={18} strokeWidth={2} /></div></div>
            <div className="stat-value">{documents.length}</div>
            <div className="stat-label">Indexed Documents</div>
          </div>
          <div className="card stat-card">
            <div className="stat-card-top"><div className="stat-icon-wrap"><Layers size={18} strokeWidth={2} /></div></div>
            <div className="stat-value">{totalChunks}</div>
            <div className="stat-label">Vector Chunks</div>
          </div>
        </div>

        {/* Upload section */}
        <div className="glass-card" style={{ marginBottom: '24px' }}>
          <h2 className="section-title" style={{ marginBottom: '16px' }}>Upload Documents</h2>

          {/* Drop zone */}
          <div
            className={`file-upload-zone ${dragOver ? 'drag-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onFileDrop}
            onClick={() => !batchRunning && fileInputRef.current?.click()}
            style={{ cursor: batchRunning ? 'not-allowed' : 'pointer' }}
          >
            <input
              type="file"
              ref={fileInputRef}
              multiple
              onChange={onFileChange}
              accept=".pdf,.docx,.xlsx,.xls,.pptx,.ppt"
              disabled={batchRunning}
            />
            <div className="upload-icon"><Upload size={36} strokeWidth={1.5} /></div>
            <div className="upload-text">Click to select files or drag &amp; drop — multiple files supported</div>
            <div className="upload-hint">PDF · DOCX · Excel (.xlsx) · PowerPoint (.pptx)</div>
          </div>

          {/* Queue */}
          {queue.length > 0 && (
            <div style={{ marginTop: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Upload Queue — {queue.length} file{queue.length !== 1 ? 's' : ''}
                </span>
                <button
                  onClick={clearQueue}
                  disabled={batchRunning}
                  style={{ fontSize: '12px', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: batchRunning ? 'not-allowed' : 'pointer' }}
                >
                  Clear
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
                {queue.map(item => (
                  <QueueRow key={item.id} item={item} />
                ))}
              </div>

              {/* Batch summary */}
              {batchDone && (
                <div className="success-message" style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <CheckCircle2 size={14} strokeWidth={2} />
                  Batch complete — {doneCount} file{doneCount !== 1 ? 's' : ''} processed, {totalAdded} chunk{totalAdded !== 1 ? 's' : ''} added to the knowledge base.
                </div>
              )}

              {/* Start button */}
              {pendingCount > 0 && !batchRunning && (
                <button className="btn-primary" onClick={runQueue} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Upload size={14} strokeWidth={2} />
                  Start Upload ({pendingCount} file{pendingCount !== 1 ? 's' : ''})
                </button>
              )}
              {batchRunning && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-muted)' }}>
                  <Loader2 size={14} strokeWidth={2} style={{ animation: 'spin 0.8s linear infinite' }} />
                  Processing — do not close this page…
                </div>
              )}
            </div>
          )}
        </div>

        {/* Indexed documents table */}
        <div className="glass-card">
          <h2 className="section-title">Indexed Documents</h2>

          {loading ? (
            <div className="skeleton" style={{ height: '180px', marginTop: '16px' }} />
          ) : documents.length === 0 ? (
            <div className="empty-state">
              <div className="empty-title">No documents yet</div>
              <div className="empty-text">Upload PDF, DOCX, Excel, or PowerPoint files to build your knowledge base.</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="docs-table">
                <thead>
                  <tr>
                    <th style={{ width: '36px' }}>
                      <input
                        type="checkbox"
                        checked={allChecked}
                        ref={el => { if (el) el.indeterminate = someChecked; }}
                        onChange={toggleSelectAll}
                        style={{ cursor: 'pointer' }}
                      />
                    </th>
                    <th>Document</th>
                    <th>Type</th>
                    <th>Chunks</th>
                    <th>Uploaded By</th>
                    <th>Date</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc: any) => (
                    <tr key={doc.id} style={{ background: selectedIds.has(doc.id) ? 'rgba(29,52,97,0.06)' : undefined }}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(doc.id)}
                          onChange={() => toggleSelect(doc.id)}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{doc.name}</td>
                      <td>
                        <span className={
                          doc.file_type === 'pdf'  ? 'file-badge-pdf'  :
                          doc.file_type === 'xlsx' ? 'file-badge-xlsx' :
                          doc.file_type === 'pptx' ? 'file-badge-pptx' :
                          'file-badge-docx'
                        }>
                          {doc.file_type}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{doc.chunk_count}</td>
                      <td>{doc.uploaded_by}</td>
                      <td>
                        {new Date(doc.created_at).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </td>
                      <td>
                        <button
                          className="delete-btn"
                          onClick={() => deleteOne(doc.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
                        >
                          <Trash2 size={12} strokeWidth={2} />
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Queue row sub-component ──────────────────────────────────────────────────

function QueueRow({ item }: { item: QueueItem }) {
  const statusConfig: Record<QueueStatus, { icon: React.ReactNode; color: string; bg: string }> = {
    pending:    { icon: <Clock size={13} strokeWidth={2} />,         color: '#6B7280', bg: '#F3F4F6' },
    processing: { icon: <Loader2 size={13} strokeWidth={2} style={{ animation: 'spin 0.8s linear infinite' }} />, color: '#92400E', bg: '#FEF3C7' },
    done:       { icon: <CheckCircle2 size={13} strokeWidth={2} />,  color: '#065F46', bg: '#D1FAE5' },
    error:      { icon: <AlertCircle size={13} strokeWidth={2} />,   color: '#991B1B', bg: '#FEE2E2' },
    duplicate:  { icon: <AlertTriangle size={13} strokeWidth={2} />, color: '#92400E', bg: '#FEF3C7' },
  };

  const cfg = statusConfig[item.status];

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '8px 12px', borderRadius: '8px',
      background: cfg.bg,
      border: `1px solid ${cfg.color}22`,
    }}>
      <span style={{ color: cfg.color, flexShrink: 0 }}>{cfg.icon}</span>
      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.file.name}
      </span>
      <span style={{ fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0 }}>
        {formatBytes(item.file.size)}
      </span>
      <span style={{ fontSize: '12px', color: cfg.color, flexShrink: 0 }}>
        {item.message}
      </span>
    </div>
  );
}
