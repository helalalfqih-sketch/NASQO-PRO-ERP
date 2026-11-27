package com.nasqo.audit;

import android.app.*;
import android.os.*;
import android.content.*;
import android.view.accessibility.AccessibilityNodeInfo;
import java.io.*;
import java.lang.reflect.Method;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import io.flutter.plugin.common.MethodCall;
import io.flutter.plugin.common.MethodChannel;

/** Runs in the debug app; receiver runs separately and reads a granted content URI. */
public class DocumentInstrumentation extends Instrumentation {
  public void onCreate(Bundle b){super.onCreate(b);start();}
  public void onStart(){
    Bundle status=new Bundle();
    try {
      android.accessibilityservice.AccessibilityServiceInfo info=getUiAutomation().getServiceInfo();
      info.eventTypes=android.view.accessibility.AccessibilityEvent.TYPES_ALL_MASK;
      info.flags|=android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS|android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
      getUiAutomation().setServiceInfo(info);
      Activity activity=startActivitySync(new Intent().setClassName(getTargetContext(),"com.indexesstore.nasqo_pro_erp.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      Thread.sleep(5000);
      Method output=activity.getClass().getDeclaredMethod("documentOutput",MethodCall.class,MethodChannel.Result.class);output.setAccessible(true);
      for(String ext: new String[]{"pdf","xlsx","png"}) {
        String name="fixture."+ext;
        String mime=ext.equals("pdf")?"application/pdf":ext.equals("png")?"image/png":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        File root=new File(activity.getCacheDir(),"nasqo-document-export");root.mkdirs();File source=new File(root,name);
        try(InputStream in=getContext().getAssets().open(name);OutputStream out=new FileOutputStream(source)){byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);}
        byte[] expected;try(InputStream in=new FileInputStream(source)){MessageDigest sha=MessageDigest.getInstance("SHA-256");byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1)sha.update(buf,0,n);expected=sha.digest();}
        CountDownLatch received=new CountDownLatch(1);Intent[] result={null};
        BroadcastReceiver receiver=new BroadcastReceiver(){public void onReceive(Context c,Intent i){result[0]=i;received.countDown();}};
        activity.registerReceiver(receiver,new IntentFilter("com.nasqo.audit.RECEIVED"),Context.RECEIVER_EXPORTED);
        Map<String,Object> args=new HashMap<>();args.put("path",source.getPath());args.put("fileName",name);args.put("mimeType",mime);
        runOnMainSync(()->{try{output.invoke(activity,new MethodCall("shareDocument",args),callback());}catch(Exception e){throw new RuntimeException(e);}});
        boolean selected=false;for(int i=0;i<30&&!selected;i++){Thread.sleep(500);selected=clickReceiver(getUiAutomation().getRootInActiveWindow());}
        if(!selected||!received.await(15,TimeUnit.SECONDS))throw new AssertionError("receiver not reached: "+ext);
        activity.unregisterReceiver(receiver);
        Intent r=result[0];if(!r.getBooleanExtra("ok",false))throw new AssertionError(r.getStringExtra("error"));
        if(!name.equals(r.getStringExtra("name"))||!mime.equals(r.getStringExtra("mime"))||!ReceiverActivity.hex(expected).equals(r.getStringExtra("sha")))throw new AssertionError("attachment mismatch");
        android.util.Log.i("NASQO_ACCEPTANCE","receiver "+ext+" bytes/name/MIME/readability PASS");
        getUiAutomation().takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG,100,new FileOutputStream(new File(activity.getFilesDir(),"receiver-"+ext+".png")));
      }
      // System picker cancellation: no output path and no success claim.
      Method picker=activity.getClass().getDeclaredMethod("backupPicker",MethodCall.class,MethodChannel.Result.class);picker.setAccessible(true);
      Map<String,Object> args=new HashMap<>();File source=new File(activity.getCacheDir(),"nasqo-document-export/fixture.pdf");args.put("path",source.getPath());args.put("fileName","fixture.pdf");args.put("mimeType","application/pdf");
      CountDownLatch canceled=new CountDownLatch(1);Object[] value={"not-returned"};
      runOnMainSync(()->{try{picker.invoke(activity,new MethodCall("exportDocument",args),new MethodChannel.Result(){public void success(Object o){value[0]=o;canceled.countDown();}public void error(String c,String m,Object d){value[0]=m;canceled.countDown();}public void notImplemented(){}});}catch(Exception e){throw new RuntimeException(e);}});
      // The create-document dialog opens its filename IME. First back dismisses
      // the IME, second back cancels the picker, as on a real Android phone.
      Thread.sleep(4000);
      for(int attempt=0;attempt<3&&canceled.getCount()>0;attempt++){
        getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);
        canceled.await(3,TimeUnit.SECONDS);
      }
      if(!canceled.await(10,TimeUnit.SECONDS)||value[0]!=null)throw new AssertionError("save cancellation did not return null: "+value[0]);
      android.util.Log.i("NASQO_ACCEPTANCE","system save picker cancellation PASS");
      CountDownLatch unexpectedReceiver=new CountDownLatch(1);
      BroadcastReceiver canceledShare=new BroadcastReceiver(){public void onReceive(Context c,Intent i){unexpectedReceiver.countDown();}};
      activity.registerReceiver(canceledShare,new IntentFilter("com.nasqo.audit.RECEIVED"),Context.RECEIVER_EXPORTED);
      runOnMainSync(()->{try{output.invoke(activity,new MethodCall("shareDocument",args),callback());}catch(Exception e){throw new RuntimeException(e);}});
      Thread.sleep(2000);getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);
      if(unexpectedReceiver.await(2,TimeUnit.SECONDS))throw new AssertionError("canceled chooser delivered a file");
      activity.unregisterReceiver(canceledShare);
      android.util.Log.i("NASQO_ACCEPTANCE","share chooser canceled, no receiver delivery PASS");
      // Real ACTION_OPEN_DOCUMENT -> file bytes -> review -> native SQLite.
      createDownload(activity,"nasqo-import-items.csv","اسم الصنف,الباركود,سعر الشراء,سعر البيع,الحالة\nصنف Android مستورد,000123,17.5,25,خامل");
      createDownload(activity,"nasqo-import-accounts.csv","الاسم,الهاتف,التصنيف,العملة\n\"شركة, فرع Android\",001234,العملاء,ريال");
      Thread.sleep(1500);
      clickText("ملف الأصناف");clickText("خيارات بطاقات الأصناف");clickText("استيراد أصناف");
      chooseImportFile("nasqo-import-items.csv");
      clickText("راجعت الصفوف والتصنيف والعملة وأوافق على إضافة البطاقات الجديدة فقط");
      getUiAutomation().takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG,100,new FileOutputStream(new File(activity.getFilesDir(),"import-items-review.png")));
      clickText("استيراد البطاقات");Thread.sleep(1200);
      android.database.sqlite.SQLiteDatabase importedDb=android.database.sqlite.SQLiteDatabase.openDatabase(activity.getDatabasePath("nasqo_pro_erp.db").getPath(),null,android.database.sqlite.SQLiteDatabase.OPEN_READONLY);
      android.database.Cursor importedItem=importedDb.rawQuery("SELECT i.sku,i.quantity,i.avgCost,i.warehouseId,u.settings_json FROM inventory_items i JOIN inventory_unit_settings u ON u.item_id=i.id WHERE i.name=?",new String[]{"صنف Android مستورد"});
      if(!importedItem.moveToFirst()||!"000123".equals(importedItem.getString(0))||importedItem.getDouble(1)!=0||importedItem.getDouble(2)!=0||!"".equals(importedItem.getString(3)))throw new AssertionError("imported catalog identity/stock mismatch");
      org.json.JSONObject settings=new org.json.JSONObject(importedItem.getString(4));
      if(settings.getDouble("catalogReferenceCost")!=17.5||settings.getBoolean("isActive"))throw new AssertionError("reference cost or inactive status changed");
      importedItem.close();importedDb.close();
      android.util.Log.i("NASQO_ACCEPTANCE","UI catalog import picker -> preview -> SQLite: zero stock, unassigned, reference price, barcode PASS");
      clickText("رجوع");clickText("فتح القائمة");clickText("استيراد الحسابات من ملف");
      chooseImportFile("nasqo-import-accounts.csv");
      clickText("راجعت الصفوف والتصنيف والعملة وأوافق على إضافة البطاقات الجديدة فقط");
      getUiAutomation().takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG,100,new FileOutputStream(new File(activity.getFilesDir(),"import-accounts-review.png")));
      clickText("استيراد البطاقات");Thread.sleep(1200);
      importedDb=android.database.sqlite.SQLiteDatabase.openDatabase(activity.getDatabasePath("nasqo_pro_erp.db").getPath(),null,android.database.sqlite.SQLiteDatabase.OPEN_READONLY);
      android.database.Cursor importedAccount=importedDb.rawQuery("SELECT phone,openingBalance,category FROM accounts WHERE name=?",new String[]{"شركة, فرع Android"});
      if(!importedAccount.moveToFirst()||!"001234".equals(importedAccount.getString(0))||importedAccount.getDouble(1)!=0||!"clients".equals(importedAccount.getString(2)))throw new AssertionError("imported account fields changed");
      importedAccount.close();
      for(String table:new String[]{"ledger_entries","stock_movements"}){android.database.Cursor count=importedDb.rawQuery("SELECT COUNT(*) FROM "+table,null);count.moveToFirst();if(count.getInt(0)!=0)throw new AssertionError("catalog import created financial/stock writes");count.close();}
      importedDb.close();
      android.util.Log.i("NASQO_ACCEPTANCE","UI account CSV picker -> preview -> SQLite: quotes, phone, category, no financial postings PASS");
      // Actual UI -> React -> bridge -> SQLite. No injected database or JS writes.
      Thread.sleep(1500);
      clickText("فتح القائمة");
      clickText("الموارد البشرية والرواتب");
      clickText("موظف جديد");
      AccessibilityNodeInfo field=waitNode("الاسم الكامل للموظف",true);
      Bundle input=new Bundle();input.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,"موظف Android اصطناعي");
      if(!field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,input))throw new AssertionError("employee input failed");
      clickText("حفظ بيانات الموظف");
      Thread.sleep(2000);
      File dbFile=activity.getDatabasePath("nasqo_pro_erp.db");
      android.database.sqlite.SQLiteDatabase db=android.database.sqlite.SQLiteDatabase.openDatabase(dbFile.getPath(),null,android.database.sqlite.SQLiteDatabase.OPEN_READONLY);
      android.database.Cursor c=db.rawQuery("SELECT payloadJson FROM erp_state WHERE stateKey LIKE 'erp-record:employees:%'",null);
      int employeeCount=0;while(c.moveToNext())if(c.getString(0).contains("موظف Android اصطناعي"))employeeCount++;
      c.close();db.close();if(employeeCount!=1)throw new AssertionError("UI employee not persisted once: "+employeeCount);
      getUiAutomation().takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG,100,new FileOutputStream(new File(activity.getFilesDir(),"employee-sqlite.png")));
      android.util.Log.i("NASQO_ACCEPTANCE","UI employee click -> React -> bridge -> SQLite exactly once PASS");
      // A separate complete click-to-file path from the empty synthetic inventory.
      clickText("رجوع");clickText("حركة المخزون");clickText("طباعة التقرير");
      CountDownLatch uiReceived=new CountDownLatch(1);Intent[] uiResult={null};
      BroadcastReceiver uiReceiver=new BroadcastReceiver(){public void onReceive(Context c,Intent i){uiResult[0]=i;uiReceived.countDown();}};
      activity.registerReceiver(uiReceiver,new IntentFilter("com.nasqo.audit.RECEIVED"),Context.RECEIVER_EXPORTED);
      clickText("مشاركة");
      boolean uiSelected=false;for(int i=0;i<30&&!uiSelected;i++){Thread.sleep(500);uiSelected=clickReceiver(getUiAutomation().getRootInActiveWindow());}
      if(!uiSelected||!uiReceived.await(15,TimeUnit.SECONDS))throw new AssertionError("UI inventory PDF receiver not reached");
      activity.unregisterReceiver(uiReceiver);
      if(!uiResult[0].getBooleanExtra("ok",false)||!"application/pdf".equals(uiResult[0].getStringExtra("mime"))||!uiResult[0].getStringExtra("name").contains("inventory"))throw new AssertionError("UI inventory PDF identity/read failed");
      android.util.Log.i("NASQO_ACCEPTANCE","UI inventory report click -> PDF attachment -> independent receiver PASS");
      status.putString("stream","Android receiver: PDF/XLSX/PNG exact bytes, names, MIME, independent opening; canceled save picker PASS\n");finish(Activity.RESULT_OK,status);
    }catch(Throwable e){try{getUiAutomation().takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG,100,new FileOutputStream(new File(getTargetContext().getFilesDir(),"failure.png")));StringBuilder tree=new StringBuilder();dumpTree(getUiAutomation().getRootInActiveWindow(),tree,0);try(FileOutputStream dump=new FileOutputStream(new File(getTargetContext().getFilesDir(),"failure-tree.txt"))){dump.write(tree.toString().getBytes("UTF-8"));}}catch(Throwable ignored){}android.util.Log.e("NASQO_ACCEPTANCE","FAIL",e);status.putString("stream",e.toString());finish(Activity.RESULT_CANCELED,status);}
  }
  private void createDownload(Activity activity,String name,String content)throws Exception{
    android.content.ContentValues values=new android.content.ContentValues();
    values.put(android.provider.MediaStore.Downloads.DISPLAY_NAME,name);values.put(android.provider.MediaStore.Downloads.MIME_TYPE,"text/csv");
    values.put(android.provider.MediaStore.Downloads.RELATIVE_PATH,android.os.Environment.DIRECTORY_DOWNLOADS);values.put(android.provider.MediaStore.Downloads.IS_PENDING,1);
    android.net.Uri uri=activity.getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);
    if(uri==null)throw new AssertionError("test file creation failed");
    try(OutputStream out=activity.getContentResolver().openOutputStream(uri)){out.write(content.getBytes("UTF-8"));}
    values.clear();values.put(android.provider.MediaStore.Downloads.IS_PENDING,0);activity.getContentResolver().update(uri,values,null,null);
  }
  private void chooseImportFile(String name)throws Exception{
    Thread.sleep(2000);
    if(findNode(getUiAutomation().getRootInActiveWindow(),name,false)==null){
      clickText("Show roots");clickText("Downloads");
    }
    clickText(name);waitNode("مراجعة استيراد "+(name.contains("items")?"بطاقات الأصناف":"بطاقات الحسابات"),false);
  }
  private boolean scrollForward(AccessibilityNodeInfo n){if(n==null)return false;for(int i=0;i<n.getChildCount();i++)if(scrollForward(n.getChild(i)))return true;return n.isScrollable()&&n.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD);}
  private void dumpTree(AccessibilityNodeInfo n,StringBuilder s,int depth){if(n==null||depth>25||s.length()>50000)return;s.append(n.getClassName()).append(" text=").append(n.getText()).append(" desc=").append(n.getContentDescription()).append(" hint=").append(n.getHintText()).append(" clickable=").append(n.isClickable()).append(" scroll=").append(n.isScrollable()).append("\n");for(int i=0;i<n.getChildCount();i++)dumpTree(n.getChild(i),s,depth+1);}
  private AccessibilityNodeInfo findNode(AccessibilityNodeInfo n,String label,boolean editable){
    if(n==null||!n.refresh())return null;
    String text=String.valueOf(n.getText())+" "+String.valueOf(n.getContentDescription())+" "+String.valueOf(n.getHintText());
    if((label.equals(String.valueOf(n.getText()))||label.equals(String.valueOf(n.getContentDescription()))||label.equals(String.valueOf(n.getHintText())))&&(!editable||n.isEditable()))return n;
    for(int i=0;i<n.getChildCount();i++){AccessibilityNodeInfo found=findNode(n.getChild(i),label,editable);if(found!=null)return found;}return null;
  }
  private AccessibilityNodeInfo waitNode(String label,boolean editable)throws Exception{
    for(int i=0;i<20;i++){AccessibilityNodeInfo n=findNode(getUiAutomation().getRootInActiveWindow(),label,editable);if(n!=null)return n;if(i%4==3)scrollForward(getUiAutomation().getRootInActiveWindow());Thread.sleep(500);}
    throw new AssertionError("UI node missing: "+label);
  }
  private void clickText(String label)throws Exception{
    AccessibilityNodeInfo n=waitNode(label,false);n.performAction(android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.getId());
    while(n!=null){if(n.isClickable()&&n.performAction(AccessibilityNodeInfo.ACTION_CLICK)){Thread.sleep(700);return;}n=n.getParent();}
    throw new AssertionError("UI not clickable: "+label);
  }
  private MethodChannel.Result callback(){return new MethodChannel.Result(){public void success(Object o){}public void error(String c,String m,Object d){throw new AssertionError(c+":"+m);}public void notImplemented(){throw new AssertionError("not implemented");}};}
  private boolean clickReceiver(AccessibilityNodeInfo node){if(node==null)return false;CharSequence text=node.getText();if(text!=null&&text.toString().contains("NASQO Test Receiver")){AccessibilityNodeInfo n=node;while(n!=null){if(n.isClickable())return n.performAction(AccessibilityNodeInfo.ACTION_CLICK);n=n.getParent();}}for(int i=0;i<node.getChildCount();i++)if(clickReceiver(node.getChild(i)))return true;return false;}
}
