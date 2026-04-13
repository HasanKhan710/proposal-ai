'use client';

import { useState, useEffect } from 'react';
import { UserPlus, ShieldCheck, Ban, RefreshCw } from 'lucide-react';

export default function UsersPage() {
  const [users, setUsers]         = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole]         = useState('member');
  const [formError, setFormError] = useState('');

  useEffect(() => { fetchUsers(); }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) setUsers(await res.json());
    } finally {
      setLoading(false);
    }
  };

  const toggleUserStatus = async (user: any) => {
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: user.id, is_active: !user.is_active }),
    });
    if (res.ok) fetchUsers();
  };

  const toggleUserRole = async (user: any) => {
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: user.id, role: user.role === 'admin' ? 'member' : 'admin' }),
    });
    if (res.ok) fetchUsers();
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const res  = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role }),
    });
    const data = await res.json();

    if (res.ok) {
      setIsModalOpen(false);
      setName(''); setEmail(''); setPassword(''); setRole('member');
      fetchUsers();
    } else {
      setFormError(data.error || 'Failed to create user.');
    }
  };

  return (
    <>
      <header className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">User Management</h1>
          <p className="page-subtitle">Manage access and roles for your organisation members.</p>
        </div>
        <button className="primary-btn" onClick={() => setIsModalOpen(true)}>
          <UserPlus size={15} strokeWidth={2} />
          Add User
        </button>
      </header>

      <div className="page-body">
        {loading ? (
          <div className="skeleton" style={{ height: '200px', borderRadius: '10px' }} />
        ) : (
          <div className="users-grid">
            {users.map(user => (
              <div key={user.id} className="glass-card user-card">
                <div className="user-card-avatar">{user.name.charAt(0).toUpperCase()}</div>

                <div className="user-card-info">
                  <div className="user-card-name">{user.name}</div>
                  <div className="user-card-email">{user.email}</div>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '5px', flexWrap: 'wrap' }}>
                    <span className={`user-card-role role-${user.role}`}>{user.role}</span>
                    <span className={`status-badge status-${user.is_active ? 'active' : 'inactive'}`}>
                      {user.is_active ? 'Active' : 'Suspended'}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <button
                    className={`toggle-btn ${user.role === 'admin' ? 'active-state' : ''}`}
                    onClick={() => toggleUserRole(user)}
                    title="Toggle admin role"
                    style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
                  >
                    <ShieldCheck size={12} strokeWidth={2} />
                    Admin
                  </button>
                  <button
                    className={`toggle-btn ${!user.is_active ? 'active-state' : ''}`}
                    onClick={() => toggleUserStatus(user)}
                    title={user.is_active ? 'Suspend user' : 'Reactivate user'}
                    style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
                  >
                    {user.is_active
                      ? <><Ban size={12} strokeWidth={2} /> Suspend</>
                      : <><RefreshCw size={12} strokeWidth={2} /> Activate</>
                    }
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add User modal */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">Add New User</h2>

            <form onSubmit={handleCreateUser} className="login-form">
              {formError && <div className="error-message">{formError}</div>}

              <div className="form-group">
                <label>Full Name</label>
                <input required className="glass-input" value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" />
              </div>

              <div className="form-group">
                <label>Work Email</label>
                <input required type="email" className="glass-input" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@company.com" />
              </div>

              <div className="form-group">
                <label>Password</label>
                <input required type="password" minLength={6} className="glass-input" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 6 characters" />
              </div>

              <div className="form-group">
                <label>Role</label>
                <select className="glass-input" value={role} onChange={e => setRole(e.target.value)}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div className="modal-actions">
                <button type="button" className="secondary-btn" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
