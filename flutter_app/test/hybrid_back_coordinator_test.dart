import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:nasqo_pro_erp/hybrid/hybrid_back_coordinator.dart';

void main() {
  String reply(String? backId,
          {String outcome = 'handled', String route = 'home', int depth = 1}) =>
      jsonEncode({
        'protocolVersion': '1.0.0',
        'kind': 'request',
        'action': 'goBack',
        'requestId': 'react-reply',
        'payload': {
          'requestId': backId,
          'outcome': outcome,
          'currentRoute': route,
          'stackDepth': depth
        },
      });

  String eventId(String event) =>
      (jsonDecode(event)['payload']['requestId']) as String;

  test('one correlated consumed reply cannot authorize exit', () async {
    late HybridBackCoordinator coordinator;
    coordinator = HybridBackCoordinator(dispatch: (event) async {
      final decoded = jsonDecode(event);
      expect(decoded['event'], 'backPressed');
      expect(decoded['protocolVersion'], '1.0.0');
      coordinator.handleMessage(reply(eventId(event)));
      return 'sent';
    });
    addTearDown(coordinator.dispose);
    expect(await coordinator.requestBack(), HybridBackOutcome.handled);
  });

  test('IME consumption completes without requiring a React reply', () async {
    final coordinator = HybridBackCoordinator(dispatch: (_) async => 'ime');
    addTearDown(coordinator.dispose);
    expect(await coordinator.requestBack(), HybridBackOutcome.handled);
  });

  test('home exit requires a current correlated reply and exact root',
      () async {
    for (final testCase in [
      (route: 'home', depth: 1, expected: HybridBackOutcome.home),
      (route: 'purchases', depth: 1, expected: HybridBackOutcome.blocked),
      (route: 'home', depth: 2, expected: HybridBackOutcome.blocked),
    ]) {
      late HybridBackCoordinator coordinator;
      coordinator = HybridBackCoordinator(dispatch: (event) async {
        coordinator.handleMessage(reply(eventId(event),
            outcome: 'home', route: testCase.route, depth: testCase.depth));
        return 'sent';
      });
      expect(await coordinator.requestBack(), testCase.expected);
      coordinator.dispose();
    }
  });

  test('rapid double back shares no request and applies no second result',
      () async {
    String? id;
    var dispatches = 0;
    final coordinator = HybridBackCoordinator(dispatch: (event) async {
      dispatches++;
      id = eventId(event);
      return 'sent';
    });
    addTearDown(coordinator.dispose);
    final first = coordinator.requestBack();
    expect(await coordinator.requestBack(), HybridBackOutcome.blocked);
    expect(dispatches, 1);
    coordinator.handleMessage(reply(id));
    expect(await first, HybridBackOutcome.handled);
    // A duplicate or late root reply cannot turn the completed press into exit.
    final ack =
        jsonDecode(coordinator.handleMessage(reply(id, outcome: 'home'))!);
    expect(ack['data']['accepted'], false);
  });

  test('missing, unavailable and throwing bridge never exit', () async {
    for (final dispatch in <Future<String?> Function(String)>[
      (_) async => 'sent',
      (_) async => 'unavailable',
      (_) async => throw StateError('offline'),
      (_) => Completer<String?>().future,
    ]) {
      final coordinator = HybridBackCoordinator(
          dispatch: dispatch, timeout: const Duration(milliseconds: 10));
      expect(await coordinator.requestBack(), HybridBackOutcome.blocked);
      coordinator.dispose();
    }
  });

  test('late reply from expired request cannot satisfy subsequent request',
      () async {
    final ids = <String>[];
    final coordinator = HybridBackCoordinator(
        dispatch: (event) async {
          ids.add(eventId(event));
          return 'sent';
        },
        timeout: const Duration(milliseconds: 10));
    addTearDown(coordinator.dispose);
    expect(await coordinator.requestBack(), HybridBackOutcome.blocked);
    final next = coordinator.requestBack();
    coordinator.handleMessage(reply(ids.first, outcome: 'home'));
    coordinator.handleMessage(reply(ids.last));
    expect(await next, HybridBackOutcome.handled);
  });

  test('uncorrelated legacy message is acknowledged without exiting', () async {
    final coordinator = HybridBackCoordinator(
        dispatch: (_) async => 'sent',
        timeout: const Duration(milliseconds: 10));
    addTearDown(coordinator.dispose);
    final pending = coordinator.requestBack();
    final ack =
        jsonDecode(coordinator.handleMessage(reply(null, outcome: 'home'))!);
    expect(ack['data']['accepted'], false);
    expect(await pending, HybridBackOutcome.blocked);
  });

  test('unrelated/malformed messages remain in normal protocol path', () {
    final coordinator = HybridBackCoordinator(dispatch: (_) async => 'sent');
    addTearDown(coordinator.dispose);
    expect(coordinator.handleMessage('{'), isNull);
    expect(coordinator.handleMessage('[]'), isNull);
    expect(
        coordinator.handleMessage(jsonEncode({
          'protocolVersion': '1.0.0',
          'kind': 'request',
          'action': 'createLedgerEntry',
          'requestId': 'financial-request',
          'payload': {},
        })),
        isNull);
  });

  test('dispose interrupts back and stale callbacks cannot exit a new view',
      () async {
    final coordinator = HybridBackCoordinator(dispatch: (_) async => 'sent');
    final pending = coordinator.requestBack();
    coordinator.dispose();
    expect(await pending, HybridBackOutcome.blocked);
    expect(await coordinator.requestBack(), HybridBackOutcome.blocked);
  });

  test('opening an external picker or pausing cancels pending exit permission',
      () async {
    String? id;
    final coordinator = HybridBackCoordinator(dispatch: (event) async {
      id = eventId(event);
      return 'sent';
    });
    addTearDown(coordinator.dispose);
    final pending = coordinator.requestBack();
    coordinator.cancelPending();
    coordinator.handleMessage(reply(id, outcome: 'home'));
    expect(await pending, HybridBackOutcome.blocked);
    final resumed = coordinator.requestBack();
    coordinator.handleMessage(reply(id));
    expect(await resumed, HybridBackOutcome.handled);
  });
}
