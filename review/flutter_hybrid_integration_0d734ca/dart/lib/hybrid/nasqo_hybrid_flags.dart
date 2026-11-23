import 'package:flutter/foundation.dart';

/// Feature flag controller for the experimental NASQO PRO React Hybrid V2
/// integration branch (`integration/hybrid-seven-20261121` @ `0d734ca`).
///
/// Confirmed rollout behavior:
/// - **Debug APK (`kDebugMode == true`)**: runs the current React UI by default
///   (`NASQO_REACT_HYBRID_V2` defaults to `kDebugMode`) with local SQLite writes
///   enabled (`NASQO_REACT_HYBRID_ALLOW_WRITES` defaults to `kDebugMode`), paired
///   with a one-tap runtime fallback button to return to the previous `0d734ca` UI.
/// - **Release / Profile builds (`kDebugMode == false`)**: keeps the existing
///   `0d734ca` Hybrid UI active (`false`) and financial writes gated (`false`)
///   so production and `main` are never affected unintentionally.
/// - **Explicit kill-switch in Debug**: pass
///   `--dart-define=NASQO_REACT_HYBRID_V2=false` or
///   `--dart-define=NASQO_REACT_HYBRID_ALLOW_WRITES=false` at build time.
class NasqoHybridFlags {
  NasqoHybridFlags._();

  static const bool defaultUseReactHybridV2 = bool.fromEnvironment(
    'NASQO_REACT_HYBRID_V2',
    defaultValue: kDebugMode,
  );

  static const bool defaultAllowFinancialWrites = bool.fromEnvironment(
    'NASQO_REACT_HYBRID_ALLOW_WRITES',
    defaultValue: kDebugMode,
  );

  /// `true`  = current React Hybrid V2 offline bundle (default in Debug APK).
  /// `false` = previous stable `0d734ca` Hybrid / Flutter UI (fallback / Release default).
  static final ValueNotifier<bool> useReactHybridV2 =
      ValueNotifier<bool>(defaultUseReactHybridV2);

  /// Independent Dart-side write authorization gate. Never controlled by JS.
  static final ValueNotifier<bool> allowFinancialWrites =
      ValueNotifier<bool>(defaultAllowFinancialWrites);

  static void setUseReactHybridV2(bool enabled) {
    useReactHybridV2.value = enabled;
  }

  static void setAllowFinancialWrites(bool allowed) {
    allowFinancialWrites.value = allowed;
  }
}
