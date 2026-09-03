/**
 * Trello Sync Client — creates and updates cards in Trello.
 *
 * Uses the Trello REST API to create cards with checklists for test steps.
 * All requests require API key + token as query parameters.
 */
import { TrelloConfig } from '../config';
import { TestCase, SyncState, SyncResult } from '../test-cases/types';
export declare function syncToTrello(config: TrelloConfig, toCreate: TestCase[], toUpdate: TestCase[], syncState: SyncState): Promise<SyncResult>;
//# sourceMappingURL=trello.d.ts.map