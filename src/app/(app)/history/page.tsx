'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Copy, Check, Trash2, ClockIcon, FileText, FileDown } from 'lucide-react';

export default function HistoryPage() {
  const [proposals, setProposals]           = useState<any[]>([]);
  const [loading, setLoading]               = useState(true);
  const [selectedProposal, setSelectedProposal] = useState<any | null>(null);
  const [copied, setCopied]                 = useState(false);

  const searchParams = useSearchParams();
  const targetId     = searchParams.get('id');

  useEffect(() => { fetchProposals(); }, []);

  useEffect(() => {
    if (targetId && proposals.length > 0) {
      const p = proposals.find(p => p.id === targetId);
      if (p) setSelectedProposal(p);
    }
  }, [targetId, proposals]);

  const fetchProposals = async () => {
    try {
      const res = await fetch('/api/proposals');
      if (res.ok) setProposals(await res.json());
    } finally {
      setLoading(false);
    }
  };

  const deleteProposal = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this proposal? This cannot be undone.')) return;
    const res = await fetch(`/api/proposals?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      setProposals(prev => prev.filter(p => p.id !== id));
      if (selectedProposal?.id === id) setSelectedProposal(null);
    }
  };

  const copyOutput = () => {
    if (!selectedProposal) return;
    navigator.clipboard.writeText(selectedProposal.output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportWord = async () => {
    if (!selectedProposal) return;
    try {
      const res = await fetch('/api/export', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ markdown: selectedProposal.output }),
      });
      if (!res.ok) throw new Error(await res.text());
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const nameMatch   = disposition.match(/filename="?([^"]+)"?/);
      const filename    = nameMatch ? decodeURIComponent(nameMatch[1]) : 'proposal.docx';
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { console.error('Export failed:', err); }
  };

  if (loading) {
    return (
      <div className="page-body">
        {[1, 2, 3].map(i => (
          <div key={i} className="skeleton" style={{ height: '72px', marginBottom: '8px', borderRadius: '10px' }} />
        ))}
      </div>
    );
  }

  return (
    <>
      <header className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Proposal History</h1>
          <p className="page-subtitle">Access and review your previously generated proposals.</p>
        </div>
      </header>

      <div className="page-body" style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
        {/* List */}
        <div style={{ flex: '0 0 420px', minWidth: 0 }}>
          {proposals.length === 0 ? (
            <div className="glass-card empty-state">
              <div className="empty-icon"><ClockIcon size={40} strokeWidth={1.5} /></div>
              <div className="empty-title">No proposals yet</div>
              <div className="empty-text">Generated proposals will appear here.</div>
            </div>
          ) : (
            <div className="history-list">
              {proposals.map(proposal => (
                <div
                  key={proposal.id}
                  className={`glass-card history-item ${selectedProposal?.id === proposal.id ? 'active-state' : ''}`}
                  onClick={() => setSelectedProposal(proposal)}
                >
                  <div className={`history-mode-badge badge-${proposal.mode}`}>
                    {proposal.mode}
                  </div>
                  <div className="history-content">
                    <div className="history-title">{proposal.title || 'Untitled Proposal'}</div>
                    <div className="history-date">
                      {new Date(proposal.created_at).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </div>
                  </div>
                  <button
                    className="delete-btn"
                    onClick={(e) => deleteProposal(proposal.id, e)}
                    title="Delete proposal"
                    style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
                  >
                    <Trash2 size={12} strokeWidth={2} />
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Preview panel */}
        {selectedProposal ? (
          <div style={{ flex: 1, minWidth: 0, position: 'sticky', top: '84px' }}>
            <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Preview header */}
              <div style={{
                padding: '16px 24px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'var(--bg-light)',
              }}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {selectedProposal.title || 'Untitled Proposal'}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {new Date(selectedProposal.created_at).toLocaleString('en-GB', {
                      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="icon-btn" onClick={copyOutput}>
                    {copied
                      ? <><Check size={13} strokeWidth={2.5} style={{ color: 'var(--success)' }} /> Copied</>
                      : <><Copy size={13} strokeWidth={2} /> Copy</>
                    }
                  </button>
                  <button className="icon-btn" onClick={exportWord}>
                    <FileDown size={13} strokeWidth={2} /> Export Word
                  </button>
                </div>
              </div>

              {/* Prompt context */}
              <div style={{
                padding: '12px 24px',
                borderBottom: '1px solid var(--border)',
                background: 'var(--bg-white)',
              }}>
                <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                  Prompt
                </span>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  {selectedProposal.prompt}
                </p>
              </div>

              {/* Output */}
              <div className="proposal-viewer" style={{ borderRadius: 0, border: 'none', margin: '0' }}>
                {selectedProposal.output}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="glass-card empty-state">
              <div className="empty-icon"><FileText size={40} strokeWidth={1.5} /></div>
              <div className="empty-title">Select a proposal</div>
              <div className="empty-text">Click any proposal on the left to preview it here.</div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
