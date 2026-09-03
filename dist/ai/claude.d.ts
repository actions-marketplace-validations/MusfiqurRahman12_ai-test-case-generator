/**
 * Claude (Anthropic) AI Provider.
 *
 * Uses the Anthropic Messages API with structured JSON output for
 * reliable test case generation.
 */
import { AIProvider } from './provider';
import { CodeContext, TestCase, TestDecision, AIGenerationResult, ChangeSet, ProjectContext } from '../test-cases/types';
export declare class ClaudeProvider implements AIProvider {
    readonly name = "Claude";
    private client;
    private model;
    constructor(apiKey: string, model: string);
    generateTestCases(context: CodeContext, existingTests: TestCase[], changeSet: ChangeSet): Promise<AIGenerationResult>;
    shouldCreateTestCase(changeSet: ChangeSet): Promise<TestDecision>;
    generateAutomationCode(testCase: TestCase, projectContext: ProjectContext): Promise<string>;
    generateAutomationSuite(featureArea: string, testCases: TestCase[], projectContext: ProjectContext): Promise<string>;
}
//# sourceMappingURL=claude.d.ts.map