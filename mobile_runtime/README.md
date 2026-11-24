# Original web engine, offline Android integration

This branch starts from the exact original web source at 8bb37903967bd46035426cef6becf042cf51eaf0. The original src/ and server/ trees are unchanged. The transport-only host calls the original mountSqliteApi, including original importers, account balances, documents, inventory, ERP and reports. It binds only to 127.0.0.1, requires a 256-bit app-local session cookie, and uses a separate persistent SQLite database. No cloud services are started and no private accounting files are packaged.

## Host acceptance (Node 24)

Run in a private checkout, with the original project's dependencies installed:

    npm ci --no-audit --no-fund
    npm run check:runtime
    node mobile_runtime/acceptance.mjs

For the user's private legacy backup already on their own machine:

    NASQO_PRIVATE_LEGACY_BACKUP="$HOME/private-backups/backup_2026.11.08_03.49.26.back" node mobile_runtime/acceptance.mjs

The acceptance runner uses a temporary DB, original API routes, restart and export checks. It never sends source contents to a server outside loopback and never modifies the original file. Do not run the private-file test in shared CI, or add the backup to Git.

The Android target requires a reviewed full Node 24 Android SDK that actually provides node:sqlite (including backup and isTransaction). Do not substitute a Node 18 mobile binary or a lite SDK. The original frontend is not the existing hybrid service adapter, which has different domain behavior. Android runtime packaging, browser-native file output, Google native identity and physical-device tests must be completed before claiming an installable replacement. This branch does not publish a signed update or migrate the current Android app's database.
