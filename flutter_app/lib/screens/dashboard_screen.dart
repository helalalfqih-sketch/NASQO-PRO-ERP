import 'package:flutter/material.dart';
import '../models/erp_models.dart';
import '../services/accounting_engine.dart';
import '../state/erp_controller.dart';
import 'invoice_form_sheet.dart';
import 'customer_list_sheet.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({
    super.key,
    required this.controller,
    required this.onNavigateTab,
    required this.onOpenModule,
  });

  final ErpController controller;
  final ValueChanged<int> onNavigateTab;
  final ValueChanged<String> onOpenModule;

  @override
  Widget build(BuildContext context) {
    final income = AccountingEngine.computeIncomeStatement(
      controller.accounts,
      controller.ledger,
    );
    final invValue = AccountingEngine.computeInventoryValue(controller.inventory);
    final cur = controller.defaultCurrency.label;

    final cards = [
      ('المبيعات', income.netSales, true, Icons.trending_up),
      ('المشتريات', income.cogs, false, Icons.shopping_bag_outlined),
      ('العملاء', _categoryNet(AccountCategory.clients), true, Icons.people_outline),
      ('الموظفون', AccountingEngine.computeTotalNetPayroll(controller.employees), false, Icons.badge_outlined),
      ('الحوالات والصناديق', _categoryNet(AccountCategory.transfers), true, Icons.account_balance_wallet_outlined),
      ('المحل والمصروفات', income.totalOperatingExpenses, false, Icons.storefront_outlined),
      ('قيمة المخزون', invValue, true, Icons.inventory_2_outlined),
      ('صافي الربح', income.netProfit, income.netProfit >= 0, Icons.analytics_outlined),
    ];

    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        Card(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
            side: BorderSide(color: Theme.of(context).colorScheme.primary.withOpacity(0.18)),
          ),
          child: ListTile(
            leading: CircleAvatar(
              backgroundColor: const Color(0xFF0B5CA8),
              foregroundColor: Colors.white,
              child: Text(controller.companyName.characters.first),
            ),
            title: Text(
              controller.companyName,
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
            subtitle: const Text('لوحة القيادة الرئيسية — نسخه Flutter المتكاملة'),
            trailing: FilledButton(
              onPressed: () => onNavigateTab(1),
              child: const Text('مركز ERP'),
            ),
          ),
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            FilledButton.icon(
              onPressed: () => showModalBottomSheet(
                context: context,
                isScrollControlled: true,
                builder: (_) => InvoiceFormSheet(controller: controller),
              ),
              icon: const Icon(Icons.receipt_long, size: 18),
              label: const Text('فاتورة جديدة'),
            ),
            FilledButton.tonalIcon(
              onPressed: () => showModalBottomSheet(
                context: context,
                isScrollControlled: true,
                builder: (_) => CustomerListSheet(
                  controller: controller,
                  onSelectCustomer: (c) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('العميل المحدد: ${c.name}')),
                    );
                  },
                ),
              ),
              icon: const Icon(Icons.people, size: 18),
              label: const Text('العملاء'),
            ),
            FilledButton.tonalIcon(
              onPressed: () => onNavigateTab(2),
              icon: const Icon(Icons.point_of_sale, size: 18),
              label: const Text('نقطة البيع'),
            ),
          ],
        ),
        const SizedBox(height: 12),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: cards.length,
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2,
            mainAxisSpacing: 8,
            crossAxisSpacing: 8,
            childAspectRatio: 1.55,
          ),
          itemBuilder: (context, index) {
            final (title, amount, positive, icon) = cards[index];
            return InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: () {
                if (index == 0 || index == 2) {
                  onNavigateTab(2);
                } else if (index == 1) {
                  onOpenModule('procurement');
                } else if (index == 3) {
                  onOpenModule('hr');
                } else {
                  onOpenModule('finance');
                }
              },
              child: Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFF0B5CA8), width: 1.5),
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(icon, color: const Color(0xFF0B5CA8), size: 24),
                    const SizedBox(height: 4),
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF0B5CA8),
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${AccountingEngine.formatAmount(amount.abs())} $cur',
                      textDirection: TextDirection.ltr,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: positive
                            ? const Color(0xFF169B62)
                            : const Color(0xFFD84949),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ],
    );
  }

  double _categoryNet(AccountCategory cat) {
    double sum = 0;
    for (final acc in controller.accounts.where((a) => a.category == cat)) {
      sum += AccountingEngine.computeAccountSummary(acc, controller.ledger)
          .netBalance;
    }
    return sum;
  }
}
