/**
 * Claude (Anthropic) AI Provider.
 *
 * Uses the Anthropic Messages API with structured JSON output for
 * reliable test case generation.
 */

import Anthropic from '@anthropic-ai/sdk';
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
  buildAutomationSuitePrompt,
} from './prompts';

export class ClaudeProvider implements AIProvider {
  readonly name = 'Claude';
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
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

    core.info(`[Claude] Generating test cases (model: ${this.model})...`);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text content in Claude response');
      }

      const parsed = parseJSON(textBlock.text);
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
          promptTokens: response.usage?.input_tokens || 0,
          completionTokens: response.usage?.output_tokens || 0,
          totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
        },
      };
    } catch (error) {
      core.error(`[Claude] Test case generation failed: ${error}`);
      throw error;
    }
  }

  async shouldCreateTestCase(changeSet: ChangeSet): Promise<TestDecision> {
    const userPrompt = buildDecisionPrompt(changeSet);

    core.info(`[Claude] Analyzing whether changes need test cases...`);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: 'You are a QA engineer. Analyze code changes and decide if they need test cases. Respond with valid JSON only, no markdown.',
        messages: [{ role: 'user', content: userPrompt }],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text content in Claude response');
      }

      return parseJSON(textBlock.text) as unknown as TestDecision;
    } catch (error) {
      core.warning(`[Claude] Decision analysis failed, defaulting to create test cases: ${error}`);
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

    core.info(`[Claude] Generating Playwright automation for ${testCase.id}...`);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: 'You are a Playwright test automation expert. Generate clean, production-ready Playwright test code. Return ONLY the TypeScript code, no markdown fences or explanations.',
        messages: [{ role: 'user', content: userPrompt }],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text content in Claude response');
      }

      return cleanCodeOutput(textBlock.text);
    } catch (error) {
      core.warning(`[Claude] Automation generation failed for ${testCase.id}: ${error}`);
      return generateFallbackAutomation(testCase);
    }
  }

  async generateAutomationSuite(
    featureArea: string,
    testCases: TestCase[],
    projectContext: ProjectContext
  ): Promise<string> {
    const userPrompt = buildAutomationSuitePrompt(featureArea, testCases, projectContext);

    core.info(`[Claude] Generating Playwright automation suite for "${featureArea}" (${testCases.length} tests in 1 batch call)...`);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 8192,
        system: 'You are a Playwright test automation expert. Generate clean, production-ready Playwright test code. Return ONLY the TypeScript code, no markdown fences or explanations.',
        messages: [{ role: 'user', content: userPrompt }],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text content in Claude response');
      }

      return cleanCodeOutput(textBlock.text);
    } catch (error) {
      core.warning(`[Claude] Automation suite generation failed for "${featureArea}": ${error}`);
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJSON(text: string): Record<string, any> {
  // Strip markdown code fences if present
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
