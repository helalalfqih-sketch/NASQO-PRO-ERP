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
      Thread.sleep(2000);getUiAutomation().injectInputEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN,android.view.KeyEvent.KEYCODE_BACK),true);getUiAutomation().injectInputEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_UP,android.view.KeyEvent.KEYCODE_BACK),true);
      if(!canceled.await(10,TimeUnit.SECONDS)||value[0]!=null)throw new AssertionError("save cancellation did not return null");
      android.util.Log.i("NASQO_ACCEPTANCE","system save picker cancellation PASS");
      status.putString("stream","Android receiver: PDF/XLSX/PNG exact bytes, names, MIME, independent opening; canceled save picker PASS\n");finish(Activity.RESULT_OK,status);
    }catch(Throwable e){android.util.Log.e("NASQO_ACCEPTANCE","FAIL",e);status.putString("stream",e.toString());finish(Activity.RESULT_CANCELED,status);}
  }
  private MethodChannel.Result callback(){return new MethodChannel.Result(){public void success(Object o){}public void error(String c,String m,Object d){throw new AssertionError(c+":"+m);}public void notImplemented(){throw new AssertionError("not implemented");}};}
  private boolean clickReceiver(AccessibilityNodeInfo node){if(node==null)return false;CharSequence text=node.getText();if(text!=null&&text.toString().contains("NASQO Test Receiver")){AccessibilityNodeInfo n=node;while(n!=null){if(n.isClickable())return n.performAction(AccessibilityNodeInfo.ACTION_CLICK);n=n.getParent();}}for(int i=0;i<node.getChildCount();i++)if(clickReceiver(node.getChild(i)))return true;return false;}
}
