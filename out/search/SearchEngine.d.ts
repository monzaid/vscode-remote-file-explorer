import { IProtocolAdapter } from '../core/IProtocolAdapter';
import { SearchOptions, SearchResult } from '../core/types';
/**
 * Remote search engine using grep or ripgrep on the remote server.
 * Attempts rg (ripgrep) first, falls back to grep if rg is not available.
 */
export declare class SearchEngine {
    /**
     * Search for a pattern in files on a remote server.
     * @param adapter The protocol adapter for remote execution
     * @param rootPath The root directory to search in
     * @param pattern The search pattern (regex supported)
     * @param options Search options (case sensitivity, whole word, max results)
     * @returns Array of search results
     */
    search(adapter: IProtocolAdapter, rootPath: string, pattern: string, options?: SearchOptions): Promise<SearchResult[]>;
    /**
     * Check a regex pattern for ReDoS-prone constructs (nested quantifiers).
     * Returns true if the pattern looks safe for regex search.
     */
    private isRegexSafe;
    /**
     * Build the search command string for remote execution.
     * Uses fixed-string search (-F) by default to prevent ReDoS.
     * Only enables regex mode when options.useRegex is explicitly true.
     */
    buildSearchCommand(rootPath: string, pattern: string, options?: SearchOptions): string;
    /**
     * Parse grep/rg output into structured search results.
     * Supported formats:
     *   rg:  file:line:content
     *   grep: file:line:content
     *
     * @deprecated P2: This method duplicates parseSearchOutput in SSHAdapter.
     *   Since search() delegates to adapter.search() which returns SearchResult[],
     *   this parser is only used as a fallback for adapters that don't implement search().
     *   Future: extract shared parse logic to a common module (e.g. src/search/searchParser.ts).
     */
    parseSearchOutput(output: string): SearchResult[];
    /**
     * Parse a single line of search output.
     *
     * @deprecated P2: Duplicated in SSHAdapter. Keep in sync or extract to shared module.
     */
    private parseLine;
}
//# sourceMappingURL=SearchEngine.d.ts.map