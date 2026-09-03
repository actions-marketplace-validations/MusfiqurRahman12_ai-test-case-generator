/**
 * AI Provider — abstract interface for test case generation.
 *
 * All AI providers (Claude, Gemini, Groq) implement this interface so the
 * rest of the system is provider-agnostic.
 */
import { CodeContext, TestCase, TestDecision, AIGenerationResult, ChangeSet, ProjectContext } from '../test-cases/types';
export interface AIProvider {
    /** Provider name for logging */
    readonly name: string;
    /**
     * Generate test cases from code context.
     * @param context        Code files and project info
     * @param existingTests  Already-existing test cases (to avoid duplicates)
     * @param changeSet      The change set that triggered this run
     */
    generateTestCases(context: CodeContext, existingTests: TestCase[], changeSet: ChangeSet): Promise<AIGenerationResult>;
    /**
     * Decide whether a change set warrants new test cases.
     * Used in incremental mode to skip no-op changes.
     */
    shouldCreateTestCase(changeSet: ChangeSet): Promise<TestDecision>;
    /**
     * Generate Playwright automation code for a manual test case.
     */
    generateAutomationCode(testCase: TestCase, projectContext: ProjectContext): Promise<string>;
    /**
     * Generate Playwright automation code for an entire feature area suite (batch mode).
     * Bundles all test cases into a single API call to minimize quota consumption.
     */
    generateAutomationSuite?(featureArea: string, testCases: TestCase[], projectContext: ProjectContext): Promise<string>;
}
import { Config } from '../config';
export declare function createAIProvider(config: Config): AIProvider;
//# sourceMappingURL=provider.d.ts.map