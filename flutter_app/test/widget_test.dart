import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nasqo_pro_erp/screens/dashboard_screen.dart';
import 'package:nasqo_pro_erp/state/erp_controller.dart';

void main() {
  testWidgets('a clean offline dashboard renders without sample data', (tester) async {
    final controller = ErpController(autoInitDb: false);
    addTearDown(controller.dispose);

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: DashboardScreen(
          controller: controller,
          onNavigateTab: (_) {},
          onOpenModule: (_) {},
        ),
      ),
    ));

    expect(find.text('المبيعات'), findsOneWidget);
    expect(controller.accounts, isEmpty);
    expect(controller.ledger, isEmpty);
    expect(controller.inventory, isEmpty);
  });
}
