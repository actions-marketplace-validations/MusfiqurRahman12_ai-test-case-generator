/**
 * Test Case Generator — orchestrates the AI-powered test case creation flow.
 *
 * Coordinates between the code analyzer, AI provider, and test case manager
 * to produce new test cases while avoiding duplicates.
 */

import * as core from '@actions/core';
import { AIProvider } from '../ai/provider';
import {
  CodeContext,
  ChangeSet,
  TestCase,
  AIGenerationResult,
} from './types';
import { loadTestCases } from './manager';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerationResult {
  /** Newly created test cases */
  newTestCases: TestCase[];
  /** Updated existing test cases */
  updatedTestCases: TestCase[];
  /** AI warnings */
  warnings: string[];
  /** Token usage */
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Whether generation was skipped (no test cases needed) */
  skipped: boolean;
  /** Reason for skipping */
  skipReason?: string;
}

/**
 * Generate test cases for the given code context and change set.
 *
 * Flow:
 * 1. Load existing test cases
 * 2. For incremental runs, ask AI if test cases are needed
 * 3. If yes, generate test cases via AI
 * 4. Deduplicate against existing test cases
 * 5. Return new and updated test cases
 */
export async function generateTestCases(
  aiProvider: AIProvider,
  codeContext: CodeContext,
  changeSet: ChangeSet,
  testOutputDir: string
): Promise<GenerationResult> {
  // 1. Load existing test cases
  const existingTestCases = loadTestCases(testOutputDir);
  core.info(`Found ${existingTestCases.length} existing test cases`);

  // 2. For incremental runs, check if test cases are needed
  if (!changeSet.isFullScan) {
    core.info('Incremental run — checking if changes need test cases...');

    const decision = await aiProvider.shouldCreateTestCase(changeSet);
    core.info(`AI decision: ${decision.needsTestCase ? 'YES' : 'NO'} — ${decision.reasoning}`);
    core.info(`Change type: ${decision.changeType}, suggested count: ${decision.suggestedTestCount}`);

    if (!decision.needsTestCase) {
      return {
        newTestCases: [],
        updatedTestCases: [],
        warnings: [],
        tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        skipped: true,
        skipReason: decision.reasoning,
      };
    }
  }

  // 3. Generate test cases via AI
  core.info(`Generating test cases with ${aiProvider.name}...`);
  let aiResult: AIGenerationResult;

  try {
    aiResult = await aiProvider.generateTestCases(codeContext, existingTestCases, changeSet);
  } catch (error) {
    core.error(`AI generation failed: ${error}`);
    return {
      newTestCases: [],
      updatedTestCases: [],
      warnings: [`AI generation failed: ${error}`],
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      skipped: true,
      skipReason: `AI generation failed: ${error}`,
    };
  }

  core.info(`AI generated ${aiResult.testCases.length} test cases`);
  if (aiResult.warnings.length > 0) {
    core.warning(`AI warnings: ${aiResult.warnings.join('; ')}`);
  }

  // 4. Deduplicate
  const { newCases, updatedCases } = deduplicateTestCases(
    aiResult.testCases,
    existingTestCases
  );

  core.info(`After deduplication: ${newCases.length} new, ${updatedCases.length} updated`);

  return {
    newTestCases: newCases,
    updatedTestCases: updatedCases,
    warnings: aiResult.warnings,
    tokenUsage: aiResult.tokenUsage,
    skipped: false,
  };
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

interface DeduplicationResult {
  newCases: TestCase[];
  updatedCases: TestCase[];
}

function deduplicateTestCases(
  generated: TestCase[],
  existing: TestCase[]
): DeduplicationResult {
  const existingById = new Map(existing.map((tc) => [tc.id, tc]));
  const existingByTitle = new Map(existing.map((tc) => [normalizeTitle(tc.title), tc]));

  const newCases: TestCase[] = [];
  const updatedCases: TestCase[] = [];

  for (const tc of generated) {
    // Check for exact ID match
    const existingById_match = existingById.get(tc.id);
    if (existingById_match) {
      // Update the existing test case if content changed
      if (hasContentChanged(existingById_match, tc)) {
        updatedCases.push({
          ...tc,
          createdAt: existingById_match.createdAt,
          updatedAt: new Date().toISOString(),
        });
      }
      continue;
    }

    // Check for similar title (fuzzy match)
    const normalizedTitle = normalizeTitle(tc.title);
    const existingByTitle_match = existingByTitle.get(normalizedTitle);
    if (existingByTitle_match) {
      // Same test, likely updated
      if (hasContentChanged(existingByTitle_match, tc)) {
        updatedCases.push({
          ...tc,
          id: existingByTitle_match.id, // Keep the original ID
          createdAt: existingByTitle_match.createdAt,
          updatedAt: new Date().toISOString(),
        });
      }
      continue;
    }

    // Truly new test case
    newCases.push(tc);
  }

  return { newCases, updatedCases };
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasContentChanged(existing: TestCase, generated: TestCase): boolean {
  // Compare steps count and content
  if (existing.steps.length !== generated.steps.length) return true;

  const existingSteps = existing.steps.map((s) => `${s.action}|${s.expectedResult}`).join('::');
  const generatedSteps = generated.steps.map((s) => `${s.action}|${s.expectedResult}`).join('::');

  return existingSteps !== generatedSteps ||
    existing.expectedResult !== generated.expectedResult ||
    existing.priority !== generated.priority;
}
