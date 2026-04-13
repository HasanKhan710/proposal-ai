import { countActiveUsers, countDocuments, countUserProposals, listRecentUserProposals } from '@/lib/db';
import { getSession } from '@/lib/auth';
import Link from 'next/link';
import { FileText, Database, Users, ChevronRight, PenLine } from 'lucide-react';

export default async function DashboardPage() {
  const session = await getSession();

  const docCount = await countDocuments();
  const userCount = await countActiveUsers();
  const proposalCount = await countUserProposals(session.id);
  const recentProposals = await listRecentUserProposals(session.id);

  return (
    <>
      <header className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Welcome back, {session.name}</h1>
          <p className="page-subtitle">Here is what&apos;s happening with your organisation&apos;s proposals.</p>
        </div>
        <Link href="/generate" className="primary-btn" style={{ textDecoration: 'none' }}>
          <PenLine size={15} strokeWidth={2} />
          New Proposal
        </Link>
      </header>

      <div className="page-body">
        {/* Stats */}
        <div className="card-grid">
          <div className="card stat-card">
            <div className="stat-card-top">
              <div className="stat-icon-wrap"><FileText size={18} strokeWidth={2} /></div>
            </div>
            <div className="stat-value">{proposalCount}</div>
            <div className="stat-label">Your Proposals</div>
          </div>

          <div className="card stat-card">
            <div className="stat-card-top">
              <div className="stat-icon-wrap"><Database size={18} strokeWidth={2} /></div>
            </div>
            <div className="stat-value">{docCount}</div>
            <div className="stat-label">Knowledge Base Assets</div>
          </div>

          {session.role === 'admin' && (
            <div className="card stat-card">
              <div className="stat-card-top">
                <div className="stat-icon-wrap"><Users size={18} strokeWidth={2} /></div>
              </div>
                <div className="stat-value">{userCount}</div>
              <div className="stat-label">Active Members</div>
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div style={{ marginTop: '32px' }}>
          <div className="output-header">
            <h2 className="section-title">Recent Activity</h2>
            <Link href="/history" className="icon-btn">
              View All
              <ChevronRight size={13} strokeWidth={2.5} />
            </Link>
          </div>

          <div className="history-list" style={{ marginTop: '12px' }}>
            {recentProposals.length > 0 ? (
              recentProposals.map((item) => (
                <Link
                  key={item.id}
                  href={`/history?id=${item.id}`}
                  className="glass-card history-item"
                  style={{ textDecoration: 'none' }}
                >
                  <div className={`history-mode-badge badge-${item.mode}`}>
                    {item.mode}
                  </div>
                  <div className="history-content">
                    <div className="history-title">{item.title || 'Untitled Proposal'}</div>
                    <div className="history-date">
                      {new Date(item.created_at).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </div>
                  </div>
                  <ChevronRight size={16} strokeWidth={2} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                </Link>
              ))
            ) : (
              <div className="glass-card empty-state">
                <div className="empty-icon"><PenLine size={40} strokeWidth={1.5} /></div>
                <div className="empty-title">No proposals yet</div>
                <div className="empty-text">Start by creating a new proposal using your knowledge base.</div>
                <Link
                  href="/generate"
                  className="primary-btn"
                  style={{ textDecoration: 'none', display: 'inline-flex', marginTop: '4px' }}
                >
                  Create Proposal
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
