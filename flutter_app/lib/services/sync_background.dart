import 'package:flutter/widgets.dart';
import 'package:workmanager/workmanager.dart';
import 'sync_runtime.dart';

const syncTask = 'nasqo.workspace.sync';

@pragma('vm:entry-point')
void syncCallbackDispatcher() {
  WidgetsFlutterBinding.ensureInitialized();
  Workmanager().executeTask((task, input) async {
    if (task != syncTask) return true;
    final workspace = input?['workspace'];
    final uid = input?['uid'];
    if (workspace is! String || uid is! String) return true;
    try {
      await SyncRuntime.run(workspace, uid);
      return true;
    } catch (_) {
      return false;
    }
  });
}

class SyncBackground {
  static Future<void> initialize() =>
      Workmanager().initialize(syncCallbackDispatcher);

  static Future<void> schedule(String workspace, String uid) async {
    if (workspace.isEmpty || uid.isEmpty) {
      throw ArgumentError('Missing authenticated workspace');
    }
    await Workmanager().registerPeriodicTask(
      syncTask, syncTask,
      frequency: const Duration(minutes: 15),
      constraints: Constraints(networkType: NetworkType.connected),
      inputData: {'workspace': workspace, 'uid': uid},
    );
  }

  static Future<void> cancel() => Workmanager().cancelByUniqueName(syncTask);
}
