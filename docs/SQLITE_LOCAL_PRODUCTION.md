# NASQO PRO — empty single-database SQLite deployment

This is a NEW, initially empty NASQO installation. **Do not upload or import an old
SmartPro backup unless the operator explicitly chooses Restore.** The legacy
MariaDB SmartPro API can remain in the repository but is disabled by default and
is not the accounting store in this mode.

## Data model and startup

The single active SQLite file is `data/nasqo.sqlite` for native local development.
Its tables and indexes are created on first startup; **no sample business
accounts, invoices, products, inventory or payroll records are seeded.**

On Windows/macOS desktop development, launch NASQO with `npm run dev`; the
server uses the local file. To select another file on the same computer, set
`NASQO_SQLITE_PATH` to an absolute path. Keep it private.

For the independent Docker deployment, this repository provides
`docker-compose.sqlite.yml`. It listens on **127.0.0.1:18177** (not a public
listener), uses a named persistent volume mounted at `/app/data`, and stores
one active DB at `/app/data/nasqo.sqlite`. It does **not** change the current
`nsqo-mobile-app` container or its database.

1. Build the client with `npm ci && npm run build` from a trusted checkout.
2. Create an **untracked** `.env` alongside the compose file containing:
   `NASQO_SQLITE_ADMIN_PASSWORD` (12+ characters) and
   `NASQO_SQLITE_SESSION_SECRET` (independent random string, 32+ characters).
   Do not commit passwords to GitHub.
3. Run `docker compose -f docker-compose.sqlite.yml up -d --build`.
4. Open `http://127.0.0.1:18177/` from the host. It uses local direct access.
   When accessed via a reverse proxy, NASQO requires the admin password.
5. For an HTTPS proxy, set `NASQO_SQLITE_PUBLIC_ORIGIN` to its exact origin
   (e.g. `https://erp.example.com`) and set `NASQO_SQLITE_SECURE_COOKIE=1`.
   Require TLS; do not publish a password-login endpoint over HTTP.

Do **not** run the old generic `deploy-current.sh` for this SQLite mode: its
Docker run command does not mount the SQLite volume. In production the new
server refuses to boot without an explicit absolute SQLite path on a separate
mounted volume. Its health check must not be accepted if SQLite initialization
fails.

## Access and deletion

Only loopback requests with a loopback Host use passwordless local mode.
Remote access requires a configured password and signed HttpOnly SameSite
session cookie. All `/api/db` routes are guarded server-side. Destructive
requests use same-origin verification.

The `تفريغ القاعدة` action needs explicit typed confirmation. In production
it is also disabled unless `NASQO_SQLITE_ALLOW_RESET=1` is intentionally set
**after** an independent verified backup.

## Backup and data safety

A backup is a **separate archival copy**, not a second active operational DB.
Use the in-app export, or execute inside the compose container:

```sh
docker compose -f docker-compose.sqlite.yml exec nasqo-sqlite \
  node scripts/backup-sqlite.mjs /app/data/backups/nasqo-2026-11-18.sqlite
```

The script uses SQLite's online backup API and verifies `PRAGMA integrity_check`,
refusing to overwrite an existing file. The example filename is illustrative:
choose a unique name. **Copy the resulting backup off the Docker volume** to
separate media; a volume failure could otherwise destroy both the active DB
and its same-volume backups. Restores should be tested in a separate temporary
container before replacing the active database, with users offline.

Never put `data/`, backups, encryption keys or `.env` files into public
assets or GitHub. Do not set `NASQO_AUTO_BOOTSTRAP_SQL=1` in an empty-install
deployment. The compose file explicitly disables automatic legacy imports.

## Verification before customer rollout

Run `npm run check:runtime`, `npm run lint`,
`npx tsc -p tsconfig.server.json --noEmit`,
`npx tsx --test tests/unified-sqlite.test.ts`, and
`node --test tests/sqlite-local-production.test.mjs`.
The latter verifies zero initial business rows, protected remote endpoints,
new account persistence across server restarts, and backup integrity.
CI additionally runs browser and Docker image smoke tests.

The SQLite migration's functional modules should be acceptance-tested with
NEW test records for invoices, account balances, stock transfers and returns.
No original user backup is required to start the system.
