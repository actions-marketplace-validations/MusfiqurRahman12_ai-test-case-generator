/**
 * Jira Sync Client — creates and updates issues in Jira.
 *
 * Uses Jira REST API v3 with Basic Auth (email + API token).
 * Creates Story/Task issues with test steps formatted in the description
 * using Atlassian Document Format (ADF).
 */

import * as core from '@actions/core';
import { JiraConfig } from '../config';
import { TestCase, SyncState, SyncResult, SyncRecord } from '../test-cases/types';
import { computeContentHash } from '../test-cases/manager';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function syncToJira(
  config: JiraConfig,
  toCreate: TestCase[],
  toUpdate: TestCase[],
  syncState: SyncState
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: [], details: [] };
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
  const headers = {
    'Authorization': `Basic ${auth}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  // Create new issues
  for (const tc of toCreate) {
    try {
      const body = buildCreatePayload(config.projectKey, tc);
      const response = await fetch(`${config.baseUrl}/rest/api/3/issue`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json() as { key: string; id: string };
      const issueUrl = `${config.baseUrl}/browse/${data.key}`;

      core.info(`[Jira] Created issue ${data.key} for ${tc.id}`);

      result.created++;
      result.details.push({
        testCaseId: tc.id,
        pmTool: 'jira',
        externalId: data.key,
        externalUrl: issueUrl,
        lastSyncedAt: new Date().toISOString(),
        contentHash: computeContentHash(tc),
      });

      // Rate limiting — Jira Cloud has generous limits but be safe
      await sleep(200);
    } catch (error) {
      core.warning(`[Jira] Failed to create issue for ${tc.id}: ${error}`);
      result.errors.push(`Failed to create ${tc.id}: ${error}`);
    }
  }

  // Update existing issues
  for (const tc of toUpdate) {
    const existingRecord = syncState.records.find((r) => r.testCaseId === tc.id);
    if (!existingRecord) continue;

    try {
      const body = buildUpdatePayload(tc);
      const response = await fetch(`${config.baseUrl}/rest/api/3/issue/${existingRecord.externalId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      core.info(`[Jira] Updated issue ${existingRecord.externalId} for ${tc.id}`);

      result.updated++;
      result.details.push({
        ...existingRecord,
        lastSyncedAt: new Date().toISOString(),
        contentHash: computeContentHash(tc),
      });

      await sleep(200);
    } catch (error) {
      core.warning(`[Jira] Failed to update issue ${existingRecord.externalId}: ${error}`);
      result.errors.push(`Failed to update ${tc.id}: ${error}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Payload Builders (Atlassian Document Format)
// ---------------------------------------------------------------------------

function buildCreatePayload(projectKey: string, tc: TestCase) {
  return {
    fields: {
      project: { key: projectKey },
      summary: `[Test] ${tc.title}`,
      issuetype: { name: 'Task' },
      description: buildADFDescription(tc),
      labels: ['auto-generated', 'test-case', tc.priority, tc.type],
      priority: mapPriority(tc.priority),
    },
  };
}

function buildUpdatePayload(tc: TestCase) {
  return {
    fields: {
      summary: `[Test] ${tc.title}`,
      description: buildADFDescription(tc),
      labels: ['auto-generated', 'test-case', tc.priority, tc.type],
    },
  };
}

/**
 * Build an Atlassian Document Format (ADF) description with
 * test case details, steps table, and expected results.
 */
function buildADFDescription(tc: TestCase) {
  const content: unknown[] = [];

  // Description paragraph
  content.push({
    type: 'paragraph',
    content: [
      { type: 'text', text: tc.description, marks: [] },
    ],
  });

  // Priority & Type info
  content.push({
    type: 'paragraph',
    content: [
      { type: 'text', text: `Priority: ${tc.priority.toUpperCase()} | Type: ${tc.type} | ID: ${tc.id}`, marks: [{ type: 'strong' }] },
    ],
  });

  // Preconditions
  if (tc.preconditions.length > 0) {
    content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Preconditions' }],
    });

    content.push({
      type: 'bulletList',
      content: tc.preconditions.map((pre) => ({
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: pre }],
          },
        ],
      })),
    });
  }

  // Test Steps as a table
  content.push({
    type: 'heading',
    attrs: { level: 3 },
    content: [{ type: 'text', text: 'Test Steps' }],
  });

  const tableRows = [
    // Header row
    {
      type: 'tableRow',
      content: ['#', 'Action', 'Expected Result', 'Test Data'].map((header) => ({
        type: 'tableHeader',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: header, marks: [{ type: 'strong' }] }],
          },
        ],
      })),
    },
    // Data rows
    ...tc.steps.map((step) => ({
      type: 'tableRow',
      content: [
        String(step.stepNumber),
        step.action,
        step.expectedResult,
        step.testData || '—',
      ].map((cell) => ({
        type: 'tableCell',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: cell }],
          },
        ],
      })),
    })),
  ];

  content.push({
    type: 'table',
    attrs: { isNumberColumnEnabled: false, layout: 'default' },
    content: tableRows,
  });

  // Expected Result
  content.push({
    type: 'heading',
    attrs: { level: 3 },
    content: [{ type: 'text', text: 'Expected Result' }],
  });

  content.push({
    type: 'paragraph',
    content: [{ type: 'text', text: tc.expectedResult }],
  });

  // Source Files
  if (tc.sourceFiles.length > 0) {
    content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Related Source Files' }],
    });

    content.push({
      type: 'bulletList',
      content: tc.sourceFiles.map((file) => ({
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: file, marks: [{ type: 'code' }] }],
          },
        ],
      })),
    });
  }

  return {
    version: 1,
    type: 'doc',
    content,
  };
}

function mapPriority(priority: string): { name: string } {
  switch (priority) {
    case 'critical': return { name: 'Highest' };
    case 'high': return { name: 'High' };
    case 'medium': return { name: 'Medium' };
    case 'low': return { name: 'Low' };
    default: return { name: 'Medium' };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
