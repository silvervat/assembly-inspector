import { useState, useEffect, useCallback } from 'react';
import { supabase, CraneModel } from '../../../../supabase';

interface UseCranesResult {
  cranes: CraneModel[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createCrane: (data: Partial<CraneModel>) => Promise<CraneModel | null>;
  updateCrane: (id: string, data: Partial<CraneModel>) => Promise<boolean>;
  deleteCrane: (id: string) => Promise<boolean>;
  uploadCraneImage: (craneId: string, file: File) => Promise<string | null>;
}

export function useCranes(): UseCranesResult {
  const [cranes, setCranes] = useState<CraneModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCranes = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('crane_models')
        .select('*')
        .order('manufacturer', { ascending: true })
        .order('model', { ascending: true });

      if (fetchError) {
        console.error('Error fetching cranes:', fetchError);
        setError(fetchError.message);
        return;
      }

      setCranes(data || []);
    } catch (err) {
      console.error('Error fetching cranes:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCranes();
  }, [fetchCranes]);

  const createCrane = useCallback(async (data: Partial<CraneModel>): Promise<CraneModel | null> => {
    try {
      const { data: newCrane, error: insertError } = await supabase
        .from('crane_models')
        .insert(data)
        .select()
        .single();

      if (insertError) {
        console.error('Error creating crane:', insertError);
        setError(insertError.message);
        return null;
      }

      // Update local state
      setCranes(prev => [...prev, newCrane].sort((a, b) => {
        const manuCompare = a.manufacturer.localeCompare(b.manufacturer);
        if (manuCompare !== 0) return manuCompare;
        return a.model.localeCompare(b.model);
      }));

      return newCrane;
    } catch (err) {
      console.error('Error creating crane:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    }
  }, []);

  const updateCrane = useCallback(async (id: string, data: Partial<CraneModel>): Promise<boolean> => {
    try {
      const { error: updateError } = await supabase
        .from('crane_models')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (updateError) {
        console.error('Error updating crane:', updateError);
        setError(updateError.message);
        return false;
      }

      // Update local state
      setCranes(prev => prev.map(crane =>
        crane.id === id ? { ...crane, ...data } : crane
      ));

      return true;
    } catch (err) {
      console.error('Error updating crane:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  }, []);

  const deleteCrane = useCallback(async (id: string): Promise<boolean> => {
    try {
      const { error: deleteError } = await supabase
        .from('crane_models')
        .delete()
        .eq('id', id);

      if (deleteError) {
        console.error('Error deleting crane:', deleteError);
        setError(deleteError.message);
        return false;
      }

      // Update local state
      setCranes(prev => prev.filter(crane => crane.id !== id));

      return true;
    } catch (err) {
      console.error('Error deleting crane:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  }, []);

  // Upload crane image to Supabase storage
  // NOTE: Requires 'crane-images' bucket to be created in Supabase Storage with public access
  const uploadCraneImage = useCallback(async (craneId: string, file: File): Promise<string | null> => {
    const BUCKET_NAME = 'crane-images';

    try {
      // Create a unique filename
      const fileExt = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const fileName = `crane_${craneId}_${Date.now()}.${fileExt}`;

      // Upload to Supabase storage
      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) {
        console.error('Error uploading crane image:', uploadError);
        // Provide helpful error message for bucket not found
        if (uploadError.message.includes('Bucket not found') || uploadError.message.includes('bucket')) {
          setError(`Storage bucket '${BUCKET_NAME}' not found. Please create it in Supabase Dashboard → Storage with public access enabled.`);
        } else {
          setError(uploadError.message);
        }
        return null;
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(fileName);

      const imageUrl = urlData.publicUrl;

      // Update crane with image URL
      const { error: updateError } = await supabase
        .from('crane_models')
        .update({ image_url: imageUrl, updated_at: new Date().toISOString() })
        .eq('id', craneId);

      if (updateError) {
        console.error('Error updating crane image URL:', updateError);
        setError(updateError.message);
        return null;
      }

      // Update local state
      setCranes(prev => prev.map(crane =>
        crane.id === craneId ? { ...crane, image_url: imageUrl } : crane
      ));

      return imageUrl;
    } catch (err) {
      console.error('Error uploading crane image:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    }
  }, []);

  return {
    cranes,
    loading,
    error,
    refetch: fetchCranes,
    createCrane,
    updateCrane,
    deleteCrane,
    uploadCraneImage
  };
}
