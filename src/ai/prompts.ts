/**
 * Prompt Templates — centralized prompts for all AI operations.
 *
 * Each prompt is designed to produce structured JSON output matching
 * our TestCase and TestDecision schemas.
 */

import { CodeContext, ChangeSet, TestCase, ProjectContext } from '../test-cases/types';

// ---------------------------------------------------------------------------
// JSON Schema (shared across providers)
// ---------------------------------------------------------------------------

export const TEST_CASE_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    testCases: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          id: { type: 'string' as const, description: 'Unique ID like TC-feature-area-001' },
          title: { type: 'string' as const, description: 'Short descriptive title' },
          description: { type: 'string' as const, description: 'What this test validates' },
          priority: { type: 'string' as const, enum: ['critical', 'high', 'medium', 'low'] },
          type: { type: 'string' as const, enum: ['functional', 'regression', 'edge_case', 'integration', 'ui', 'api', 'security'] },
          preconditions: { type: 'array' as const, items: { type: 'string' as const } },
          steps: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: {
                stepNumber: { type: 'number' as const },
                action: { type: 'string' as const },
                expectedResult: { type: 'string' as const },
                testData: { type: 'string' as const },
              },
              required: ['stepNumber', 'action', 'expectedResult'],
            },
          },
          expectedResult: { type: 'string' as const, description: 'Overall expected result' },
          sourceFiles: { type: 'array' as const, items: { type: 'string' as const } },
          tags: { type: 'array' as const, items: { type: 'string' as const } },
          featureArea: { type: 'string' as const },
        },
        required: ['id', 'title', 'description', 'priority', 'type', 'preconditions', 'steps', 'expectedResult', 'sourceFiles', 'tags'],
      },
    },
    warnings: {
      type: 'array' as const,
      items: { type: 'string' as const },
    },
  },
  required: ['testCases', 'warnings'],
};

export const TEST_DECISION_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    needsTestCase: { type: 'boolean' as const },
    reasoning: { type: 'string' as const },
    changeType: {
      type: 'string' as const,
      enum: ['new_feature', 'bug_fix', 'refactor', 'config', 'docs', 'dependency', 'other'],
    },
    suggestedTestCount: { type: 'number' as const },
  },
  required: ['needsTestCase', 'reasoning', 'changeType', 'suggestedTestCount'],
};

// ---------------------------------------------------------------------------
// Prompt Builders
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for test case generation.
 */
export function buildSystemPrompt(): string {
  return `You are an expert QA engineer and test architect. Your job is to analyze source code and generate comprehensive manual test cases.

RULES:
1. Each test case must have clear, actionable steps that a manual tester can follow.
2. Each step must have an action (what to do) and an expected result (what should happen).
3. Include preconditions (setup needed before testing).
4. Assign appropriate priority: critical (auth, payments, data loss), high (core features), medium (secondary features), low (cosmetic, nice-to-have).
5. Assign appropriate type: functional, regression, edge_case, integration, ui, api, security.
6. Generate IDs in the format: TC-{feature-area}-{number}, e.g. TC-auth-login-001.
7. Group test cases by feature area.
8. Include both happy path and negative/edge case tests.
9. For API endpoints, test different HTTP methods, status codes, validation errors, and auth scenarios.
10. For UI components, test user interactions, form validation, loading states, error states, and responsive behavior.
11. Do NOT generate test cases for pure utility functions, type definitions, or configuration files unless they contain complex business logic.
12. Be thorough but avoid redundant test cases that test the same thing differently.

OUTPUT: Respond with valid JSON matching the provided schema. Do NOT include markdown code fences or any text outside the JSON.`;
}

/**
 * Build the user prompt for full-scan test generation.
 */
export function buildFullScanPrompt(context: CodeContext): string {
  const projectInfo = formatProjectInfo(context.project);
  const filesSummary = context.files
    .map((f) => `### ${f.path}\n\`\`\`${f.language}\n${f.content}\n\`\`\``)
    .join('\n\n');

  return `Analyze this codebase and generate comprehensive manual test cases.

${projectInfo}

## Source Files

${filesSummary}

Generate test cases covering:
- All user-facing features and workflows
- API endpoint testing (if applicable)
- Authentication and authorization (if applicable)
- Form validation and error handling
- Edge cases and boundary conditions
- Data integrity scenarios
- Integration points between components`;
}

/**
 * Build the user prompt for incremental test generation.
 */
export function buildIncrementalPrompt(
  context: CodeContext,
  changeSet: ChangeSet,
  existingTests: TestCase[]
): string {
  const projectInfo = formatProjectInfo(context.project);

  const changesInfo = changeSet.files
    .map((f) => {
      const label = f.category === 'new_file' ? '[NEW]' : f.category === 'modified' ? '[MODIFIED]' : `[${f.category.toUpperCase()}]`;
      const diffSection = f.diff ? `\nDiff:\n\`\`\`diff\n${f.diff.substring(0, 3000)}\n\`\`\`\n` : '';
      const contentSection = f.content ? `\nFull content:\n\`\`\`\n${f.content.substring(0, 5000)}\n\`\`\`\n` : '';
      return `### ${label} ${f.filePath}${diffSection}${contentSection}`;
    })
    .join('\n\n');

  const existingTestSummary = existingTests.length > 0
    ? `## Existing Test Cases (do NOT duplicate these)\n${existingTests.map((t) => `- ${t.id}: ${t.title}`).join('\n')}`
    : 'No existing test cases.';

  const contextInfo = [
    changeSet.commitMessage ? `Commit message: ${changeSet.commitMessage}` : '',
    changeSet.prTitle ? `PR title: ${changeSet.prTitle}` : '',
    changeSet.prBody ? `PR description: ${changeSet.prBody}` : '',
  ].filter(Boolean).join('\n');

  return `Analyze the following code changes and generate test cases ONLY for the new or changed functionality.

${projectInfo}

## Change Context
${contextInfo || 'No additional context.'}

## Changed Files

${changesInfo}

${existingTestSummary}

Generate test cases ONLY for functionality that is new or significantly changed. Do NOT create test cases for:
- Refactoring that doesn't change behavior
- Import/export changes
- Comment or formatting changes
- Dependency version bumps
- Changes already covered by existing test cases`;
}

/**
 * Build the prompt for the "should we create test cases?" decision.
 */
export function buildDecisionPrompt(changeSet: ChangeSet): string {
  const fileSummary = changeSet.files
    .map((f) => `- [${f.category}] ${f.filePath}`)
    .join('\n');

  const diffPreview = changeSet.files
    .filter((f) => f.diff)
    .slice(0, 5)
    .map((f) => `### ${f.filePath}\n\`\`\`diff\n${f.diff.substring(0, 1500)}\n\`\`\``)
    .join('\n\n');

  const contextInfo = [
    changeSet.commitMessage ? `Commit message: ${changeSet.commitMessage}` : '',
    changeSet.prTitle ? `PR title: ${changeSet.prTitle}` : '',
  ].filter(Boolean).join('\n');

  return `Analyze these code changes and decide if they require new or updated manual test cases.

## Changed Files
${fileSummary}

${contextInfo ? `## Context\n${contextInfo}` : ''}

## Diff Preview
${diffPreview}

Classify the change type and decide if test cases are needed.

Guidelines:
- new_feature → Almost always needs test cases
- bug_fix → Usually needs a regression test case
- refactor → Only if public behavior changes
- config → Only if it affects user-facing behavior
- docs → No test cases needed
- dependency → Only if major version upgrade with breaking changes

Respond with your analysis.`;
}

/**
 * Build the prompt for generating Playwright automation code.
 */
export function buildAutomationPrompt(testCase: TestCase, projectContext: ProjectContext): string {
  const isWeb = projectContext.hasFrontend;
  const isAPI = projectContext.hasBackend && !projectContext.hasFrontend;

  return `Convert this manual test case into a Playwright automated test.

## Test Case
- **ID**: ${testCase.id}
- **Title**: ${testCase.title}
- **Type**: ${testCase.type}
- **Description**: ${testCase.description}

### Preconditions
${testCase.preconditions.map((p) => `- ${p}`).join('\n')}

### Steps
${testCase.steps.map((s) => `${s.stepNumber}. Action: ${s.action} → Expected: ${s.expectedResult}${s.testData ? ` (Data: ${s.testData})` : ''}`).join('\n')}

### Expected Result
${testCase.expectedResult}

## Project Context
- Language: ${projectContext.language}
- Frameworks: ${projectContext.frameworks.join(', ')}
- Has Frontend: ${isWeb}
- Has Backend API: ${projectContext.hasBackend}

## Requirements
1. Use Playwright Test runner (import { test, expect } from '@playwright/test')
2. Use resilient locators: getByRole, getByLabel, getByText, getByTestId — prefer these over CSS selectors
3. ${isWeb ? 'Test the web UI interactions as described' : isAPI ? 'Use request.newContext() for API testing' : 'Adapt to the project type'}
4. Add clear assertions matching each expected result
5. Use descriptive test names
6. Add // TODO: Review comments for steps that may need manual adjustment (e.g., auth flows, specific URLs, test data)
7. Include setup/teardown if preconditions require it
8. Use page.waitForLoadState or other appropriate waits

Return ONLY the TypeScript code for the Playwright test file. Do NOT include markdown code fences.`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatProjectInfo(project: ProjectContext): string {
  return `## Project Info
- **Language**: ${project.language}
- **Framework(s)**: ${project.frameworks.join(', ')}
- **Has Frontend**: ${project.hasFrontend}
- **Has Backend**: ${project.hasBackend}
- **Has Existing Tests**: ${project.hasExistingTests}${project.existingTestFramework ? ` (${project.existingTestFramework})` : ''}
- **Entry Points**: ${project.entryPoints.join(', ') || 'not detected'}
- **Source Directories**: ${project.sourceDirectories.join(', ') || 'not detected'}`;
}
