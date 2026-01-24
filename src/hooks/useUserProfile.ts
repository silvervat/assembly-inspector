import { useState, useEffect, useCallback } from 'react';
import { supabase, TrimbleExUserExtended, UserProfileExtension } from '../supabase';

export interface UseUserProfileResult {
  profile: TrimbleExUserExtended | null;
  loading: boolean;
  error: string | null;
  updateProfile: (updates: Partial<UserProfileExtension>) => Promise<boolean>;
  uploadSignature: (dataUrl: string) => Promise<string | null>;
  deleteSignature: () => Promise<boolean>;
  refresh: () => Promise<void>;
}

/**
 * Hook for managing user profile with signature support
 */
export function useUserProfile(userEmail: string | null, projectId?: string): UseUserProfileResult {
  const [profile, setProfile] = useState<TrimbleExUserExtended | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load user profile
  const loadProfile = useCallback(async () => {
    if (!userEmail) {
      setProfile(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('trimble_inspection_users')
        .select('*')
        .eq('email', userEmail);

      if (projectId) {
        query = query.eq('trimble_project_id', projectId);
      }

      const { data, error: queryError } = await query.single();

      if (queryError && queryError.code !== 'PGRST116') {
        throw queryError;
      }

      setProfile(data as TrimbleExUserExtended);
    } catch (err) {
      console.error('Error loading user profile:', err);
      setError(err instanceof Error ? err.message : 'Viga profiili laadimisel');
    } finally {
      setLoading(false);
    }
  }, [userEmail, projectId]);

  // Update profile
  const updateProfile = useCallback(async (
    updates: Partial<UserProfileExtension>
  ): Promise<boolean> => {
    if (!userEmail || !profile) {
      setError('Kasutaja pole sisselogitud');
      return false;
    }

    try {
      const { error: updateError } = await supabase
        .from('trimble_inspection_users')
        .update({
          ...updates,
          profile_updated_at: new Date().toISOString()
        })
        .eq('id', profile.id);

      if (updateError) throw updateError;

      // Refresh profile
      await loadProfile();
      return true;
    } catch (err) {
      console.error('Error updating profile:', err);
      setError(err instanceof Error ? err.message : 'Viga profiili uuendamisel');
      return false;
    }
  }, [userEmail, profile, loadProfile]);

  // Upload signature image
  const uploadSignature = useCallback(async (dataUrl: string): Promise<string | null> => {
    if (!userEmail || !profile) {
      setError('Kasutaja pole sisselogitud');
      return null;
    }

    try {
      // Convert data URL to blob
      const response = await fetch(dataUrl);
      const blob = await response.blob();

      // Generate file path
      const fileName = `${profile.id}_${Date.now()}.png`;
      const path = `signatures/${fileName}`;

      // Delete old signature if exists
      if (profile.signature_storage_path) {
        await supabase.storage
          .from('inspection-signatures')
          .remove([profile.signature_storage_path]);
      }

      // Upload new signature
      const { error: uploadError } = await supabase.storage
        .from('inspection-signatures')
        .upload(path, blob, {
          contentType: 'image/png',
          upsert: true
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('inspection-signatures')
        .getPublicUrl(path);

      // Update profile with signature URL
      const { error: updateError } = await supabase
        .from('trimble_inspection_users')
        .update({
          signature_url: urlData.publicUrl,
          signature_storage_path: path,
          signature_updated_at: new Date().toISOString()
        })
        .eq('id', profile.id);

      if (updateError) throw updateError;

      // Refresh profile
      await loadProfile();

      return urlData.publicUrl;
    } catch (err) {
      console.error('Error uploading signature:', err);
      setError(err instanceof Error ? err.message : 'Viga allkirja üleslaadimisel');
      return null;
    }
  }, [userEmail, profile, loadProfile]);

  // Delete signature
  const deleteSignature = useCallback(async (): Promise<boolean> => {
    if (!userEmail || !profile) {
      setError('Kasutaja pole sisselogitud');
      return false;
    }

    try {
      // Delete from storage
      if (profile.signature_storage_path) {
        await supabase.storage
          .from('inspection-signatures')
          .remove([profile.signature_storage_path]);
      }

      // Update profile
      const { error: updateError } = await supabase
        .from('trimble_inspection_users')
        .update({
          signature_url: null,
          signature_storage_path: null,
          signature_updated_at: null
        })
        .eq('id', profile.id);

      if (updateError) throw updateError;

      // Refresh profile
      await loadProfile();
      return true;
    } catch (err) {
      console.error('Error deleting signature:', err);
      setError(err instanceof Error ? err.message : 'Viga allkirja kustutamisel');
      return false;
    }
  }, [userEmail, profile, loadProfile]);

  // Load profile on mount
  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  return {
    profile,
    loading,
    error,
    updateProfile,
    uploadSignature,
    deleteSignature,
    refresh: loadProfile
  };
}

export default useUserProfile;
