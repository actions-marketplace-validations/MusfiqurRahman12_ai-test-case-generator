/**
 * Code Analyzer — inspects the project structure and prepares context for AI.
 *
 * Detects language, framework, architecture pattern, and identifies testable
 * units. Batches file contents intelligently so they fit within AI context limits.
 */
import { ChangeSet, CodeContext } from '../test-cases/types';
/**
 * Analyze the project and prepare code context for the AI provider.
 * @param changeSet  Files to analyze (from change detector)
 * @param maxFiles   Maximum files to include (cost control)
 */
export declare function analyzeCode(changeSet: ChangeSet, maxFiles: number): Promise<CodeContext>;
//# sourceMappingURL=index.d.ts.map