/**
 * Mocha test setup — registers the vscode mock before any test modules load.
 *
 * This intercepts `require('vscode')` and returns the mock,
 * allowing unit tests to import modules that depend on vscode
 * without needing a running VSCode instance.
 *
 * Must be loaded via: mocha --require ts-node/register --require src/test/unit/setup.ts
 */

import { resolve } from 'path';
import module from 'module';

// Intercept require('vscode') and redirect to our mock
const originalResolveFilename = (module as any)._resolveFilename;

(module as any)._resolveFilename = function (
  request: string,
  parent: any,
  isMain: boolean,
  options?: any,
) {
  if (request === 'vscode') {
    const mockPath = resolve(__dirname, '..', 'vscode-mock');
    return originalResolveFilename.call(this, mockPath, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
