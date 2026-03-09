# jcalcada.github.io
**Demoduty Runbook for eCommerce using SRE agents from PAGERDUTY**

1. Check if the java process has the `-xms 1024` flag set
2. increase ulimit to unlimited value
3. utilize the nice command to provide higher priority to the job
4. restart the process
5. plug it in
6. Further details on it can be found in our SRE pages

## PagerDuty MCP Server Integration

This repository includes configuration for the [PagerDuty MCP Server](https://github.com/PagerDuty/pagerduty-mcp-server), which enables AI assistants (VS Code Copilot, Cursor, Claude Desktop) to interact with your PagerDuty account — managing incidents, services, schedules, and more — directly from your editor.

### Prerequisites

- [uv](https://github.com/astral-sh/uv) installed globally (`pip install uv` or see [uv docs](https://docs.astral.sh/uv/getting-started/installation/))
- A PagerDuty **User API Token**:
  1. In PagerDuty, click your profile icon → **My Profile** → **User Settings**
  2. Under **API Access**, click **Create API User Token**
  3. Copy and store the token securely — you will need it below

### VS Code Integration

The `.vscode/mcp.json` file in this repository pre-configures the PagerDuty MCP server for VS Code.

1. Open VS Code settings and ensure **MCP** is enabled: **Features → Chat → Mcp: Enabled**
2. Open the Chat view (**View → Chat**) and select **Agent** mode
3. VS Code will prompt you for your PagerDuty User API Key the first time the server starts
4. Ask questions like:
   - `Show me the latest PagerDuty incident`
   - `List my on-call schedules`
   - `Create a new incident for the checkout service`

### Cursor Integration

Add the following to your Cursor `settings.json` (**Cursor Settings → Tools → Add MCP**):

```json
{
  "mcpServers": {
    "pagerduty-mcp": {
      "type": "stdio",
      "command": "uvx",
      "args": ["pagerduty-mcp", "--enable-write-tools"],
      "env": {
        "PAGERDUTY_USER_API_KEY": "<your-pagerduty-user-api-key>"
      }
    }
  }
}
```

### Claude Desktop Integration

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "pagerduty-mcp": {
      "command": "uvx",
      "args": ["pagerduty-mcp", "--enable-write-tools"],
      "env": {
        "PAGERDUTY_USER_API_KEY": "<your-pagerduty-user-api-key>",
        "PAGERDUTY_API_HOST": "https://api.pagerduty.com"
      }
    }
  }
}
```

Restart Claude Desktop and test with: `Show me my latest PagerDuty incidents`

> **Note:** For EU PagerDuty accounts, set `PAGERDUTY_API_HOST` to `https://api.eu.pagerduty.com`.
