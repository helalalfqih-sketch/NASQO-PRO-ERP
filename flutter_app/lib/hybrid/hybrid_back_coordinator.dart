import 'dart:async';
import 'dart:convert';

enum HybridBackOutcome { handled, home, blocked }

/// One in-flight, correlated UI-only request. A missing/stale/malformed reply
/// always leaves the application open. This class cannot perform ERP writes.
class HybridBackCoordinator {
  HybridBackCoordinator({
    required this.dispatch,
    this.timeout = const Duration(milliseconds: 1500),
  });

  /// Native returns `ime` when it consumed the press, otherwise `sent`.
  final Future<String?> Function(String event) dispatch;
  final Duration timeout;
  int _sequence = 0;
  String? _requestId;
  Completer<HybridBackOutcome>? _pending;
  bool _disposed = false;

  Future<HybridBackOutcome> requestBack() async {
    if (_disposed || _pending != null) return HybridBackOutcome.blocked;
    final id = 'back_${DateTime.now().microsecondsSinceEpoch}_${++_sequence}';
    final pending = Completer<HybridBackOutcome>();
    _requestId = id;
    _pending = pending;
    // The deadline includes native dispatch; an unavailable platform channel
    // must not leave the coordinator locked indefinitely.
    final timer = Timer(timeout, () {
      if (!pending.isCompleted) pending.complete(HybridBackOutcome.blocked);
    });
    unawaited(() async {
      try {
        final delivery = await dispatch(jsonEncode({
          'protocolVersion': '1.0.0',
          'kind': 'event',
          'event': 'backPressed',
          'payload': {'requestId': id},
        }));
        if (!pending.isCompleted && delivery != 'sent') {
          pending.complete(delivery == 'ime'
              ? HybridBackOutcome.handled
              : HybridBackOutcome.blocked);
        }
      } catch (_) {
        if (!pending.isCompleted) pending.complete(HybridBackOutcome.blocked);
      }
    }());
    try {
      return await pending.future;
    } finally {
      timer.cancel();
      if (identical(_pending, pending)) {
        _pending = null;
        _requestId = null;
      }
    }
  }

  /// Returns the transport acknowledgement, or null for a non-navigation
  /// message. Legacy/unsolicited goBack notifications are acknowledged but
  /// never authorize exiting Android.
  String? handleMessage(String raw) {
    if (raw.length > 32768) return null;
    dynamic request;
    try {
      request = jsonDecode(raw);
    } on FormatException {
      return null;
    }
    if (request is! Map<String, dynamic> ||
        request['protocolVersion'] != '1.0.0' ||
        request['kind'] != 'request' ||
        request['action'] != 'goBack' ||
        request['requestId'] is! String ||
        (request['requestId'] as String).isEmpty ||
        (request['requestId'] as String).length > 150 ||
        request['payload'] is! Map<String, dynamic>) {
      return null;
    }
    final payload = request['payload'] as Map<String, dynamic>;
    final pending = _pending;
    final matched = pending != null &&
        !pending.isCompleted &&
        payload['requestId'] == _requestId;
    if (matched) {
      final outcome = switch (payload['outcome']) {
        'handled' => HybridBackOutcome.handled,
        'home'
            when payload['currentRoute'] == 'home' &&
                payload['stackDepth'] == 1 =>
          HybridBackOutcome.home,
        _ => HybridBackOutcome.blocked,
      };
      pending.complete(outcome);
    }
    return jsonEncode({
      'protocolVersion': '1.0.0',
      'kind': 'response',
      'requestId': request['requestId'],
      'action': 'goBack',
      'ok': true,
      'data': {'accepted': matched},
    });
  }

  void cancelPending() {
    final pending = _pending;
    if (pending != null && !pending.isCompleted) {
      pending.complete(HybridBackOutcome.blocked);
    }
  }

  void dispose() {
    _disposed = true;
    cancelPending();
  }
}
