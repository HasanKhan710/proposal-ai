'use client';

import { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Layers, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function KnowledgeBasePage() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver]   = useState(false);
  const [message, setMessage]     = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchDocuments(); }, []);

  const fetchDocuments = async () => {
    try {
      const res = await fetch('/api/admin/knowledge-base');
      if (res.ok) setDocuments(await res.json());
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!file) return;

    const isValid =
      file.type === 'application/pdf' ||
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.name.toLowerCase().endsWith('.pdf') ||
      file.name.toLowerCase().endsWith('.docx');

    if (!isValid) {
      setMessage({ type: 'error', text: 'Only PDF and DOCX files are supported.' });
      return;
    }

    setUploading(true);
    setMessage(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res  = await fetch('/api/knowledge-base/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: data.message });
        fetchDocuments();
      } else {
        setMessage({ type: 'error', text: data.error || 'Upload failed.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'An error occurred during upload.' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.[0]) handleFileUpload(e.dataTransfer.files[0]);
  };

  const deleteDocument = async (id: string) => {
    if (!confirm('Delete this document? All associated knowledge chunks will be removed.')) return;
    const res = await fetch(`/api/admin/knowledge-base?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      setDocuments(prev => prev.filter(d => d.id !== id));
    } else {
      const data = await res.json();
      setMessage({ type: 'error', text: data.error || 'Failed to delete.' });
    }
  };

  const totalChunks = documents.reduce((acc, d) => acc + d.chunk_count, 0);

  return (
    <>
      <header className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Knowledge Base</h1>
          <p className="page-subtitle">Upload past proposals to train the AI on your organisation&apos;s style.</p>
        </div>
      </header>

      <div className="page-body">
        {/* Status message */}
        {message && (
          <div className={message.type === 'error' ? 'error-message' : 'success-message'}
            style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {message.type === 'error'
              ? <AlertCircle size={14} strokeWidth={2} />
              : <CheckCircle2 size={14} strokeWidth={2} />
            }
            {message.text}
          </div>
        )}

        {/* Stats */}
        <div className="card-grid" style={{ marginBottom: '24px' }}>
          <div className="card stat-card">
            <div className="stat-card-top">
              <div className="stat-icon-wrap"><FileText size={18} strokeWidth={2} /></div>
            </div>
            <div className="stat-value">{documents.length}</div>
            <div className="stat-label">Indexed Documents</div>
          </div>
          <div className="card stat-card">
            <div className="stat-card-top">
              <div className="stat-icon-wrap"><Layers size={18} strokeWidth={2} /></div>
            </div>
            <div className="stat-value">{totalChunks}</div>
            <div className="stat-label">Vector Chunks</div>
          </div>
        </div>

        {/* Upload zone */}
        <div className="glass-card" style={{ marginBottom: '24px' }}>
          <h2 className="section-title" style={{ marginBottom: '16px' }}>Upload Document</h2>

          <div
            className={`file-upload-zone ${dragOver ? 'drag-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onFileDrop}
            onClick={() => !uploading && fileInputRef.current?.click()}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => e.target.files && handleFileUpload(e.target.files[0])}
              accept=".pdf,.docx"
              disabled={uploading}
            />
            <div className="upload-icon">
              <Upload size={36} strokeWidth={1.5} />
            </div>
            <div className="upload-text">
              {uploading ? (
                <>
                  <span className="spinner" style={{
                    border: '2px solid var(--border-strong)',
                    borderTopColor: 'var(--accent)',
                    borderRadius: '50%',
                    width: '14px', height: '14px',
                    display: 'inline-block',
                    animation: 'spin 0.65s linear infinite',
                  }} />
                  Vectorizing document — this may take a moment…
                </>
              ) : (
                <>Click to upload or drag &amp; drop a file</>
              )}
            </div>
            {!uploading && <div className="upload-hint">PDF or DOCX · Max 10 MB</div>}
          </div>
        </div>

        {/* Documents table */}
        <div className="glass-card">
          <h2 className="section-title">Indexed Documents</h2>

          {loading ? (
            <div className="skeleton" style={{ height: '180px', marginTop: '16px' }} />
          ) : documents.length === 0 ? (
            <div className="empty-state">
              <div className="empty-title">No documents yet</div>
              <div className="empty-text">Upload a PDF or DOCX to start building your knowledge base.</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Type</th>
                    <th>Chunks</th>
                    <th>Uploaded By</th>
                    <th>Date</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map(doc => (
                    <tr key={doc.id}>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{doc.name}</td>
                      <td>
                        <span className={doc.file_type === 'pdf' ? 'file-badge-pdf' : 'file-badge-docx'}>
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
                          onClick={() => deleteDocument(doc.id)}
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
