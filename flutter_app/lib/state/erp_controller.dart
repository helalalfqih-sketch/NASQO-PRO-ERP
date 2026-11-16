import 'dart:async';
import 'package:flutter/foundation.dart';
import '../models/erp_models.dart';
import '../services/accounting_engine.dart';
import '../services/local_database.dart';

class ErpController extends ChangeNotifier {
  ErpController({bool autoInitDb = true}) {
    _seedInitialData();
    if (autoInitDb) {
      unawaited(initDatabase());
    }
  }

  String companyName = 'نسقو برو ERP';
  CurrencyCode defaultCurrency = CurrencyCode.sar;
  bool isDarkMode = false;
  bool dbReady = false;

  final List<AccountRecord> accounts = [];
  final List<LedgerEntryRecord> ledger = [];
  final List<WarehouseRecord> warehouses = [];
  final List<InventoryItemRecord> inventory = [];
  final List<ErpEmployeeProfile> employees = [];
  final List<ErpLeaveRequest> leaveRequests = [];
  final List<ErpDealRecord> deals = [];
  final List<ErpPurchaseOrder> purchaseOrders = [];
  final List<ErpBomRecipe> boms = [];
  final List<ErpProductionOrder> productionOrders = [];
  final List<ErpCostCenter> costCenters = [];

  int _nextEntryNumber = 1200;

  void _seedInitialData() {
    warehouses.addAll(const [
      WarehouseRecord(
        id: 'wh_1',
        name: 'المخزن الرئيسي',
        details: 'المستودع المركزي - الرياض',
        isDefault: true,
      ),
      WarehouseRecord(
        id: 'wh_2',
        name: 'مستودع الفرع التجاري',
        details: 'فرع المبيعات والتجزئة',
      ),
    ]);

    accounts.addAll(const [
      AccountRecord(
        id: 'acc_sales_1',
        name: 'مبيعات الصالة الرئيسية',
        category: AccountCategory.sales,
        codeNumber: 4001,
        openingBalance: 18500,
        openingDirection: EntryDirection.credit,
      ),
      AccountRecord(
        id: 'acc_client_1',
        name: 'شركة الرواد للتجارة',
        category: AccountCategory.clients,
        phone: '0551234567',
        codeNumber: 1201,
      ),
      AccountRecord(
        id: 'acc_client_2',
        name: 'مؤسسة أفق الإمداد',
        category: AccountCategory.clients,
        phone: '0507654321',
        codeNumber: 1202,
      ),
      AccountRecord(
        id: 'acc_sup_1',
        name: 'مورد الأغذية والتموين',
        category: AccountCategory.purchases,
        phone: '0549988776',
        codeNumber: 2101,
      ),
      AccountRecord(
        id: 'acc_cash_1',
        name: 'الصندوق الرئيسي',
        category: AccountCategory.transfers,
        isCashAccount: true,
        codeNumber: 1101,
        openingBalance: 45000,
        openingDirection: EntryDirection.debit,
      ),
      AccountRecord(
        id: 'acc_shop_1',
        name: 'مصروفات التشغيل والإيجار',
        category: AccountCategory.shop,
        codeNumber: 5101,
      ),
      AccountRecord(
        id: 'acc_emp_pool',
        name: 'مستحقات الرواتب والأجور',
        category: AccountCategory.employees,
        codeNumber: 2201,
      ),
    ]);

    inventory.addAll(const [
      InventoryItemRecord(
        id: 'inv_1',
        name: 'أرز بسمتي فاخر 10 كجم',
        unit: 'كيس',
        quantity: 80,
        avgCost: 62,
        warehouseId: 'wh_1',
        sku: 'SKU-101',
      ),
      InventoryItemRecord(
        id: 'inv_2',
        name: 'زيت زيتون بكر ممتاز 1 لتر',
        unit: 'عبوة',
        quantity: 65,
        avgCost: 34,
        warehouseId: 'wh_1',
        sku: 'SKU-102',
      ),
      InventoryItemRecord(
        id: 'inv_3',
        name: 'قهوة عربية محمصة 1 كجم',
        unit: 'علبة',
        quantity: 40,
        avgCost: 48,
        warehouseId: 'wh_1',
        sku: 'SKU-103',
      ),
      InventoryItemRecord(
        id: 'inv_4',
        name: 'سلة تموين متكاملة (منتج تام)',
        unit: 'سلة',
        quantity: 18,
        avgCost: 145,
        warehouseId: 'wh_1',
        sku: 'FG-201',
      ),
    ]);

    ledger.addAll([
      LedgerEntryRecord(
        id: 'led_1',
        accountId: 'acc_client_1',
        accountName: 'شركة الرواد للتجارة',
        kind: LedgerKind.invoice,
        typeLabel: 'ف.مبيعات آجل',
        payment: PaymentMethod.credit,
        direction: EntryDirection.debit,
        amount: 6400,
        details: 'توريد مواد غذائية متنوعة',
        documentNumber: 'INV-1001',
        entryNumber: 1001,
        entryDate: '2026-11-12',
      ),
      LedgerEntryRecord(
        id: 'led_2',
        accountId: 'acc_sup_1',
        accountName: 'مورد الأغذية والتموين',
        kind: LedgerKind.invoice,
        typeLabel: 'ف.مشتريات مخزنية',
        payment: PaymentMethod.credit,
        direction: EntryDirection.credit,
        amount: 4200,
        details: 'شراء أرز وزيت وقهوة للمستودع',
        documentNumber: 'PUR-1002',
        entryNumber: 1002,
        entryDate: '2026-11-13',
      ),
      LedgerEntryRecord(
        id: 'led_3',
        accountId: 'acc_shop_1',
        accountName: 'مصروفات التشغيل والإيجار',
        kind: LedgerKind.voucher,
        typeLabel: 'سند صرف مصروفات',
        payment: PaymentMethod.cash,
        direction: EntryDirection.debit,
        amount: 1800,
        details: 'إيجار ومرافق الفرع الشهري',
        expenseCategory: 'إيجار ومقر',
        entryNumber: 1003,
        entryDate: '2026-11-14',
      ),
    ]);

    employees.addAll(const [
      ErpEmployeeProfile(
        id: 'emp_1',
        name: 'أحمد العتيبي',
        roleTitle: 'مدير العمليات والمبيعات',
        department: 'المبيعات',
        basicSalary: 7500,
        allowances: 1200,
        deductions: 250,
        hireDate: '2024-03-01',
      ),
      ErpEmployeeProfile(
        id: 'emp_2',
        name: 'سارة القحطاني',
        roleTitle: 'محاسبة أولى',
        department: 'المالية',
        basicSalary: 6800,
        allowances: 900,
        deductions: 0,
        hireDate: '2024-06-15',
      ),
      ErpEmployeeProfile(
        id: 'emp_3',
        name: 'خالد الشهري',
        roleTitle: 'أمين مستودع',
        department: 'المخازن',
        basicSalary: 4800,
        allowances: 600,
        deductions: 150,
        hireDate: '2025-01-10',
      ),
    ]);

    leaveRequests.addAll(const [
      ErpLeaveRequest(
        id: 'lv_1',
        employeeId: 'emp_3',
        employeeName: 'خالد الشهري',
        leaveType: 'سنوية',
        startDate: '2026-11-20',
        days: 4,
        note: 'إجازة عائلية مجدولة',
      ),
    ]);

    deals.addAll(const [
      ErpDealRecord(
        id: 'deal_1',
        title: 'عقد تموين شهري - مطاعم السعادة',
        clientAccountId: 'acc_client_1',
        clientName: 'شركة الرواد للتجارة',
        value: 24500,
        stage: ErpDealStage.negotiation,
        probability: 75,
        expectedCloseDate: '2026-11-25',
        assignedTo: 'أحمد العتيبي',
      ),
      ErpDealRecord(
        id: 'deal_2',
        title: 'تجهيز سلات ضيافة للشركات',
        clientAccountId: 'acc_client_2',
        clientName: 'مؤسسة أفق الإمداد',
        value: 14000,
        stage: ErpDealStage.proposal,
        probability: 50,
        expectedCloseDate: '2026-11-30',
        assignedTo: 'أحمد العتيبي',
      ),
    ]);

    purchaseOrders.addAll(const [
      ErpPurchaseOrder(
        id: 'po_1',
        poNumber: 'PO-2026-101',
        supplierAccountId: 'acc_sup_1',
        supplierName: 'مورد الأغذية والتموين',
        warehouseId: 'wh_1',
        warehouseName: 'المخزن الرئيسي',
        orderDate: '2026-11-14',
        expectedDate: '2026-11-17',
        status: PurchaseOrderStatus.approved,
        lines: [
          ErpPurchaseOrderLine(
            inventoryItemId: 'inv_1',
            itemName: 'أرز بسمتي فاخر 10 كجم',
            unit: 'كيس',
            quantity: 20,
            unitCost: 60,
          ),
        ],
        notes: 'توريد دفعة منتصف الشهر',
      ),
    ]);

    boms.addAll(const [
      ErpBomRecipe(
        id: 'bom_1',
        name: 'تجميع سلة التموين المتكاملة',
        finishedItemId: 'inv_4',
        finishedItemName: 'سلة تموين متكاملة (منتج تام)',
        finishedUnit: 'سلة',
        components: [
          ErpBomComponent(
            inventoryItemId: 'inv_1',
            itemName: 'أرز بسمتي فاخر 10 كجم',
            unit: 'كيس',
            quantityPerUnit: 1,
          ),
          ErpBomComponent(
            inventoryItemId: 'inv_2',
            itemName: 'زيت زيتون بكر ممتاز 1 لتر',
            unit: 'عبوة',
            quantityPerUnit: 1,
          ),
          ErpBomComponent(
            inventoryItemId: 'inv_3',
            itemName: 'قهوة عربية محمصة 1 كجم',
            unit: 'علبة',
            quantityPerUnit: 1,
          ),
        ],
      ),
    ]);

    productionOrders.addAll(const [
      ErpProductionOrder(
        id: 'mfg_1',
        orderNumber: 'MFG-01',
        bomId: 'bom_1',
        bomName: 'تجميع سلة التموين المتكاملة',
        finishedItemId: 'inv_4',
        finishedItemName: 'سلة تموين متكاملة (منتج تام)',
        quantityToProduce: 5,
        warehouseId: 'wh_1',
        createdDate: '2026-11-15',
        costCenterId: 'cc_1',
      ),
    ]);

    costCenters.addAll(const [
      ErpCostCenter(
        id: 'cc_1',
        code: 'CC-100',
        name: 'مركز التشغيل والتوزيع',
        managerName: 'أحمد العتيبي',
        budget: 40000,
        extraPostedSpend: 3500,
        linkedCategories: ['إيجار ومقر', 'شحن ونقل'],
      ),
      ErpCostCenter(
        id: 'cc_2',
        code: 'CC-200',
        name: 'مركز التصنيع والتعبئة',
        managerName: 'خالد الشهري',
        budget: 25000,
        extraPostedSpend: 1800,
        linkedCategories: ['مصروفات تشغيلية'],
      ),
    ]);
  }

  Future<void> initDatabase() async {
    try {
      final hasData = await LocalDatabase.instance.hasSeededData();
      if (hasData) {
        final snap = await LocalDatabase.instance.loadSnapshot();
        accounts
          ..clear()
          ..addAll(snap.accounts);
        ledger
          ..clear()
          ..addAll(snap.ledger);
        warehouses
          ..clear()
          ..addAll(snap.warehouses);
        inventory
          ..clear()
          ..addAll(snap.inventory);
        if (snap.companyName != null && snap.companyName!.isNotEmpty) {
          companyName = snap.companyName!;
        }
        if (snap.isDarkMode != null) {
          isDarkMode = snap.isDarkMode!;
        }
        if (snap.nextEntryNumber != null) {
          _nextEntryNumber = snap.nextEntryNumber!;
        }
      } else {
        await _persistToDb();
      }
      dbReady = true;
      notifyListeners();
    } catch (_) {
      // Safe fallback when sqflite platform channel is unavailable in headless unit tests
    }
  }

  Future<void> _persistToDb() async {
    try {
      await LocalDatabase.instance.saveSnapshot(
        accounts: accounts,
        ledger: ledger,
        warehouses: warehouses,
        inventory: inventory,
        companyName: companyName,
        isDarkMode: isDarkMode,
        nextEntryNumber: _nextEntryNumber,
      );
      dbReady = true;
    } catch (_) {
      // Ignore if running outside device SQLite runtime
    }
  }

  Future<void> resetLocalDatabase() async {
    try {
      await LocalDatabase.instance.clearAll();
    } catch (_) {}
    accounts.clear();
    ledger.clear();
    warehouses.clear();
    inventory.clear();
    employees.clear();
    leaveRequests.clear();
    deals.clear();
    purchaseOrders.clear();
    boms.clear();
    productionOrders.clear();
    costCenters.clear();
    _nextEntryNumber = 1200;
    _seedInitialData();
    await _persistToDb();
    notifyListeners();
  }

  void toggleTheme() {
    isDarkMode = !isDarkMode;
    unawaited(_persistToDb());
    notifyListeners();
  }

  AccountRecord addCustomer({
    required String name,
    String phone = '',
    String note = '',
  }) {
    final acc = AccountRecord(
      id: 'acc_client_${DateTime.now().millisecondsSinceEpoch}',
      name: name.trim(),
      category: AccountCategory.clients,
      phone: phone.trim(),
      note: note.trim(),
      currency: defaultCurrency,
      codeNumber: 1200 + accounts.length + 1,
    );
    accounts.insert(0, acc);
    unawaited(_persistToDb());
    notifyListeners();
    return acc;
  }

  void submitSalesInvoice({
    required String accountId,
    required String customerName,
    required WarehouseRecord warehouse,
    required PaymentMethod payment,
    required bool includeVat,
    required List<InvoiceItemRow> rows,
  }) {
    final subtotal = rows.fold<double>(0, (s, r) => s + r.lineTotal);
    final vatAmount = includeVat ? ((subtotal * 0.15) * 100).roundToDouble() / 100 : 0.0;
    final grandTotal = subtotal + vatAmount;

    for (final row in rows) {
      if (row.itemId == null) continue;
      final idx = inventory.indexWhere((i) => i.id == row.itemId);
      if (idx >= 0) {
        final item = inventory[idx];
        inventory[idx] = item.copyWith(
          quantity: (item.quantity - row.quantity).clamp(0, double.infinity),
        );
      }
    }

    final details = [
      ...rows.map((r) => '${r.productName} | ${r.quantity} × ${AccountingEngine.formatAmount(r.unitPrice)}'),
      if (includeVat) 'ضريبة القيمة المضافة 15%: ${AccountingEngine.formatAmount(vatAmount)}',
    ].join('\n');

    final entryNum = ++_nextEntryNumber;
    ledger.insert(
      0,
      LedgerEntryRecord(
        id: 'led_${DateTime.now().millisecondsSinceEpoch}',
        accountId: accountId,
        accountName: customerName,
        kind: LedgerKind.invoice,
        typeLabel: payment == PaymentMethod.cash ? 'ف.مبيعات نقدية' : 'ف.مبيعات آجل',
        payment: payment,
        direction: EntryDirection.debit,
        amount: grandTotal,
        currency: defaultCurrency,
        details: details,
        documentNumber: 'INV-$entryNum',
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        entryNumber: entryNum,
        entryDate: DateTime.now().toIso8601String().substring(0, 10),
      ),
    );
    unawaited(_persistToDb());
    notifyListeners();
  }

  void createDeal({
    required String title,
    required AccountRecord client,
    required double value,
  }) {
    deals.insert(
      0,
      ErpDealRecord(
        id: 'deal_${DateTime.now().millisecondsSinceEpoch}',
        title: title,
        clientAccountId: client.id,
        clientName: client.name,
        value: value,
        currency: defaultCurrency,
        expectedCloseDate: DateTime.now().toIso8601String().substring(0, 10),
        assignedTo: employees.isNotEmpty ? employees.first.name : 'فريق المبيعات',
      ),
    );
    notifyListeners();
  }

  void advanceDeal(String dealId) {
    final idx = deals.indexWhere((d) => d.id == dealId);
    if (idx < 0) return;
    final d = deals[idx];
    final next = switch (d.stage) {
      ErpDealStage.lead => ErpDealStage.proposal,
      ErpDealStage.proposal => ErpDealStage.negotiation,
      ErpDealStage.negotiation => ErpDealStage.won,
      _ => null,
    };
    if (next == null) return;
    deals[idx] = d.copyWith(stage: next, probability: next.defaultProbability);
    notifyListeners();
  }

  void convertDealToInvoice(String dealId) {
    final idx = deals.indexWhere((d) => d.id == dealId);
    if (idx < 0) return;
    final deal = deals[idx];
    if (deal.convertedInvoiceEntryId != null) return;

    final entryNum = ++_nextEntryNumber;
    final entryId = 'led_${DateTime.now().millisecondsSinceEpoch}';
    ledger.insert(
      0,
      LedgerEntryRecord(
        id: entryId,
        accountId: deal.clientAccountId,
        accountName: deal.clientName,
        kind: LedgerKind.invoice,
        typeLabel: 'فاتورة مبيعات (CRM)',
        payment: PaymentMethod.credit,
        direction: EntryDirection.debit,
        amount: deal.value,
        currency: deal.currency,
        details: 'تحويل صفقة: ${deal.title}',
        documentNumber: 'CRM-$entryNum',
        entryNumber: entryNum,
        entryDate: DateTime.now().toIso8601String().substring(0, 10),
      ),
    );
    deals[idx] = deal.copyWith(
      stage: ErpDealStage.won,
      probability: 100,
      convertedInvoiceEntryId: entryId,
    );
    unawaited(_persistToDb());
    notifyListeners();
  }

  void addEmployee({
    required String name,
    required String roleTitle,
    required String department,
    required double basicSalary,
    required double allowances,
    required double deductions,
  }) {
    employees.insert(
      0,
      ErpEmployeeProfile(
        id: 'emp_${DateTime.now().millisecondsSinceEpoch}',
        name: name,
        roleTitle: roleTitle,
        department: department,
        basicSalary: basicSalary,
        allowances: allowances,
        deductions: deductions,
        hireDate: DateTime.now().toIso8601String().substring(0, 10),
      ),
    );
    notifyListeners();
  }

  void postPayrollToGl() {
    final total = AccountingEngine.computeTotalNetPayroll(employees);
    if (total <= 0) return;
    final empAcc = accounts.firstWhere(
      (a) => a.category == AccountCategory.employees,
      orElse: () => accounts.first,
    );
    final entryNum = ++_nextEntryNumber;
    ledger.insert(
      0,
      LedgerEntryRecord(
        id: 'led_${DateTime.now().millisecondsSinceEpoch}',
        accountId: empAcc.id,
        accountName: empAcc.name,
        kind: LedgerKind.voucher,
        typeLabel: 'ترحيل مسير الرواتب',
        payment: PaymentMethod.cash,
        direction: EntryDirection.debit,
        amount: total,
        details: 'مسير رواتب ${employees.length} موظفين',
        expenseCategory: 'رواتب وأجور',
        entryNumber: entryNum,
        entryDate: DateTime.now().toIso8601String().substring(0, 10),
      ),
    );
    unawaited(_persistToDb());
    notifyListeners();
  }

  void decideLeave(String leaveId, LeaveStatus status) {
    final idx = leaveRequests.indexWhere((l) => l.id == leaveId);
    if (idx < 0) return;
    final lv = leaveRequests[idx];
    leaveRequests[idx] = lv.copyWith(status: status);
    if (status == LeaveStatus.approved) {
      final empIdx = employees.indexWhere((e) => e.id == lv.employeeId);
      if (empIdx >= 0) {
        final emp = employees[empIdx];
        employees[empIdx] = emp.copyWith(
          leaveBalanceDays: (emp.leaveBalanceDays - lv.days).clamp(0, 999),
          attendanceToday: AttendanceStatus.leave,
        );
      }
    }
    notifyListeners();
  }

  void createPurchaseOrder({
    required AccountRecord supplier,
    required WarehouseRecord warehouse,
    required InventoryItemRecord item,
    required double quantity,
    required double unitCost,
  }) {
    final numCode = 101 + purchaseOrders.length;
    purchaseOrders.insert(
      0,
      ErpPurchaseOrder(
        id: 'po_${DateTime.now().millisecondsSinceEpoch}',
        poNumber: 'PO-2026-$numCode',
        supplierAccountId: supplier.id,
        supplierName: supplier.name,
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        orderDate: DateTime.now().toIso8601String().substring(0, 10),
        expectedDate: DateTime.now().toIso8601String().substring(0, 10),
        status: PurchaseOrderStatus.approved,
        lines: [
          ErpPurchaseOrderLine(
            inventoryItemId: item.id,
            itemName: item.name,
            unit: item.unit,
            quantity: quantity,
            unitCost: unitCost,
          ),
        ],
      ),
    );
    notifyListeners();
  }

  void receivePurchaseOrder(String poId) {
    final idx = purchaseOrders.indexWhere((p) => p.id == poId);
    if (idx < 0) return;
    final po = purchaseOrders[idx];
    if (po.status == PurchaseOrderStatus.received) return;

    for (final line in po.lines) {
      if (line.inventoryItemId == null) continue;
      final invIdx = inventory.indexWhere((i) => i.id == line.inventoryItemId);
      if (invIdx >= 0) {
        final item = inventory[invIdx];
        final nextCost = AccountingEngine.computeWeightedAverageCost(
          item.quantity,
          item.avgCost,
          line.quantity,
          line.unitCost,
        );
        inventory[invIdx] = item.copyWith(
          quantity: item.quantity + line.quantity,
          avgCost: nextCost,
        );
      }
    }

    final total = AccountingEngine.computePurchaseOrderTotal(po);
    final entryNum = ++_nextEntryNumber;
    final entryId = 'led_${DateTime.now().millisecondsSinceEpoch}';
    ledger.insert(
      0,
      LedgerEntryRecord(
        id: entryId,
        accountId: po.supplierAccountId,
        accountName: po.supplierName,
        kind: LedgerKind.invoice,
        typeLabel: 'ف.مشتريات (استلام PO)',
        payment: PaymentMethod.credit,
        direction: EntryDirection.credit,
        amount: total,
        details: 'استلام أمر شراء ${po.poNumber}',
        documentNumber: po.poNumber,
        warehouseId: po.warehouseId,
        warehouseName: po.warehouseName,
        entryNumber: entryNum,
        entryDate: DateTime.now().toIso8601String().substring(0, 10),
      ),
    );
    purchaseOrders[idx] = po.copyWith(
      status: PurchaseOrderStatus.received,
      postedLedgerEntryId: entryId,
    );
    unawaited(_persistToDb());
    notifyListeners();
  }

  String? completeProductionOrder(String orderId) {
    final idx = productionOrders.indexWhere((o) => o.id == orderId);
    if (idx < 0) return 'الأمر غير موجود';
    final order = productionOrders[idx];
    if (order.status == ProductionOrderStatus.completed) return null;

    final bom = boms.firstWhere((b) => b.id == order.bomId);
    for (final comp in bom.components) {
      final raw = inventory.firstWhere((i) => i.id == comp.inventoryItemId);
      final req = comp.quantityPerUnit * order.quantityToProduce;
      if (raw.quantity < req) {
        return 'نقص في الخامة: ${comp.itemName}';
      }
    }

    for (final comp in bom.components) {
      final invIdx = inventory.indexWhere((i) => i.id == comp.inventoryItemId);
      if (invIdx >= 0) {
        final raw = inventory[invIdx];
        inventory[invIdx] = raw.copyWith(
          quantity: raw.quantity - (comp.quantityPerUnit * order.quantityToProduce),
        );
      }
    }

    final fgIdx = inventory.indexWhere((i) => i.id == order.finishedItemId);
    if (fgIdx >= 0) {
      final fg = inventory[fgIdx];
      inventory[fgIdx] = fg.copyWith(quantity: fg.quantity + order.quantityToProduce);
    }

    productionOrders[idx] = order.copyWith(
      status: ProductionOrderStatus.completed,
      completedDate: DateTime.now().toIso8601String().substring(0, 10),
    );
    notifyListeners();
    return null;
  }
}
