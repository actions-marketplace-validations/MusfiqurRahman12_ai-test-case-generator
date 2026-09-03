# 🤖 AI Test Case Generator — GitHub Action

**Automatically generate manual test cases, sync them to your project management tool, and progressively build Playwright automation — all powered by AI.**

![GitHub Action](https://img.shields.io/badge/GitHub_Action-2088FF?logo=github-actions&logoColor=white)
![AI Powered](https://img.shields.io/badge/AI_Powered-Claude%20%7C%20Gemini%20%7C%20Groq-purple)
![Playwright](https://img.shields.io/badge/Playwright-45ba4b?logo=playwright&logoColor=white)

## ✨ Features

- 🧠 **AI-Powered Test Generation** — Uses Claude, Gemini, or Groq to analyze your code and generate comprehensive manual test cases with steps and expected results
- 🔄 **Smart Change Detection** — On code updates, AI decides whether new test cases are needed (new feature → yes, refactor → no)
- 📋 **PM Tool Sync** — Automatically creates test cases in **Jira**, **ClickUp**, or **Trello** with proper formatting, checklists, and labels
- 🎭 **Progressive Automation** — Generates Playwright test files that grow alongside your manual test suite
- 📁 **Version-Controlled** — Stores test cases as JSON (machine-readable) + Markdown (human-readable) in your repo
- 🏗️ **Framework Agnostic** — Works with any project: React, Next.js, Express, Django, Spring, Rails, Go, and more

## 🚀 Quick Start

### 1. Add the workflow to your repository

Create `.github/workflows/test-case-generator.yml`:

```yaml
name: AI Test Case Generator

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  workflow_dispatch:  # Manual trigger for first run

permissions:
  contents: write     # For auto-committing generated files
  pull-requests: write # For PR comments

jobs:
  generate-test-cases:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Required for change detection

      - name: Generate Test Cases
        uses: your-org/ai-test-case-generator@v1
        with:
          ai_provider: claude
          ai_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          pm_tool: jira
          jira_base_url: ${{ secrets.JIRA_BASE_URL }}
          jira_email: ${{ secrets.JIRA_EMAIL }}
          jira_api_token: ${{ secrets.JIRA_API_TOKEN }}
          jira_project_key: 'PROJ'
          generate_automation: true
```

### 2. Add your secrets

Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Required | Description |
|--------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes (if using Claude) | Your Anthropic API key |
| `GEMINI_API_KEY` | Yes (if using Gemini) | Your Google Gemini API key |
| `GROQ_API_KEY` | Yes (if using Groq) | Your Groq API key |
| `JIRA_BASE_URL` | If using Jira | e.g., `https://yourorg.atlassian.net` |
| `JIRA_EMAIL` | If using Jira | Your Jira account email |
| `JIRA_API_TOKEN` | If using Jira | Jira API token |
| `CLICKUP_API_TOKEN` | If using ClickUp | ClickUp API token |
| `TRELLO_API_KEY` | If using Trello | Trello API key |
| `TRELLO_API_TOKEN` | If using Trello | Trello API token |

### 3. Run it!

- **First run**: Use "Run workflow" button (workflow_dispatch) for a full scan
- **Subsequent runs**: Automatically triggers on push/PR

## 📖 Configuration

### All Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `ai_provider` | No | `claude` | AI provider: `claude`, `gemini`, `groq` |
| `ai_api_key` | **Yes** | — | API key for the selected provider |
| `ai_model` | No | Auto | Specific model override |
| `pm_tool` | No | `none` | `jira`, `clickup`, `trello`, or `none` |
| `generate_automation` | No | `true` | Generate Playwright tests |
| `max_files_per_run` | No | `50` | Cap on files analyzed (controls cost) |
| `test_output_dir` | No | `.testcases` | Where test cases are stored |
| `auto_commit` | No | `true` | Auto-commit generated files |
| `automation_output_dir` | No | `tests/e2e` | Where Playwright specs go |

### PM Tool Inputs

<details>
<summary><b>Jira</b></summary>

| Input | Description |
|-------|-------------|
| `jira_base_url` | Instance URL (e.g., `https://org.atlassian.net`) |
| `jira_email` | Account email |
| `jira_api_token` | API token from [Atlassian](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `jira_project_key` | Project key (e.g., `PROJ`) |

</details>

<details>
<summary><b>ClickUp</b></summary>

| Input | Description |
|-------|-------------|
| `clickup_api_token` | API token from ClickUp Settings |
| `clickup_list_id` | List ID where tasks will be created |

</details>

<details>
<summary><b>Trello</b></summary>

| Input | Description |
|-------|-------------|
| `trello_api_key` | API key from [Trello Power-Ups](https://trello.com/power-ups/admin) |
| `trello_api_token` | API token |
| `trello_board_id` | Board ID |
| `trello_list_id` | List ID for test case cards |

</details>

### Outputs

| Output | Description |
|--------|-------------|
| `test_cases_created` | Number of new test cases |
| `test_cases_updated` | Number of updated test cases |
| `automation_files_generated` | Number of Playwright spec files |
| `sync_status` | PM tool sync result |
| `skipped_reason` | Why the run was skipped (if applicable) |

## 🧪 Example: Generated Test Case

### Markdown (for PR review)

```markdown
### TC-auth-login-001: User Login with Valid Credentials

**Priority**: 🟠 High | **Type**: Functional | **Automation**: ⏳ Pending

#### Steps
| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to /login | Login form is displayed |
| 2 | Enter valid email | Email field populated |
| 3 | Enter valid password | Password field masked |
| 4 | Click "Sign In" | Redirected to dashboard |

#### Expected Result
User is authenticated and sees the dashboard.
```

### Playwright (automation)

```typescript
test('User Login with Valid Credentials', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();

  await page.getByLabel('Email').fill('test@example.com');
  await page.getByLabel('Password').fill('securePassword123');
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page).toHaveURL('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});
```

## 🤔 How It Decides

| Change Type | New Test Cases? | Example |
|------------|----------------|---------|
| New feature | ✅ Yes | New API endpoint, UI component |
| Bug fix | ✅ Yes (regression test) | Fix for auth bypass |
| Refactor | ❌ Usually no | Rename variables, extract function |
| Config change | ❌ No | Update ESLint rules |
| Docs | ❌ No | Update README |
| Dependency update | ⚠️ Only if breaking | Major version bump |

## 📂 Output Structure

```
.testcases/
├── README.md           # Summary with metrics
├── test-cases.json     # Machine-readable (used by automation)
├── authentication.md   # Human-readable test cases
├── user-management.md
├── payments.md
└── .sync-state.json    # PM tool sync tracking

tests/e2e/
├── authentication.spec.ts
├── user-management.spec.ts
└── payments.spec.ts

playwright.config.ts    # Auto-created if missing
```

## 💰 Cost Estimation

| Repo Size | Files Analyzed | Approx. Tokens | Claude Cost* |
|-----------|---------------|-----------------|-------------|
| Small (< 20 files) | 20 | ~50K | ~$0.30 |
| Medium (50 files) | 50 | ~150K | ~$0.90 |
| Large (100+ files) | 50 (capped) | ~200K | ~$1.20 |

*Based on Claude Sonnet pricing. Use `max_files_per_run` to control costs.*

## 📄 License

MIT
