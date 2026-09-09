# External bug bounty scheduler and watchdog

This dependency-free Cloudflare Worker runs outside GitHub every ten minutes.
It dispatches `bugbounty-change-monitor.yml`, checks the latest independent
cloud-health run, and sends a deduplicated Telegram failure/recovery alert.

Deployment requires a Cloudflare account and a fine-grained GitHub token with
**Actions: write** only for `Genezera/ZeroToOne`. Secrets are never committed.

1. Create a Workers KV namespace and bind it as `ALERT_STATE`.
2. Copy `wrangler.example.jsonc` to `wrangler.jsonc` and replace the KV ID.
3. Configure Worker secrets: `GITHUB_ACTIONS_TOKEN`, `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_CHAT_ID`, and a random `STATUS_TOKEN`.
4. Deploy through the Cloudflare dashboard or a current trusted Wrangler
   installation.
5. Invoke the authenticated HTTP endpoint and verify a 200 response.

Do not install Wrangler into the main project dependency graph merely for
deployment. On 2026-09-08 its current dependency tree produced High-severity
development audit findings; the Worker itself has no runtime dependencies.

