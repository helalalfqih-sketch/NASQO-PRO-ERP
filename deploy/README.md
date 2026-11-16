# NASQO mobile web auto-deployment to waha-shopify-test

## Verified baseline (2026-11-16)

- GitHub Actions build/test on pull requests passes.
- Host: `waha-shopify-test` at `185.197.31.233`; SSH ed25519 host-key fingerprint `SHA256:gU9FVPp0sH8VF+xYbX3CsInMYRDzQUROH7/G6Vmt3Ck` was checked against the server itself.
- The app gets a separate Docker container `nsqo-mobile-app` on **127.0.0.1:18176**, leaving existing NASQO/WAHA services untouched.
- Server-side code (already staged) lives in `/home/chatgpt-admin/apps/nsqo-mobile/receive.sh` and `deploy-current.sh`. Those scripts are **not** pulled from the release artifact; only reviewed host-side code executes deployment.
- An SSH deployment key pair is staged at `/home/chatgpt-admin/.config/nsqo-deploy/id_ed25519[.pub]`. The private key must not be committed or pasted into chats.
- **This is NOT live until Actions secrets are configured, the dedicated key is restricted, this PR is merged, and the workflow's deploy job succeeds.**

## Critical security setup

On the server's `chatgpt-admin` account, the deploy key's entry in `~/.ssh/authorized_keys` must use an SSH forced command and forwarding restrictions:

```
restrict,command="bash /home/chatgpt-admin/apps/nsqo-mobile/receive.sh" ssh-ed25519 <base64-deploy-public-key> nasqo-gh-actions-2026-11
```

Replace the existing unprefixed entry for that same public key; **do not** keep both. Keep unrelated SSH keys unchanged. Confirm the forced command actually receives the release stream and arbitrary SSH commands are denied. This host user is a member of the Docker group, which is sensitive and effectively host-privileged; a dedicated minimally privileged deployment account or a rootless container runtime is recommended as a follow-up hardening step.

## GitHub Actions secrets

Set repository secrets for `helalalfqih-sketch/nsqo-mobile-`:

| Secret | Value |
| --- | --- |
| `NASQO_DEPLOY_HOST` | `185.197.31.233` |
| `NASQO_DEPLOY_USER` | `chatgpt-admin` (until an isolated deploy account is ready) |
| `NASQO_DEPLOY_SSH_KEY` | contents of server's `~/.config/nsqo-deploy/id_ed25519` |
| `NASQO_DEPLOY_KNOWN_HOSTS` | verified public-host line from server's `~/.config/nsqo-deploy/known_hosts` |

Use GitHub **Settings → Secrets and variables → Actions → New repository secret**, or authenticate `gh` temporarily on the server and run `gh secret set -R helalalfqih-sketch/nsqo-mobile- NAME < file` for file-valued secrets. Do not print the private key. Log out from `gh` on the server after uploading secrets if it was used only for setup.

## Deployment

After setup, merge the reviewed pull request into `main`. A push to `main` runs Node 24.12 build checks and tests. GitHub Actions creates a compressed release with a pinned `package-lock.json` and version marker, then streams it over the SSH key. The forced SSH command runs a fixed host receiver which rejects unsafe archives and deploys the release using Docker after a health check. The old container is restored if the live health check fails.

Verify **on server**:

```bash
curl -fsS http://127.0.0.1:18176/api/health
docker ps --filter name=nsqo-mobile-app
```

A result such as `{"ok":true,"service":"nasqo-pro-api"}` confirms the web server responds. The application is deliberately **not publicly exposed** until a separate reviewed HTTPS reverse proxy route/domain is configured. Never point an unrelated production route to it by default.

The app is local-first: browser IndexedDB holds ERP data; this deployment must not be described as migrating, synchronizing, or backing up user financial records.

This deploys the web interface, not Flutter Android/iOS binaries.
