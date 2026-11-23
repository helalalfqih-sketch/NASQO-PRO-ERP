import 'dart:convert';
import 'dart:io';
import 'sync_engine.dart';

/// Native HTTPS transport. Tokens are supplied by the authentication layer,
/// never embedded in assets or passed through the React bridge.
class HttpSyncTransport implements SyncTransport {
  HttpSyncTransport(this.baseUri, this.getIdToken) {
    if (baseUri.scheme != 'https' || baseUri.host.isEmpty ||
        baseUri.userInfo.isNotEmpty || baseUri.hasQuery || baseUri.hasFragment) {
      throw ArgumentError('A trusted HTTPS endpoint is required');
    }
  }
  final Uri baseUri;
  final Future<String> Function() getIdToken;

  Future<Map<String, dynamic>> _request(String path,
      Map<String, dynamic> payload) async {
    final token = await getIdToken();
    if (token.isEmpty) throw StateError('Authentication required');
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 15);
    try {
      final uri = baseUri.resolve(path);
      final request = await client.postUrl(uri).timeout(const Duration(seconds: 20));
      request.followRedirects = false;
      request.headers.contentType = ContentType.json;
      request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
      request.write(jsonEncode(payload));
      final response = await request.close().timeout(const Duration(seconds: 30));
      if (response.statusCode != 200) {
        throw HttpException('Sync rejected: ${response.statusCode}');
      }
      final bytes = <int>[];
      await for (final chunk in response.timeout(const Duration(seconds: 30))) {
        bytes.addAll(chunk);
        if (bytes.length > 4 * 1024 * 1024) {
          throw const FormatException('Sync response too large');
        }
      }
      final decoded = jsonDecode(utf8.decode(bytes));
      if (decoded is! Map<String, dynamic>) {
        throw const FormatException('Invalid sync response');
      }
      return decoded;
    } finally {
      client.close(force: true);
    }
  }

  @override
  Future<String> push(String workspaceId, String operationId,
      String operationType, Map<String, dynamic> payload) async {
    final result = await _request('/api/sync/push', {
      'workspace_id': workspaceId, 'operation_id': operationId,
      'operation_type': operationType, 'payload': payload,
    });
    final revision = result['server_revision'];
    if (result['operation_id'] != operationId ||
        result['workspace_id'] != workspaceId ||
        revision is! String || revision.isEmpty) {
      throw const FormatException('Invalid acknowledgement');
    }
    return revision;
  }

  @override
  Future<SyncPage> pull(String workspaceId, String? cursor) async {
    final result = await _request('/api/sync/pull', {
      'workspace_id': workspaceId, 'cursor': cursor,
    });
    final next = result['next_cursor'];
    final operations = result['operations'];
    if (result['workspace_id'] != workspaceId ||
        next is! String || next.isEmpty || operations is! List) {
      throw const FormatException('Invalid sync page');
    }
    return SyncPage(next, operations.map((item) {
      if (item is! Map<String, dynamic>) {
        throw const FormatException('Invalid remote operation');
      }
      return item;
    }).toList());
  }
}
