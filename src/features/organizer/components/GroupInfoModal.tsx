import { useTranslation } from 'react-i18next';
import { FiX, FiInfo, FiLock, FiCamera, FiPaperclip, FiClock } from 'react-icons/fi';
import { OrganizerGroup, CustomFieldDefinition } from '../../../supabase';

interface GroupInfoFile {
  type: 'photo' | 'attachment';
  url: string;
  itemMark: string;
  fieldName: string;
}

interface GroupInfoActivity {
  id: string;
  action_type: string;
  user_email: string;
  user_name?: string | null;
  created_at: string;
  item_count: number;
  field_name?: string | null;
}

interface GroupInfoModalProps {
  show: boolean;
  groupInfoGroupId: string | null;
  groups: OrganizerGroup[];
  groupInfoFiles: GroupInfoFile[];
  groupInfoActivities: GroupInfoActivity[];
  groupInfoActivitiesLoading: boolean;
  onClose: () => void;
  getRootParent: (groupId: string) => OrganizerGroup | null;
  setGroupInfoLightboxPhotos: (photos: string[]) => void;
  setGroupInfoLightboxIndex: (index: number) => void;
}

export function GroupInfoModal({
  show,
  groupInfoGroupId,
  groups,
  groupInfoFiles,
  groupInfoActivities,
  groupInfoActivitiesLoading,
  onClose,
  getRootParent,
  setGroupInfoLightboxPhotos,
  setGroupInfoLightboxIndex
}: GroupInfoModalProps) {
  const { t } = useTranslation('organizer');

  if (!show || !groupInfoGroupId) return null;

  const group = groups.find(g => g.id === groupInfoGroupId);
  if (!group) return null;

  const rootGroup = getRootParent(groupInfoGroupId) || group;
  const customFields = rootGroup.custom_fields || [];
  const photoFields = customFields.filter((f: CustomFieldDefinition) => f.type === 'photo');
  const attachmentFields = customFields.filter((f: CustomFieldDefinition) => f.type === 'attachment');
  const photos = groupInfoFiles.filter(f => f.type === 'photo');
  const attachments = groupInfoFiles.filter(f => f.type === 'attachment');

  // Permission helpers
  const getPermissionLabel = (perm: boolean) => perm ? '✓' : '—';
  const permLabels = {
    can_add: t('groupInfo.canAdd'),
    can_delete_own: t('groupInfo.canDeleteOwn'),
    can_delete_all: t('groupInfo.canDeleteAll'),
    can_edit_group: t('groupInfo.canEditGroup'),
    can_manage_fields: t('groupInfo.canManageFields')
  };

  const actionLabels: Record<string, string> = {
    add_items: t('activityLog.actionAddedDetails'),
    remove_items: t('activityLog.actionRemovedDetails'),
    update_item: t('activityLog.actionUpdateItem'),
    create_group: t('activityLog.actionCreateGroup'),
    delete_group: t('activityLog.actionDeleteGroup'),
    update_group: t('activityLog.actionUpdateGroup'),
    add_photo: t('activityLog.actionAddPhoto'),
    remove_photo: t('activityLog.actionRemovePhoto'),
    add_attachment: t('activityLog.actionAddAttachment'),
    add_field: t('activityLog.actionAddField'),
    remove_field: t('activityLog.actionRemoveField')
  };

  const actionColors: Record<string, string> = {
    add_items: '#10b981',
    remove_items: '#ef4444',
    update_item: '#f59e0b',
    create_group: '#3b82f6',
    delete_group: '#dc2626',
    update_group: '#8b5cf6',
    add_photo: '#22c55e',
    remove_photo: '#f87171',
    add_attachment: '#14b8a6',
    add_field: '#6366f1',
    remove_field: '#f43f5e'
  };

  return (
    <div className="org-modal-overlay" onClick={onClose}>
      <div
        className="org-modal group-info-modal"
        style={{ maxWidth: '700px', width: '95%', maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="org-modal-header">
          <h2><FiInfo size={16} /> {t('groupInfo.title', { name: group.name })}</h2>
          <button onClick={onClose}><FiX size={18} /></button>
        </div>
        <div className="org-modal-body" style={{ padding: '0', display: 'flex', flexDirection: 'column', gap: '0', maxHeight: 'calc(90vh - 120px)', overflowY: 'auto' }}>
          {/* Basic Info Section */}
          <div className="group-info-section">
            <h3><FiInfo size={14} /> {t('groupInfo.generalInfo')}</h3>
            <div className="group-info-grid">
              <div className="group-info-item">
                <span className="info-label">{t('groupInfo.creator')}</span>
                <span className="info-value">{group.created_by}</span>
              </div>
              <div className="group-info-item">
                <span className="info-label">{t('groupInfo.created')}</span>
                <span className="info-value">{new Date(group.created_at).toLocaleString('et-EE')}</span>
              </div>
              <div className="group-info-item">
                <span className="info-label">{t('groupInfo.lastModified')}</span>
                <span className="info-value">{new Date(group.updated_at).toLocaleString('et-EE')}</span>
              </div>
              {group.updated_by && (
                <div className="group-info-item">
                  <span className="info-label">{t('groupInfo.modifier')}</span>
                  <span className="info-value">{group.updated_by}</span>
                </div>
              )}
              {group.is_locked && (
                <>
                  <div className="group-info-item">
                    <span className="info-label">{t('groupInfo.lockedBy')}</span>
                    <span className="info-value">{group.locked_by || t('unknown')}</span>
                  </div>
                  <div className="group-info-item">
                    <span className="info-label">{t('groupInfo.lockedAt')}</span>
                    <span className="info-value">{group.locked_at ? new Date(group.locked_at).toLocaleString('et-EE') : '-'}</span>
                  </div>
                </>
              )}
              {group.description && (
                <div className="group-info-item full-width">
                  <span className="info-label">{t('groupInfo.description')}</span>
                  <span className="info-value">{group.description}</span>
                </div>
              )}
            </div>
          </div>

          {/* Permissions Section */}
          <div className="group-info-section">
            <h3><FiLock size={14} /> {t('groupInfo.permissions')}</h3>
            <div className="group-info-permissions">
              <div className="permissions-mode">
                <span className="info-label">{t('groupInfo.sharingMode')}</span>
                <span className="info-value">
                  {group.is_private ? t('groupInfo.private') :
                   Object.keys(group.user_permissions || {}).length > 0 ? t('groupInfo.selectedUsers') : t('groupInfo.wholeProject')}
                </span>
              </div>
              {!group.is_private && (
                <div className="permissions-table">
                  <div className="permissions-header">
                    <span>{t('groupInfo.userPermission')}</span>
                    {Object.keys(permLabels).map(key => (
                      <span key={key} title={permLabels[key as keyof typeof permLabels]}>{permLabels[key as keyof typeof permLabels].split(' ')[0]}</span>
                    ))}
                  </div>
                  {/* Default permissions */}
                  <div className="permissions-row">
                    <span className="perm-user">{t('groupInfo.defaultAll')}</span>
                    <span>{getPermissionLabel(group.default_permissions?.can_add)}</span>
                    <span>{getPermissionLabel(group.default_permissions?.can_delete_own)}</span>
                    <span>{getPermissionLabel(group.default_permissions?.can_delete_all)}</span>
                    <span>{getPermissionLabel(group.default_permissions?.can_edit_group)}</span>
                    <span>{getPermissionLabel(group.default_permissions?.can_manage_fields)}</span>
                  </div>
                  {/* User-specific permissions */}
                  {Object.entries(group.user_permissions || {}).map(([email, perms]: [string, any]) => (
                    <div key={email} className="permissions-row">
                      <span className="perm-user" title={email}>{email.split('@')[0]}</span>
                      <span>{getPermissionLabel(perms.can_add)}</span>
                      <span>{getPermissionLabel(perms.can_delete_own)}</span>
                      <span>{getPermissionLabel(perms.can_delete_all)}</span>
                      <span>{getPermissionLabel(perms.can_edit_group)}</span>
                      <span>{getPermissionLabel(perms.can_manage_fields)}</span>
                    </div>
                  ))}
                </div>
              )}
              {group.is_private && (
                <div style={{ fontSize: '12px', color: '#6b7280', padding: '8px 0' }}>
                  {t('groupInfo.privateOnly')}
                </div>
              )}
            </div>
          </div>

          {/* Photos Gallery */}
          {photoFields.length > 0 && (
            <div className="group-info-section">
              <h3><FiCamera size={14} /> {t('groupInfo.photos', { count: photos.length })}</h3>
              {photos.length > 0 ? (
                <div className="group-info-gallery">
                  {photos.map((photo, idx) => (
                    <div
                      key={idx}
                      className="gallery-item"
                      onClick={() => {
                        setGroupInfoLightboxPhotos(photos.map(p => p.url));
                        setGroupInfoLightboxIndex(idx);
                      }}
                    >
                      <img src={photo.url} alt={photo.itemMark} />
                      <div className="gallery-item-info">
                        <span className="item-mark">{photo.itemMark}</span>
                        <span className="field-name">{photo.fieldName}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: '#6b7280', padding: '8px 0' }}>
                  {t('groupInfo.noPhotos')}
                </div>
              )}
            </div>
          )}

          {/* Attachments */}
          {attachmentFields.length > 0 && (
            <div className="group-info-section">
              <h3><FiPaperclip size={14} /> {t('groupInfo.attachments', { count: attachments.length })}</h3>
              {attachments.length > 0 ? (
                <div className="group-info-attachments">
                  {attachments.map((att, idx) => (
                    <a
                      key={idx}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="attachment-item"
                    >
                      <FiPaperclip size={12} />
                      <span className="att-mark">{att.itemMark}</span>
                      <span className="att-field">{att.fieldName}</span>
                    </a>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: '#6b7280', padding: '8px 0' }}>
                  {t('groupInfo.noAttachments')}
                </div>
              )}
            </div>
          )}

          {/* Recent Activities */}
          <div className="group-info-section">
            <h3><FiClock size={14} /> {t('groupInfo.recentActivities')}</h3>
            {groupInfoActivitiesLoading ? (
              <div style={{ padding: '16px', textAlign: 'center', color: '#6b7280' }}>{t('loading')}</div>
            ) : groupInfoActivities.length > 0 ? (
              <div className="group-info-activities">
                {groupInfoActivities.map((log) => {
                  const userName = log.user_name || log.user_email.split('@')[0];
                  const actionLabel = actionLabels[log.action_type] || log.action_type;
                  const actionColor = actionColors[log.action_type] || '#6b7280';
                  const date = new Date(log.created_at);

                  return (
                    <div key={log.id} className="activity-item">
                      <span className="activity-dot" style={{ background: actionColor }} />
                      <span className="activity-user" title={log.user_email}>{userName}</span>
                      <span className="activity-action">{actionLabel}</span>
                      {log.item_count > 1 && (
                        <span className="activity-count" style={{ background: actionColor }}>
                          {log.item_count}
                        </span>
                      )}
                      {log.field_name && (
                        <span className="activity-field">({log.field_name})</span>
                      )}
                      <span className="activity-time">
                        {date.toLocaleDateString('et-EE')} {date.toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: '12px', color: '#6b7280', padding: '8px 0' }}>
                {t('groupInfo.noActivities')}
              </div>
            )}
          </div>
        </div>
        <div className="org-modal-footer">
          <button className="cancel" onClick={onClose}>{t('close')}</button>
        </div>
      </div>
    </div>
  );
}
