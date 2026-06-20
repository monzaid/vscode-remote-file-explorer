  /**
 * Unit tests for SearchEngine.
 * Tests command building, output parsing, and regex safety checking.
 */

import { expect } from 'chai';
import { SearchEngine } from '../../search/SearchEngine';
import { SearchOptions } from '../../core/types';

describe('SearchEngine', () => {
  let engine: SearchEngine;

  beforeEach(() => {
    engine = new SearchEngine();
  });

  describe('buildSearchCommand() — ripgrep', () => {
    it('should produce a command string starting with ripgrep check', () => {
      const cmd = engine.buildSearchCommand('/tmp', 'hello');
      expect(cmd).to.include('which rg');
      expect(cmd).to.include('rg --line-number --no-heading --color never');
    });

    it('should use fixed-string search (-F) by default for ripgrep', () => {
      const cmd = engine.buildSearchCommand('/tmp', 'hello');
      expect(cmd).to.include('rg');
      expect(cmd).to.include(' -F ');
    });

    it('should add -i flag when caseSensitive is false', () => {
      const cmd = engine.buildSearchCommand('/tmp', 'hello', { caseSensitive: false, pattern: 'hello' });
      expect(cmd).to.include('-i ');
    });

    it('should NOT add -i flag when caseSensitive is true', () => {
      const cmd = engine.buildSearchCommand('/tmp', 'hello', { caseSensitive: true, pattern: 'hello' });
      // The cmd should not have -i for ripgrep part when caseSensitive is true
      // Check the rg portion specifically: after "rg --line-number --no-heading --color never "
      const rgPart = cmd.split('||')[0];
      expect(rgPart).to.not.include(' -i ');
    });

    it('should add -w flag when wholeWord is true', () => {
      const cmd = engine.buildSearchCommand('/tmp', 'hello', { wholeWord: true, pattern: 'hello' });
      expect(cmd).to.include('-w ');
    });

    it('should NOT add -w flag when wholeWord is false', () => {
      const cmd = engine.buildSearchCommand('/tmp', 'hello', { wholeWord: false, pattern: 'hello' });
      const rgPart = cmd.split('||')[0];
      expect(rgPart).to.not.include(' -w ');
    });

    it('should NOT use -F when useRegex is true and pattern is safe', () => {
      const cmd = engine.buildSearchCommand('/tmp', 'hello', { useRegex: true, pattern: 'hello' });
      const rgPart = cmd.split('||')[0];
      expect(rgPart).to.not.include(' -F ');
    });

    it('should throw for unsafe regex patterns with useRegex', () => {
      expect(() => {
        engine.buildSearchCommand('/tmp', '(a+)+', { useRegex: true, pattern: '(a+)+' });
      }).to.throw(/Unsafe regex pattern/);
    });

    it('should escape single quotes in the pattern', () => {
      const cmd = engine.buildSearchCommand('/tmp', "it's");
      // The escape replaces ' with '\\'' (close-quote, escaped-quote, open-quote)
      // So "it's" becomes "'it'\\''s'" in the command
      expect(cmd).to.include("'it'");
      expect(cmd).to.include("\\'");
      expect(cmd).to.include("s'");
    });
  });

  describe('buildSearchCommand() — grep fallback', () => {
    it('should include grep fallback after ||', () => {
      const cmd = engine.buildSearchCommand('/tmp', 'hello');
      expect(cmd).to.include(' || grep -rn --color=never');
    });

    it('should use -F flag for grep by default', () => {
      const cmd = engine.buildSearchCommand('/tmp', 'hello');
      const grepPart = cmd.split('||')[1];
      expect(grepPart).to.include(' -F ');
    });

    it('should add -i for case-insensitive grep', () => {
      const cmd = engine.buildSearchCommand('/tmp', 'hello', { caseSensitive: false, pattern: 'hello' });
      const grepPart = cmd.split('||')[1];
      expect(grepPart).to.include(' -i ');
    });

    it('should add -w for whole-word grep', () => {
      const cmd = engine.buildSearchCommand('/tmp', 'hello', { wholeWord: true, pattern: 'hello' });
      const grepPart = cmd.split('||')[1];
      expect(grepPart).to.include(' -w ');
    });

    it('should NOT use -F for grep when useRegex is true', () => {
      const cmd = engine.buildSearchCommand('/tmp', 'hello', { useRegex: true, pattern: 'hello' });
      const grepPart = cmd.split('||')[1];
      expect(grepPart).to.not.include(' -F ');
    });
  });

  describe('parseSearchOutput()', () => {
    it('should parse typical ripgrep/grep output correctly', () => {
      const output = [
        'src/core/types.ts:12:export type ConnectionProtocol',
        'src/search/SearchEngine.ts:50:buildSearchCommand(rootPath: string',
      ].join('\n');

      const results = engine.parseSearchOutput(output);

      expect(results).to.have.lengthOf(2);
      expect(results[0].filePath).to.equal('src/core/types.ts');
      expect(results[0].lineNumber).to.equal(12);
      expect(results[0].lineContent).to.equal('export type ConnectionProtocol');
      expect(results[1].filePath).to.equal('src/search/SearchEngine.ts');
      expect(results[1].lineNumber).to.equal(50);
    });

    it('should handle empty output', () => {
      const results = engine.parseSearchOutput('');
      expect(results).to.be.an('array').that.is.empty;
    });

    it('should handle whitespace-only output', () => {
      const results = engine.parseSearchOutput('   \n  \n  ');
      expect(results).to.be.an('array').that.is.empty;
    });

    it('should handle malformed lines gracefully (no colon)', () => {
      const output = 'this line has no colon';
      const results = engine.parseSearchOutput(output);
      expect(results).to.be.an('array').that.is.empty;
    });

    it('should handle malformed lines (non-numeric line number)', () => {
      const output = 'file.txt:notanumber:some content';
      const results = engine.parseSearchOutput(output);
      expect(results).to.be.an('array').that.is.empty;
    });

    it('should handle mixed valid and invalid lines', () => {
      const output = [
        'valid.ts:42:hello world',
        'bad line',
        'also.ts:7:good content',
        'nocolonhere',
      ].join('\n');

      const results = engine.parseSearchOutput(output);

      expect(results).to.have.lengthOf(2);
      expect(results[0].filePath).to.equal('valid.ts');
      expect(results[0].lineNumber).to.equal(42);
      expect(results[1].filePath).to.equal('also.ts');
      expect(results[1].lineNumber).to.equal(7);
    });

    it('should parse output with column numbers (ripgrep --column)', () => {
      const output = 'app.ts:15:3:some code here';
      const results = engine.parseSearchOutput(output);

      expect(results).to.have.lengthOf(1);
      expect(results[0].filePath).to.equal('app.ts');
      expect(results[0].lineNumber).to.equal(15);
      expect(results[0].columnNumber).to.equal(3);
      expect(results[0].lineContent).to.equal('some code here');
    });
  });

  describe('isRegexSafe (via buildSearchCommand)', () => {
    it('should reject nested quantifier (a+)+', () => {
      expect(() => {
        engine.buildSearchCommand('/tmp', '(a+)+', { useRegex: true, pattern: '(a+)+' });
      }).to.throw(/Unsafe regex pattern/);
    });

    it('should reject nested quantifier with star (a*)*', () => {
      expect(() => {
        engine.buildSearchCommand('/tmp', '(a*)*', { useRegex: true, pattern: '(a*)*' });
      }).to.throw(/Unsafe regex pattern/);
    });

    it('should reject nested brace quantifier (a+){2,}', () => {
      expect(() => {
        engine.buildSearchCommand('/tmp', '(a+){2,}', { useRegex: true, pattern: '(a+){2,}' });
      }).to.throw(/Unsafe regex pattern/);
    });

    it('should reject backtracking alternation (a|b)+', () => {
      expect(() => {
        engine.buildSearchCommand('/tmp', '(a|b)+', { useRegex: true, pattern: '(a|b)+' });
      }).to.throw(/Unsafe regex pattern/);
    });

    it('should accept simple regex patterns', () => {
      const cmd = engine.buildSearchCommand('/tmp', 'hello\\s+world', { useRegex: true, pattern: 'hello\\s+world' });
      expect(cmd).to.be.a('string');
      expect(cmd).to.not.include(' -F ');
    });

    it('should accept regex character classes', () => {
      const cmd = engine.buildSearchCommand('/tmp', '[a-z]+', { useRegex: true, pattern: '[a-z]+' });
      expect(cmd).to.be.a('string');
    });
  });

  describe('case-sensitive and whole-word options', () => {
    it('should omit -i in rg command when caseSensitive is true', () => {
      const cmd = engine.buildSearchCommand('/tmp', 'Hello', { caseSensitive: true, pattern: 'Hello' });
      const rgPart = cmd.split('||')[0];
      // Should have -w but not -i
      expect(rgPart).to.not.include('-i ');
    });

    it('should include -i in rg command when caseSensitive is false (default)', () => {
      const cmd = engine.buildSearchCommand('/tmp', 'Hello');
      const rgPart = cmd.split('||')[0];
      expect(rgPart).to.include('-i ');
    });

    it('should include both -i and -w when caseSensitive false and wholeWord true', () => {
      const cmd = engine.buildSearchCommand('/tmp', 'hello', { wholeWord: true, caseSensitive: false, pattern: 'hello' });
      const rgPart = cmd.split('||')[0];
      expect(rgPart).to.include('-i ');
      expect(rgPart).to.include('-w ');
    });
  });
});
