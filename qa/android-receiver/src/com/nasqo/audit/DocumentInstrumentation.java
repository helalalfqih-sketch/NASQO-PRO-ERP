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
      status.putString("stream","Android receiver: PDF/XLSX/PNG exact bytes, names, MIME, independent opening; canceled save picker PASS\n");finish(Activity.RESULT_OK,status);
    }catch(Throwable e){android.util.Log.e("NASQO_ACCEPTANCE","FAIL",e);status.putString("stream",e.toString());finish(Activity.RESULT_CANCELED,status);}
  }
  private AccessibilityNodeInfo findNode(AccessibilityNodeInfo n,String label,boolean editable){
    if(n==null)return null;
    String text=String.valueOf(n.getText())+" "+String.valueOf(n.getContentDescription())+" "+String.valueOf(n.getHintText());
    if(text.contains(label)&&(!editable||n.isEditable()))return n;
    for(int i=0;i<n.getChildCount();i++){AccessibilityNodeInfo found=findNode(n.getChild(i),label,editable);if(found!=null)return found;}return null;
  }
  private AccessibilityNodeInfo waitNode(String label,boolean editable)throws Exception{
    for(int i=0;i<20;i++){AccessibilityNodeInfo n=findNode(getUiAutomation().getRootInActiveWindow(),label,editable);if(n!=null)return n;Thread.sleep(500);}
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
