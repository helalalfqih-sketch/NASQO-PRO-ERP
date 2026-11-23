import 'dart:convert';
import 'erp_hybrid_adapter.dart';
import 'hybrid_protocol.dart';

typedef HybridNativeActionCallback = Future<Map<String, Object?>?> Function(
  String action,
  Map<String, Object?> payload,
);

/// Callback invoked for legacy `0d734ca` `NasqoHome` messages that do NOT carry
/// `protocolVersion: "1.0.0"`. Guarantees zero regressions in the existing bridge.
typedef LegacyNasqoHomeHandler = Future<String?> Function(String rawMessage);

/// Compatibility router for the existing `NasqoHome` WebViewCompat channel.
///
/// - Legacy messages (from commit 0d734ca) pass untouched to [legacyHandler].
/// - v1.0.0 React Hybrid envelopes pass through independent Dart validation,
///   allowlist checks, [allowFinancialWrites] gating, and [ErpHybridAdapter]
///   (backed by `ErpController` + `LocalDatabase` + `PostingReceiptGuard`).
class HybridBridgeRouter {
  HybridBridgeRouter({
    required this.adapter,
    required this.allowFinancialWrites,
    this.legacyHandler,
    this.onNavigate,
    this.onGoBack,
    this.onShowMessage,
    this.onThemeModeChanged,
    this.onNativeServiceAction,
    this.onSnapshotUpdated,
  });

  final ErpHybridAdapter adapter;
  final bool Function() allowFinancialWrites;
  final LegacyNasqoHomeHandler? legacyHandler;
  final void Function(String route, Map<String, Object?> params)? onNavigate;
  final void Function(String? currentRoute, int? stackDepth)? onGoBack;
  final void Function(String message, String level)? onShowMessage;
  final void Function(String themeMode)? onThemeModeChanged;
  final HybridNativeActionCallback? onNativeServiceAction;
  final void Function(Map<String, Object?> snapshot)? onSnapshotUpdated;

  /// Routes an inbound message from `NasqoHome`.
  /// Returns a JSON response string, or `null` if [legacyHandler] handled it silently.
  Future<String?> handleRawMessage(String rawJson) async {
    if (!isReactHybridV1RawMessage(rawJson) && legacyHandler != null) {
      return legacyHandler!(rawJson);
    }

    String fallbackRequestId = 'unknown';
    String? fallbackAction;

    try {
      final dynamic preview = jsonDecode(rawJson);
      if (preview is Map) {
        if (preview['requestId'] is String) {
          fallbackRequestId = preview['requestId'] as String;
        }
        if (preview['action'] is String) {
          fallbackAction = preview['action'] as String;
        }
      }
    } catch (_) {}

    try {
      final request = HybridRequestEnvelope.parse(rawJson);
      final data = await dispatch(request);
      return HybridResponseEnvelope.success(
        requestId: request.requestId,
        action: request.action,
        data: data,
      ).toJsonString();
    } on HybridBridgeException catch (e) {
      return HybridResponseEnvelope.failure(
        requestId: fallbackRequestId,
        action: fallbackAction,
        error: e,
      ).toJsonString();
    } catch (e) {
      return HybridResponseEnvelope.failure(
        requestId: fallbackRequestId,
        action: fallbackAction,
        error: HybridBridgeException(
          'INTERNAL_ERROR',
          'تعذر تنفيذ الأمر عبر جسر Flutter: $e',
        ),
      ).toJsonString();
    }
  }

  Future<Object?> dispatch(HybridRequestEnvelope request) async {
    final writesAllowed = allowFinancialWrites();

    if (kHybridFinancialMutationCommands.contains(request.action) &&
        !writesAllowed) {
      throw const HybridBridgeException(
        'UNAUTHORIZED_ACTION',
        'الترحيل المالي مغلق حاليًا في Flutter (NASQO_REACT_HYBRID_ALLOW_WRITES=false).',
      );
    }

    final payload = request.payload;

    switch (request.action) {
      case 'getSnapshot':
        return adapter.getSnapshot(allowFinancialWrites: writesAllowed);

      case 'navigate':
        final route = (payload['route'] as String? ?? '/').trim();
        final rawParams = payload['params'];
        final params = rawParams is Map
            ? rawParams.map((k, v) => MapEntry(k.toString(), v))
            : <String, Object?>{};
        onNavigate?.call(route, params);
        return <String, Object?>{'navigated': true, 'route': route};

      case 'goBack':
        onGoBack?.call(
          payload['currentRoute'] as String?,
          (payload['stackDepth'] as num?)?.toInt(),
        );
        return <String, Object?>{'handled': true};

      case 'changeCurrency':
        return adapter.changeCurrency((payload['currency'] as String? ?? '').trim());

      case 'saveUiPreferences':
        final rawPrefs = payload['preferences'];
        if (rawPrefs is! Map) {
          throw const HybridBridgeException(
            'VALIDATION_ERROR',
            'تفضيلات الواجهة يجب أن تكون كائنًا.',
          );
        }
        final prefs = rawPrefs.map((k, v) => MapEntry(k.toString(), v));
        final themeMode = prefs['themeMode'];
        if (themeMode is String && themeMode.isNotEmpty) {
          onThemeModeChanged?.call(themeMode);
        }
        return adapter.saveUiPreferences(prefs);

      case 'openInvoice':
      case 'openVoucher':
      case 'openAccountStatement':
        return <String, Object?>{'opened': true, 'action': request.action};

      case 'showMessage':
        final msg = (payload['message'] as String? ?? '').trim();
        final level = (payload['level'] as String? ?? 'info').trim();
        if (msg.isNotEmpty) onShowMessage?.call(msg, level);
        return <String, Object?>{'shown': true};

      case 'printDocument':
      case 'exportPdf':
      case 'pickFile':
      case 'googleDriveAction':
        if (onNativeServiceAction != null) {
          final custom = await onNativeServiceAction!(request.action, payload);
          if (custom != null) return custom;
        }
        if (request.action == 'pickFile') {
          return const <String, Object?>{
            'cancelled': true,
            'fileName': '',
            'mimeType': 'application/octet-stream',
            'sizeBytes': 0,
            'base64Content': '',
          };
        }
        if (request.action == 'googleDriveAction') {
          return const <String, Object?>{
            'connected': false,
            'offlineOnly': true,
          };
        }
        return <String, Object?>{'queued': true, 'action': request.action};

      case 'saveWorkspaceSettings':
        final rawUpdates = payload['updates'];
        final updates = rawUpdates is Map
            ? rawUpdates.map((k, v) => MapEntry(k.toString(), v))
            : payload;
        return _emitIfSnapshot(
          await adapter.saveWorkspaceSettings(
            updates,
            allowFinancialWrites: writesAllowed,
          ),
        );

      case 'saveAccountGroup':
        return _emitIfSnapshot(
          await adapter.saveAccountGroup(
            idempotencyKey: request.idempotencyKey!,
            payload: payload,
            allowFinancialWrites: writesAllowed,
          ),
        );

      case 'saveCurrency':
        return _emitIfSnapshot(
          await adapter.saveCurrency(
            idempotencyKey: request.idempotencyKey!,
            payload: payload,
            allowFinancialWrites: writesAllowed,
          ),
        );

      case 'deleteCurrency':
        return _emitIfSnapshot(
          await adapter.deleteCurrency(
            idempotencyKey: request.idempotencyKey!,
            payload: payload,
            allowFinancialWrites: writesAllowed,
          ),
        );

      case 'saveAccount':
        return _emitIfSnapshot(
          await adapter.saveAccount(
            idempotencyKey: request.idempotencyKey!,
            payload: payload,
            allowFinancialWrites: writesAllowed,
          ),
        );

      case 'deleteAccount':
        return _emitIfSnapshot(
          await adapter.deleteAccount(
            idempotencyKey: request.idempotencyKey!,
            payload: payload,
            allowFinancialWrites: writesAllowed,
          ),
        );

      case 'createLedgerEntry':
        return _emitIfSnapshot(
          await adapter.createLedgerEntry(
            idempotencyKey: request.idempotencyKey!,
            payload: payload,
            allowFinancialWrites: writesAllowed,
          ),
        );

      case 'updateLedgerEntry':
        return _emitIfSnapshot(
          await adapter.updateLedgerEntry(
            idempotencyKey: request.idempotencyKey!,
            payload: payload,
            allowFinancialWrites: writesAllowed,
          ),
        );

      case 'setLedgerDeleted':
        return _emitIfSnapshot(
          await adapter.setLedgerDeleted(
            idempotencyKey: request.idempotencyKey!,
            payload: payload,
            allowFinancialWrites: writesAllowed,
          ),
        );

      case 'permanentlyDeleteLedger':
        return _emitIfSnapshot(
          await adapter.permanentlyDeleteLedger(
            idempotencyKey: request.idempotencyKey!,
            payload: payload,
            allowFinancialWrites: writesAllowed,
          ),
        );

      case 'saveWarehouse':
        return _emitIfSnapshot(
          await adapter.saveWarehouse(
            idempotencyKey: request.idempotencyKey!,
            payload: payload,
            allowFinancialWrites: writesAllowed,
          ),
        );

      case 'createInventoryItem':
        return _emitIfSnapshot(
          await adapter.createInventoryItem(
            idempotencyKey: request.idempotencyKey!,
            payload: payload,
            allowFinancialWrites: writesAllowed,
          ),
        );

      case 'updateInventoryItem':
        return _emitIfSnapshot(
          await adapter.updateInventoryItem(
            idempotencyKey: request.idempotencyKey!,
            payload: payload,
            allowFinancialWrites: writesAllowed,
          ),
        );

      case 'deleteInventoryItem':
        return _emitIfSnapshot(
          await adapter.deleteInventoryItem(
            idempotencyKey: request.idempotencyKey!,
            payload: payload,
            allowFinancialWrites: writesAllowed,
          ),
        );

      case 'importInventoryItems':
        return _emitIfSnapshot(
          await adapter.importInventoryItems(
            idempotencyKey: request.idempotencyKey!,
            payload: payload,
            allowFinancialWrites: writesAllowed,
          ),
        );

      case 'batchUpdateInventoryItems':
        return _emitIfSnapshot(
          await adapter.batchUpdateInventoryItems(
            idempotencyKey: request.idempotencyKey!,
            payload: payload,
            allowFinancialWrites: writesAllowed,
          ),
        );

      case 'getInventoryMovementsReport':
        final rawOpts = payload['options'];
        final opts = rawOpts is Map
            ? rawOpts.map((k, v) => MapEntry(k.toString(), v))
            : <String, Object?>{};
        return adapter.getInventoryMovementsReport(opts);

      case 'getCashboxesReport':
        final rawOpts = payload['options'];
        final opts = rawOpts is Map
            ? rawOpts.map((k, v) => MapEntry(k.toString(), v))
            : <String, Object?>{};
        return adapter.getCashboxesReport(opts);

      case 'getInvoiceDetail':
        return adapter.getInvoiceDetail(
          (payload['entryId'] as String? ?? '').trim(),
        );

      case 'getProductPriceStats':
        return adapter.getProductPriceStats(
          (payload['itemId'] as String? ?? '').trim(),
        );

      case 'saveErpData':
        final rawData = payload['data'];
        if (rawData is! Map) {
          throw const HybridBridgeException(
            'VALIDATION_ERROR',
            'بيانات ERP غير صالحة.',
          );
        }
        return adapter.saveErpData(
          rawData.map((k, v) => MapEntry(k.toString(), v)),
        );

      case 'backupWorkspace':
        return adapter.backupWorkspace(
          backupName: (payload['backupName'] as String? ?? '').trim(),
          allowFinancialWrites: writesAllowed,
        );

      case 'restoreWorkspace':
        return _emitIfSnapshot(
          await adapter.restoreWorkspace(
            idempotencyKey: request.idempotencyKey!,
            payload: payload,
            allowFinancialWrites: writesAllowed,
          ),
        );

      case 'resetWorkspace':
        return _emitIfSnapshot(
          await adapter.resetWorkspace(
            idempotencyKey: request.idempotencyKey!,
            payload: payload,
            allowFinancialWrites: writesAllowed,
          ),
        );

      default:
        throw HybridBridgeException(
          'UNAUTHORIZED_ACTION',
          'الأمر غير مدعوم: ${request.action}',
        );
    }
  }

  Map<String, Object?> _emitIfSnapshot(Map<String, Object?> result) {
    final snap = result['snapshot'];
    if (snap is Map<String, Object?>) {
      onSnapshotUpdated?.call(snap);
    }
    return result;
  }
}
