import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDeliveryVehicles } from './useDeliveryVehicles';

vi.mock('../../../supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnValue({ data: null, error: null }),
      order: vi.fn().mockReturnValue({ data: [], error: null }),
    })),
  },
}));

describe('useDeliveryVehicles', () => {
  const defaultParams = {
    projectId: 'test-project',
    userEmail: 'test@test.com',
    t: (key: string) => key,
    setMessage: vi.fn(),
  };

  it('should initialize with empty vehicles', () => {
    const { result } = renderHook(() => useDeliveryVehicles(defaultParams));
    expect(result.current.vehicles).toEqual([]);
    expect(result.current.saving).toBe(false);
  });

  it('should have CRUD functions', () => {
    const { result } = renderHook(() => useDeliveryVehicles(defaultParams));
    expect(typeof result.current.loadVehicles).toBe('function');
    expect(typeof result.current.createVehicle).toBe('function');
    expect(typeof result.current.deleteVehicle).toBe('function');
  });
});
