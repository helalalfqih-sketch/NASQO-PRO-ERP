# NASQO web release: secure host-initiated pull deployment

## Overview

A successful push to `main` runs `.github/workflows/deploy-nasqo.yml` on **GitHub-hosted runners**. The workflow installs dependencies, checks the protected runtime and TypeScript, builds the frontend and runs site tests. It uploads a compressed `nsqo-release` artifact containing compiled `dist/client`, `package-lock.json`, server entry point, `Dockerfile.deploy`, and the exact commit SHA.

The host `waha-shopify-test` polls **every three minutes** using the existing Linux cron service and authenticated GitHub CLI. Only when the current main SHA has a **completed, successful push-workflow run** does it download that run's artifact. Before deploying it verifies the release commit marker matches current `main` (also rechecks after download). A host-local deployment receiver validates the archive before building and promoting a Docker container with a health check and rollback on failure.

There is **no inbound SSH connectivity needed for automated releases**. GitHub has no server private key and does not run remote shell commands.

## Host setup (already performed for this installation)

- GitHub private repository: `helalalfqih-sketch/nsqo-mobile-`.
- Host: `waha-shopify-test`; account: `chatgpt-admin`; authenticated GitHub CLI must remain authorized with access to the private repository and Actions artifacts.
- Cron daemon is active. User crontab retains its existing nightly NASQO backup, with an additional NASQO release poll:
  `*/3 * * * * /home/chatgpt-admin/apps/nsqo-mobile/poll-updates.sh >> /home/chatgpt-admin/apps/nsqo-mobile/poll-updates.log 2>&1 # NASQO_AUTO_DEPLOY`
- Persistent **host-owned** scripts are at `~/apps/nsqo-mobile/poll-updates.sh`, `receive.sh` and `deploy-current.sh`, with permissions `700`. The GitHub release artifact **does not replace** these scripts.
- Production Docker app: `nsqo-mobile-app`, bound to `127.0.0.1:18176`. No existing NASQO/WAHA production containers are replaced.
- The `production.env` file is kept on the server; do not commit secrets. Without `GEMINI_API_KEY`, the optional AI expense endpoint responds with a service-not-configured error.
- Production image uses Node **24.12** to satisfy Firebase package engine requirements.
- Deployments are only as reliable as the host's ability to reach GitHub and as the GitHub authentication; monitor `poll-updates.log` and GitHub Actions runs.

## Verify

```bash
gh run list -R helalalfqih-sketch/nsqo-mobile- --workflow deploy-nasqo.yml --limit 5
tail -n 30 ~/apps/nsqo-mobile/poll-updates.log
cat ~/apps/nsqo-mobile/current-release
docker ps --filter name=nsqo-mobile-app
curl -fsS http://127.0.0.1:18176/api/health
```

To test immediately, run `~/apps/nsqo-mobile/poll-updates.sh`; the same checks apply. To disable auto-update without stopping the app, remove only the tagged `# NASQO_AUTO_DEPLOY` line from the user crontab.

## Security and limits

- The GitHub CLI currently uses the repository owner's authorized session stored in the host user's GitHub config. This is broader than ideal; replace it with read-only GitHub access to repository metadata and Actions artifacts using a dedicated credential when practical.
- The earlier experimental inbound SSH deploy key is **not used** by this pull mechanism. Review and remove it from `~/.ssh/authorized_keys` and its corresponding private key files if no longer required.
- The host executes a reviewed local receiver, but Docker builds still consume a Dockerfile and dependencies from trusted repository commits. Restrict who can push to `main`, require code review for sensitive changes, and avoid allowing untrusted PR code to execute on the host.
- The endpoint is **local to the host**. To expose it publicly, configure a separately reviewed HTTPS reverse proxy with an explicitly chosen domain. Do not reuse another service's route without authorization.
- The web application's IndexedDB data remains in individual browsers: deploying a new frontend does not migrate, upload, or back up local accounting data.
- The `flutter_app` directory does not mean this pipeline builds Android/iOS binaries.
