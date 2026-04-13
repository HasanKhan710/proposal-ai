'use client';

import { useState, useEffect, useRef } from 'react';
import { Upload, CheckCircle2, AlertCircle, Trash2, FileType } from 'lucide-react';

interface TemplateStatus {
  hasTemplate:  boolean;
  uploadedAt:   string | null;
  styles:       Record<string, any> | null;
}

export default function SettingsPage() {
  const [status, setStatus]     = useState<TemplateStatus | null>(null);
  const [loading, setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [message, setMessage]   = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchStatus(); }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/admin/settings/template');
      if (res.ok) setStatus(await res.json());
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.docx')) {
      setMessage({ type: 'error', text: 'Only .docx files are accepted as master templates.' });
      return;
    }

    setUploading(true);
    setMessage(null);

    const form = new FormData();
    form.append('file', file);

    try {
      const res  = await fetch('/api/admin/settings/template', { method: 'POST', body: form });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: data.message });
        fetchStatus();
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

  const handleRemove = async () => {
    if (!confirm('Remove the master template? Exports will revert to the default Gravity One style.')) return;
    const res = await fetch('/api/admin/settings/template', { method: 'DELETE' });
    if (res.ok) {
      setMessage({ type: 'success', text: 'Master template removed.' });
      fetchStatus();
    }
  };

  return (
    <>
      <header className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Configure export templates and tool preferences.</p>
        </div>
      </header>

      <div className="page-body">
        {message && (
          <div className={message.type === 'error' ? 'error-message' : 'success-message'}
            style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {message.type === 'error'
              ? <AlertCircle size={14} />
              : <CheckCircle2 size={14} />
            }
            {message.text}
          </div>
        )}

        {/* Master Template Card */}
        <div className="glass-card">
          <div style={{ marginBottom: '20px' }}>
            <h2 className="section-title" style={{ marginBottom: '6px' }}>Master Export Template</h2>
            <p style={{ fontSize: '13.5px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Upload a <strong>.docx</strong> file whose formatting you want all exported proposals to follow —
              fonts, heading colours, spacing, and page margins will be extracted and applied automatically.
              Leave blank to use the default Gravity One style.
            </p>
          </div>

          {/* Current status */}
          {!loading && status?.hasTemplate ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '14px',
              padding: '14px 18px', background: 'var(--success-light)',
              border: '1px solid var(--success-border)', borderRadius: 'var(--radius-sm)',
              marginBottom: '20px',
            }}>
              <CheckCircle2 size={18} style={{ color: 'var(--success)', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--success)' }}>
                  Master template active
                </div>
                {status.uploadedAt && (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Uploaded {new Date(status.uploadedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </div>
                )}
              </div>
              <button className="delete-btn" onClick={handleRemove}
                style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Trash2 size={12} strokeWidth={2} /> Remove
              </button>
            </div>
          ) : null}

          {/* Extracted styles preview */}
          {status?.styles && (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px',
              marginBottom: '20px',
            }}>
              {[
                { label: 'Body font',    value: status.styles.bodyFont },
                { label: 'H1 font',      value: status.styles.h1Font },
                { label: 'H1 colour',    value: `#${status.styles.h1Color}` },
                { label: 'H2 colour',    value: `#${status.styles.h2Color}` },
              ].map(s => (
                <div key={s.label} style={{
                  padding: '10px 14px', background: 'var(--bg-light)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-xs)',
                }}>
                  <div style={{ fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '3px' }}>{s.label}</div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {s.label.includes('colour') && (
                      <span style={{ width: 12, height: 12, borderRadius: 2, background: s.value, border: '1px solid var(--border)', flexShrink: 0 }} />
                    )}
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Upload zone */}
          <div
            className={`file-upload-zone ${dragOver ? 'drag-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]); }}
            onClick={() => !uploading && fileInputRef.current?.click()}
          >
            <input type="file" ref={fileInputRef} accept=".docx" disabled={uploading}
              onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} />

            <div className="upload-icon">
              {uploading
                ? <span className="spinner" style={{ border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)', borderRadius: '50%', width: 32, height: 32, display: 'inline-block', animation: 'spin 0.65s linear infinite' }} />
                : <FileType size={36} strokeWidth={1.5} />
              }
            </div>
            <div className="upload-text">
              {uploading ? 'Extracting styles from template…' : (status?.hasTemplate ? 'Upload a new template to replace the current one' : 'Click to upload or drag & drop your master .docx')}
            </div>
            {!uploading && <div className="upload-hint">.docx only</div>}
          </div>
        </div>
      </div>
    </>
  );
}
