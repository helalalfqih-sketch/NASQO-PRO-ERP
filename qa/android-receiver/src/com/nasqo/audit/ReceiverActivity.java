package com.nasqo.audit;

import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.net.Uri;
import android.graphics.BitmapFactory;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.*;
import java.security.MessageDigest;
import java.util.zip.*;

/** Separate APK/UID: opens only the synthetic attachment selected in the chooser. */
public class ReceiverActivity extends Activity {
  public void onCreate(Bundle saved) {
    super.onCreate(saved);
    Intent reply = new Intent("com.nasqo.audit.RECEIVED").setPackage("com.indexesstore.nasqo_pro_erp");
    try {
      Uri uri = getIntent().getParcelableExtra(Intent.EXTRA_STREAM);
      String mime = getContentResolver().getType(uri);
      String name;
      try (android.database.Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
        if(c == null || !c.moveToFirst()) throw new IOException("missing name");
        name = c.getString(0);
      }
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      try(InputStream in = getContentResolver().openInputStream(uri)) {
        byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1){bytes.write(buf,0,n);if(bytes.size()>16777216)throw new IOException("too large");}
      }
      byte[] data=bytes.toByteArray();
      if(name.endsWith(".pdf")) {
        try(ParcelFileDescriptor fd=getContentResolver().openFileDescriptor(uri,"r");PdfRenderer pdf=new PdfRenderer(fd)){
          if(pdf.getPageCount()<1)throw new IOException("empty PDF");
          try(PdfRenderer.Page page=pdf.openPage(0)) {if(page.getWidth()<1)throw new IOException("invalid PDF page");}
          reply.putExtra("pages",pdf.getPageCount());
        }
      } else if(name.endsWith(".png")) {
        android.graphics.Bitmap b=BitmapFactory.decodeByteArray(data,0,data.length);
        if(b==null||b.getWidth()!=1240||b.getHeight()!=1754)throw new IOException("invalid PNG");b.recycle();
      } else if(name.endsWith(".xlsx")) {
        boolean workbook=false, totals=false;
        try(ZipInputStream zip=new ZipInputStream(new ByteArrayInputStream(data))){ZipEntry e;while((e=zip.getNextEntry())!=null){
          if(e.getName().equals("xl/workbook.xml"))workbook=true;
          if(e.getName().equals("xl/worksheets/sheet2.xml")){
            ByteArrayOutputStream xml=new ByteArrayOutputStream();byte[] buf=new byte[2048];int n;while((n=zip.read(buf))!=-1)xml.write(buf,0,n);
            String s=xml.toString("UTF-8");totals=s.contains("<v>165</v>")&&s.contains("<v>21</v>");
          }
        }}
        if(!workbook||!totals)throw new IOException("XLSX workbook/currency totals missing");
      }
      reply.putExtra("sha",hex(MessageDigest.getInstance("SHA-256").digest(data))).putExtra("mime",mime).putExtra("name",name).putExtra("ok",true);
    } catch(Exception e){reply.putExtra("ok",false).putExtra("error",e.toString());}
    sendBroadcast(reply);finish();
  }
  static String hex(byte[] b){StringBuilder s=new StringBuilder();for(byte v:b)s.append(String.format("%02x",v));return s.toString();}
}
