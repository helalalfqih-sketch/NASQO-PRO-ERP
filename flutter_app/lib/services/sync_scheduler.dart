import 'package:flutter/widgets.dart';
import 'package:workmanager/workmanager.dart';
import 'native_sync_service.dart';

const syncTask = 'nasqo.sync.periodic';

@pragma('vm:entry-point')
void nasqoSyncDispatcher() {
  WidgetsFlutterBinding.ensureInitialized();
  Workmanager().executeTask((task, inputData) async {
    if (task != syncTask) return true;
    try {
      await NativeSyncService.synchronize();
      return true;
    } catch (_) {
      return false;
    }
  });
}

class SyncScheduler {
  static Future<void> enable() async {
    await Workmanager().initialize(nasqoSyncDispatcher);
    await Workmanager().registerPeriodicTask(syncTask, syncTask,
      frequency: const Duration(minutes: 30),
      constraints: Constraints(networkType: NetworkType.connected));
  }

  static Future<void> disable() async {
    await Workmanager().cancelByUniqueName(syncTask);
  }
}
