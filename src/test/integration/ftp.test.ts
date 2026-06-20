import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { FTPAdapter } from '../../adapters/FTPAdapter';
import { ConnectionConfig } from '../../core/types';

/**
 * FTP integration tests.
 * Requires Docker FTP container running on localhost:2121.
 *
 * Start with: cd docker && docker compose up -d
 */
describe('FTPAdapter Integration', function () {
  this.timeout(30000);

  let adapter: FTPAdapter;
  let config: ConnectionConfig;

  before(() => {
    adapter = new FTPAdapter();
    config = {
      id: 'test-ftp',
      label: 'Test FTP',
      protocol: 'ftp',
      host: process.env.TEST_FTP_HOST || 'localhost',
      port: parseInt(process.env.TEST_FTP_PORT || '2121', 10),
      username: 'ftpuser',
      authType: 'password',
      password: 'ftppass',
      mountedPaths: [{ remotePath: '/', label: 'Root' }],
    };
  });

  after(async () => {
    if (adapter.isConnected()) {
      await adapter.disconnect();
    }
  });

  it('should connect to FTP server', async () => {
    await adapter.connect(config);
    expect(adapter.isConnected()).to.be.true;
  });

  it('should list root directory', async () => {
    const entries = await adapter.readDirectory('/');
    expect(entries).to.be.an('array');
  });

  it('should create a directory', async () => {
    await adapter.createDirectory('/test-upload-dir');
    const entries = await adapter.readDirectory('/');
    const dir = entries.find((e) => e.name === 'test-upload-dir');
    expect(dir).to.exist;
    expect(dir!.stat.type).to.equal('directory');
  });

  it('should upload and download a file', async () => {
    const content = new Uint8Array(Buffer.from('Hello FTP test!'));
    await adapter.writeFile('/test-upload-dir/test.txt', content);

    const downloaded = await adapter.readFile('/test-upload-dir/test.txt');
    expect(Buffer.from(downloaded).toString()).to.equal('Hello FTP test!');
  });

  it('should rename a file', async () => {
    await adapter.rename('/test-upload-dir/test.txt', '/test-upload-dir/renamed.txt');
    const entries = await adapter.readDirectory('/test-upload-dir');
    const renamed = entries.find((e) => e.name === 'renamed.txt');
    expect(renamed).to.exist;
  });

  it('should delete a file', async () => {
    await adapter.delete('/test-upload-dir/renamed.txt');
    const entries = await adapter.readDirectory('/test-upload-dir');
    const deleted = entries.find((e) => e.name === 'renamed.txt');
    expect(deleted).to.be.undefined;
  });

  it('should delete a directory', async () => {
    await adapter.delete('/test-upload-dir', true);
    try {
      await adapter.readDirectory('/test-upload-dir');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).to.exist;
    }
  });

  it('should reject search (not supported)', async () => {
    try {
      await adapter.search('/', 'test');
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.message).to.include('not supported');
    }
  });

  it('should reject createShell (not supported)', async () => {
    try {
      await adapter.createShell();
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.message).to.include('not supported');
    }
  });

  it('should disconnect cleanly', async () => {
    await adapter.disconnect();
    expect(adapter.isConnected()).to.be.false;
  });
});
