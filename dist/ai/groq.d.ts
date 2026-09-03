/**
 * Groq AI Provider.
 *
 * Uses the Groq SDK (OpenAI-compatible) for fast inference.
 * Best for large repos where speed matters.
 */
import { AIProvider } from './provider';
import { CodeContext, TestCase, TestDecision, AIGenerationResult, ChangeSet, ProjectContext } from '../test-cases/types';
export declare class GroqProvider implements AIProvider {
    readonly name = "Groq";
    private client;
    private model;
    constructor(apiKey: string, model: string);
    generateTestCases(context: CodeContext, existingTests: TestCase[], changeSet: ChangeSet): Promise<AIGenerationResult>;
    shouldCreateTestCase(changeSet: ChangeSet): Promise<TestDecision>;
    generateAutomationCode(testCase: TestCase, projectContext: ProjectContext): Promise<string>;
}
//# sourceMappingURL=groq.d.ts.map