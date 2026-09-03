/**
 * Trello Sync Client — creates and updates cards in Trello.
 *
 * Uses the Trello REST API to create cards with checklists for test steps.
 * All requests require API key + token as query parameters.
 */

import * as core from '@actions/core';
import { TrelloConfig } from '../config';
import { TestCase, SyncState, SyncResult } from '../test-cases/types';
import { computeContentHash } from '../test-cases/manager';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRELLO_API_BASE = 'https://api.trello.com/1';
const RATE_LIMIT_DELAY_MS = 200;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function syncToTrello(
  config: TrelloConfig,
  toCreate: TestCase[],
  toUpdate: TestCase[],
  syncState: SyncState
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: [], details: [] };
  const authParams = `key=${config.apiKey}&token=${config.apiToken}`;

  // Create new cards
  for (const tc of toCreate) {
    try {
      // 1. Create the card
      const description = buildDescription(tc);
      const cardResponse = await fetch(
        `${TRELLO_API_BASE}/cards?${authParams}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idList: config.listId,
            name: `[Test] ${tc.title}`,
            desc: description,
            pos: 'bottom',
          }),
        }
      );

      if (!cardResponse.ok) {
        const errorText = await cardResponse.text();
        throw new Error(`HTTP ${cardResponse.status}: ${errorText}`);
      }

      const cardData = await cardResponse.json() as { id: string; shortUrl: string };
      const cardId = cardData.id;

      core.info(`[Trello] Created card for ${tc.id}`);
      await sleep(RATE_LIMIT_DELAY_MS);

      // 2. Create checklist on the card
      const checklistResponse = await fetch(
        `${TRELLO_API_BASE}/checklists?${authParams}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idCard: cardId,
            name: 'Test Steps',
          }),
        }
      );

      if (checklistResponse.ok) {
        const checklistData = await checklistResponse.json() as { id: string };
        const checklistId = checklistData.id;
        await sleep(RATE_LIMIT_DELAY_MS);

        // 3. Add checklist items for each step
        for (const step of tc.steps) {
          const itemName = `Step ${step.stepNumber}: ${step.action} → Expected: ${step.expectedResult}`;
          await fetch(
            `${TRELLO_API_BASE}/checklists/${checklistId}/checkItems?${authParams}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: itemName }),
            }
          );
          await sleep(RATE_LIMIT_DELAY_MS);
        }
      }

      // 4. Add labels for priority and type
      await addLabels(config, cardId, tc, authParams);

      result.created++;
      result.details.push({
        testCaseId: tc.id,
        pmTool: 'trello',
        externalId: cardId,
        externalUrl: cardData.shortUrl,
        lastSyncedAt: new Date().toISOString(),
        contentHash: computeContentHash(tc),
      });
    } catch (error) {
      core.warning(`[Trello] Failed to create card for ${tc.id}: ${error}`);
      result.errors.push(`Failed to create ${tc.id}: ${error}`);
    }
  }

  // Update existing cards
  for (const tc of toUpdate) {
    const existingRecord = syncState.records.find((r) => r.testCaseId === tc.id);
    if (!existingRecord) continue;

    try {
      const description = buildDescription(tc);
      const response = await fetch(
        `${TRELLO_API_BASE}/cards/${existingRecord.externalId}?${authParams}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `[Test] ${tc.title}`,
            desc: description,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      core.info(`[Trello] Updated card ${existingRecord.externalId} for ${tc.id}`);

      result.updated++;
      result.details.push({
        ...existingRecord,
        lastSyncedAt: new Date().toISOString(),
        contentHash: computeContentHash(tc),
      });

      await sleep(RATE_LIMIT_DELAY_MS);
    } catch (error) {
      core.warning(`[Trello] Failed to update card ${existingRecord.externalId}: ${error}`);
      result.errors.push(`Failed to update ${tc.id}: ${error}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDescription(tc: TestCase): string {
  let desc = `**${tc.id}**\n\n${tc.description}\n\n`;
  desc += `**Priority**: ${tc.priority.toUpperCase()} | **Type**: ${tc.type}\n\n`;

  if (tc.preconditions.length > 0) {
    desc += `## Preconditions\n`;
    for (const pre of tc.preconditions) {
      desc += `- ${pre}\n`;
    }
    desc += `\n`;
  }

  desc += `## Test Steps\n\n`;
  for (const step of tc.steps) {
    desc += `**${step.stepNumber}.** ${step.action}\n`;
    desc += `   → Expected: ${step.expectedResult}\n`;
    if (step.testData) {
      desc += `   → Data: ${step.testData}\n`;
    }
    desc += `\n`;
  }

  desc += `## Expected Result\n${tc.expectedResult}\n\n`;

  if (tc.sourceFiles.length > 0) {
    desc += `## Related Files\n`;
    for (const file of tc.sourceFiles) {
      desc += `- \`${file}\`\n`;
    }
  }

  return desc;
}

async function addLabels(
  config: TrelloConfig,
  cardId: string,
  tc: TestCase,
  authParams: string
): Promise<void> {
  try {
    // Get existing labels on the board
    const labelsResponse = await fetch(
      `${TRELLO_API_BASE}/boards/${config.boardId}/labels?${authParams}`
    );

    if (!labelsResponse.ok) return;

    const existingLabels = await labelsResponse.json() as Array<{ id: string; name: string; color: string }>;

    // Map priority to color
    const priorityColor = mapPriorityToColor(tc.priority);
    const priorityLabel = existingLabels.find(
      (l) => l.name === tc.priority || l.color === priorityColor
    );

    if (priorityLabel) {
      await fetch(
        `${TRELLO_API_BASE}/cards/${cardId}/idLabels?${authParams}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: priorityLabel.id }),
        }
      );
      await sleep(RATE_LIMIT_DELAY_MS);
    }
  } catch {
    // Labels are non-critical, don't fail the sync
  }
}

function mapPriorityToColor(priority: string): string {
  switch (priority) {
    case 'critical': return 'red';
    case 'high': return 'orange';
    case 'medium': return 'yellow';
    case 'low': return 'green';
    default: return 'blue';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
