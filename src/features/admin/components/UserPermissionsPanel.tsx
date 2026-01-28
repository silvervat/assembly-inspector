import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FiCheck, FiX, FiLoader, FiUsers, FiEdit2, FiPlus, FiSave, FiTrash2, FiRefreshCw } from 'react-icons/fi';
import { USER_ROLES } from '../../../constants/roles';
import { useUserStore } from '../stores/useUserStore';

interface UserPermissionsPanelProps {
  projectId: string;
  api: any;
}

export function UserPermissionsPanel({ projectId, api }: UserPermissionsPanelProps) {
  const { t } = useTranslation('admin');
  const {
    projectUsers,
    usersLoading,
    editingUser,
    showUserForm,
    userFormData,
    loadProjectUsers,
    saveUser,
    deleteUser,
    syncTeamMembers,
    openEditUserForm,
    openNewUserForm,
    setUserFormData,
    setShowUserForm,
  } = useUserStore();

  useEffect(() => {
    loadProjectUsers(projectId);
  }, [projectId, loadProjectUsers]);

  return (
    <div className="admin-content" style={{ padding: '16px' }}>
      <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            className="inspector-button primary"
            onClick={() => syncTeamMembers(api, projectId)}
            disabled={usersLoading}
            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <FiUsers size={14} /> Laadi meeskond
          </button>
          <button
            className="inspector-button"
            onClick={openNewUserForm}
            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <FiPlus size={14} /> Lisa kasutaja
          </button>
          <button
            className="inspector-button"
            onClick={() => loadProjectUsers(projectId)}
            disabled={usersLoading}
          >
            <FiRefreshCw size={14} className={usersLoading ? 'spin' : ''} />
          </button>
        </div>
        <span style={{ fontSize: '12px', color: '#6b7280' }}>
          {projectUsers.length} kasutajat
        </span>
      </div>

      {usersLoading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <FiLoader size={24} className="spin" />
          <p style={{ marginTop: '8px', color: '#6b7280' }}>Laadin...</p>
        </div>
      ) : projectUsers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
          <FiUsers size={48} style={{ opacity: 0.3, marginBottom: '12px' }} />
          <p>Kasutajaid pole veel lisatud</p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '12px' }}>
            <button className="inspector-button primary" onClick={() => syncTeamMembers(api, projectId)} disabled={usersLoading}>
              <FiUsers size={14} /> Laadi meeskond
            </button>
            <button className="inspector-button" onClick={openNewUserForm}>
              <FiPlus size={14} /> Lisa k&#228;sitsi
            </button>
          </div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '2px solid var(--border-color)' }}>
                <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: '600' }}>Nimi</th>
                <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: '600' }}>Email</th>
                <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: '600' }}>Roll</th>
                <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: '600' }}>Assembly</th>
                <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: '600' }}>Poldid</th>
                <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: '600' }}>Aktiivne</th>
                <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: '600' }}>Tegevused</th>
              </tr>
            </thead>
            <tbody>
              {projectUsers.map(user => (
                <tr key={user.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: '500' }}>{user.name || '-'}</td>
                  <td style={{ padding: '10px 12px', color: '#6b7280' }}>{user.email}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      fontWeight: '500',
                      backgroundColor: user.role === USER_ROLES.ADMIN ? '#fef2f2' : user.role === USER_ROLES.MODERATOR ? '#fffbeb' : '#f0fdf4',
                      color: user.role === USER_ROLES.ADMIN ? '#dc2626' : user.role === USER_ROLES.MODERATOR ? '#d97706' : '#16a34a'
                    }}>
                      {user.role === USER_ROLES.ADMIN ? 'Admin' : user.role === USER_ROLES.MODERATOR ? 'Moderaator' : 'Inspektor'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    {user.can_assembly_inspection ? <FiCheck color="#16a34a" /> : <FiX color="#dc2626" />}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    {user.can_bolt_inspection ? <FiCheck color="#16a34a" /> : <FiX color="#dc2626" />}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    {user.is_active ? <FiCheck color="#16a34a" /> : <FiX color="#dc2626" />}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                      <button
                        onClick={() => openEditUserForm(user)}
                        style={{
                          padding: '4px 8px',
                          border: '1px solid var(--border-color)',
                          borderRadius: '4px',
                          background: 'var(--bg-secondary)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '11px'
                        }}
                      >
                        <FiEdit2 size={12} /> Muuda
                      </button>
                      <button
                        onClick={() => deleteUser(user.id, projectId)}
                        style={{
                          padding: '4px 8px',
                          border: '1px solid #fecaca',
                          borderRadius: '4px',
                          background: '#fef2f2',
                          color: '#dc2626',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '11px'
                        }}
                      >
                        <FiTrash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* User Form Modal */}
      {showUserForm && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }} onClick={() => setShowUserForm(false)}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '24px',
            width: '100%',
            maxWidth: '550px',
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0 }}>{editingUser ? 'Muuda kasutajat' : 'Lisa uus kasutaja'}</h3>
              <button onClick={() => setShowUserForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                <FiX size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Basic Info */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: '500' }}>Email *</label>
                  <input
                    type="email"
                    value={userFormData.email}
                    onChange={e => setUserFormData({ email: e.target.value })}
                    disabled={!!editingUser}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid #e5e7eb',
                      backgroundColor: editingUser ? '#f3f4f6' : 'white',
                      fontSize: '13px'
                    }}
                    placeholder="kasutaja@email.com"
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: '500' }}>Nimi</label>
                  <input
                    type="text"
                    value={userFormData.name}
                    onChange={e => setUserFormData({ name: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid #e5e7eb',
                      backgroundColor: 'white',
                      fontSize: '13px'
                    }}
                    placeholder="Kasutaja nimi"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: '500' }}>Roll</label>
                  <select
                    value={userFormData.role}
                    onChange={e => setUserFormData({ role: e.target.value as any })}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid #e5e7eb',
                      backgroundColor: 'white',
                      fontSize: '13px'
                    }}
                  >
                    <option value="viewer">Vaatleja (ainult vaatab)</option>
                    <option value="inspector">Inspektor</option>
                    <option value="moderator">Moderaator</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={userFormData.is_active}
                      onChange={e => setUserFormData({ is_active: e.target.checked })}
                    />
                    <span style={{ fontSize: '13px', fontWeight: '500' }}>Aktiivne kasutaja</span>
                  </label>
                </div>
              </div>

              {/* Permissions Table */}
              <div style={{ marginTop: '8px', backgroundColor: 'white', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                <h4 style={{ margin: 0, padding: '12px', fontSize: '14px', fontWeight: '600', borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
                  &#213;igused moodulite kaupa
                </h4>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', backgroundColor: 'white' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f3f4f6' }}>
                      <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Moodul</th>
                      <th style={{ textAlign: 'center', padding: '8px', borderBottom: '1px solid #e5e7eb', width: '60px' }}>Vaata</th>
                      <th style={{ textAlign: 'center', padding: '8px', borderBottom: '1px solid #e5e7eb', width: '60px' }}>Muuda</th>
                      <th style={{ textAlign: 'center', padding: '8px', borderBottom: '1px solid #e5e7eb', width: '60px' }}>Kustuta</th>
                    </tr>
                  </thead>
                  <tbody>
                    <PermissionRow label="🚚 Tarnegraafik" prefix="delivery" formData={userFormData} onChange={setUserFormData} />
                    <PermissionRow label="📅 Paigaldusgraafik" prefix="installation_schedule" formData={userFormData} onChange={setUserFormData} />
                    <PermissionRow label="🔧 Paigaldused" prefix="installations" formData={userFormData} onChange={setUserFormData} />
                    <PermissionRow label="📁 Organiseerija" prefix="organizer" formData={userFormData} onChange={setUserFormData} />
                    <PermissionRow label="🔍 Inspektsioonid" prefix="inspections" formData={userFormData} onChange={setUserFormData} isLast />
                  </tbody>
                </table>
              </div>

              {/* Legacy permissions */}
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px' }}>
                  <input type="checkbox" checked={userFormData.can_assembly_inspection} onChange={e => setUserFormData({ can_assembly_inspection: e.target.checked })} />
                  Assembly inspektsioon
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px' }}>
                  <input type="checkbox" checked={userFormData.can_bolt_inspection} onChange={e => setUserFormData({ can_bolt_inspection: e.target.checked })} />
                  Poltide inspektsioon
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px' }}>
                  <input type="checkbox" checked={userFormData.can_access_admin} onChange={e => setUserFormData({ can_access_admin: e.target.checked })} />
                  Admin ligip&#228;&#228;s
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px' }}>
                  <input type="checkbox" checked={userFormData.can_access_gps_search} onChange={e => setUserFormData({ can_access_gps_search: e.target.checked })} />
                  GPS Location Search
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '24px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowUserForm(false)}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb',
                  background: '#f9fafb',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                T&#252;hista
              </button>
              <button
                onClick={() => saveUser(projectId)}
                disabled={usersLoading}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#059669',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <FiSave size={14} />
                {usersLoading ? t('users.saving') : t('users.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper component to reduce repetition in permission rows
function PermissionRow({
  label,
  prefix,
  formData,
  onChange,
  isLast = false,
}: {
  label: string;
  prefix: string;
  formData: any;
  onChange: (data: any) => void;
  isLast?: boolean;
}) {
  const viewKey = `can_view_${prefix}`;
  const editKey = `can_edit_${prefix}`;
  const deleteKey = `can_delete_${prefix}`;
  const borderStyle = isLast ? undefined : '1px solid #e5e7eb';

  return (
    <tr style={{ backgroundColor: 'white' }}>
      <td style={{ padding: '6px 8px', borderBottom: borderStyle }}>{label}</td>
      <td style={{ textAlign: 'center', padding: '6px', borderBottom: borderStyle }}>
        <input type="checkbox" checked={formData[viewKey]} onChange={e => onChange({ [viewKey]: e.target.checked })} />
      </td>
      <td style={{ textAlign: 'center', padding: '6px', borderBottom: borderStyle }}>
        <input type="checkbox" checked={formData[editKey]} onChange={e => onChange({ [editKey]: e.target.checked })} />
      </td>
      <td style={{ textAlign: 'center', padding: '6px', borderBottom: borderStyle }}>
        <input type="checkbox" checked={formData[deleteKey]} onChange={e => onChange({ [deleteKey]: e.target.checked })} />
      </td>
    </tr>
  );
}
