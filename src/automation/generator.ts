/**
 * Automation Generator — converts manual test cases into Playwright test files.
 *
 * Groups test cases by feature area into `.spec.ts` files.
 * Uses AI to generate the actual test code, with fallback to skeletons.
 * Creates a playwright.config.ts if one doesn't exist.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as core from '@actions/core';
import { AIProvider } from '../ai/provider';
import { TestCase, ProjectContext } from '../test-cases/types';
import {
  PLAYWRIGHT_CONFIG_TEMPLATE,
  generateTestFileHeader,
  generateTestSkeleton,
  generateAPITestSkeleton,
} from './templates';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
export async function generateAutomation(
  aiProvider: AIProvider,
  testCases: TestCase[],
  projectContext: ProjectContext,
  automationDir: string
): Promise<AutomationResult> {
  const result: AutomationResult = { filesGenerated: 0, filePaths: [], errors: [] };

  if (testCases.length === 0) {
    core.info('No test cases to generate automation for');
    return result;
  }

  // Ensure directory exists
  fs.mkdirSync(automationDir, { recursive: true });

  // Create playwright.config.ts if it doesn't exist
  ensurePlaywrightConfig(automationDir);

  // Group test cases by feature area
  const groups = groupByFeatureArea(testCases);

  core.info(`Generating Playwright tests for ${Object.keys(groups).length} feature areas...`);

  for (const [featureArea, cases] of Object.entries(groups)) {
    try {
      const specContent = await generateSpecFile(
        aiProvider,
        featureArea,
        cases,
        projectContext
      );

      const safeName = featureArea
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      const specPath = path.join(automationDir, `${safeName || 'general'}.spec.ts`);

      // If file exists, merge new tests into it
      if (fs.existsSync(specPath)) {
        const existingContent = fs.readFileSync(specPath, 'utf-8');
        const mergedContent = mergeSpecFiles(existingContent, specContent, cases);
        fs.writeFileSync(specPath, mergedContent, 'utf-8');
      } else {
        fs.writeFileSync(specPath, specContent, 'utf-8');
      }

      core.info(`Generated ${specPath} (${cases.length} tests)`);
      result.filesGenerated++;
      result.filePaths.push(specPath);

      // Mark test cases as having generated automation
      for (const tc of cases) {
        tc.automationStatus = 'generated';
      }
    } catch (error) {
      core.warning(`Failed to generate automation for "${featureArea}": ${error}`);
      result.errors.push(`Failed for "${featureArea}": ${error}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Spec File Generation
// ---------------------------------------------------------------------------

async function generateSpecFile(
  aiProvider: AIProvider,
  featureArea: string,
  testCases: TestCase[],
  projectContext: ProjectContext
): Promise<string> {
  // Batch optimization: generate the whole feature spec in 1 AI call to conserve API quota
  if (typeof aiProvider.generateAutomationSuite === 'function') {
    try {
      core.info(`[Batch Automation] Generating spec for "${featureArea}" (${testCases.length} tests in 1 AI call)...`);
      const suiteCode = await aiProvider.generateAutomationSuite(
        featureArea,
        testCases,
        projectContext
      );

      if (suiteCode && (suiteCode.includes('test(') || suiteCode.includes('test.describe'))) {
        if (suiteCode.includes('@playwright/test')) {
          return suiteCode.trim() + '\n';
        }
        return `${generateTestFileHeader(featureArea)}\n${suiteCode.trim()}\n`;
      }
    } catch (batchError) {
      core.warning(`Batch suite generation failed for "${featureArea}", falling back to sequential generation: ${batchError}`);
    }
  }

  // Sequential fallback
  let content = generateTestFileHeader(featureArea);
  content += `test.describe('${featureArea}', () => {\n\n`;

  for (const tc of testCases) {
    try {
      // Try AI generation first
      const aiCode = await aiProvider.generateAutomationCode(tc, projectContext);

      // Extract just the test block from the AI output
      const testBlock = extractTestBlock(aiCode, tc.title);
      if (testBlock) {
        content += `  ${indentBlock(testBlock, 2)}\n\n`;
      } else {
        // AI returned something but we couldn't parse it; use it anyway
        content += `  // AI-generated test for ${tc.id}\n`;
        content += `  ${indentBlock(aiCode, 2)}\n\n`;
      }
    } catch {
      // Fallback to skeleton
      core.info(`Using skeleton for ${tc.id} (AI generation failed)`);
      const skeleton = tc.type === 'api'
        ? generateAPITestSkeleton(tc.id, tc.title, tc.description, tc.steps)
        : generateTestSkeleton(tc.id, tc.title, tc.description, tc.steps, tc.preconditions);
      content += `  ${indentBlock(skeleton, 2)}\n\n`;
    }
  }

  content += `});\n`;

  return content;
}

// ---------------------------------------------------------------------------
// Playwright Config
// ---------------------------------------------------------------------------

function ensurePlaywrightConfig(automationDir: string): void {
  // Check project root and automation dir parent for existing config
  const projectRoot = process.cwd();
  const configLocations = [
    path.join(projectRoot, 'playwright.config.ts'),
    path.join(projectRoot, 'playwright.config.js'),
    path.join(projectRoot, 'playwright.config.mjs'),
  ];

  if (configLocations.some((loc) => fs.existsSync(loc))) {
    core.info('Playwright config already exists, skipping creation');
    return;
  }

  // Create config at project root
  const configPath = path.join(projectRoot, 'playwright.config.ts');
  // Update testDir to match the automation output directory
  const relativeDir = path.relative(projectRoot, automationDir).replace(/\\/g, '/');
  const config = PLAYWRIGHT_CONFIG_TEMPLATE.replace(
    "testDir: './tests/e2e'",
    `testDir: './${relativeDir}'`
  );

  fs.writeFileSync(configPath, config, 'utf-8');
  core.info(`Created Playwright config at ${configPath}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByFeatureArea(testCases: TestCase[]): Record<string, TestCase[]> {
  const groups: Record<string, TestCase[]> = {};
  for (const tc of testCases) {
    const area = tc.featureArea || 'General';
    if (!groups[area]) groups[area] = [];
    groups[area].push(tc);
  }
  return groups;
}

/**
 * Extract a test(...) block from AI-generated code.
 */
function extractTestBlock(code: string, title: string): string | null {
  // Try to find a test() or test.only() block
  const testPattern = /test(?:\.only)?\s*\(/;
  const match = code.match(testPattern);
  if (!match) return null;

  // Return everything from the test call
  const startIdx = code.indexOf(match[0]);
  return code.substring(startIdx);
}

/**
 * Indent a block of code by a given number of spaces.
 */
function indentBlock(code: string, spaces: number): string {
  const indent = ' '.repeat(spaces);
  return code
    .split('\n')
    .map((line, i) => (i === 0 ? line : `${indent}${line}`))
    .join('\n');
}

/**
 * Merge new test content into an existing spec file.
 * Avoids duplicate tests by checking test case IDs in comments.
 */
function mergeSpecFiles(
  existing: string,
  newContent: string,
  newTestCases: TestCase[]
): string {
  // Find which test case IDs are already in the existing file
  const existingIds = new Set<string>();
  const idPattern = /Test Case: (TC-[\w-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = idPattern.exec(existing)) !== null) {
    existingIds.add(match[1]);
  }

  // Filter new test cases to only those not already present
  const toAdd = newTestCases.filter((tc) => !existingIds.has(tc.id));

  if (toAdd.length === 0) {
    core.info('All test cases already exist in spec file, skipping merge');
    return existing;
  }

  // Find the closing of the describe block and insert before it
  const lastCloseIdx = existing.lastIndexOf('});');
  if (lastCloseIdx === -1) {
    // Can't find describe close, append at end
    return existing + '\n' + newContent;
  }

  // Extract new test blocks from newContent
  const testBlocks: string[] = [];
  const testBlockPattern = /\s{2}(test\([\s\S]*?\n\s{2}\}\);)/g;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = testBlockPattern.exec(newContent)) !== null) {
    // Check if this block is for a test case we need to add
    const blockText = blockMatch[1];
    const idCheck = /Test Case: (TC-[\w-]+)/.exec(blockText);
    if (idCheck && toAdd.some((tc) => tc.id === idCheck[1])) {
      testBlocks.push(blockMatch[1]);
    }
  }

  if (testBlocks.length === 0) {
    return existing;
  }

  const insertion = '\n' + testBlocks.map((b) => `  ${b}`).join('\n\n') + '\n';
  return existing.substring(0, lastCloseIdx) + insertion + existing.substring(lastCloseIdx);
}
