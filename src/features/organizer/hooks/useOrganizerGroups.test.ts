import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOrganizerGroups } from './useOrganizerGroups';

vi.mock('../../../supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnValue({ data: [], error: null }),
    })),
  },
}));

describe('useOrganizerGroups', () => {
  const defaultParams = {
    projectId: 'test-project',
    userEmail: 'test@test.com',
    t: (key: string) => key,
  };

  it('should initialize with empty state', () => {
    const { result } = renderHook(() => useOrganizerGroups(defaultParams));
    expect(result.current.groups).toEqual([]);
    expect(result.current.groupItems).toEqual(new Map());
    expect(result.current.loading).toBe(false);
    expect(result.current.saving).toBe(false);
  });

  it('should have CRUD functions', () => {
    const { result } = renderHook(() => useOrganizerGroups(defaultParams));
    expect(typeof result.current.loadGroups).toBe('function');
    expect(typeof result.current.loadGroupItems).toBe('function');
    expect(typeof result.current.deleteGroup).toBe('function');
    expect(typeof result.current.updateGroupColor).toBe('function');
    expect(typeof result.current.toggleGroupLock).toBe('function');
  });

  it('should update groups state', () => {
    const { result } = renderHook(() => useOrganizerGroups(defaultParams));
    act(() => {
      result.current.setGroups([{ id: '1', name: 'Test' } as any]);
    });
    expect(result.current.groups).toHaveLength(1);
    expect(result.current.groups[0].name).toBe('Test');
  });
});
