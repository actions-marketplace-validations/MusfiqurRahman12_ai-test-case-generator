/**
 * AI Provider — abstract interface for test case generation.
 *
 * All AI providers (Claude, Gemini, Groq) implement this interface so the
 * rest of the system is provider-agnostic.
 */

import {
  CodeContext,
  TestCase,
  TestDecision,
  AIGenerationResult,
  ChangeSet,
  ProjectContext,
} from '../test-cases/types';

// ---------------------------------------------------------------------------
// Abstract Interface
// ---------------------------------------------------------------------------

export interface AIProvider {
  /** Provider name for logging */
  readonly name: string;

  /**
   * Generate test cases from code context.
   * @param context        Code files and project info
   * @param existingTests  Already-existing test cases (to avoid duplicates)
   * @param changeSet      The change set that triggered this run
   */
  generateTestCases(
    context: CodeContext,
    existingTests: TestCase[],
    changeSet: ChangeSet
  ): Promise<AIGenerationResult>;

  /**
   * Decide whether a change set warrants new test cases.
   * Used in incremental mode to skip no-op changes.
   */
  shouldCreateTestCase(changeSet: ChangeSet): Promise<TestDecision>;

  /**
   * Generate Playwright automation code for a manual test case.
   */
  generateAutomationCode(
    testCase: TestCase,
    projectContext: ProjectContext
  ): Promise<string>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

import { Config, AIProviderType } from '../config';
import { ClaudeProvider } from './claude';
import { GeminiProvider } from './gemini';
import { GroqProvider } from './groq';

export function createAIProvider(config: Config): AIProvider {
  const providers: Record<AIProviderType, () => AIProvider> = {
    claude: () => new ClaudeProvider(config.aiApiKey, config.aiModel),
    gemini: () => new GeminiProvider(config.aiApiKey, config.aiModel),
    groq: () => new GroqProvider(config.aiApiKey, config.aiModel),
  };

  return providers[config.aiProvider]();
}
