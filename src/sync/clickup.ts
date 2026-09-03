/**
 * ClickUp Sync Client — creates and updates tasks in ClickUp.
 *
 * Uses ClickUp API v2 to create tasks with checklists for test steps.
 * Rate limit: 100 requests/minute.
 */

import * as core from '@actions/core';
import { ClickUpConfig } from '../config';
import { TestCase, SyncState, SyncResult, SyncRecord } from '../test-cases/types';
import { computeContentHash } from '../test-cases/manager';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';
const RATE_LIMIT_DELAY_MS = 650; // ~92 req/min, safely under 100

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function syncToClickUp(
  config: ClickUpConfig,
  toCreate: TestCase[],
  toUpdate: TestCase[],
  syncState: SyncState
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: [], details: [] };
  const headers = {
    'Authorization': config.apiToken,
    'Content-Type': 'application/json',
  };

  // Create new tasks
  for (const tc of toCreate) {
    try {
      // 1. Create the task
      const taskPayload = buildTaskPayload(tc);
      const taskResponse = await fetch(`${CLICKUP_API_BASE}/list/${config.listId}/task`, {
        method: 'POST',
        headers,
        body: JSON.stringify(taskPayload),
      });

      if (!taskResponse.ok) {
        const errorText = await taskResponse.text();
        throw new Error(`HTTP ${taskResponse.status}: ${errorText}`);
      }

      const taskData = await taskResponse.json() as { id: string; url: string };
      const taskId = taskData.id;

      core.info(`[ClickUp] Created task ${taskId} for ${tc.id}`);
      await sleep(RATE_LIMIT_DELAY_MS);

      // 2. Add a checklist for test steps
      const checklistResponse = await fetch(`${CLICKUP_API_BASE}/task/${taskId}/checklist`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Test Steps' }),
      });

      if (checklistResponse.ok) {
        const checklistData = await checklistResponse.json() as { checklist: { id: string } };
        const checklistId = checklistData.checklist.id;
        await sleep(RATE_LIMIT_DELAY_MS);

        // 3. Add checklist items for each step
        for (const step of tc.steps) {
          const itemName = `Step ${step.stepNumber}: ${step.action} → Expected: ${step.expectedResult}`;
          await fetch(`${CLICKUP_API_BASE}/checklist/${checklistId}/checklist_item`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ name: itemName }),
          });
          await sleep(RATE_LIMIT_DELAY_MS);
        }
      }

      result.created++;
      result.details.push({
        testCaseId: tc.id,
        pmTool: 'clickup',
        externalId: taskId,
        externalUrl: taskData.url,
        lastSyncedAt: new Date().toISOString(),
        contentHash: computeContentHash(tc),
      });
    } catch (error) {
      core.warning(`[ClickUp] Failed to create task for ${tc.id}: ${error}`);
      result.errors.push(`Failed to create ${tc.id}: ${error}`);
    }
  }

  // Update existing tasks
  for (const tc of toUpdate) {
    const existingRecord = syncState.records.find((r) => r.testCaseId === tc.id);
    if (!existingRecord) continue;

    try {
      const taskPayload = buildUpdatePayload(tc);
      const response = await fetch(`${CLICKUP_API_BASE}/task/${existingRecord.externalId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(taskPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      core.info(`[ClickUp] Updated task ${existingRecord.externalId} for ${tc.id}`);

      result.updated++;
      result.details.push({
        ...existingRecord,
        lastSyncedAt: new Date().toISOString(),
        contentHash: computeContentHash(tc),
      });

      await sleep(RATE_LIMIT_DELAY_MS);
    } catch (error) {
      core.warning(`[ClickUp] Failed to update task ${existingRecord.externalId}: ${error}`);
      result.errors.push(`Failed to update ${tc.id}: ${error}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Payload Builders
// ---------------------------------------------------------------------------

function buildTaskPayload(tc: TestCase) {
  const description = buildDescription(tc);
  const priority = mapPriority(tc.priority);

  return {
    name: `[Test] ${tc.title}`,
    description,
    markdown_description: description,
    priority,
    tags: ['auto-generated', 'test-case', tc.type].map((tag) => ({ name: tag })),
  };
}

function buildUpdatePayload(tc: TestCase) {
  const description = buildDescription(tc);

  return {
    name: `[Test] ${tc.title}`,
    description,
    markdown_description: description,
  };
}

function buildDescription(tc: TestCase): string {
  let desc = `**${tc.id}** — ${tc.description}\n\n`;
  desc += `**Priority**: ${tc.priority.toUpperCase()} | **Type**: ${tc.type}\n\n`;

  if (tc.preconditions.length > 0) {
    desc += `### Preconditions\n`;
    for (const pre of tc.preconditions) {
      desc += `- ${pre}\n`;
    }
    desc += `\n`;
  }

  desc += `### Test Steps\n\n`;
  for (const step of tc.steps) {
    desc += `**${step.stepNumber}.** ${step.action}\n`;
    desc += `   → Expected: ${step.expectedResult}\n`;
    if (step.testData) {
      desc += `   → Data: ${step.testData}\n`;
    }
    desc += `\n`;
  }

  desc += `### Expected Result\n${tc.expectedResult}\n\n`;

  if (tc.sourceFiles.length > 0) {
    desc += `### Related Files\n`;
    for (const file of tc.sourceFiles) {
      desc += `- \`${file}\`\n`;
    }
  }

  return desc;
}

function mapPriority(priority: string): number {
  // ClickUp priorities: 1=Urgent, 2=High, 3=Normal, 4=Low
  switch (priority) {
    case 'critical': return 1;
    case 'high': return 2;
    case 'medium': return 3;
    case 'low': return 4;
    default: return 3;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
