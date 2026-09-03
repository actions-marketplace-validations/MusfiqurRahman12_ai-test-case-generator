/**
 * Configuration parsing and validation.
 *
 * Reads GitHub Action inputs, validates required conditional fields
 * (e.g., Jira URL is required when pm_tool=jira), and produces a
 * typed Config object consumed by every module.
 */
export type AIProviderType = 'claude' | 'gemini' | 'groq';
export type PMToolType = 'jira' | 'clickup' | 'trello' | 'none';
export interface JiraConfig {
    baseUrl: string;
    email: string;
    apiToken: string;
    projectKey: string;
}
export interface ClickUpConfig {
    apiToken: string;
    listId: string;
}
export interface TrelloConfig {
    apiKey: string;
    apiToken: string;
    boardId: string;
    listId: string;
}
export interface Config {
    aiProvider: AIProviderType;
    aiApiKey: string;
    aiModel: string;
    pmTool: PMToolType;
    jira?: JiraConfig;
    clickup?: ClickUpConfig;
    trello?: TrelloConfig;
    generateAutomation: boolean;
    maxFilesPerRun: number;
    testOutputDir: string;
    autoCommit: boolean;
    automationOutputDir: string;
}
export declare function parseConfig(): Config;
