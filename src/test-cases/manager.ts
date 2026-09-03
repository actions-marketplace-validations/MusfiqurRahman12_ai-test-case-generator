/**
 * Test Case Manager — handles CRUD for the local `.testcases/` directory.
 *
 * Reads, writes, and updates test case files (JSON + Markdown).
 * Also manages the sync state file that tracks PM tool integration.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as core from '@actions/core';
import { TestCase, SyncState, SyncRecord } from './types';
import { formatTestCaseMarkdown, formatTestSuiteMarkdown } from './formatter';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYNC_STATE_FILE = '.sync-state.json';
const TEST_CASES_FILE = 'test-cases.json';

// ---------------------------------------------------------------------------
// Read Operations
// ---------------------------------------------------------------------------

/**
 * Load all test cases from the output directory.
 */
export function loadTestCases(testOutputDir: string): TestCase[] {
  const jsonFile = path.join(testOutputDir, TEST_CASES_FILE);

  if (!fs.existsSync(jsonFile)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(jsonFile, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data.testCases) ? data.testCases : [];
  } catch (error) {
    core.warning(`Failed to read existing test cases: ${error}`);
    return [];
  }
}

/**
 * Load the sync state from the output directory.
 */
export function loadSyncState(testOutputDir: string): SyncState {
  const stateFile = path.join(testOutputDir, SYNC_STATE_FILE);

  if (!fs.existsSync(stateFile)) {
    return { records: [], updatedAt: new Date().toISOString() };
  }

  try {
    const raw = fs.readFileSync(stateFile, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    core.warning(`Failed to read sync state: ${error}`);
    return { records: [], updatedAt: new Date().toISOString() };
  }
}

// ---------------------------------------------------------------------------
// Write Operations
// ---------------------------------------------------------------------------

/**
 * Save test cases to the output directory (JSON + Markdown).
 */
export function saveTestCases(
  testOutputDir: string,
  newTestCases: TestCase[],
  updatedTestCases: TestCase[]
): void {
  // Ensure directory exists
  fs.mkdirSync(testOutputDir, { recursive: true });

  // Load existing
  const existing = loadTestCases(testOutputDir);

  // Build the merged set
  const mergedMap = new Map<string, TestCase>();

  // Add existing
  for (const tc of existing) {
    mergedMap.set(tc.id, tc);
  }

  // Add updated (overwrites existing)
  for (const tc of updatedTestCases) {
    mergedMap.set(tc.id, tc);
  }

  // Add new
  for (const tc of newTestCases) {
    mergedMap.set(tc.id, tc);
  }

  const allTestCases = Array.from(mergedMap.values());

  // Sort by feature area then ID
  allTestCases.sort((a, b) => {
    const areaComp = (a.featureArea || '').localeCompare(b.featureArea || '');
    if (areaComp !== 0) return areaComp;
    return a.id.localeCompare(b.id);
  });

  // Write JSON
  const jsonFile = path.join(testOutputDir, TEST_CASES_FILE);
  const jsonContent = JSON.stringify(
    {
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
      totalCount: allTestCases.length,
      testCases: allTestCases,
    },
    null,
    2
  );
  fs.writeFileSync(jsonFile, jsonContent, 'utf-8');
  core.info(`Wrote ${allTestCases.length} test cases to ${jsonFile}`);

  // Write Markdown — one file per feature area
  const byFeature = groupByFeatureArea(allTestCases);
  for (const [featureArea, cases] of Object.entries(byFeature)) {
    const safeName = featureArea
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const mdFile = path.join(testOutputDir, `${safeName || 'general'}.md`);
    const mdContent = formatTestSuiteMarkdown(featureArea, cases);
    fs.writeFileSync(mdFile, mdContent, 'utf-8');
  }

  // Also write a summary README
  writeSummaryReadme(testOutputDir, allTestCases, byFeature);

  core.info(`Wrote Markdown files for ${Object.keys(byFeature).length} feature areas`);
}

/**
 * Save sync state to the output directory.
 */
export function saveSyncState(testOutputDir: string, syncState: SyncState): void {
  fs.mkdirSync(testOutputDir, { recursive: true });
  const stateFile = path.join(testOutputDir, SYNC_STATE_FILE);
  syncState.updatedAt = new Date().toISOString();
  fs.writeFileSync(stateFile, JSON.stringify(syncState, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Content Hashing
// ---------------------------------------------------------------------------

/**
 * Compute a content hash for a test case, used to detect changes for sync.
 */
export function computeContentHash(testCase: TestCase): string {
  const content = JSON.stringify({
    title: testCase.title,
    description: testCase.description,
    steps: testCase.steps,
    expectedResult: testCase.expectedResult,
    priority: testCase.priority,
    type: testCase.type,
    preconditions: testCase.preconditions,
  });
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
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

function writeSummaryReadme(
  testOutputDir: string,
  allTestCases: TestCase[],
  byFeature: Record<string, TestCase[]>
): void {
  const priorityCounts = {
    critical: allTestCases.filter((t) => t.priority === 'critical').length,
    high: allTestCases.filter((t) => t.priority === 'high').length,
    medium: allTestCases.filter((t) => t.priority === 'medium').length,
    low: allTestCases.filter((t) => t.priority === 'low').length,
  };

  const automationCounts = {
    pending: allTestCases.filter((t) => t.automationStatus === 'pending').length,
    generated: allTestCases.filter((t) => t.automationStatus === 'generated').length,
    verified: allTestCases.filter((t) => t.automationStatus === 'verified').length,
  };

  const featureList = Object.entries(byFeature)
    .map(([area, cases]) => {
      const safeName = area.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      return `| ${area} | ${cases.length} | [${safeName || 'general'}.md](${safeName || 'general'}.md) |`;
    })
    .join('\n');

  const readme = `# Test Cases

> Auto-generated by [AI Test Case Generator](https://github.com/ai-test-case-generator)

## Summary

| Metric | Count |
|--------|-------|
| **Total Test Cases** | ${allTestCases.length} |
| 🔴 Critical | ${priorityCounts.critical} |
| 🟠 High | ${priorityCounts.high} |
| 🟡 Medium | ${priorityCounts.medium} |
| 🟢 Low | ${priorityCounts.low} |

## Automation Status

| Status | Count |
|--------|-------|
| ⏳ Pending | ${automationCounts.pending} |
| 🤖 Generated | ${automationCounts.generated} |
| ✅ Verified | ${automationCounts.verified} |

## Feature Areas

| Feature Area | Test Cases | File |
|-------------|-----------|------|
${featureList}

## Files

- \`test-cases.json\` — Machine-readable test cases (used by automation)
- \`*.md\` — Human-readable test cases grouped by feature area

*Last updated: ${new Date().toISOString()}*
`;

  fs.writeFileSync(path.join(testOutputDir, 'README.md'), readme, 'utf-8');
}
