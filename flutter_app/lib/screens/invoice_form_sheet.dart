import 'package:flutter/material.dart';
import '../models/erp_models.dart';
import '../services/accounting_engine.dart';
import '../state/erp_controller.dart';
import 'customer_list_sheet.dart';

class InvoiceFormSheet extends StatefulWidget {
  const InvoiceFormSheet({
    super.key,
    required this.controller,
  });

  final ErpController controller;

  @override
  State<InvoiceFormSheet> createState() => _InvoiceFormSheetState();
}

class _InvoiceFormSheetState extends State<InvoiceFormSheet> {
  late String _selectedAccountId;
  late String _selectedWhId;
  bool _useCustomCustomer = false;
  final _customNameCtrl = TextEditingController();
  PaymentMethod _payment = PaymentMethod.cash;
  bool _includeVat = true;
  final List<InvoiceItemRow> _rows = [];

  @override
  void initState() {
    super.initState();
    final preferredAccounts = _clientAccounts;
    _selectedAccountId = preferredAccounts.isNotEmpty ? preferredAccounts.first.id : '';
    _selectedWhId = widget.controller.warehouses.isNotEmpty
        ? widget.controller.warehouses.first.id
        : '';
    final firstItem = widget.controller.inventory.isNotEmpty
        ? widget.controller.inventory.first
        : null;
    _rows.add(
      InvoiceItemRow(
        id: 'row_${DateTime.now().millisecondsSinceEpoch}',
        itemId: firstItem?.id,
        productName: firstItem?.name ?? 'صنف افتراضي',
        quantity: 1,
        unitPrice: firstItem != null ? (firstItem.avgCost * 1.25).roundToDouble() : 100,
      ),
    );
  }

  @override
  void dispose() {
    _customNameCtrl.dispose();
    super.dispose();
  }

  List<AccountRecord> get _clientAccounts {
    final list = widget.controller.accounts
        .where((a) =>
            a.category == AccountCategory.clients ||
            a.category == AccountCategory.sales)
        .toList();
    return list.isNotEmpty ? list : widget.controller.accounts;
  }

  double get _subtotal => _rows.fold(0.0, (sum, r) => sum + r.lineTotal);
  double get _vat => _includeVat ? ((_subtotal * 0.15) * 100).roundToDouble() / 100 : 0.0;
  double get _grandTotal => _subtotal + _vat;

  void _openCustomerList() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => CustomerListSheet(
        controller: widget.controller,
        onSelectCustomer: (acc) {
          setState(() {
            _selectedAccountId = acc.id;
            _useCustomCustomer = false;
          });
        },
      ),
    );
  }

  void _saveInvoice() {
    if (widget.controller.accounts.isEmpty || widget.controller.warehouses.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('أضف حساب عميل ومستودعًا قبل إنشاء فاتورة.')),
      );
      return;
    }
    final activeAcc = widget.controller.accounts.firstWhere(
      (a) => a.id == _selectedAccountId,
      orElse: () => widget.controller.accounts.first,
    );
    final wh = widget.controller.warehouses.firstWhere(
      (w) => w.id == _selectedWhId,
      orElse: () => widget.controller.warehouses.first,
    );
    final customerName = _useCustomCustomer
        ? _customNameCtrl.text.trim()
        : activeAcc.name;
    if (customerName.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('أدخل اسم العميل أولًا')),
      );
      return;
    }

    widget.controller.submitSalesInvoice(
      accountId: activeAcc.id,
      customerName: customerName,
      warehouse: wh,
      payment: _payment,
      includeVat: _includeVat,
      rows: _rows,
    );

    Navigator.pop(context);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          'تمت إضافة الفاتورة للعميل ($customerName) بقيمة ${AccountingEngine.formatAmount(_grandTotal)} ${widget.controller.defaultCurrency.label}',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // A fresh offline database contains no accounts or warehouses. Never
    // show invalid dropdown defaults or generate placeholder financial data.
    if (widget.controller.accounts.isEmpty || widget.controller.warehouses.isEmpty) {
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('لا يمكن إنشاء فاتورة بعد',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              const SizedBox(height: 12),
              const Text('أضف حساب عميل ومستودعًا أولًا. قاعدة البيانات تبدأ فارغة دون بيانات تجريبية.'),
              const SizedBox(height: 16),
              Align(
                alignment: AlignmentDirectional.centerEnd,
                child: TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('إغلاق'),
                ),
              ),
            ],
          ),
        ),
      );
    }
    final currencyLabel = widget.controller.defaultCurrency.label;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 12,
          right: 12,
          top: 10,
          bottom: MediaQuery.of(context).viewInsets.bottom + 12,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'إصدار فاتورة مبيعات جديدة',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              Row(
                children: [
                  Expanded(
                    child: SegmentedButton<bool>(
                      segments: const [
                        ButtonSegment(value: false, label: Text('حساب مسجل')),
                        ButtonSegment(value: true, label: Text('اسم حر')),
                      ],
                      selected: {_useCustomCustomer},
                      onSelectionChanged: (s) =>
                          setState(() => _useCustomCustomer = s.first),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton.tonal(
                    onPressed: _openCustomerList,
                    child: const Text('قائمة العملاء'),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              if (_useCustomCustomer)
                TextField(
                  controller: _customNameCtrl,
                  decoration: const InputDecoration(
                    labelText: 'اسم العميل أو الجهة',
                    isDense: true,
                    border: OutlineInputBorder(),
                  ),
                )
              else
                DropdownButtonFormField<String>(
                  value: _selectedAccountId,
                  decoration: const InputDecoration(
                    labelText: 'العميل',
                    isDense: true,
                    border: OutlineInputBorder(),
                  ),
                  items: _clientAccounts
                      .map((a) => DropdownMenuItem(value: a.id, child: Text(a.name)))
                      .toList(),
                  onChanged: (v) {
                    if (v != null) setState(() => _selectedAccountId = v);
                  },
                ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      value: _selectedWhId,
                      decoration: const InputDecoration(
                        labelText: 'المستودع',
                        isDense: true,
                        border: OutlineInputBorder(),
                      ),
                      items: widget.controller.warehouses
                          .map((w) => DropdownMenuItem(value: w.id, child: Text(w.name)))
                          .toList(),
                      onChanged: (v) {
                        if (v != null) setState(() => _selectedWhId = v);
                      },
                    ),
                  ),
                  const SizedBox(width: 8),
                  SegmentedButton<PaymentMethod>(
                    segments: const [
                      ButtonSegment(value: PaymentMethod.cash, label: Text('نقدي')),
                      ButtonSegment(value: PaymentMethod.credit, label: Text('آجل')),
                    ],
                    selected: {_payment},
                    onSelectionChanged: (s) => setState(() => _payment = s.first),
                  ),
                ],
              ),
              CheckboxListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                title: const Text('ضريبة القيمة المضافة 15%'),
                value: _includeVat,
                onChanged: (v) => setState(() => _includeVat = v ?? true),
              ),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('بنود الأصناف',
                      style: TextStyle(fontWeight: FontWeight.bold)),
                  TextButton.icon(
                    onPressed: () {
                      final firstItem = widget.controller.inventory.isNotEmpty
                          ? widget.controller.inventory.first
                          : null;
                      setState(() {
                        _rows.add(
                          InvoiceItemRow(
                            id: 'row_${DateTime.now().millisecondsSinceEpoch}_${_rows.length}',
                            itemId: firstItem?.id,
                            productName: firstItem?.name ?? 'صنف جديد',
                            quantity: 1,
                            unitPrice: firstItem != null
                                ? (firstItem.avgCost * 1.25).roundToDouble()
                                : 100,
                          ),
                        );
                      });
                    },
                    icon: const Icon(Icons.add, size: 16),
                    label: const Text('إضافة صنف'),
                  ),
                ],
              ),
              ..._rows.map((row) {
                return Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    children: [
                      Expanded(
                        flex: 3,
                        child: DropdownButtonFormField<String?>(
                          value: row.itemId,
                          isExpanded: true,
                          decoration: const InputDecoration(
                            isDense: true,
                            border: OutlineInputBorder(),
                          ),
                          items: widget.controller.inventory
                              .map((inv) => DropdownMenuItem(
                                    value: inv.id,
                                    child: Text(inv.name,
                                        overflow: TextOverflow.ellipsis),
                                  ))
                              .toList(),
                          onChanged: (val) {
                            setState(() {
                              row.itemId = val;
                              final matched = widget.controller.inventory
                                  .where((i) => i.id == val)
                                  .firstOrNull;
                              if (matched != null) {
                                row.productName = matched.name;
                                row.unitPrice =
                                    (matched.avgCost * 1.25).roundToDouble();
                              }
                            });
                          },
                        ),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: TextFormField(
                          initialValue: row.quantity.toString(),
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: 'الكمية',
                            isDense: true,
                            border: OutlineInputBorder(),
                          ),
                          onChanged: (v) => setState(() {
                            row.quantity = (double.tryParse(v) ?? 1).clamp(1, 99999);
                          }),
                        ),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: TextFormField(
                          initialValue: row.unitPrice.toString(),
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: 'السعر',
                            isDense: true,
                            border: OutlineInputBorder(),
                          ),
                          onChanged: (v) => setState(() {
                            row.unitPrice = (double.tryParse(v) ?? 0).clamp(0, 999999);
                          }),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.delete_outline, color: Colors.red),
                        onPressed: _rows.length > 1
                            ? () => setState(() => _rows.remove(row))
                            : null,
                      ),
                    ],
                  ),
                );
              }),
              const SizedBox(height: 6),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: Theme.of(context)
                      .colorScheme
                      .primaryContainer
                      .withOpacity(0.35),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  children: [
                    _summaryRow('المجموع الفرعي',
                        '${AccountingEngine.formatAmount(_subtotal)} $currencyLabel'),
                    if (_includeVat)
                      _summaryRow('الضريبة (15%)',
                          '${AccountingEngine.formatAmount(_vat)} $currencyLabel'),
                    const Divider(height: 10),
                    _summaryRow(
                      'الإجمالي النهائي',
                      '${AccountingEngine.formatAmount(_grandTotal)} $currencyLabel',
                      bold: true,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              FilledButton.icon(
                onPressed: _saveInvoice,
                icon: const Icon(Icons.check_circle_outline),
                label: const Text('حفظ الفاتورة وترحيل المبيعات'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _summaryRow(String label, String value, {bool bold = false}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label,
            style: TextStyle(
                fontWeight: bold ? FontWeight.bold : FontWeight.normal)),
        Text(value,
            style: TextStyle(
              fontWeight: bold ? FontWeight.bold : FontWeight.w600,
              color: bold ? const Color(0xFF169B62) : null,
            )),
      ],
    );
  }
}
