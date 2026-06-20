"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchEngine = void 0;
/**
 * Remote search engine using grep or ripgrep on the remote server.
 * Attempts rg (ripgrep) first, falls back to grep if rg is not available.
 */
class SearchEngine {
    /**
     * Search for a pattern in files on a remote server.
     * @param adapter The protocol adapter for remote execution
     * @param rootPath The root directory to search in
     * @param pattern The search pattern (regex supported)
     * @param options Search options (case sensitivity, whole word, max results)
     * @returns Array of search results
     */
    async search(adapter, rootPath, pattern, options) {
        // Use the adapter's search method if available
        if (adapter.search) {
            return adapter.search(rootPath, pattern, options);
        }
        // Fallback: throw not supported
        throw new Error('Search is not supported for this protocol adapter');
    }
    /**
     * Check a regex pattern for ReDoS-prone constructs (nested quantifiers).
     * Returns true if the pattern looks safe for regex search.
     */
    isRegexSafe(pattern) {
        // Detect nested quantifiers like (a+)+, (a*)*, (a+){2,}, etc.
        // This catches the most common ReDoS patterns without a full regex analyzer.
        const nestedQuantifier = /\([^)]*[+*]\s*\)\s*[+*]/;
        const nestedBraceQuantifier = /\([^)]*[+*]\s*\)\s*\{/;
        const backtrackingGroup = /\([^)]*\|[^)]*\)\s*[+*]/;
        return !nestedQuantifier.test(pattern) && !nestedBraceQuantifier.test(pattern) && !backtrackingGroup.test(pattern);
    }
    /**
     * Build the search command string for remote execution.
     * Uses fixed-string search (-F) by default to prevent ReDoS.
     * Only enables regex mode when options.useRegex is explicitly true.
     */
    buildSearchCommand(rootPath, pattern, options) {
        let cmd;
        const escapedPattern = pattern.replace(/'/g, "'\\''");
        // Prefer rg (ripgrep)
        cmd = `which rg > /dev/null 2>&1 && rg --line-number --no-heading --color never `;
        if (!options?.caseSensitive)
            cmd += '-i ';
        if (options?.wholeWord)
            cmd += '-w ';
        // Default to fixed-string search to prevent ReDoS; only use regex if explicitly requested
        if (options?.useRegex) {
            if (!this.isRegexSafe(pattern)) {
                throw new Error('Unsafe regex pattern: nested quantifiers detected. Use a simpler pattern or fixed-string search.');
            }
        }
        else {
            cmd += '-F ';
        }
        cmd += `'${escapedPattern}' '${rootPath}'`;
        // Fallback to grep
        cmd += ` || grep -rn --color=never `;
        if (!options?.caseSensitive)
            cmd += '-i ';
        if (options?.wholeWord)
            cmd += '-w ';
        if (!options?.useRegex) {
            cmd += '-F ';
        }
        cmd += `'${escapedPattern}' '${rootPath}'`;
        return cmd;
    }
    /**
     * Parse grep/rg output into structured search results.
     * Supported formats:
     *   rg:  file:line:content
     *   grep: file:line:content
     */
    parseSearchOutput(output) {
        const lines = output.trim().split('\n').filter((l) => l.length > 0);
        const results = [];
        for (const line of lines) {
            const result = this.parseLine(line);
            if (result) {
                results.push(result);
            }
        }
        return results;
    }
    /**
     * Parse a single line of search output.
     */
    parseLine(line) {
        // Handle format: file:line:content or file:line:column:content
        const firstColon = line.indexOf(':');
        if (firstColon === -1)
            return null;
        const filePath = line.substring(0, firstColon);
        const rest = line.substring(firstColon + 1);
        const secondColon = rest.indexOf(':');
        if (secondColon === -1)
            return null;
        const lineStr = rest.substring(0, secondColon);
        const lineNumber = parseInt(lineStr, 10);
        if (isNaN(lineNumber))
            return null;
        // Check if the next part is a column number
        const afterLine = rest.substring(secondColon + 1);
        const thirdColon = afterLine.indexOf(':');
        let columnNumber = 1;
        let lineContent;
        const possibleColumn = thirdColon > 0 ? afterLine.substring(0, thirdColon) : '';
        const columnNum = parseInt(possibleColumn, 10);
        if (!isNaN(columnNum) && possibleColumn.length <= 4) {
            // This is likely a column number
            columnNumber = columnNum;
            lineContent = afterLine.substring(thirdColon + 1);
        }
        else {
            lineContent = afterLine;
        }
        return {
            filePath,
            lineNumber,
            columnNumber,
            lineContent: lineContent.trim(),
            matchLength: lineContent.trim().length,
        };
    }
}
exports.SearchEngine = SearchEngine;
//# sourceMappingURL=SearchEngine.js.map