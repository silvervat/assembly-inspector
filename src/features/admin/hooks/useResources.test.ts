import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useResources } from './useResources';

vi.mock('../../../supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnValue({ data: [], error: null }),
    })),
  },
  DEFAULT_PROPERTY_MAPPINGS: {},
}));

describe('useResources', () => {
  const defaultParams = {
    projectId: 'test-project',
    userEmail: 'test@test.com',
    setMessage: vi.fn(),
    t: (key: string) => key,
  };

  it('should initialize with empty state', () => {
    const { result } = renderHook(() => useResources(defaultParams));
    expect(result.current.projectResources).toEqual([]);
    expect(result.current.resourcesLoading).toBe(false);
    expect(result.current.resourcesSaving).toBe(false);
  });

  it('should set resource form data', () => {
    const { result } = renderHook(() => useResources(defaultParams));
    act(() => {
      result.current.setResourceFormData({ name: 'Test Resource' });
    });
    expect(result.current.resourceFormData.name).toBe('Test Resource');
  });

  it('should reset resource form', () => {
    const { result } = renderHook(() => useResources(defaultParams));
    act(() => {
      result.current.setResourceFormData({ name: 'Test' });
      result.current.resetResourceForm();
    });
    expect(result.current.resourceFormData.name).toBe('');
  });
});
