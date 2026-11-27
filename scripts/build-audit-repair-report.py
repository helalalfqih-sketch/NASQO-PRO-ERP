from pathlib import Path
import csv,json,collections,subprocess,hashlib
R=Path('deliverables/audit-repairs');OLD=R/'baseline'
sha=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
product_sha='6f615b6d9aed413bf4ba2ca9588740cd125dc467'
def dump(name,data):(R/name).write_text(json.dumps(data,ensure_ascii=False,indent=2))
def load(p):return json.loads(p.read_text())
rows=list(csv.DictReader((OLD/'actions.csv').open(encoding='utf-8-sig')))
browser={r['id']:r for r in load(R/'browser-final/results.json')['results']}
fidelity={r['name']:r for r in load(R/'regression-final/backup-fidelity/results.json')['results']}
# Explicit mappings only. No status upgrade from source scanning or a shared handler.
updates={
'UI-share-pdf':'attachment-PDF','UI-share-excel':'attachment-Excel','UI-share-image':'attachment-صورة',
'UI-save-excel':'statement-currencies-scope','UI-save-image':'large-516-image-pages',
'UI-inventory-share-context':'inventory-search-single-and-context','UI-balance-confirmation':'balance-confirmation-template',
'UI-sales-exports-purchases':'sales-exports-own-category','UI-inventory-search-export-scope':'inventory-search-single-and-context',
'UI-erp-employee-not-persisted':'employee-confirmed-create-edit-reject-double-click','UI-backup-cancel-success-message':'backup-cancel-honest',
'UI-items-template-browser-only':'native-template-csv-cancel','UI-finance-excel-browser-only':'finance-native-xlsx',
'CAT-item-4':'catalog-cancel-preserves-unsaved',
}
for r in rows:
 r['baselineStatus']=r['status'];r['baselineSha']=r['sha'];r['currentVerification']='لم يُعَد اختبار هذا الصف؛ الدليل السابق من نسخته الأصلية فقط'
 if r['id'].startswith('FID-') and fidelity.get(r['id'][4:],{}).get('passed'):
  r.update(sha=product_sha,version='نسخة العمل',evidence='regression-final/backup-fidelity/results.json#'+r['id'][4:],currentVerification='أعيد هذا الاختبار بعينه في نسخة العمل؛ كان الإصلاح قائمًا فلم يعاد تنفيذه',level='Chromium وجسر اصطناعي؛ ليس Android',android='ليس مسار Android كاملًا')
 case=updates.get(r['id'])
 if case and browser[case]['execution']=='observed':
  r.update(status='ناجح بدليل',version='نسخة العمل المرشحة، ليست إصدارًا منشورًا',sha=product_sha,level='Chromium 360×800 وجسر اصطناعي؛ SQLite منفصل عند الحفظ',evidence='browser-final/results.json#'+case,currentVerification='أعيد اختباره في نسخة العمل',actual='نجحت التأكيدات المحددة في '+case,android='ليس مسار Android كاملًا')
 if r['id']=='OUT-sale-pdf':r.update(status='ناجح بدليل',sha=product_sha,version='نسخة العمل',evidence='performance-after/results.json + pdf-page-{1,7,13,26}.png',currentVerification='قصيرة و150 بندًا؛ 13 صفحة جدول + 13 ملحق مصدر',level='Chromium + قارئ PyMuPDF مستقل',actual='150 معرفًا بالترتيب مرة واحدة في الجدول؛ 2,400 إجمالي؛ ترويسة متكررة')
 if r['id']=='BASE-currency':r.update(status='ناجح بدليل',sha=product_sha,version='نسخة العمل',evidence='currency-route/results.json',currentVerification='كان مصححًا بالفعل؛ أثبته اختبار شاشة صرف العملات دون تغيير التنفيذ',actual='فتحت الشاشة دون KeyboardProvider error؛ لم يختبر ترحيل الصرف')
 if r['id']=='UI-send-image':r.update(status='جزئي',sha=product_sha,currentVerification='الزر السابق أزيل؛ البديل مشاركة يحترم الصورة. لم تُختبر عملية إرسال لجهة خارجية',actual='نافذة مشاركة مرفق فقط؛ لا ادعاء إرسال تلقائي')
 if r['id'] in ['CAT-cashbox-0','CAT-cashbox-3']:r.update(status='جزئي',sha=product_sha,evidence='references/results.json#voucher-new-cashbox-return + logs/flutter-final.log',currentVerification='إضافة وعودة من السند بمتصفح؛ تعديل/أرشفة في SQLite منفصل',actual='الحساب والصندوق مرجعان؛ لم يرحل السند الأب')
 if r['id'] in ['SET-passwordLock','SET-backupReminderOnExit','SET-sellWithoutBalance']:r.update(status='جزئي',sha=product_sha,evidence='references/results.json#settings-legacy-on + logs/flutter-final.log',currentVerification='تفضيل قديم true وfalse: عرض غير متاح؛ لم يُنفذ قفل أو تذكير',actual='لا تجاوز لحارس المخزون. البيع فوق الرصيد يفشل دون تغيير كامل تصدير القاعدة في الحالتين')
 if r['id'].startswith('G') and r['id'] in ['G01-cash-sale','G02-report-trace','G03-duplicate-ack-loss','G04-mid-save-rollback','G05-partial-return','G06-credit-sale','G07-purchase','G08-receipt-payment','G09-linked-delete-guard','G10-native-backup-restore','G11-disk-reopen-offline']:
  r.update(sha=product_sha,version='نسخة العمل',evidence='logs/flutter-final.log; flutter_app/test/owner_acceptance_test.dart',currentVerification='أعيد في SQLite الحقيقي؛ بقي جزئيًا لعدم إثبات الرحلة الهاتفية كاملة')
 if r['id'] in ['GAP-3','GAP-4','GAP-5','GAP-6']:
  r.update(status='ناجح بدليل' if r['id']!='GAP-6' else 'جزئي',sha='6f980410790346a385d27c12753db65d692d952e',version='APK debug 6f98041',evidence='android-final/NASQO_ACCEPTANCE.log',currentVerification='Android API35 محاكي فعلي، قناة أصلية وتطبيق استقبال منفصل',level='Android emulator',android='اختبار أصلي مباشر',actual='إلغاء منتقي الحفظ null؛ قارئ PDF/PNG واسم/MIME/SHA؛ XLSX قارئ ZIP/XML تجريبي، وليس Excel تجاريًا')
 if r['id'] in ['GAP-7','GAP-8']:r.update(status='جزئي',sha='6f980410790346a385d27c12753db65d692d952e',evidence='android-final/NASQO_LIFECYCLE.log',currentVerification='Home/relaunch/force-stop نفذت؛ السجل يميز process/WebView/load. لا يثبت حفظ شاشة مسودة مكتملة')
 if r['id'] in ['UI-erp-employee-not-persisted','UI-inventory-share-context']:
  r.update(sha='6f980410790346a385d27c12753db65d692d952e',version='APK debug 6f98041',level='Android API35 emulator + SQLite reader/independent receiver',evidence=r['evidence']+'; android-final/NASQO_ACCEPTANCE.log',android='اختبار أصلي مباشر',currentVerification='إنشاء الموظف من نقرة إلى SQLite مرة واحدة؛ أو تقرير المخزون الفارغ من نقرة إلى PDF وreceiver، بحسب الصف. بقية حالات التحرير/الفلترة لها دليل Chromium منفصل')
 if r['id']=='GAP-16':r['currentVerification']='ERP-001-RET-LATE مؤجل صراحة؛ لم يُشغّل الاختبار المستبعد'
for r in rows:
 if r['sha']==product_sha:r['version']='نسخة العمل، ليست إصدارًا منشورًا'
 if r['sha']=='6f980410790346a385d27c12753db65d692d952e':r['version']='APK debug 6f98041'
with (R/'actions-current.csv').open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=list(rows[0]),lineterminator='\n');w.writeheader();w.writerows(rows)
dump('actions-current.json',rows)
dump('coverage.json',{'baseline':{'ناجح بدليل':55,'فاشل':13,'جزئي':127,'لم يُختبر':94,'directAndroid':0},'afterEvidenceLedger':dict(collections.Counter(r['status'] for r in rows)),'rows':len(rows),'recheckedOrQualified':sum(r['currentVerification']!='لم يُعَد اختبار هذا الصف؛ الدليل السابق من نسخته الأصلية فقط' for r in rows),'directAndroidRows':sum(r['android']=='اختبار أصلي مباشر' for r in rows),'warning':'المجموع دفتر أدلة بإصدارات مختلفة؛ الصفوف الباقية تحتفظ بالدليل القديم ولا تعني نجاحها على APK الحالي. ليس 289 اختبار هاتف.'})
settings=load(OLD/'settings/matrix.json')
for r in settings:
 r['nativeStorageCurrent']='77 إعدادًا في test/settings_persistence_test.dart؛ مقارنة قارئ SQLite مستقل؛ التخزين ليس أثرًا سلوكيًا'
 r['currentEffectVerification']='لم يعاد إثبات أثر التفعيل والإيقاف؛ يبقى جزئيًا أو بدليل الإصدار القديم'
 if r['key'] in ['passwordLock','backupReminderOnExit','sellWithoutBalance']:r['currentEffectVerification']='true/false محفوظان سابقًا؛ عرض غير متاح وغير مفعل في Android hybrid. سلبيات المخزون مرفوضة فعليًا من SQLite. لا قفل ولا تذكير مصطنع.'
dump('settings-77-current.json',settings)
dump('manifest.json',{'repository':'helalalfqih-sketch/NASQO-PRO-ERP','branch':'agent/cloud-session-hardening-v1118','productSha':product_sha,'reportBaseSha':sha,'testHarnessSha':'6f980410790346a385d27c12753db65d692d952e','publishedBranchUntouched':'dev/offline-first-android-phase2','publishedSha':'0a0b2414207166f783ea2bee2e64d4df4a4fa394','preservedPriorLocalCommits':['61f9736','e5e3b491435803e3e35438c1e28c9edee629b930'],'data':'synthetic only','deferred':'ERP-001-RET-LATE'})
(R/'modified-files.txt').write_text(subprocess.check_output(['git','diff','--name-status','e5e3b491435803e3e35438c1e28c9edee629b930',sha],text=True))
print(json.dumps(load(R/'coverage.json'),ensure_ascii=False))
