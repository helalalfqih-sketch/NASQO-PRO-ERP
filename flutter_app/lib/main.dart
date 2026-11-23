import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'hybrid/hybrid_react_preview_screen.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'screens/dashboard_screen.dart';
import 'screens/erp_hub_screen.dart';
import 'screens/finance_screen.dart';
import 'screens/hr_screen.dart';
import 'screens/manufacturing_screen.dart';
import 'screens/pos_crm_screen.dart';
import 'screens/procurement_screen.dart';
import 'state/erp_controller.dart';

void main() {
  runApp(const NasqoProErpApp());
}

class NasqoProErpApp extends StatefulWidget {
  const NasqoProErpApp({super.key});

  @override
  State<NasqoProErpApp> createState() => _NasqoProErpAppState();
}

class _NasqoProErpAppState extends State<NasqoProErpApp> {
  final ErpController _controller = ErpController();
  bool _showNativeInDebug = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _controller,
      builder: (context, _) {
        final colorScheme = ColorScheme.fromSeed(
          seedColor: const Color(0xFF0B5CA8),
          secondary: const Color(0xFFF39A16),
          brightness:
              _controller.isDarkMode ? Brightness.dark : Brightness.light,
        );

        return MaterialApp(
          title: 'نسقو برو ERP',
          debugShowCheckedModeBanner: false,
          locale: const Locale('ar'),
          supportedLocales: const [Locale('ar'), Locale('en')],
          localizationsDelegates: const [
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          theme: ThemeData(
            useMaterial3: true,
            colorScheme: colorScheme,
            appBarTheme: const AppBarTheme(
              backgroundColor: Color(0xFF0B5CA8),
              foregroundColor: Colors.white,
              centerTitle: false,
            ),
          ),
          home: Directionality(
            textDirection: TextDirection.rtl,
            child: kDebugMode &&
                    defaultTargetPlatform == TargetPlatform.android &&
                    !_showNativeInDebug
                ? HybridReactPreviewScreen(
                    onShowNative: () => setState(() => _showNativeInDebug = true),
                  )
                : NasqoMainShell(controller: _controller),
          ),
        );
      },
    );
  }
}

class NasqoMainShell extends StatefulWidget {
  const NasqoMainShell({super.key, required this.controller});
  final ErpController controller;

  @override
  State<NasqoMainShell> createState() => _NasqoMainShellState();
}

class _NasqoMainShellState extends State<NasqoMainShell> {
  int _navIndex = 0;

  void _openModulePage(String moduleId) {
    final (title, Widget page) = switch (moduleId) {
      'finance' => (
          'القوائم المالية والأستاذ العام',
          FinanceScreen(controller: widget.controller)
        ),
      'crm' => (
          'المبيعات ونقطة البيع',
          PosCrmScreen(controller: widget.controller)
        ),
      'hr' => (
          'الموارد البشرية والرواتب',
          HrScreen(controller: widget.controller)
        ),
      'procurement' => (
          'المشتريات وسلسلة التوريد',
          ProcurementScreen(controller: widget.controller)
        ),
      'manufacturing' => (
          'التصنيع ومراكز التكلفة',
          ManufacturingScreen(controller: widget.controller)
        ),
      _ => (
          'مركز الـ ERP',
          ErpHubScreen(
            controller: widget.controller,
            onOpenModule: _openModulePage,
          )
        ),
    };

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => Directionality(
          textDirection: TextDirection.rtl,
          child: Scaffold(
            appBar: AppBar(title: Text(title)),
            body: ListenableBuilder(
              listenable: widget.controller,
              builder: (_, __) => page,
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      DashboardScreen(
        controller: widget.controller,
        onNavigateTab: (i) => setState(() => _navIndex = i),
        onOpenModule: _openModulePage,
      ),
      ErpHubScreen(
        controller: widget.controller,
        onOpenModule: _openModulePage,
      ),
      PosCrmScreen(controller: widget.controller),
      FinanceScreen(controller: widget.controller),
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('نسقو برو ERP — Flutter'),
        actions: [
          if (kDebugMode && defaultTargetPlatform == TargetPlatform.android)
            IconButton(
              tooltip: 'معاينة واجهة React محليًا (قراءة فقط)',
              icon: const Icon(Icons.web_asset_outlined),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const HybridReactPreviewScreen(),
                ),
              ),
            ),
          IconButton(
            tooltip: 'تبديل المظهر',
            onPressed: widget.controller.toggleTheme,
            icon: Icon(
              widget.controller.isDarkMode ? Icons.light_mode : Icons.dark_mode,
            ),
          ),
        ],
      ),
      drawer: Drawer(
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            DrawerHeader(
              decoration: const BoxDecoration(color: Color(0xFF0B5CA8)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  const Icon(Icons.layers, color: Color(0xFFF39A16), size: 38),
                  const SizedBox(height: 8),
                  Text(
                    widget.controller.companyName,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const Text(
                    'نسخة Flutter المتكاملة (Dart 3)',
                    style: TextStyle(color: Colors.white70, fontSize: 12),
                  ),
                ],
              ),
            ),
            ListTile(
              leading: const Icon(Icons.dashboard),
              title: const Text('لوحة التحكم'),
              onTap: () {
                Navigator.pop(context);
                setState(() => _navIndex = 0);
              },
            ),
            ListTile(
              leading: const Icon(Icons.hub),
              title: const Text('مركز قيادة الـ ERP'),
              onTap: () {
                Navigator.pop(context);
                setState(() => _navIndex = 1);
              },
            ),
            ListTile(
              leading: const Icon(Icons.bar_chart),
              title: const Text('القوائم المالية والأستاذ العام'),
              onTap: () {
                Navigator.pop(context);
                _openModulePage('finance');
              },
            ),
            ListTile(
              leading: const Icon(Icons.point_of_sale),
              title: const Text('نقطة البيع و CRM'),
              onTap: () {
                Navigator.pop(context);
                _openModulePage('crm');
              },
            ),
            ListTile(
              leading: const Icon(Icons.local_shipping),
              title: const Text('المشتريات وسلسلة التوريد'),
              onTap: () {
                Navigator.pop(context);
                _openModulePage('procurement');
              },
            ),
            ListTile(
              leading: const Icon(Icons.people),
              title: const Text('الموارد البشرية والرواتب'),
              onTap: () {
                Navigator.pop(context);
                _openModulePage('hr');
              },
            ),
            ListTile(
              leading: const Icon(Icons.precision_manufacturing),
              title: const Text('التصنيع (BOM) ومراكز التكلفة'),
              onTap: () {
                Navigator.pop(context);
                _openModulePage('manufacturing');
              },
            ),
          ],
        ),
      ),
      body: pages[_navIndex],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _navIndex,
        onDestinationSelected: (i) => setState(() => _navIndex = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: 'الرئيسية',
          ),
          NavigationDestination(
            icon: Icon(Icons.rocket_launch_outlined),
            selectedIcon: Icon(Icons.rocket_launch),
            label: 'ERP',
          ),
          NavigationDestination(
            icon: Icon(Icons.point_of_sale_outlined),
            selectedIcon: Icon(Icons.point_of_sale),
            label: 'POS',
          ),
          NavigationDestination(
            icon: Icon(Icons.bar_chart_outlined),
            selectedIcon: Icon(Icons.bar_chart),
            label: 'المالية',
          ),
        ],
      ),
    );
  }
}
