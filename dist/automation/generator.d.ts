/**
 * Automation Generator — converts manual test cases into Playwright test files.
 *
 * Groups test cases by feature area into `.spec.ts` files.
 * Uses AI to generate the actual test code, with fallback to skeletons.
 * Creates a playwright.config.ts if one doesn't exist.
 */
import { AIProvider } from '../ai/provider';
import { TestCase, ProjectContext } from '../test-cases/types';
export interface AutomationResult {
    /** Number of spec files generated or updated */
    filesGenerated: number;
    /** Paths to generated files */
    filePaths: string[];
    /** Errors during generation */
    errors: string[];
}
/**
 * Generate Playwright automation files from test cases.
 *
 * @param aiProvider       AI provider for code generation
 * @param testCases        Test cases to generate automation for
 * @param projectContext   Project context for code generation hints
 * @param automationDir    Output directory for spec files
 */
export declare function generateAutomation(aiProvider: AIProvider, testCases: TestCase[], projectContext: ProjectContext, automationDir: string): Promise<AutomationResult>;
//# sourceMappingURL=generator.d.ts.map