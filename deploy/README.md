# Deployment of NASQO mobile web to waha-shopify-test

This repository is private. GitHub Actions checks out and builds the source, then transfers the compiled release over SSH to the server. The server **does not** require a GitHub personal access token.

## First-time setup

1. Set GitHub Actions repository secrets:
   - `NASQO_DEPLOY_HOST`: server hostname or IP that the runner can reach
   - `NASQO_DEPLOY_USER`: a dedicated, non-root SSH deployment user, with Docker permissions
   - `NASQO_DEPLOY_SSH_KEY`: the private key for that dedicated deploy account (never commit it)
   - `NASQO_DEPLOY_KNOWN_HOSTS`: verified SSH host-key line, obtained from a trusted source rather than blindly trusting ssh-keyscan output
2. Install the matching public key in the deploy user's `authorized_keys`. Restrict its permissions, and make sure Docker and Node deployment permissions are appropriate.
3. Ensure the deploy user has Docker access. Docker group grants broad host-level privileges, so use an isolated account and consider a rootless Docker installation where practical.
4. Optionally create `~/apps/nsqo-mobile/production.env` on the server, mode 600, containing `GEMINI_API_KEY=...`. Never commit secrets. If absent, the deploy script creates an empty env file (AI expense categorization returns 503).
5. Merge the deployment workflow and push to `main`, or run the workflow manually. The deployment checks source/runtime, TypeScript, build, and site worker tests before transfer.
6. On the host, verify `curl -fsS http://127.0.0.1:18176/api/health`. Traffic is deliberately bound to localhost only. Add a separately reviewed reverse-proxy route and HTTPS domain before making it public.

## Deployment behavior

- Separate image and container name `nsqo-mobile-app` (the existing `nasqo-pro-mobile-web`, `nasqo-pro-mobile-erp` and WAHA services are not touched).
- Releases at `~/apps/nsqo-mobile/releases/<sha>`.
- Builds a Docker runtime image, tests a candidate instance, and promotes it to port 18176.
- On a failed production health check, it attempts to restore the previous container.
- Protected runtime files are only read, not edited.
- This serves the **web app**. Flutter APK/iOS packaging is not performed.
- The app's local-first IndexedDB data lives in browsers, not the Docker container; deployments do not migrate or back up user browser data.
- An initial deploy cannot happen until the four SSH secrets and authorized key are configured and the workflow is merged. A successful build alone is not a successful deployment.

## Updating from ChatGPT

When ChatGPT edits and commits source in this GitHub repository, merging into `main` triggers this workflow. Deployment status should be checked in GitHub Actions and verified with the health endpoint before claiming success. The assistant cannot silently push updates after the conversation without an automation or an external workflow trigger.
