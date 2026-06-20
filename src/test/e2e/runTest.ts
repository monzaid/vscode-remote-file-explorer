/**
 * E2E Test Runner for Remote File Explorer.
 * Uses @vscode/test-electron to launch VSCode Extension Development Host.
 *
 * Usage: node src/test/e2e/runTest.js
 */

import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  try {
    // The folder containing the Extension Manifest package.json
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../');

    // The path to the extension test script
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        '--disable-extensions',
        '--new-window',
      ],
    });
  } catch (err) {
    console.error('Failed to run E2E tests:', err);
    process.exit(1);
  }
}

main();
