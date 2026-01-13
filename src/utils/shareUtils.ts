/**
 * Secure Share Utilities for Delivery Reports
 *
 * Provides cryptographically secure token generation and share link management
 * for sharing delivery reports with external parties.
 */

import { supabase, DeliveryShareLink, ArrivedVehicle, DeliveryVehicle, ArrivalItemConfirmation, ArrivalPhoto, DeliveryItem } from '../supabase';

/**
 * Generate a cryptographically secure share token
 * Uses Web Crypto API for secure random bytes
 * @returns 48-character hexadecimal string
 */
export function generateShareToken(): string {
  const array = new Uint8Array(24);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate the full share URL for a given token
 * Uses Vite's BASE_URL to ensure correct path for GitHub Pages
 */
export function getShareUrl(token: string): string {
  // import.meta.env.BASE_URL is set in vite.config.ts (e.g., '/assembly-inspector/')
  const basePath = import.meta.env.BASE_URL || '/';
  // Remove trailing slash from base path for clean URL
  const cleanBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  return `${window.location.origin}${cleanBase}/share/${token}`;
}

/**
 * Create or get existing share link for an arrived vehicle
 */
export async function createOrGetShareLink(
  projectId: string,
  projectName: string,
  arrivedVehicleId: string,
  vehicleCode: string,
  arrivalDate: string,
  createdBy?: string
): Promise<{ shareLink: DeliveryShareLink | null; error: string | null }> {
  try {
    // Check for existing active share link
    const { data: existing, error: fetchError } = await supabase
      .from('trimble_delivery_share_links')
      .select('*')
      .eq('arrived_vehicle_id', arrivedVehicleId)
      .eq('is_active', true)
      .single();

    if (existing && !fetchError) {
      return { shareLink: existing, error: null };
    }

    // Create new share link
    const shareToken = generateShareToken();

    const { data: newLink, error: insertError } = await supabase
      .from('trimble_delivery_share_links')
      .insert({
        trimble_project_id: projectId,
        arrived_vehicle_id: arrivedVehicleId,
        share_token: shareToken,
        project_name: projectName,
        vehicle_code: vehicleCode,
        arrival_date: arrivalDate,
        is_active: true,
        view_count: 0,
        created_by: createdBy
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating share link:', insertError);
      return { shareLink: null, error: insertError.message };
    }

    return { shareLink: newLink, error: null };
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : 'Unknown error';
    console.error('Error in createOrGetShareLink:', e);
    return { shareLink: null, error: errorMessage };
  }
}

/**
 * Fetch share link data by token (for public gallery)
 */
export async function getShareLinkByToken(token: string): Promise<{
  shareLink: DeliveryShareLink | null;
  arrivedVehicle: (ArrivedVehicle & { vehicle?: DeliveryVehicle }) | null;
  confirmations: ArrivalItemConfirmation[];
  photos: ArrivalPhoto[];
  items: DeliveryItem[];
  error: string | null;
}> {
  try {
    // Get share link
    const { data: shareLink, error: linkError } = await supabase
      .from('trimble_delivery_share_links')
      .select('*')
      .eq('share_token', token)
      .eq('is_active', true)
      .single();

    if (linkError || !shareLink) {
      return {
        shareLink: null,
        arrivedVehicle: null,
        confirmations: [],
        photos: [],
        items: [],
        error: 'Share link not found or expired'
      };
    }

    // Check expiration
    if (shareLink.expires_at && new Date(shareLink.expires_at) < new Date()) {
      return {
        shareLink: null,
        arrivedVehicle: null,
        confirmations: [],
        photos: [],
        items: [],
        error: 'Share link has expired'
      };
    }

    // Update view count
    await supabase
      .from('trimble_delivery_share_links')
      .update({
        view_count: (shareLink.view_count || 0) + 1,
        last_viewed_at: new Date().toISOString()
      })
      .eq('id', shareLink.id);

    // Fetch arrived vehicle with delivery vehicle info
    const { data: arrivedVehicle } = await supabase
      .from('trimble_arrived_vehicles')
      .select(`
        *,
        vehicle:trimble_delivery_vehicles(*)
      `)
      .eq('id', shareLink.arrived_vehicle_id)
      .single();

    // Fetch confirmations
    const { data: confirmations } = await supabase
      .from('trimble_arrival_confirmations')
      .select('*')
      .eq('arrived_vehicle_id', shareLink.arrived_vehicle_id)
      .order('confirmed_at', { ascending: true });

    // Fetch photos
    const { data: photos } = await supabase
      .from('trimble_arrival_photos')
      .select('*')
      .eq('arrived_vehicle_id', shareLink.arrived_vehicle_id)
      .order('created_at', { ascending: true });

    // Get item IDs from confirmations and fetch items
    const itemIds = [...new Set((confirmations || []).map(c => c.item_id))];
    let items: DeliveryItem[] = [];

    if (itemIds.length > 0) {
      const { data: itemsData } = await supabase
        .from('trimble_delivery_items')
        .select('*')
        .in('id', itemIds);
      items = itemsData || [];
    }

    // Also fetch items by vehicle_id if arrived vehicle exists
    if (arrivedVehicle?.vehicle_id) {
      const { data: vehicleItems } = await supabase
        .from('trimble_delivery_items')
        .select('*')
        .eq('vehicle_id', arrivedVehicle.vehicle_id);

      // Merge items, avoiding duplicates
      const existingIds = new Set(items.map(i => i.id));
      for (const item of vehicleItems || []) {
        if (!existingIds.has(item.id)) {
          items.push(item);
        }
      }
    }

    return {
      shareLink,
      arrivedVehicle: arrivedVehicle as (ArrivedVehicle & { vehicle?: DeliveryVehicle }) | null,
      confirmations: confirmations || [],
      photos: photos || [],
      items,
      error: null
    };
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : 'Unknown error';
    console.error('Error fetching share link:', e);
    return {
      shareLink: null,
      arrivedVehicle: null,
      confirmations: [],
      photos: [],
      items: [],
      error: errorMessage
    };
  }
}

/**
 * Deactivate a share link
 */
export async function deactivateShareLink(shareId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('trimble_delivery_share_links')
      .update({ is_active: false })
      .eq('id', shareId);

    return !error;
  } catch {
    return false;
  }
}

/**
 * Format date for display (English)
 */
export function formatDateEnglish(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

/**
 * Format time for display
 */
export function formatTime(timeStr: string | null | undefined): string {
  if (!timeStr) return '-';
  return timeStr.slice(0, 5); // HH:MM
}

/**
 * Get status label in English
 */
export function getStatusLabelEnglish(status: string): string {
  const labels: Record<string, string> = {
    confirmed: 'Confirmed',
    pending: 'Pending',
    missing: 'Missing',
    wrong_vehicle: 'Wrong Vehicle',
    added: 'Added'
  };
  return labels[status] || status;
}

/**
 * Get photo type label in English
 */
export function getPhotoTypeLabelEnglish(type: string): string {
  const labels: Record<string, string> = {
    general: 'General',
    delivery_note: 'Delivery Note',
    item: 'Item Photo',
    loading: 'Loading',
    unloading: 'Unloading',
    damage: 'Damage'
  };
  return labels[type] || type;
}
