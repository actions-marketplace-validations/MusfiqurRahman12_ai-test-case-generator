/**
 * ClickUp Sync Client — creates and updates tasks in ClickUp.
 *
 * Uses ClickUp API v2 to create tasks with checklists for test steps.
 * Rate limit: 100 requests/minute.
 */
import { ClickUpConfig } from '../config';
import { TestCase, SyncState, SyncResult } from '../test-cases/types';
export declare function syncToClickUp(config: ClickUpConfig, toCreate: TestCase[], toUpdate: TestCase[], syncState: SyncState): Promise<SyncResult>;
//# sourceMappingURL=clickup.d.ts.map