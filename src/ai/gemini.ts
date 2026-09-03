/**
 * Gemini (Google) AI Provider.
 *
 * Uses the Google Generative AI SDK with JSON mode for structured output.
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
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
} from './prompts';

export class GeminiProvider implements AIProvider {
  readonly name = 'Gemini';
  private model: GenerativeModel;

  constructor(apiKey: string, modelName: string) {
    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
      },
    });
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

    core.info(`[Gemini] Generating test cases...`);

    try {
      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
      });

      const response = result.response;
      const text = response.text();
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

      // Gemini doesn't provide granular token usage in the same way
      const usage = response.usageMetadata;

      return {
        testCases,
        warnings,
        tokenUsage: {
          promptTokens: usage?.promptTokenCount || 0,
          completionTokens: usage?.candidatesTokenCount || 0,
          totalTokens: usage?.totalTokenCount || 0,
        },
      };
    } catch (error) {
      core.error(`[Gemini] Test case generation failed: ${error}`);
      throw error;
    }
  }

  async shouldCreateTestCase(changeSet: ChangeSet): Promise<TestDecision> {
    const userPrompt = buildDecisionPrompt(changeSet);

    core.info(`[Gemini] Analyzing whether changes need test cases...`);

    try {
      const result = await this.model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `You are a QA engineer. Analyze code changes and decide if they need test cases. Respond with valid JSON.\n\n${userPrompt}`,
              },
            ],
          },
        ],
      });

      const text = result.response.text();
      return parseJSON(text) as unknown as TestDecision;
    } catch (error) {
      core.warning(`[Gemini] Decision analysis failed, defaulting to create: ${error}`);
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

    core.info(`[Gemini] Generating Playwright automation for ${testCase.id}...`);

    try {
      // Switch to text mode for code generation
      const genAI = new GoogleGenerativeAI(
        (this.model as unknown as { apiKey: string }).apiKey || ''
      );
      const codeModel = genAI.getGenerativeModel({
        model: (this.model as unknown as { model: string }).model || 'gemini-2.5-flash',
      });

      const result = await codeModel.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `You are a Playwright test automation expert. Generate clean, production-ready Playwright test code. Return ONLY the TypeScript code, no markdown fences or explanations.\n\n${userPrompt}`,
              },
            ],
          },
        ],
      });

      return cleanCodeOutput(result.response.text());
    } catch (error) {
      core.warning(`[Gemini] Automation generation failed for ${testCase.id}: ${error}`);
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
