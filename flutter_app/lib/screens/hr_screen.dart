import 'package:flutter/material.dart';
import '../models/erp_models.dart';
import '../services/accounting_engine.dart';
import '../state/erp_controller.dart';

class HrScreen extends StatelessWidget {
  const HrScreen({super.key, required this.controller});
  final ErpController controller;

  @override
  Widget build(BuildContext context) {
    final cur = controller.defaultCurrency.label;
    final totalPayroll = AccountingEngine.computeTotalNetPayroll(controller.employees);

    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        Card(
          color: const Color(0xFF0B5CA8),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'إجمالي مسير الرواتب الشهري',
                  style: TextStyle(color: Colors.white70, fontSize: 12),
                ),
                const SizedBox(height: 4),
                Text(
                  '${AccountingEngine.formatAmount(totalPayroll)} $cur',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 10),
                FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFFF39A16),
                    foregroundColor: Colors.white,
                  ),
                  onPressed: () {
                    controller.postPayrollToGl();
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('تم ترحيل مسير الرواتب للأستاذ العام')),
                    );
                  },
                  child: const Text('ترحيل الرواتب للأستاذ العام'),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        const Text('الموظفون', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
        const SizedBox(height: 6),
        ...controller.employees.map((emp) => Card(
              margin: const EdgeInsets.only(bottom: 6),
              child: ListTile(
                leading: const CircleAvatar(child: Icon(Icons.person)),
                title: Text(emp.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: Text('${emp.roleTitle} · ${emp.department}'),
                trailing: Text(
                  '${AccountingEngine.formatAmount(emp.netSalary)} $cur',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
              ),
            )),
        if (controller.leaveRequests.isNotEmpty) ...[
          const SizedBox(height: 12),
          const Text('طلبات الإجازات', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
          const SizedBox(height: 6),
          ...controller.leaveRequests.map((lv) => Card(
                margin: const EdgeInsets.only(bottom: 6),
                child: ListTile(
                  title: Text('${lv.employeeName} (${lv.leaveType})'),
                  subtitle: Text('${lv.startDate} · ${lv.days} أيام · ${lv.status.label}'),
                  trailing: lv.status == LeaveStatus.pending
                      ? Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            IconButton(
                              icon: const Icon(Icons.check_circle, color: Colors.green),
                              onPressed: () =>
                                  controller.decideLeave(lv.id, LeaveStatus.approved),
                            ),
                            IconButton(
                              icon: const Icon(Icons.cancel, color: Colors.red),
                              onPressed: () =>
                                  controller.decideLeave(lv.id, LeaveStatus.rejected),
                            ),
                          ],
                        )
                      : null,
                ),
              )),
        ],
      ],
    );
  }
}
