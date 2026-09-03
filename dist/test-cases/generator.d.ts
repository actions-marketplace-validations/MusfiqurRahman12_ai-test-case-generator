/**
 * Test Case Generator — orchestrates the AI-powered test case creation flow.
 *
 * Coordinates between the code analyzer, AI provider, and test case manager
 * to produce new test cases while avoiding duplicates.
 */
import { AIProvider } from '../ai/provider';
import { CodeContext, ChangeSet, TestCase } from './types';
export interface GenerationResult {
    /** Newly created test cases */
    newTestCases: TestCase[];
    /** Updated existing test cases */
    updatedTestCases: TestCase[];
    /** AI warnings */
    warnings: string[];
    /** Token usage */
    tokenUsage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    /** Whether generation was skipped (no test cases needed) */
    skipped: boolean;
    /** Reason for skipping */
    skipReason?: string;
}
/**
 * Generate test cases for the given code context and change set.
 *
 * Flow:
 * 1. Load existing test cases
 * 2. For incremental runs, ask AI if test cases are needed
 * 3. If yes, generate test cases via AI
 * 4. Deduplicate against existing test cases
 * 5. Return new and updated test cases
 */
export declare function generateTestCases(aiProvider: AIProvider, codeContext: CodeContext, changeSet: ChangeSet, testOutputDir: string): Promise<GenerationResult>;
//# sourceMappingURL=generator.d.ts.map