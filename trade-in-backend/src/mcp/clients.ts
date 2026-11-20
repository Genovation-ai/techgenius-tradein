/**
 * How to connect each AI tool, as data: one place feeds the public setup page
 * (GET /mcp in a browser, /connect) and the JSON the admin panel reads to
 * generate configs with a real key.
 *
 * `{{URL}}`, `{{SSE}}` and `{{KEY}}` are filled in by whoever renders it.
 */
export interface ClientGuide {
  id: string;
  name: string;
  /** "signin": OAuth, no key. "key": paste an API key. */
  auth: "signin" | "key" | "either";
  steps: string[];
  /** Config text to paste, if the tool uses one. */
  config?: { file?: string; language: "json" | "toml" | "shell" | "text"; body: string };
}

const jsonBlock = (o: unknown) => JSON.stringify(o, null, 2);
const HDR = { "x-api-key": "{{KEY}}" };

export const CLIENT_GUIDES: ClientGuide[] = [
  {
    id: "claude-ai",
    name: "Claude (claude.ai, desktop and mobile apps)",
    auth: "signin",
    steps: [
      "Open Settings → Connectors → Add custom connector.",
      "Name it Gadget Swap and paste the server URL: {{URL}}",
      "Click Connect, sign in with your Gadget Swap staff login, and choose what Claude may do.",
    ],
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    auth: "signin",
    steps: [
      "In ChatGPT settings, open Connectors (called Apps in some versions) and turn on Developer mode under Advanced.",
      "Create a connector, paste the server URL {{URL}} and choose OAuth for authentication.",
      "Sign in with your Gadget Swap staff login when asked.",
    ],
  },
  {
    id: "claude-code",
    name: "Claude Code",
    auth: "either",
    steps: [
      "Run the command below. Without the --header part, Claude Code opens the Gadget Swap sign-in instead (run /mcp to sign in).",
    ],
    config: { language: "shell", body: 'claude mcp add --transport http gadget-swap {{URL}} --header "x-api-key: {{KEY}}"' },
  },
  {
    id: "cursor",
    name: "Cursor",
    auth: "either",
    steps: ["Use the one-click install in Gadget Swap admin, or add this to ~/.cursor/mcp.json and reload Cursor."],
    config: { file: "~/.cursor/mcp.json", language: "json", body: jsonBlock({ mcpServers: { "gadget-swap": { url: "{{URL}}", headers: HDR } } }) },
  },
  {
    id: "vscode",
    name: "VS Code (GitHub Copilot agent mode)",
    auth: "either",
    steps: ["Use the one-click install in Gadget Swap admin, or add this to .vscode/mcp.json (or your user MCP settings)."],
    config: {
      file: ".vscode/mcp.json",
      language: "json",
      body: jsonBlock({ servers: { "gadget-swap": { type: "http", url: "{{URL}}", headers: HDR } } }),
    },
  },
  {
    id: "windsurf",
    name: "Windsurf",
    auth: "key",
    steps: ["Add this to ~/.codeium/windsurf/mcp_config.json, then refresh MCP servers."],
    config: {
      file: "~/.codeium/windsurf/mcp_config.json",
      language: "json",
      body: jsonBlock({ mcpServers: { "gadget-swap": { serverUrl: "{{URL}}", headers: HDR } } }),
    },
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    auth: "key",
    steps: ["Add this to ~/.gemini/settings.json."],
    config: {
      file: "~/.gemini/settings.json",
      language: "json",
      body: jsonBlock({ mcpServers: { "gadget-swap": { httpUrl: "{{URL}}", headers: HDR } } }),
    },
  },
  {
    id: "claude-desktop-config",
    name: "Claude Desktop (config file, with a key)",
    auth: "key",
    steps: [
      "Prefer Settings → Connectors (sign-in, no key). If you need a key instead, Claude Desktop's config file only runs local programs, so use the mcp-remote bridge (needs Node.js).",
      "Settings → Developer → Edit Config, add this, and restart Claude Desktop.",
    ],
    config: {
      file: "claude_desktop_config.json",
      language: "json",
      body: jsonBlock({
        mcpServers: {
          "gadget-swap": { command: "npx", args: ["-y", "mcp-remote", "{{URL}}", "--header", "x-api-key:${GADGETSWAP_KEY}"], env: { GADGETSWAP_KEY: "{{KEY}}" } },
        },
      }),
    },
  },
  {
    id: "codex",
    name: "OpenAI Codex CLI",
    auth: "key",
    steps: ["Add this to ~/.codex/config.toml (uses the mcp-remote bridge; needs Node.js)."],
    config: {
      file: "~/.codex/config.toml",
      language: "toml",
      body: '[mcp_servers.gadget-swap]\ncommand = "npx"\nargs = ["-y", "mcp-remote", "{{URL}}", "--header", "x-api-key:{{KEY}}"]',
    },
  },
  {
    id: "n8n",
    name: "n8n (MCP Client node)",
    auth: "key",
    steps: [
      "Endpoint: {{URL}} · Server transport: HTTP Streamable (or SSE with {{SSE}} on older versions).",
      "Authentication: Header Auth — name x-api-key, value your key.",
    ],
  },
  {
    id: "other",
    name: "Any other MCP tool",
    auth: "either",
    steps: [
      "Streamable HTTP: {{URL}} — send the key as header x-api-key, or Authorization: Bearer <key>. Tools that support OAuth can sign in instead.",
      "Older tools that only speak SSE: {{SSE}} with the same header.",
      "Tools that only run local programs: npx -y mcp-remote {{URL}} --header x-api-key:<key>",
    ],
  },
];

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The public setup page shown when someone opens the MCP URL in a browser. */
export function renderConnectPage(mcpUrl: string, sseUrl: string, adminUrl: string): string {
  const fill = (s: string) => s.replace(/\{\{URL\}\}/g, mcpUrl).replace(/\{\{SSE\}\}/g, sseUrl).replace(/\{\{KEY\}\}/g, "YOUR_API_KEY");
  const badge = (a: ClientGuide["auth"]) =>
    a === "signin" ? "Sign in — no key" : a === "key" ? "API key" : "Sign in or API key";
  const cards = CLIENT_GUIDES.map(
    (c) => `<details${c.id === "claude-ai" ? " open" : ""}><summary><strong>${esc(c.name)}</strong> <span class="b">${badge(c.auth)}</span></summary>
<ol>${c.steps.map((s) => `<li>${esc(fill(s))}</li>`).join("")}</ol>
${c.config ? `${c.config.file ? `<p class="f">${esc(c.config.file)}</p>` : ""}<pre>${esc(fill(c.config.body))}</pre>` : ""}
</details>`,
  ).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Connect an AI assistant · Gadget Swap</title>
<style>
:root{--fg:#111827;--mu:#6b7280;--ln:#e5e7eb;--bg:#fff;--card:#f9fafb;--br:#0B3D2E}
@media (prefers-color-scheme:dark){:root{--fg:#f3f4f6;--mu:#9ca3af;--ln:#374151;--bg:#0b0f14;--card:#111827;--br:#34d399}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:28px 16px 48px}h1{font-size:1.4rem;margin:0 0 6px}p{color:var(--mu);margin:0 0 12px}
.url{display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:var(--card);border:1px solid var(--ln);border-radius:12px;padding:12px;margin:14px 0 22px}
.url code{font-size:1rem;word-break:break-all;flex:1;color:var(--fg)}
details{border:1px solid var(--ln);border-radius:12px;padding:10px 14px;margin:10px 0;background:var(--card)}summary{cursor:pointer}
.b{font-size:.75rem;color:var(--br);margin-left:6px}ol{margin:10px 0;padding-left:20px}pre{overflow:auto;background:var(--bg);border:1px solid var(--ln);border-radius:8px;padding:10px;font-size:.82rem;color:var(--fg)}
.f{font-size:.8rem;margin:6px 0 2px}a{color:var(--br)}
</style></head><body><main>
<h1>Connect an AI assistant to Gadget Swap</h1>
<p>This is the Gadget Swap MCP server. Point any MCP-capable AI tool at the address below.</p>
<div class="url"><code>${esc(mcpUrl)}</code></div>
<p><strong>Sign in</strong> works in claude.ai, ChatGPT, Claude Code, Cursor and VS Code — no key needed. For other tools, create an
<strong>API key</strong> in <a href="${esc(adminUrl)}">Gadget Swap admin → Settings → API keys &amp; AI assistants</a>, where you can also copy a
ready-made config with your key filled in. Every key and sign-in has its own access level and can be revoked there.</p>
${cards}
</main></body></html>`;
}
