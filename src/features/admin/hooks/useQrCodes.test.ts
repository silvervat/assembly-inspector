import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQrCodes } from './useQrCodes';

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
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  },
  DEFAULT_PROPERTY_MAPPINGS: {},
}));

const mockApi = {
  viewer: {
    getSelection: vi.fn().mockResolvedValue([]),
    getObjectProperties: vi.fn().mockResolvedValue([]),
    convertToObjectIds: vi.fn().mockResolvedValue([]),
    setSelection: vi.fn(),
  },
};

describe('useQrCodes', () => {
  const defaultParams = {
    api: mockApi,
    projectId: 'test-project',
    userEmail: 'test@test.com',
    propertyMappings: {
      assembly_mark_set: 'Tekla Common',
      assembly_mark_prop: 'Assembly/Cast unit Mark',
    },
    setMessage: vi.fn(),
    t: (key: string) => key,
  };

  it('should initialize with empty state', () => {
    const { result } = renderHook(() => useQrCodes(defaultParams));
    expect(result.current.qrCodes).toEqual([]);
    expect(result.current.qrLoading).toBe(false);
  });

  it('should have qr management functions', () => {
    const { result } = renderHook(() => useQrCodes(defaultParams));
    expect(typeof result.current.loadQrCodes).toBe('function');
    expect(typeof result.current.handleGenerateQr).toBe('function');
    expect(typeof result.current.handleDeleteQr).toBe('function');
  });
});
