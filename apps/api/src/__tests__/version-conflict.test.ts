import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphQLError } from 'graphql';

// Mock the Supabase module before importing resolvers
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn()
}));

describe('Version Conflict Handling - Integration Tests', () => {
  let mockSupabaseClient: any;
  let resolvers: any;

  beforeEach(async () => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    
    // Import resolvers fresh for each test
    const resolverModule = await import('../resolvers.ts');
    resolvers = resolverModule.resolvers;
  });

  it('should throw VERSION_CONFLICT when version mismatch on renameAsset', async () => {
    // Create mock context with userId
    const mockContext = {
      userId: 'test-user-123',
      supabase: {
        from: vi.fn((table: string) => {
          if (table === 'asset') {
            return {
              update: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'No rows returned', code: 'PGRST116' }
              })
            };
          }
          return {};
        })
      }
    };

    // Try to rename asset with wrong version
    await expect(
      resolvers.Mutation.renameAsset(
        null,
        { 
          assetId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 
          filename: 'new-name.jpg', 
          version: 1 
        },
        mockContext
      )
    ).rejects.toThrow(GraphQLError);

    await expect(
      resolvers.Mutation.renameAsset(
        null,
        { 
          assetId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 
          filename: 'new-name.jpg', 
          version: 1 
        },
        mockContext
      )
    ).rejects.toMatchObject({
      extensions: { code: 'VERSION_CONFLICT' }
    });
  });

  it('should successfully rename when version matches', async () => {
    const mockAsset = {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      filename: 'renamed-file.jpg',
      mime: 'image/jpeg',
      size: 102400,
      sha256: 'abc123',
      status: 'ready',
      version: 2,
      owner_id: 'test-user-123',
      storage_path: 'test-user-123/2025/01/file.jpg',
      created_at: '2025-01-30T10:00:00Z',
      updated_at: '2025-01-30T10:05:00Z'
    };

    const mockContext = {
      userId: 'test-user-123',
      supabase: {
        from: vi.fn((table: string) => {
          if (table === 'asset') {
            return {
              update: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: mockAsset,
                error: null
              })
            };
          }
          return {};
        })
      }
    };

    const result = await resolvers.Mutation.renameAsset(
      null,
      { 
        assetId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 
        filename: 'renamed-file.jpg', 
        version: 1 
      },
      mockContext
    );

    expect(result).toBeDefined();
    expect(result.filename).toBe('renamed-file.jpg');
    expect(result.version).toBe(2);
  });

  it('should validate optimistic locking prevents concurrent updates', async () => {
    // Simulate two concurrent rename attempts
    const assetId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const currentVersion = 1;

    // First update succeeds
    const mockContext1 = {
      userId: 'test-user-123',
      supabase: {
        from: vi.fn(() => ({
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { version: 2, filename: 'first-rename.jpg' },
            error: null
          })
        }))
      }
    };

    const firstRename = await resolvers.Mutation.renameAsset(
      null,
      { assetId, filename: 'first-rename.jpg', version: currentVersion },
      mockContext1
    );

    expect(firstRename.version).toBe(2);

    // Second update with stale version fails
    const mockContext2 = {
      userId: 'test-user-123',
      supabase: {
        from: vi.fn(() => ({
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'No rows matched', code: 'PGRST116' }
          })
        }))
      }
    };

    await expect(
      resolvers.Mutation.renameAsset(
        null,
        { assetId, filename: 'second-rename.jpg', version: currentVersion }, // Stale version!
        mockContext2
      )
    ).rejects.toThrow(GraphQLError);
  });
});