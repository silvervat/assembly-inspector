import React, { useState, useEffect } from 'react';
import { useUserProfile } from '../hooks/useUserProfile';
import { SignaturePad } from './SignaturePad';
import { UserProfileExtension } from '../supabase';

export interface UserProfileModalProps {
  userEmail: string;
  projectId?: string;
  onClose: () => void;
  onSave?: () => void;
}

/**
 * User profile modal with signature pad
 */
export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  userEmail,
  projectId,
  onClose,
  onSave
}) => {
  const { profile, loading, error, updateProfile, uploadSignature, deleteSignature } = useUserProfile(userEmail, projectId);

  const [phone, setPhone] = useState('');
  const [position, setPosition] = useState('');
  const [company, setCompany] = useState('');
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load initial values from profile
  useEffect(() => {
    if (profile) {
      setPhone(profile.phone || '');
      setPosition(profile.position || '');
      setCompany(profile.company || '');
    }
  }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);

    const updates: Partial<UserProfileExtension> = {
      phone: phone || undefined,
      position: position || undefined,
      company: company || undefined
    };

    const success = await updateProfile(updates);

    if (success) {
      onSave?.();
      onClose();
    } else {
      setSaveError('Profiili salvestamine ebaõnnestus');
    }

    setSaving(false);
  };

  const handleSignatureSave = async (dataUrl: string) => {
    setSaving(true);
    setSaveError(null);

    const url = await uploadSignature(dataUrl);

    if (url) {
      setShowSignaturePad(false);
    } else {
      setSaveError('Allkirja salvestamine ebaõnnestus');
    }

    setSaving(false);
  };

  const handleDeleteSignature = async () => {
    if (!confirm('Kas oled kindel, et soovid allkirja kustutada?')) return;

    setSaving(true);
    await deleteSignature();
    setSaving(false);
  };

  if (loading) {
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}
      >
        <div
          style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            padding: '40px',
            textAlign: 'center'
          }}
        >
          Laadin...
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          maxWidth: '450px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #E5E7EB',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <h2 style={{ margin: 0, fontSize: '18px', color: '#111827' }}>Kasutaja profiil</h2>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              fontSize: '20px',
              color: '#6B7280',
              padding: '4px'
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '20px' }}>
          {/* Error message */}
          {(error || saveError) && (
            <div
              style={{
                padding: '12px',
                backgroundColor: '#FEE2E2',
                color: '#DC2626',
                borderRadius: '6px',
                marginBottom: '16px',
                fontSize: '14px'
              }}
            >
              {error || saveError}
            </div>
          )}

          {/* User info */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  backgroundColor: '#EFF6FF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px'
                }}
              >
                {profile?.name?.[0]?.toUpperCase() || '?'}
              </div>
              <div>
                <div style={{ fontWeight: 'bold', color: '#111827' }}>{profile?.name || 'Kasutaja'}</div>
                <div style={{ fontSize: '12px', color: '#6B7280' }}>{profile?.email}</div>
                <div style={{ fontSize: '11px', color: '#9CA3AF' }}>
                  {profile?.role === 'admin' ? 'Admin' : profile?.role === 'moderator' ? 'Moderaator' : 'Inspektor'}
                </div>
              </div>
            </div>
          </div>

          {/* Form fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Phone */}
            <div>
              <label
                style={{
                  display: 'block',
                  marginBottom: '4px',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#374151'
                }}
              >
                Telefon
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+372 5XX XXXX"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              />
            </div>

            {/* Position */}
            <div>
              <label
                style={{
                  display: 'block',
                  marginBottom: '4px',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#374151'
                }}
              >
                Ametinimetus
              </label>
              <input
                type="text"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                placeholder="nt. Kvaliteedikontrolör"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              />
            </div>

            {/* Company */}
            <div>
              <label
                style={{
                  display: 'block',
                  marginBottom: '4px',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#374151'
                }}
              >
                Ettevõte
              </label>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="nt. AS Ehitusfirma"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              />
            </div>

            {/* Signature section */}
            <div>
              <label
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#374151'
                }}
              >
                Allkiri
              </label>

              {showSignaturePad ? (
                <SignaturePad
                  onSave={handleSignatureSave}
                  onCancel={() => setShowSignaturePad(false)}
                  existingSignature={profile?.signature_url}
                />
              ) : profile?.signature_url ? (
                <div>
                  <div
                    style={{
                      border: '1px solid #D1D5DB',
                      borderRadius: '6px',
                      padding: '12px',
                      backgroundColor: '#F9FAFB',
                      marginBottom: '8px'
                    }}
                  >
                    <img
                      src={profile.signature_url}
                      alt="Allkiri"
                      style={{
                        maxWidth: '100%',
                        height: 'auto',
                        display: 'block'
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => setShowSignaturePad(true)}
                      style={{
                        padding: '8px 16px',
                        border: '1px solid #D1D5DB',
                        borderRadius: '6px',
                        backgroundColor: 'white',
                        cursor: 'pointer',
                        fontSize: '13px'
                      }}
                    >
                      Muuda allkirja
                    </button>
                    <button
                      onClick={handleDeleteSignature}
                      disabled={saving}
                      style={{
                        padding: '8px 16px',
                        border: '1px solid #EF4444',
                        borderRadius: '6px',
                        backgroundColor: 'white',
                        color: '#EF4444',
                        cursor: saving ? 'not-allowed' : 'pointer',
                        fontSize: '13px'
                      }}
                    >
                      Kustuta
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowSignaturePad(true)}
                  style={{
                    width: '100%',
                    padding: '24px',
                    border: '2px dashed #D1D5DB',
                    borderRadius: '6px',
                    backgroundColor: '#F9FAFB',
                    cursor: 'pointer',
                    fontSize: '14px',
                    color: '#6B7280'
                  }}
                >
                  + Lisa allkiri
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid #E5E7EB',
            display: 'flex',
            gap: '8px',
            justifyContent: 'flex-end'
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              border: '1px solid #D1D5DB',
              borderRadius: '6px',
              backgroundColor: 'white',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Tühista
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '10px 20px',
              border: 'none',
              borderRadius: '6px',
              backgroundColor: saving ? '#9CA3AF' : '#3B82F6',
              color: 'white',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: '14px'
            }}
          >
            {saving ? 'Salvestan...' : 'Salvesta'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserProfileModal;
