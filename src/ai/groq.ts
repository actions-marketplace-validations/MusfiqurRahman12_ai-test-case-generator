/**
 * Groq AI Provider.
 *
 * Uses the Groq SDK (OpenAI-compatible) for fast inference.
 * Best for large repos where speed matters.
 */

import Groq from 'groq-sdk';
import * as core from '@actions/core';
import { AIProvider } from './provider';
import {
  CodeContext,
  TestCase,
  TestDecision,
  AIGenerationResult,
  ChangeSet,
  ProjectContext,
} from '../test-cases/types';
import {
  buildSystemPrompt,
  buildFullScanPrompt,
  buildIncrementalPrompt,
  buildDecisionPrompt,
  buildAutomationPrompt,
  TEST_CASE_JSON_SCHEMA,
  TEST_DECISION_JSON_SCHEMA,
} from './prompts';

export class GroqProvider implements AIProvider {
  readonly name = 'Groq';
  private client: Groq;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Groq({ apiKey });
    this.model = model;
  }

  async generateTestCases(
    context: CodeContext,
    existingTests: TestCase[],
    changeSet: ChangeSet
  ): Promise<AIGenerationResult> {
    const systemPrompt = buildSystemPrompt();
    const userPrompt = changeSet.isFullScan
      ? buildFullScanPrompt(context)
      : buildIncrementalPrompt(context, changeSet, existingTests);

    core.info(`[Groq] Generating test cases (model: ${this.model})...`);

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 8192,
        response_format: { type: 'json_object' },
      });

      const text = response.choices[0]?.message?.content || '{}';
      const parsed = parseJSON(text);
      const now = new Date().toISOString();

      const rawTestCases = Array.isArray(parsed.testCases) ? parsed.testCases : [];
      const testCases: TestCase[] = rawTestCases.map((tc: any) => ({
        ...tc,
        automationStatus: 'pending' as const,
        createdAt: now,
        updatedAt: now,
        commitSha: changeSet.headSha,
      } as TestCase));

      const warnings: string[] = Array.isArray(parsed.warnings) ? parsed.warnings : [];

      return {
        testCases,
        warnings,
        tokenUsage: {
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      core.error(`[Groq] Test case generation failed: ${error}`);
      throw error;
    }
  }

  async shouldCreateTestCase(changeSet: ChangeSet): Promise<TestDecision> {
    const userPrompt = buildDecisionPrompt(changeSet);

    core.info(`[Groq] Analyzing whether changes need test cases...`);

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              'You are a QA engineer. Analyze code changes and decide if they need test cases. Respond with valid JSON.',
          },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
      });

      const text = response.choices[0]?.message?.content || '{}';
      return parseJSON(text) as unknown as TestDecision;
    } catch (error) {
      core.warning(`[Groq] Decision analysis failed, defaulting to create: ${error}`);
      return {
        needsTestCase: true,
        reasoning: 'Decision analysis failed, defaulting to create test cases',
        changeType: 'other',
        suggestedTestCount: 1,
      };
    }
  }

  async generateAutomationCode(
    testCase: TestCase,
    projectContext: ProjectContext
  ): Promise<string> {
    const userPrompt = buildAutomationPrompt(testCase, projectContext);

    core.info(`[Groq] Generating Playwright automation for ${testCase.id}...`);

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              'You are a Playwright test automation expert. Generate clean, production-ready Playwright test code. Return ONLY the TypeScript code, no markdown fences or explanations.',
          },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 4096,
      });

      const text = response.choices[0]?.message?.content || '';
      return cleanCodeOutput(text);
    } catch (error) {
      core.warning(`[Groq] Automation generation failed for ${testCase.id}: ${error}`);
      return generateFallbackAutomation(testCase);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJSON(text: string): Record<string, any> {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
  }
  return JSON.parse(cleaned);
}

function cleanCodeOutput(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
  }
  return cleaned;
}

function generateFallbackAutomation(testCase: TestCase): string {
  const steps = testCase.steps
    .map(
      (s) =>
        `  // Step ${s.stepNumber}: ${s.action}\n  // Expected: ${s.expectedResult}\n  // TODO: Implement this step`
    )
    .join('\n\n');

  return `import { test, expect } from '@playwright/test';

// Auto-generated from test case: ${testCase.id}
// Title: ${testCase.title}
// NOTE: This is a fallback skeleton — AI generation failed. Implement manually.

test.describe('${testCase.featureArea || 'Tests'}', () => {
  test('${testCase.title}', async ({ page }) => {
${steps}
  });
});
`;
}
