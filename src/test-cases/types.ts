/**
 * Core data models for the AI Test Case Generator.
 *
 * These types define the shape of test cases, test steps, sync state,
 * and the structures exchanged between all modules.
 */

// ---------------------------------------------------------------------------
// Test Case Core Types
// ---------------------------------------------------------------------------

export type TestCasePriority = 'critical' | 'high' | 'medium' | 'low';
export type TestCaseType = 'functional' | 'regression' | 'edge_case' | 'integration' | 'ui' | 'api' | 'security';
export type AutomationStatus = 'pending' | 'generated' | 'verified';

export interface TestStep {
  /** 1-based step number */
  stepNumber: number;
  /** What the tester does */
  action: string;
  /** What should happen at this step */
  expectedResult: string;
  /** Any specific data needed for this step */
  testData?: string;
}

export interface TestCase {
  /** Unique deterministic ID, e.g. "TC-auth-login-001" */
  id: string;
  /** Short descriptive title */
  title: string;
  /** Detailed description of what this test validates */
  description: string;
  /** Priority level */
  priority: TestCasePriority;
  /** Type of test */
  type: TestCaseType;
  /** Setup requirements before executing this test */
  preconditions: string[];
  /** Ordered list of test steps */
  steps: TestStep[];
  /** Overall expected result when all steps pass */
  expectedResult: string;
  /** Source files this test case relates to */
  sourceFiles: string[];
  /** Categorization tags (e.g., "authentication", "payment") */
  tags: string[];
  /** Current automation status */
  automationStatus: AutomationStatus;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last update */
  updatedAt: string;
  /** The commit SHA that triggered creation/update */
  commitSha?: string;
  /** Feature area grouping */
  featureArea?: string;
}

// ---------------------------------------------------------------------------
// Test Suite (collection of test cases)
// ---------------------------------------------------------------------------

export interface TestSuite {
  /** Suite name, typically the feature area */
  name: string;
  /** Description of the suite */
  description: string;
  /** All test cases in this suite */
  testCases: TestCase[];
  /** When this suite was last updated */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Change Detection Types
// ---------------------------------------------------------------------------

export type ChangeCategory = 'new_file' | 'modified' | 'deleted' | 'renamed';

export interface FileChange {
  /** File path relative to repo root */
  filePath: string;
  /** Type of change */
  category: ChangeCategory;
  /** Diff content (unified diff format) */
  diff: string;
  /** File content (for new/modified files) */
  content?: string;
  /** Previous path (for renames) */
  previousPath?: string;
}

export interface ChangeSet {
  /** All changed files */
  files: FileChange[];
  /** Whether this is a full scan (first run) */
  isFullScan: boolean;
  /** Base commit SHA */
  baseSha: string;
  /** Head commit SHA */
  headSha: string;
  /** Commit message (if push event) */
  commitMessage?: string;
  /** PR title (if PR event) */
  prTitle?: string;
  /** PR body (if PR event) */
  prBody?: string;
}

// ---------------------------------------------------------------------------
// Code Analysis Types
// ---------------------------------------------------------------------------

export type ProjectLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'java'
  | 'csharp'
  | 'go'
  | 'ruby'
  | 'php'
  | 'rust'
  | 'swift'
  | 'kotlin'
  | 'other';

export type ProjectFramework =
  | 'react'
  | 'nextjs'
  | 'vue'
  | 'angular'
  | 'express'
  | 'nestjs'
  | 'fastapi'
  | 'django'
  | 'flask'
  | 'spring'
  | 'rails'
  | 'laravel'
  | 'dotnet'
  | 'gin'
  | 'actix'
  | 'vapor'
  | 'ktor'
  | 'unknown';

export interface ProjectContext {
  /** Detected primary language */
  language: ProjectLanguage;
  /** Detected framework(s) */
  frameworks: ProjectFramework[];
  /** Whether this appears to be a web frontend */
  hasFrontend: boolean;
  /** Whether this appears to have a backend/API */
  hasBackend: boolean;
  /** Whether the project already has tests */
  hasExistingTests: boolean;
  /** Detected test framework (jest, pytest, junit, etc.) */
  existingTestFramework?: string;
  /** Entry points (main files, route files, etc.) */
  entryPoints: string[];
  /** Key directories */
  sourceDirectories: string[];
}

export interface CodeContext {
  /** Overall project context */
  project: ProjectContext;
  /** Files to analyze for test generation */
  files: CodeFile[];
}

export interface CodeFile {
  /** Relative path */
  path: string;
  /** Full file content */
  content: string;
  /** Detected language */
  language: string;
  /** Brief summary of what this file does (generated by analyzer) */
  summary?: string;
}

// ---------------------------------------------------------------------------
// AI Provider Types
// ---------------------------------------------------------------------------

export interface TestDecision {
  /** Whether this change needs new test cases */
  needsTestCase: boolean;
  /** Reasoning for the decision */
  reasoning: string;
  /** Type of change detected */
  changeType: 'new_feature' | 'bug_fix' | 'refactor' | 'config' | 'docs' | 'dependency' | 'other';
  /** Suggested test case count */
  suggestedTestCount: number;
}

export interface AIGenerationResult {
  /** Generated test cases */
  testCases: TestCase[];
  /** Any warnings from the AI */
  warnings: string[];
  /** Token usage for cost tracking */
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ---------------------------------------------------------------------------
// Sync State Types
// ---------------------------------------------------------------------------

export interface SyncRecord {
  /** Local test case ID */
  testCaseId: string;
  /** PM tool type */
  pmTool: 'jira' | 'clickup' | 'trello';
  /** External ID in the PM tool (e.g., Jira issue key, ClickUp task ID) */
  externalId: string;
  /** External URL */
  externalUrl: string;
  /** When this was last synced */
  lastSyncedAt: string;
  /** Hash of the test case content at last sync (to detect local changes) */
  contentHash: string;
}

export interface SyncState {
  /** All sync records */
  records: SyncRecord[];
  /** When the sync state was last updated */
  updatedAt: string;
}

export interface SyncResult {
  /** Number of new items created */
  created: number;
  /** Number of existing items updated */
  updated: number;
  /** Number of items skipped (no changes) */
  skipped: number;
  /** Any errors during sync */
  errors: string[];
  /** Individual sync outcomes */
  details: SyncRecord[];
}
