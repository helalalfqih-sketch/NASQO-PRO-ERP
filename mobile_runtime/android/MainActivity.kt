package com.indexesstore.nasqo_original_web

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebSettings
import android.widget.FrameLayout
import android.widget.TextView
import android.view.Gravity
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.StandardMessageCodec
import io.flutter.plugin.platform.PlatformView
import io.flutter.plugin.platform.PlatformViewFactory
import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.zip.ZipInputStream
import org.json.JSONObject

// One isolated, application-private original web engine per Android process.
object OriginalRuntime {
    private const val PORT = 39861
    private const val ORIGIN = "http://127.0.0.1:39861"
    data class Session(val origin: String, val token: String)
    private var startup: CompletableFuture<Session>? = null
    @JvmStatic external fun runNode(entry: String, config: String): Int

    private fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it.toInt() and 255) }

    @Synchronized fun start(context: Context): CompletableFuture<Session> {
        startup?.let { return it }
        val future = CompletableFuture<Session>()
        startup = future
        val app = context.applicationContext
        Thread({
            try {
                val root = File(app.noBackupFilesDir, "nasqo-original-web").canonicalFile
                require(root.isDirectory || root.mkdirs())
                val data = File(root, "data").canonicalFile
                require(data.isDirectory || data.mkdirs())
                val digest = app.assets.open("original-web-runtime.zip.sha256").bufferedReader().use { it.readText().trim() }
                require(Regex("^[a-f0-9]{64}$").matches(digest))
                val version = File(root, "runtime-$digest")
                val entry = File(version, "mobile_runtime/host.mjs")
                if (!entry.isFile) {
                    val stage = File(root, "stage-"+UUID.randomUUID())
                    require(stage.mkdir())
                    val zip = File(stage, "runtime.zip")
                    try {
                        val hash=MessageDigest.getInstance("SHA-256")
                        app.assets.open("original-web-runtime.zip").use { input ->
                            zip.outputStream().use { output ->
                                val buf=ByteArray(65536)
                                var count:Long=0
                                while(true){
                                    val n=input.read(buf);if(n<0)break
                                    count+=n
                                    require(count<=128L*1024*1024)
                                    hash.update(buf,0,n);output.write(buf,0,n)
                                }
                            }
                        }
                        require(hex(hash.digest())==digest)
                        val unpack=File(stage,"unpacked").apply { require(mkdir()) }
                        var count=0
                        var total=0L
                        ZipInputStream(zip.inputStream().buffered()).use { stream ->
                            while(true){
                                val e=stream.nextEntry?:break
                                require(++count<=25000)
                                val target=File(unpack,e.name).canonicalFile
                                require(target.path.startsWith(unpack.canonicalPath+File.separator))
                                if(e.isDirectory){require(target.isDirectory||target.mkdirs())}
                                else {
                                    require(target.parentFile!!.isDirectory||target.parentFile!!.mkdirs())
                                    require(!target.exists())
                                    target.outputStream().use { output ->
                                        val buf=ByteArray(65536)
                                        while(true){
                                            val n=stream.read(buf);if(n<0)break
                                            total+=n;require(total<=256L*1024*1024)
                                            output.write(buf,0,n)
                                        }
                                    }
                                }
                                stream.closeEntry()
                            }
                        }
                        require(File(unpack,"mobile_runtime/host.mjs").isFile)
                        require(File(unpack,"dist/client/index.html").isFile)
                        require(!version.exists())
                        require(unpack.renameTo(version))
                    } finally { stage.deleteRecursively() }
                }
                val token=hex(ByteArray(32).apply { SecureRandom().nextBytes(this) })
                val generation=UUID.randomUUID().toString()
                val ready=File(data,"runtime-ready.json")
                ready.delete()
                val config=File(root,"runtime-config.json")
                config.writeText(JSONObject().put("dataDir",data.canonicalPath)
                    .put("webDir",File(version,"dist/client").canonicalPath)
                    .put("port",PORT).put("token",token).put("generation",generation).toString())
                System.loadLibrary("node")
                System.loadLibrary("nasqo_node_host")
                Thread({
                    try {
                        val result=runNode(entry.canonicalPath,config.canonicalPath)
                        future.completeExceptionally(IllegalStateException("Node runtime exited: "+result))
                    } catch(t:Throwable){future.completeExceptionally(IllegalStateException("Node runtime unavailable"))}
                },"nasqo-node").start()
                val deadline=System.nanoTime()+60_000_000_000L
                while(System.nanoTime()<deadline&&!future.isDone){
                    if(ready.isFile){
                        val status=runCatching{JSONObject(ready.readText())}.getOrNull()
                        if(status?.optString("generation")==generation&&status.optString("origin")==ORIGIN){
                            val valid=runCatching{
                                val connection=URL(ORIGIN+"/api/health").openConnection() as HttpURLConnection
                                try{
                                    connection.instanceFollowRedirects=false
                                    connection.connectTimeout=2000;connection.readTimeout=2000
                                    connection.setRequestProperty("Cookie","nasqo_mobile_session="+token)
                                    connection.responseCode==200&&JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
                                        .optString("engine")=="node:sqlite"
                                }finally{connection.disconnect()}
                            }.getOrDefault(false)
                            if(valid){future.complete(Session(ORIGIN,token));break}
                        }
                    }
                    Thread.sleep(100)
                }
                if(!future.isDone)future.completeExceptionally(IllegalStateException("Local runtime not ready"))
            }catch(t:Throwable){future.completeExceptionally(IllegalStateException("Local runtime initialization failed"))}
        },"nasqo-runtime-preparation").start()
        return future
    }
}

class MainActivity: FlutterActivity() {
    private var chooser:ValueCallback<Array<Uri>>?=null
    private val requestCode=7341

    override fun configureFlutterEngine(engine:FlutterEngine){
        super.configureFlutterEngine(engine)
        engine.platformViewsController.registry.registerViewFactory("nasqo/original_web",
            object:PlatformViewFactory(StandardMessageCodec.INSTANCE){
                override fun create(context:Context,viewId:Int,args:Any?):PlatformView=OriginalView(context,this@MainActivity)
            })
    }

    fun choose(callback:ValueCallback<Array<Uri>>,params:WebChromeClient.FileChooserParams):Boolean{
        chooser?.onReceiveValue(null)
        chooser=callback
        return try {
            startActivityForResult(params.createIntent(),requestCode)
            true
        }catch(_:Exception){chooser=null;callback.onReceiveValue(null);true}
    }

    override fun onActivityResult(code:Int,result:Int,data:Intent?){
        super.onActivityResult(code,result,data)
        if(code!=requestCode)return
        val callback=chooser;chooser=null
        callback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data))
    }

    override fun onDestroy(){
        chooser?.onReceiveValue(null);chooser=null
        super.onDestroy()
    }
}

private class OriginalView(context:Context,private val activity:MainActivity):PlatformView{
    private val root=FrameLayout(context)
    private val message=TextView(context).apply {
        text="جارٍ تشغيل محرك نسقو برو المحلي…";gravity=Gravity.CENTER;setTextColor(Color.DKGRAY)
    }
    private var web:WebView?=null
    @Volatile private var disposed=false
    init{
        root.setBackgroundColor(Color.WHITE);root.addView(message,FrameLayout.LayoutParams(-1,-1))
        OriginalRuntime.start(context).whenComplete { session,error ->
            activity.runOnUiThread {
                if(!disposed){
                    if(error!=null||session==null)message.text="تعذر تشغيل المحرك المحلي. لم يتم حذف قاعدة البيانات."
                    else open(session)
                }
            }
        }
    }
    private fun open(session:OriginalRuntime.Session){
        val view=WebView(root.context)
        web=view
        view.settings.apply {
            javaScriptEnabled=true;domStorageEnabled=true
            allowFileAccess=false;allowContentAccess=false
            javaScriptCanOpenWindowsAutomatically=false
            mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false)
        }
        fun local(uri:Uri):Boolean=uri.scheme=="http"&&uri.host=="127.0.0.1"&&uri.port==39861&&uri.userInfo==null
        view.webViewClient=object:WebViewClient(){
            override fun shouldOverrideUrlLoading(v:WebView,request:WebResourceRequest):Boolean=!local(request.url)
            override fun shouldInterceptRequest(v:WebView,request:WebResourceRequest):WebResourceResponse?=
                if(local(request.url))null else WebResourceResponse("text/plain","utf-8",403,"Blocked",emptyMap(),ByteArrayInputStream(ByteArray(0)))
        }
        view.webChromeClient=object:WebChromeClient(){
            override fun onShowFileChooser(v:WebView,callback:ValueCallback<Array<Uri>>,params:FileChooserParams):Boolean=
                activity.choose(callback,params)
        }
        val cookies=CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        cookies.setAcceptThirdPartyCookies(view,false)
        cookies.setCookie(session.origin,"nasqo_mobile_session="+session.token+"; HttpOnly; SameSite=Strict; Path=/") { ok ->
            if(!disposed){
                if(ok==true){root.removeAllViews();root.addView(view,FrameLayout.LayoutParams(-1,-1));view.loadUrl(session.origin+"/")}
                else message.text="تعذر إنشاء جلسة محلية آمنة."
            }
        }
    }
    override fun getView()=root
    override fun dispose(){disposed=true;web?.stopLoading();web?.destroy();web=null}
}
