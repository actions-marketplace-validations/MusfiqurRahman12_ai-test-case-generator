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
  buildAutomationSuitePrompt,
} from './prompts';

// Rate pacing tracker for free tier
let lastCallTimestamp = 0;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Enforces a minimal delay between consecutive calls to avoid bursting the 15 RPM quota.
 */
async function paceRequest(minIntervalMs = 1200): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCallTimestamp;
  if (elapsed < minIntervalMs) {
    await sleep(minIntervalMs - elapsed);
  }
  lastCallTimestamp = Date.now();
}

/**
 * Executes a Gemini API call with exponential backoff retry on 429 / RESOURCE_EXHAUSTED
 * and transient network errors to protect the free tier from crashing workflows.
 */
async function callWithRetry<T>(
  actionName: string,
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      await paceRequest();
      return await fn();
    } catch (error: any) {
      const errorMsg = String(error?.message || error);
      const isRateLimit =
        errorMsg.includes('429') ||
        errorMsg.includes('RESOURCE_EXHAUSTED') ||
        error?.status === 429;
      const isTransient =
        errorMsg.includes('503') ||
        errorMsg.includes('Service Unavailable') ||
        errorMsg.includes('fetch failed') ||
        errorMsg.includes('ECONNRESET');

      if ((isRateLimit || isTransient) && attempt <= maxRetries) {
        // Backoff: 2.5s, 5s, 10s + jitter
        const baseDelay = isRateLimit ? 2500 * Math.pow(2, attempt - 1) : 1500 * attempt;
        const jitter = Math.floor(Math.random() * 800);
        const delayMs = baseDelay + jitter;

        core.warning(
          `[Gemini] ${actionName}: ${isRateLimit ? 'Rate limit (429/quota)' : 'Transient network error'} hit. ` +
          `Retrying in ${(delayMs / 1000).toFixed(1)}s (attempt ${attempt}/${maxRetries})...`
        );
        await sleep(delayMs);
        continue;
      }
      throw error;
    }
  }
  throw new Error(`[Gemini] ${actionName} failed after ${maxRetries} retries`);
}

export class GeminiProvider implements AIProvider {
  readonly name = 'Gemini';
  private apiKey: string;
  private modelName: string;
  private model: GenerativeModel;

  constructor(apiKey: string, modelName: string) {
    this.apiKey = apiKey;
    this.modelName = modelName;
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

    core.info(`[Gemini] Generating test cases (model: ${this.modelName})...`);

    try {
      const result = await callWithRetry('Test case generation', async () => {
        return await this.model.generateContent({
          contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        });
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
      const result = await callWithRetry('Decision analysis', async () => {
        return await this.model.generateContent({
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
      return await callWithRetry(`Automation for ${testCase.id}`, async () => {
        const genAI = new GoogleGenerativeAI(this.apiKey);
        const codeModel = genAI.getGenerativeModel({
          model: this.modelName,
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
      });
    } catch (error) {
      core.warning(`[Gemini] Automation generation failed for ${testCase.id}: ${error}`);
      return generateFallbackAutomation(testCase);
    }
  }

  /**
   * Batch generation: generate all Playwright tests for a feature area in a single API call.
   */
  async generateAutomationSuite(
    featureArea: string,
    testCases: TestCase[],
    projectContext: ProjectContext
  ): Promise<string> {
    const userPrompt = buildAutomationSuitePrompt(featureArea, testCases, projectContext);

    core.info(`[Gemini] Generating Playwright automation suite for "${featureArea}" (${testCases.length} tests in 1 batch call)...`);

    try {
      return await callWithRetry(`Automation suite for ${featureArea}`, async () => {
        const genAI = new GoogleGenerativeAI(this.apiKey);
        const codeModel = genAI.getGenerativeModel({
          model: this.modelName,
        });

        const result = await codeModel.generateContent({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `You are a Playwright test automation expert. Generate clean, production-ready Playwright test suite code. Return ONLY valid TypeScript code, no markdown fences or explanations.\n\n${userPrompt}`,
                },
              ],
            },
          ],
        });

        return cleanCodeOutput(result.response.text());
      });
    } catch (error) {
      core.warning(`[Gemini] Automation suite generation failed for "${featureArea}": ${error}`);
      throw error;
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
