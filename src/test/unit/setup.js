/**
 * Mocha test setup — registers the vscode mock before any test modules load.
 * Uses CommonJS to avoid ESM detection issues with ts-node.
 *
 * Load via: mocha --require ts-node/register --require src/test/unit/setup.ts
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module');

const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'vscode') {
    const mockPath = path.resolve(__dirname, '..', 'vscode-mock');
    return originalResolveFilename.call(this, mockPath, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
