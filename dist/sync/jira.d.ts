/**
 * Jira Sync Client — creates and updates issues in Jira.
 *
 * Uses Jira REST API v3 with Basic Auth (email + API token).
 * Creates Story/Task issues with test steps formatted in the description
 * using Atlassian Document Format (ADF).
 */
import { JiraConfig } from '../config';
import { TestCase, SyncState, SyncResult } from '../test-cases/types';
export declare function syncToJira(config: JiraConfig, toCreate: TestCase[], toUpdate: TestCase[], syncState: SyncState): Promise<SyncResult>;
//# sourceMappingURL=jira.d.ts.map