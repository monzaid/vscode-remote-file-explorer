/**
 * Type validation tests for Remote File Explorer core types.
 * These tests verify that type definitions enforce the correct constraints
 * at the TypeScript level. Since types are compile-time only, these tests
 * validate that valid/invalid values behave as expected at runtime.
 */

import { expect } from 'chai';

// Types are imported for type-checking; the tests verify runtime constraints
// by constructing objects and checking their properties.
import {
  ConnectionConfig,
  ConnectionProtocol,
  ConnectionStatus,
  ConflictAction,
  RemoteFileStat,
  SearchOptions,
  ConflictResult,
} from '../../core/types';

describe('Core Types', () => {
  describe('ConnectionConfig', () => {
    it('should accept a valid ConnectionConfig with all mandatory fields', () => {
      const config: ConnectionConfig = {
        id: 'test-conn-1',
        label: 'Test Server',
        protocol: 'ssh',
        host: '192.168.1.1',
        port: 22,
        username: 'admin',
        authType: 'password',
        mountedPaths: [{ remotePath: '/var/www', label: 'web' }],
      };

      expect(config.id).to.equal('test-conn-1');
      expect(config.label).to.equal('Test Server');
      expect(config.protocol).to.equal('ssh');
      expect(config.host).to.equal('192.168.1.1');
      expect(config.port).to.equal(22);
      expect(config.username).to.equal('admin');
      expect(config.authType).to.equal('password');
      expect(config.mountedPaths).to.have.lengthOf(1);
    });

    it('should accept optional fields (password, privateKeyPath, passphrase)', () => {
      const config: ConnectionConfig = {
        id: 'test-conn-2',
        label: 'Key Auth Server',
        protocol: 'ssh',
        host: '10.0.0.1',
        port: 2222,
        username: 'root',
        authType: 'key',
        privateKeyPath: '/home/user/.ssh/id_rsa',
        passphrase: 'secret',
        passphraseStored: true,
        mountedPaths: [],
      };

      expect(config.authType).to.equal('key');
      expect(config.privateKeyPath).to.equal('/home/user/.ssh/id_rsa');
      expect(config.passphrase).to.equal('secret');
      expect(config.passphraseStored).to.be.true;
    });

    it('should support all three protocol types', () => {
      const protocols: ConnectionProtocol[] = ['ssh', 'ftp', 'agent'];

      for (const proto of protocols) {
        const config: ConnectionConfig = {
          id: `test-${proto}`,
          label: `${proto} Server`,
          protocol: proto,
          host: 'example.com',
          port: proto === 'ssh' ? 22 : proto === 'ftp' ? 21 : 8080,
          username: 'user',
          authType: 'password',
          mountedPaths: [],
        };
        expect(config.protocol).to.equal(proto);
      }
    });

    it('should support agent-specific fields (agentUrl, agentToken)', () => {
      const config: ConnectionConfig = {
        id: 'agent-conn',
        label: 'Agent Server',
        protocol: 'agent',
        host: 'agent.example.com',
        port: 443,
        username: 'agent-user',
        authType: 'agent',
        agentUrl: 'https://agent.example.com/api',
        agentToken: 'token-abc123',
        mountedPaths: [],
      };

      expect(config.agentUrl).to.equal('https://agent.example.com/api');
      expect(config.agentToken).to.equal('token-abc123');
    });
  });

  describe('RemoteFileStat', () => {
    it('should accept type as "file"', () => {
      const stat: RemoteFileStat = {
        type: 'file',
        ctime: new Date(),
        mtime: new Date(),
        size: 1024,
        permissions: '-rw-r--r--',
      };
      expect(stat.type).to.equal('file');
    });

    it('should accept type as "directory"', () => {
      const stat: RemoteFileStat = {
        type: 'directory',
        ctime: new Date(),
        mtime: new Date(),
        size: 4096,
        permissions: 'drwxr-xr-x',
      };
      expect(stat.type).to.equal('directory');
    });

    it('should accept type as "symlink"', () => {
      const stat: RemoteFileStat = {
        type: 'symlink',
        ctime: new Date(),
        mtime: new Date(),
        size: 10,
        permissions: 'lrwxrwxrwx',
      };
      expect(stat.type).to.equal('symlink');
    });

    it('should have exactly 3 valid type values', () => {
      const validTypes: RemoteFileStat['type'][] = ['file', 'directory', 'symlink'];
      expect(validTypes).to.have.lengthOf(3);
      expect(validTypes).to.include.members(['file', 'directory', 'symlink']);
    });
  });

  describe('ConnectionStatus', () => {
    it('should have exactly 5 states', () => {
      const statuses: ConnectionStatus[] = [
        'idle',
        'connecting',
        'connected',
        'disconnected',
        'error',
      ];
      expect(statuses).to.have.lengthOf(5);
      expect(statuses).to.include.members([
        'idle',
        'connecting',
        'connected',
        'disconnected',
        'error',
      ]);
    });

    it('should allow assigning "connected" status', () => {
      const status: ConnectionStatus = 'connected';
      expect(status).to.equal('connected');
    });

    it('should allow assigning "error" status', () => {
      const status: ConnectionStatus = 'error';
      expect(status).to.equal('error');
    });
  });

  describe('ConflictAction', () => {
    it('should have exactly 3 actions', () => {
      const actions: ConflictAction[] = [
        'keep-remote',
        'force-overwrite',
        'manual-merge',
      ];
      expect(actions).to.have.lengthOf(3);
      expect(actions).to.include.members([
        'keep-remote',
        'force-overwrite',
        'manual-merge',
      ]);
    });

    it('should accept "keep-remote" action', () => {
      const action: ConflictAction = 'keep-remote';
      expect(action).to.equal('keep-remote');
    });

    it('should accept "force-overwrite" action', () => {
      const action: ConflictAction = 'force-overwrite';
      expect(action).to.equal('force-overwrite');
    });

    it('should accept "manual-merge" action', () => {
      const action: ConflictAction = 'manual-merge';
      expect(action).to.equal('manual-merge');
    });
  });

  describe('SearchOptions', () => {
    it('should require pattern field', () => {
      const options: SearchOptions = { pattern: 'test' };
      expect(options.pattern).to.equal('test');
    });

    it('should accept optional caseSensitive, wholeWord, maxResults, useRegex', () => {
      const options: SearchOptions = {
        pattern: 'hello',
        caseSensitive: true,
        wholeWord: true,
        maxResults: 50,
        useRegex: false,
      };

      expect(options.caseSensitive).to.be.true;
      expect(options.wholeWord).to.be.true;
      expect(options.maxResults).to.equal(50);
      expect(options.useRegex).to.be.false;
    });
  });

  describe('ConflictResult', () => {
    it('should indicate no conflict with hasConflict: false', () => {
      const result: ConflictResult = { hasConflict: false };
      expect(result.hasConflict).to.be.false;
    });

    it('should indicate conflict with timestamps', () => {
      const remoteMtime = new Date('2024-01-01T00:00:00Z');
      const localMtime = new Date('2024-01-01T01:00:00Z');
      const result: ConflictResult = {
        hasConflict: true,
        remoteMtime,
        localMtime,
      };

      expect(result.hasConflict).to.be.true;
      expect(result.remoteMtime).to.equal(remoteMtime);
      expect(result.localMtime).to.equal(localMtime);
    });
  });
});
