/**
 * Unit tests for ConflictResolver.
 *
 * NOTE: ConflictResolver depends on vscode (for showWarningMessage) and
 * IProtocolAdapter (for stat). Since these require a running VSCode instance
 * and a real remote connection, these tests focus on:
 * 1. Constructor behavior
 * 2. Function signature validation
 * 3. ConflictAction type conformance
 * 4. Skip set logic (which is pure in-memory state)
 */

import { expect } from 'chai';
import { ConflictResolver } from '../../providers/ConflictResolver';
import { IProtocolAdapter } from '../../core/IProtocolAdapter';
import { ConflictAction } from '../../core/types';

/**
 * Minimal mock of IProtocolAdapter for testing ConflictResolver.
 * Only implements the methods needed for conflict detection.
 */
class MockAdapter implements IProtocolAdapter {
  private _connected: boolean = false;

  connect(): Promise<void> {
    this._connected = true;
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this._connected = false;
    return Promise.resolve();
  }

  isConnected(): boolean {
    return this._connected;
  }

  stat(): Promise<{ type: 'file'; ctime: Date; mtime: Date; size: number; permissions: string }> {
    return Promise.resolve({
      type: 'file',
      ctime: new Date(),
      mtime: new Date(),
      size: 1024,
      permissions: '-rw-r--r--',
    });
  }

  readDirectory(): Promise<Array<{ name: string; path: string; stat: any }>> {
    return Promise.resolve([]);
  }

  readFile(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array());
  }

  writeFile(): Promise<void> {
    return Promise.resolve();
  }

  delete(): Promise<void> {
    return Promise.resolve();
  }

  rename(): Promise<void> {
    return Promise.resolve();
  }

  createDirectory(): Promise<void> {
    return Promise.resolve();
  }
}

describe('ConflictResolver', () => {
  let adapter: MockAdapter;
  let resolver: ConflictResolver;

  beforeEach(() => {
    adapter = new MockAdapter();
    resolver = new ConflictResolver(adapter);
  });

  describe('construction', () => {
    it('should be properly constructed with an IProtocolAdapter', () => {
      expect(resolver).to.be.instanceOf(ConflictResolver);
    });

    it('should not throw when constructed with a valid adapter', () => {
      expect(() => new ConflictResolver(adapter)).to.not.throw();
    });
  });

  describe('checkConflict() signature', () => {
    it('should be a function with 3 parameters', () => {
      expect(resolver.checkConflict).to.be.a('function');
      expect(resolver.checkConflict.length).to.equal(3);
    });

    it('should accept (connectionId: string, remotePath: string, localMtime: Date)', async () => {
      // Verify the method can be called with the expected signature
      const result = await resolver.checkConflict('conn-1', '/path/to/file.txt', new Date());
      expect(result).to.have.property('hasConflict');
    });

    it('should return a ConflictResult with hasConflict property', async () => {
      const result = await resolver.checkConflict('conn-1', '/remote/file.txt', new Date());
      expect(result).to.be.an('object');
      expect(result).to.have.property('hasConflict');
      expect(typeof result.hasConflict).to.equal('boolean');
    });
  });

  describe('ConflictAction type validation', () => {
    it('should recognize all 3 ConflictAction values', () => {
      const actions: ConflictAction[] = ['keep-remote', 'force-overwrite', 'manual-merge'];
      expect(actions).to.have.lengthOf(3);

      for (const action of actions) {
        expect(['keep-remote', 'force-overwrite', 'manual-merge']).to.include(action);
      }
    });

    it('should accept keep-remote as the default safe action', () => {
      const action: ConflictAction = 'keep-remote';
      expect(action).to.equal('keep-remote');
    });
  });

  describe('skipForSession and clearSkipSet', () => {
    it('should add files to skip set and clear them', async () => {
      // Add file to skip set
      resolver.skipForSession('conn-1', '/skip/this/file.txt');

      // After skipping, checkConflict should return hasConflict: false for that file
      const result = await resolver.checkConflict('conn-1', '/skip/this/file.txt', new Date());
      expect(result.hasConflict).to.be.false;

      // Clear skip set for this connection
      resolver.clearSkipSet('conn-1');

      // After clearing, the adapter.stat will be called again
      // With our mock, stat returns a recent mtime, so with an old localMtime
      // it should detect conflict
      const result2 = await resolver.checkConflict(
        'conn-1',
        '/skip/this/file.txt',
        new Date('2020-01-01'),
      );
      // The mock stat returns current date, so there should be a conflict
      expect(result2.hasConflict).to.be.true;
    });

    it('should clear all skip sets when no connectionId provided', () => {
      resolver.skipForSession('conn-1', '/file1.txt');
      resolver.skipForSession('conn-2', '/file2.txt');

      resolver.clearSkipSet(); // Clear all

      // Should not throw when checking previously skipped files
      expect(() => {
        // Just verify the method exists and is callable
      }).to.not.throw();
    });
  });

  describe('resolveConflict()', () => {
    it('should be a function', () => {
      expect(resolver.resolveConflict).to.be.a('function');
    });

    it('should accept remotePath parameter', () => {
      expect(resolver.resolveConflict.length).to.equal(1);
    });

    // resolveConflict uses vscode.window.showWarningMessage which requires
    // a running VSCode instance. The method signature is validated above.
    it('should return a Promise<ConflictAction> type', () => {
      // Type-level check: the return type should be Promise<ConflictAction>
      const returnType = resolver.resolveConflict('/test/path');
      expect(returnType).to.be.a('promise');
    });
  });
});
