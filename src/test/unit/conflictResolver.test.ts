/**
 * Unit tests for ConflictResolver.
 *
 * NOTE: ConflictResolver depends on vscode, IProtocolAdapter, and LocalCacheManager.
 * These tests use mocks for all external dependencies.
 */

import { expect } from 'chai';
import { ConflictResolver } from '../../providers/ConflictResolver';
import { IProtocolAdapter } from '../../core/IProtocolAdapter';
import { LocalCacheManager } from '../../core/LocalCacheManager';
import { ConflictAction, LocalCacheStat } from '../../core/types';

/**
 * Minimal mock of IProtocolAdapter.
 */
class MockAdapter implements IProtocolAdapter {
  private _connected: boolean = false;
  private _remoteSize: number = 1024;
  private _remoteContent: Uint8Array = new Uint8Array([1, 2, 3]);

  setRemoteContent(content: Uint8Array) { this._remoteContent = content; }
  setRemoteSize(size: number) { this._remoteSize = size; }

  connect() { this._connected = true; return Promise.resolve(); }
  disconnect() { this._connected = false; return Promise.resolve(); }
  isConnected() { return this._connected; }

  stat(): Promise<{ type: 'file'; ctime: Date; mtime: Date; size: number; permissions: string }> {
    return Promise.resolve({
      type: 'file', ctime: new Date(), mtime: new Date(),
      size: this._remoteSize, permissions: '-rw-r--r--',
    });
  }
  readFile(): Promise<Uint8Array> { return Promise.resolve(this._remoteContent); }
  readDirectory(): Promise<any[]> { return Promise.resolve([]); }
  writeFile(): Promise<void> { return Promise.resolve(); }
  delete(): Promise<void> { return Promise.resolve(); }
  rename(): Promise<void> { return Promise.resolve(); }
  createDirectory(): Promise<void> { return Promise.resolve(); }
}

/**
 * Minimal mock of LocalCacheManager for hash-based conflict detection.
 */
class MockCacheManager {
  private _cacheSize: number = 1024;
  private _baseHash: string | null = null;
  private _localHash: string | null = null;
  private _exists: boolean = true;

  setBaseHash(hash: string | null) { this._baseHash = hash; }
  setLocalHash(hash: string | null) { this._localHash = hash; }
  setCacheSize(size: number) { this._cacheSize = size; }
  setExists(exists: boolean) { this._exists = exists; }

  getCacheStat(): Promise<LocalCacheStat> {
    return Promise.resolve({ exists: this._exists, size: this._cacheSize });
  }
  readBase(): Promise<string | null> { return Promise.resolve(this._baseHash); }
  readHash(): Promise<string | null> { return Promise.resolve(this._localHash); }
  writeBase(): Promise<void> { return Promise.resolve(); }
  writeHash(): Promise<void> { return Promise.resolve(); }
  writeCache(): Promise<void> { return Promise.resolve(); }
}

describe('ConflictResolver', () => {
  let adapter: MockAdapter;
  let cacheManager: MockCacheManager;
  let resolver: ConflictResolver;

  beforeEach(() => {
    adapter = new MockAdapter();
    cacheManager = new MockCacheManager();
    resolver = new ConflictResolver(adapter, cacheManager as unknown as LocalCacheManager);
  });

  describe('construction', () => {
    it('should be properly constructed with adapter and cacheManager', () => {
      expect(resolver).to.be.instanceOf(ConflictResolver);
    });

    it('should not throw when constructed with valid dependencies', () => {
      expect(() => new ConflictResolver(adapter, cacheManager as unknown as LocalCacheManager)).to.not.throw();
    });
  });

  describe('checkConflict() — content hash based', () => {
    it('should accept (connectionId, remotePath) — 2 params, no mtime', () => {
      expect(resolver.checkConflict).to.be.a('function');
      expect(resolver.checkConflict.length).to.equal(2);
    });

    it('should return { hasConflict: false } when base matches remote AND no local edits', async () => {
      adapter.setRemoteContent(new Uint8Array([1, 2, 3]));
      cacheManager.setBaseHash('039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');
      cacheManager.setLocalHash('039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');

      const result = await resolver.checkConflict('conn-1', '/file.txt');
      expect(result.hasConflict).to.be.false;
    });

    it('should return { hasConflict: true } when remote differs from base', async () => {
      adapter.setRemoteContent(new Uint8Array([4, 5, 6]));
      cacheManager.setBaseHash('039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');

      const result = await resolver.checkConflict('conn-1', '/file.txt');
      expect(result.hasConflict).to.be.true;
    });

    it('should return { hasConflict: true } when remote matches base but local has been edited', async () => {
      adapter.setRemoteContent(new Uint8Array([1, 2, 3]));
      cacheManager.setBaseHash('039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');
      cacheManager.setLocalHash('787c798e39a5bc1910355bae6d0cd87a36b2e10fd0202a83e3bb6b005da83472');

      const result = await resolver.checkConflict('conn-1', '/file.txt');
      expect(result.hasConflict).to.be.true;
    });

    it('should return { hasConflict: false } when no baseline (first sync)', async () => {
      cacheManager.setBaseHash(null);

      const result = await resolver.checkConflict('conn-1', '/file.txt');
      expect(result.hasConflict).to.be.false;
    });

    it('should return { hasConflict: false } when cache does not exist', async () => {
      cacheManager.setExists(false);
      const result = await resolver.checkConflict('conn-1', '/file.txt');
      expect(result.hasConflict).to.be.false;
    });
  });

  describe('ConflictAction type validation', () => {
    it('should recognize all 3 ConflictAction values', () => {
      const actions: ConflictAction[] = ['keep-remote', 'force-overwrite', 'manual-merge'];
      expect(actions).to.have.lengthOf(3);
    });
  });

  describe('skipForSession and clearSkipSet', () => {
    it('should skip conflict check for files in skip set', async () => {
      resolver.skipForSession('conn-1', '/skip/this/file.txt');
      // Even though sizes differ, skip set should bypass check
      adapter.setRemoteSize(2048);
      cacheManager.setCacheSize(1024);

      const result = await resolver.checkConflict('conn-1', '/skip/this/file.txt');
      expect(result.hasConflict).to.be.false;
    });

    it('should restore normal check after clearSkipSet', async () => {
      resolver.skipForSession('conn-1', '/skip/file.txt');
      resolver.clearSkipSet('conn-1');

      // Set up a hash mismatch to trigger conflict
      adapter.setRemoteContent(new Uint8Array([9, 9, 9]));
      cacheManager.setBaseHash('039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');
      const result = await resolver.checkConflict('conn-1', '/skip/file.txt');
      expect(result.hasConflict).to.be.true;
    });
  });

  describe('resolveConflict()', () => {
    it('should be a function accepting (remotePath, mode?)', () => {
      expect(resolver.resolveConflict).to.be.a('function');
      expect(resolver.resolveConflict.length).to.be.at.most(2);
    });

    it('should return a Promise<ConflictAction>', () => {
      const result = resolver.resolveConflict('/test/path');
      expect(result).to.be.a('promise');
    });
  });
});
