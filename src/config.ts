/**
 * Configuration parsing and validation.
 *
 * Reads GitHub Action inputs, validates required conditional fields
 * (e.g., Jira URL is required when pm_tool=jira), and produces a
 * typed Config object consumed by every module.
 */

import * as core from '@actions/core';

// ---------------------------------------------------------------------------
// Config Types
// ---------------------------------------------------------------------------

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
  // AI
  aiProvider: AIProviderType;
  aiApiKey: string;
  aiModel: string;

  // PM Tool
  pmTool: PMToolType;
  jira?: JiraConfig;
  clickup?: ClickUpConfig;
  trello?: TrelloConfig;

  // Test Generation
  generateAutomation: boolean;
  maxFilesPerRun: number;
  testOutputDir: string;
  autoCommit: boolean;
  automationOutputDir: string;
}

// ---------------------------------------------------------------------------
// Default Models
// ---------------------------------------------------------------------------

const DEFAULT_MODELS: Record<AIProviderType, string> = {
  claude: 'claude-sonnet-4-20250514',
  gemini: 'gemini-3.6-flash',
  groq: 'llama-3.3-70b-versatile',
};

// ---------------------------------------------------------------------------
// Parsing & Validation
// ---------------------------------------------------------------------------

export function parseConfig(): Config {
  // AI Provider
  const aiProvider = (core.getInput('ai_provider') || 'claude') as AIProviderType;
  if (!['claude', 'gemini', 'groq'].includes(aiProvider)) {
    throw new Error(`Invalid ai_provider "${aiProvider}". Must be claude, gemini, or groq.`);
  }

  const aiApiKey = core.getInput('ai_api_key', { required: true });
  if (!aiApiKey) {
    throw new Error('ai_api_key is required.');
  }

  const aiModel = core.getInput('ai_model') || DEFAULT_MODELS[aiProvider];

  // PM Tool
  const pmTool = (core.getInput('pm_tool') || 'none') as PMToolType;
  if (!['jira', 'clickup', 'trello', 'none'].includes(pmTool)) {
    throw new Error(`Invalid pm_tool "${pmTool}". Must be jira, clickup, trello, or none.`);
  }

  // Jira
  let jira: JiraConfig | undefined;
  if (pmTool === 'jira') {
    const baseUrl = core.getInput('jira_base_url');
    const email = core.getInput('jira_email');
    const apiToken = core.getInput('jira_api_token');
    const projectKey = core.getInput('jira_project_key');

    if (!baseUrl || !email || !apiToken || !projectKey) {
      throw new Error(
        'When pm_tool=jira, jira_base_url, jira_email, jira_api_token, and jira_project_key are all required.'
      );
    }

    jira = { baseUrl: baseUrl.replace(/\/+$/, ''), email, apiToken, projectKey };
  }

  // ClickUp
  let clickup: ClickUpConfig | undefined;
  if (pmTool === 'clickup') {
    const apiToken = core.getInput('clickup_api_token');
    const listId = core.getInput('clickup_list_id');

    if (!apiToken || !listId) {
      throw new Error('When pm_tool=clickup, clickup_api_token and clickup_list_id are required.');
    }

    clickup = { apiToken, listId };
  }

  // Trello
  let trello: TrelloConfig | undefined;
  if (pmTool === 'trello') {
    const apiKey = core.getInput('trello_api_key');
    const apiToken = core.getInput('trello_api_token');
    const boardId = core.getInput('trello_board_id');
    const listId = core.getInput('trello_list_id');

    if (!apiKey || !apiToken || !boardId || !listId) {
      throw new Error(
        'When pm_tool=trello, trello_api_key, trello_api_token, trello_board_id, and trello_list_id are required.'
      );
    }

    trello = { apiKey, apiToken, boardId, listId };
  }

  // Test Generation Options
  const generateAutomation = core.getInput('generate_automation') !== 'false';
  const maxFilesPerRun = parseInt(core.getInput('max_files_per_run') || '50', 10);
  const testOutputDir = core.getInput('test_output_dir') || '.testcases';
  const autoCommit = core.getInput('auto_commit') !== 'false';
  const automationOutputDir = core.getInput('automation_output_dir') || 'tests/e2e';

  if (isNaN(maxFilesPerRun) || maxFilesPerRun < 1) {
    throw new Error('max_files_per_run must be a positive integer.');
  }

  const config: Config = {
    aiProvider,
    aiApiKey,
    aiModel,
    pmTool,
    jira,
    clickup,
    trello,
    generateAutomation,
    maxFilesPerRun,
    testOutputDir,
    autoCommit,
    automationOutputDir,
  };

  // Mask sensitive inputs so they don't appear in logs
  core.setSecret(aiApiKey);
  if (jira?.apiToken) core.setSecret(jira.apiToken);
  if (clickup?.apiToken) core.setSecret(clickup.apiToken);
  if (trello?.apiToken) core.setSecret(trello.apiToken);
  if (trello?.apiKey) core.setSecret(trello.apiKey);

  return config;
}
