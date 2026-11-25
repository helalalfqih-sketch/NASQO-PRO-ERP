#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../flutter_app"
# ERP-001-RET-LATE remains explicitly deferred by the user. These two suites
# require a private source backup and must not run against production files in CI.
mapfile -t cases < <(find test -name '*_test.dart' ! -name stock_invoice_commands_test.dart ! -name legacy_actual_file_acceptance_test.dart ! -name legacy_existing_file_fidelity_test.dart | sort)
flutter test --reporter expanded "${cases[@]}"
