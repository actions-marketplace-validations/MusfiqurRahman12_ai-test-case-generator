/**
 * Gemini (Google) AI Provider.
 *
 * Uses the Google Generative AI SDK with JSON mode for structured output.
 */
import { AIProvider } from './provider';
import { CodeContext, TestCase, TestDecision, AIGenerationResult, ChangeSet, ProjectContext } from '../test-cases/types';
export declare class GeminiProvider implements AIProvider {
    readonly name = "Gemini";
    private model;
    constructor(apiKey: string, modelName: string);
    generateTestCases(context: CodeContext, existingTests: TestCase[], changeSet: ChangeSet): Promise<AIGenerationResult>;
    shouldCreateTestCase(changeSet: ChangeSet): Promise<TestDecision>;
    generateAutomationCode(testCase: TestCase, projectContext: ProjectContext): Promise<string>;
}
//# sourceMappingURL=gemini.d.ts.map