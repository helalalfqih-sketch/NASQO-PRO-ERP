import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/firebase_sync_auth.dart';

/// Optional cloud identity, separate from the device's accounting workspace.
/// Signing in never enrolls a local database or enables synchronization.
class CloudIdentityScreen extends StatefulWidget {
  const CloudIdentityScreen({super.key});

  @override
  State<CloudIdentityScreen> createState() => _CloudIdentityScreenState();
}

class _CloudIdentityScreenState extends State<CloudIdentityScreen> {
  bool _busy = true;
  User? _user;
  String? _status;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      await FirebaseSyncAuth.initialize();
      if (mounted) setState(() => _user = FirebaseAuth.instance.currentUser);
    } catch (_) {
      if (mounted) {
        setState(() => _status = 'إعداد Firebase غير متاح في هذه النسخة.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _signIn() async {
    if (_busy) return;
    setState(() { _busy = true; _status = null; });
    try {
      final result = await FirebaseSyncAuth.signInWithGoogle();
      if (!mounted) return;
      setState(() {
        if (result == null) {
          _status = 'تم إلغاء تسجيل الدخول.';
        } else {
          _user = result.user;
          _status = 'تم التحقق من الحساب. المزامنة غير مفعّلة.';
        }
      });
    } on PlatformException catch (e) {
      if (!mounted) return;
      setState(() => _status = e.code == 'network_error'
          ? 'تعذر الاتصال بخدمة Google. يمكنك متابعة العمل محليًا.'
          : 'تعذر تسجيل الدخول بحساب Google. تحقق من اتصال الإنترنت وإعداد شهادة التطبيق.');
    } on FirebaseAuthException catch (e) {
      if (!mounted) return;
      setState(() => _status = e.code == 'network-request-failed'
          ? 'لا يوجد اتصال بخدمة Firebase.'
          : 'لم يكتمل التحقق عبر Firebase. تحقق من إعدادات تسجيل الدخول.');
    } catch (_) {
      if (mounted) setState(() => _status = 'تعذر إكمال تسجيل الدخول.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _signOut() async {
    if (_busy) return;
    setState(() { _busy = true; _status = null; });
    try {
      await FirebaseSyncAuth.signOut();
      if (mounted) setState(() { _user = null; _status = 'تم تسجيل الخروج من الحساب السحابي.'; });
    } catch (_) {
      if (mounted) setState(() {
        _user = FirebaseAuth.instance.currentUser;
        _status = 'تعذر إكمال تسجيل الخروج من جميع خدمات الهوية.';
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('الحساب السحابي')),
        body: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            const Icon(Icons.account_circle_outlined, size: 64),
            const SizedBox(height: 12),
            const Text('حساب Google اختياري', textAlign: TextAlign.center,
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            const Text('تستمر قاعدة SQLite المحلية في العمل دون تسجيل الدخول. تسجيل الحساب لا يرفع بياناتك أو يفعّل المزامنة تلقائيًا.'),
            const SizedBox(height: 20),
            if (_busy) const LinearProgressIndicator(),
            if (_user != null) ...[
              Text(_user!.email ?? 'حساب Firebase', textDirection: TextDirection.ltr),
              const SizedBox(height: 8),
              Text(_user!.emailVerified ? 'البريد موثّق' : 'البريد غير موثّق'),
              OutlinedButton.icon(onPressed: _busy ? null : _signOut,
                icon: const Icon(Icons.logout), label: const Text('تسجيل الخروج')),
            ] else
              FilledButton.icon(
                onPressed: _busy || !FirebaseSyncAuth.configured ? null : _signIn,
                icon: const Icon(Icons.login),
                label: const Text('تسجيل الدخول بحساب Google'),
              ),
            if (_status != null) Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(_status!),
            ),
          ],
        ),
      ),
    );
  }
}
