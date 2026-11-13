package br.com.eventoperto

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.pm.PackageManager
import android.content.Intent
import android.provider.Settings
import android.net.Uri
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.webkit.WebResourceResponse
import java.io.ByteArrayOutputStream
import android.graphics.Color
import android.os.Bundle
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.*
import org.json.JSONObject
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import java.util.Locale
import java.util.concurrent.Executors

/** Local UI only. All transport, credentials and persistent data stay native. */
class MainActivity : Activity() {
 private val prefs by lazy { getSharedPreferences("eventoperto", MODE_PRIVATE) }
 private val client by lazy { Nearby.getConnectionsClient(this) }
 private val device by lazy { prefs.getString("device", null) ?: UUID.randomUUID().toString().also { prefs.edit().putString("device",it).apply() } }
 private val handler = Handler(Looper.getMainLooper())
 private val network = Executors.newSingleThreadExecutor()
 private lateinit var web: WebView
 private var ready=false
 private var destroyed=false
 private var running=false
 private var advertising=false
 private var discovering=false
 private var proximityGeneration=0
 private var attachment:JSONObject?=null
 private var mutationVersion=0L
 private var busy=false
 private var event="DEMO-2026"
 private var eventName="Meu evento"
 private var lastSync=0L
 private var ping: Long?=null
 private var online="unconfigured"
 private var status="Seus dados ficam disponíveis mesmo sem internet."
 private val peers=mutableSetOf<String>()
 private val pending=mutableSetOf<String>()
 private val records=linkedMapOf<String,JSONObject>()
 private val outbox=mutableSetOf<String>()
 private val favorites=mutableSetOf<String>()
 private val routes=mutableMapOf<String,String>()
 private val pings=mutableMapOf<String,Pair<String,Long>>()
 private var tickCount=0
 private var locationPending=false
 private var locationListener:LocationListener?=null
 private fun role()=prefs.getString("role","guest")!!
 private fun teamId()=prefs.getString("teamId","")!!
 private fun username()=prefs.getString("username","")!!
  private fun visible(o:JSONObject)=SignedRecords.visible(o,role(),teamId())
 private fun cached(key:String)=runCatching{JSONArray(prefs.getString("$key:$event:${username()}","[]"))}.getOrDefault(JSONArray())
 private val tick=object:Runnable { override fun run() {
  if(destroyed) return
  tickCount++
  if(prefs.getBoolean("foreground",false))prefs.edit().putLong("foregroundAt",now()).apply()
  mergeBackground()
  if(tickCount%3==0 && prefs.getString("server","")!!.isNotBlank()) sync()
  emit(); handler.postDelayed(this,10_000)
 } }
 private fun now()=System.currentTimeMillis()
 private fun live(o:JSONObject)=o.optLong("expires")>now()
 private fun note(s:String) { status=s;emit() }
 @SuppressLint("SetJavaScriptEnabled")
 override fun onCreate(savedInstanceState:Bundle?) {
  super.onCreate(savedInstanceState)
  event=prefs.getString("event","DEMO-2026")!!;eventName=prefs.getString("eventName:$event","Meu evento")!!
  load()
  window.statusBarColor=Color.rgb(112,24,212);window.navigationBarColor=Color.rgb(250,248,255)
  web=WebView(this)
  web.settings.javaScriptEnabled=true
  web.settings.userAgentString=web.settings.userAgentString+" Ping/0.5 (br.com.eventoperto)"
  web.settings.allowFileAccess=false
  web.settings.allowContentAccess=false
  web.settings.domStorageEnabled=false
  web.settings.setSupportMultipleWindows(false)
  web.addJavascriptInterface(Bridge(),"EventoNative")
  // Never display remote HTML in a WebView with a native bridge.
  web.webViewClient=object:WebViewClient() {
   override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest)=true
   override fun shouldInterceptRequest(view:WebView,request:WebResourceRequest):WebResourceResponse? {
    if(request.url.host!="appassets.androidplatform.net")return super.shouldInterceptRequest(view,request)
    val file=request.url.path?.removePrefix("/") ?: ""
    if(file=="logo.jpeg")return WebResourceResponse("image/jpeg",null,assets.open(file))
    if(file !in listOf("leaflet.js","leaflet.css","app.js","app.css"))return WebResourceResponse("text/plain","UTF-8",java.io.ByteArrayInputStream(ByteArray(0)))
    return WebResourceResponse(if(file.endsWith(".js"))"application/javascript" else "text/css","UTF-8",assets.open(file))
   }
   override fun onPageFinished(view:WebView,url:String) { ready=true;emit() }
  }
  val frame=FrameLayout(this).apply { fitsSystemWindows=true;addView(web,FrameLayout.LayoutParams(-1,-1)) }
  setContentView(frame)
  val html=assets.open("index.html").bufferedReader().use { it.readText() }
  // Local UI with an HTTPS origin; only map tiles are loaded remotely.
  val logo=android.util.Base64.encodeToString(assets.open("logo.jpeg").use { it.readBytes() },android.util.Base64.NO_WRAP)
  web.loadDataWithBaseURL("https://appassets.androidplatform.net/",html.replace("logo.jpeg","data:image/jpeg;base64,$logo"),"text/html","UTF-8",null)
  handler.postDelayed(tick,10_000)
  PingNotifications.channels(this)
  if(role()!="guest")UpdateWorker.schedule(this)
  if(role()!="guest"&&prefs.getBoolean("nearbyRequested",false))handler.postDelayed({startWithPermissions()},1500)
 }
 inner class Bridge {
  @JavascriptInterface fun action(raw:String) { if(raw.length>16000)return;runOnUiThread {
   if(destroyed)return@runOnUiThread
   try {
    val o=JSONObject(raw)
    val action=o.getString("action")
    if(role()=="guest" && action !in listOf("ready","settings","login","register","onboardingDone","notifications","testNotification")){
     note("Entre na sua conta antes de acessar o evento.");return@runOnUiThread
    }
    when(action) {
     "ready"->emit()
     "nearby"->{if(running){prefs.edit().putBoolean("nearbyRequested",false).apply();stop()}else startWithPermissions()}
     "sync"->sync()
     "ping"->measurePeers()
     "publish"->publish(o)
     "deleteRecord"->deleteRecord(o.optString("id"))
     "chooseAttachment"->{if(role() in listOf("coach","organization")&&!busy)BulletinFiles.choose(this@MainActivity)}
     "clearAttachment"->{attachment=null;emit()}
     "openAttachment"->openAttachment(o.optString("id"))
     "openLink"->openLink(o.optString("id"))
     "discardExpired"->{outbox.removeAll{records[it]?.let{r->!live(r)} ?: true};persist();note("Publicações vencidas removidas da fila. Histórico preservado.")}
     "favorite"->{val id=o.getString("id");if(!favorites.add(id))favorites.remove(id);persist();emit()}
     "settings"->configure(o)
     "login"->authenticate(o,false)
     "register"->authenticate(o,true)
     "logout"->logout()
     "location"->locate()
     "route"->openRoute(o)
     "onboardingDone"->{prefs.edit().putBoolean("onboardingDone",true).apply();emit()}
     "notifications"->enableNotifications()
     "testNotification"->{if(PingNotifications.enabled(this@MainActivity)){
      PingNotifications.show(this@MainActivity,JSONObject().put("id","ping-test").put("text","As notificações do Ping estão habilitadas neste aparelho."),true)
      note("Notificação de teste enviada ao Android.")
     }else note("Ative a permissão de notificações primeiro.")}
     "teamSave","teamDelete","memberSave","memberDelete","roleUpdate","refreshTeams","refreshUsers","teamJoin","teamLeave"->manage(action,o)
    }
   }catch(_:Exception){note("Não foi possível concluir. Confira os campos.")}
  } }
 }
 private fun emit() {
  if(!ready||destroyed)return
  val state=JSONObject().put("event",event).put("eventName",eventName).put("nearby",running).put("peers",peers.size)
   .put("nearbyAdvertising",advertising).put("nearbyDiscovering",discovering)
   .put("attachment",attachment ?: JSONObject.NULL)
   .put("mutationVersion",mutationVersion)
   .put("status",status).put("online",online).put("busy",busy).put("lastSync",lastSync).put("ping",ping ?: JSONObject.NULL)
   .put("server",prefs.getString("server","")).put("hasAccessKey",!prefs.getString("accessKey","").isNullOrBlank())
   .put("role",role()).put("name",prefs.getString("name","Visitante")).put("username",username())
   .put("teamId",teamId()).put("requestedRole",prefs.getString("requestedRole",role()))
   .put("teams",cached("teams")).put("users",if(role()=="organization")cached("users") else JSONArray())
   .put("onboardingDone",prefs.getBoolean("onboardingDone",false))
   .put("notificationsEnabled",PingNotifications.enabled(this))
   .put("trustFingerprint",SignedRecords.fingerprint(SignedRecords.authority(prefs,event)))
   .put("outbox",JSONArray(outbox.toList()))
   .put("favorites",JSONArray(favorites.toList())).put("records",JSONArray(records.values.filter{visible(it)})).put("routes",JSONObject(routes.toMap()))
  web.evaluateJavascript("window.EventoApp && window.EventoApp.receive($state)",null)
 }
 private fun configure(o:JSONObject) {
  if(busy){note("Aguarde a sincronização terminar antes de trocar a configuração.");return}
  val code=o.optString("event").trim().uppercase(Locale.ROOT)
  val name=o.optString("eventName").trim()
  val server=o.optString("server").trim().trimEnd('/')
  if(!code.matches(Regex("[A-Z0-9-]{3,32}"))||name.length !in 1..60){note("Preencha o nome e um código de 3 a 32 letras, números ou hífen.");return}
  if(server.isNotEmpty()) {
   val url=runCatching { URL(server) }.getOrNull()
   if(url==null||url.host.isBlank()||url.userInfo!=null||url.query!=null||url.ref!=null||url.path !in listOf("","/")||
    (url.protocol!="https" && !((applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0 && url.protocol=="http"))) {
    note("Informe a origem do servidor, sem caminho. HTTPS é obrigatório fora do APK de teste.");return
   }
  }
  stop()
  val oldEvent=event;val oldServer=prefs.getString("server","")
   if(oldEvent!=code||oldServer!=server) {
    UpdateWorker.cancel(this)
    clearSession()
   }
  event=code;eventName=name
  val edit=prefs.edit().putString("event",event).putString("eventName:$event",name).putString("server",server)
  edit.apply();load();online=if(server.isEmpty())"unconfigured" else "unknown";ping=null
  note("Configuração salva. Os dados são separados por evento.")
  if(server.isNotEmpty())sync()
 }
 private fun clearSession(){
  attachment=null
  prefs.edit().putBoolean("nearbyRequested",false).apply()
  prefs.edit().remove("accessKey").remove("publishKey").remove("role").remove("name")
   .remove("username").remove("teamId").remove("requestedRole").remove("certificate").remove("certificateSignature").apply()
 }
 private fun enableNotifications(){
  if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){
   requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS),12)
  }else if(!PingNotifications.enabled(this)){
   startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,packageName))
  }else note("Notificações habilitadas. Você receberá alertas quando novas informações chegarem.")
 }
 private fun mergeBackground(){
  if(role()=="guest")return
  val key="backgroundInbox:$event:${username()}"
  val raw=prefs.getString(key,null)?:return
  runCatching{
   val a=JSONArray(raw)
   for(i in 0 until a.length())accept(a.getJSONObject(i),"internet")
   persist()
  }
  prefs.edit().remove(key).apply()
 }
 private fun permissions():Array<String> {
  val needed=mutableListOf<String>()
  if(Build.VERSION.SDK_INT>=31)needed.addAll(listOf(Manifest.permission.BLUETOOTH_SCAN,Manifest.permission.BLUETOOTH_CONNECT,Manifest.permission.BLUETOOTH_ADVERTISE))
  if(Build.VERSION.SDK_INT>=33)needed.add(Manifest.permission.NEARBY_WIFI_DEVICES)
  // Nearby Connections still requires location access on supported Play Services/Android combinations.
  needed.addAll(listOf(Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION))
  return needed.filter{checkSelfPermission(it)!=PackageManager.PERMISSION_GRANTED}.toTypedArray()
 }
 private fun startWithPermissions() {
  if(running)return
  val needed=permissions();if(needed.isNotEmpty()){requestPermissions(needed,10);return}
  val availability=com.google.android.gms.common.GoogleApiAvailability.getInstance()
  val result=availability.isGooglePlayServicesAvailable(this)
  if(result!=com.google.android.gms.common.ConnectionResult.SUCCESS){
   availability.getErrorDialog(this,result,15)?.show();note("Atualize ou habilite o Google Play Services para usar a proximidade.");return
  }
  val adapter=(getSystemService(BLUETOOTH_SERVICE) as android.bluetooth.BluetoothManager).adapter
  if(adapter==null){note("Este aparelho não possui Bluetooth compatível.");return}
  if(!adapter.isEnabled){
   note("Ative o Bluetooth para conectar participantes.");startActivity(Intent(android.bluetooth.BluetoothAdapter.ACTION_REQUEST_ENABLE));return
  }
  if(!(getSystemService(LOCATION_SERVICE) as LocationManager).isProviderEnabled(LocationManager.GPS_PROVIDER)&&
     !(getSystemService(LOCATION_SERVICE) as LocationManager).isProviderEnabled(LocationManager.NETWORK_PROVIDER)){
   note("Ative a localização do Android para a busca por proximidade.");startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS));return
  }
  running=true
  prefs.edit().putBoolean("nearbyRequested",true).apply()
  proximityGeneration++
  startTransports(proximityGeneration)
 }
 private fun startTransports(generation:Int) {
  if(!running||destroyed||generation!=proximityGeneration)return
  val hash=MessageDigest.getInstance("SHA-256").digest(event.toByteArray()).joinToString(""){"%02x".format(it)}
  val service="br.com.eventoperto.$hash" // Same discovery namespace as v0.1; records are versioned.
  note("Proximidade solicitada. Iniciando Google Nearby Connections; mantenha Bluetooth, Wi-Fi, localização e app abertos.")
  fun failed(part:String,e:Exception){
   if(!running||generation!=proximityGeneration)return
   val code=(e as? com.google.android.gms.common.api.ApiException)?.statusCode
   if(part=="anúncio"&&code==ConnectionsStatusCodes.STATUS_ALREADY_ADVERTISING)advertising=true
   else if(part=="busca"&&code==ConnectionsStatusCodes.STATUS_ALREADY_DISCOVERING)discovering=true
   else note("Nearby: falha no $part (${code ?: "permissão"}): ${e.localizedMessage}. Nova tentativa em 15 segundos. Verifique Bluetooth, Wi-Fi, localização e permissões.")
   emit()
  }
  try {
   if(!advertising)client.startAdvertising(device,service,lifecycle,AdvertisingOptions.Builder().setStrategy(Strategy.P2P_CLUSTER).build())
    .addOnSuccessListener{if(running&&generation==proximityGeneration){advertising=true;note("Nearby: anúncio ativo. Buscando participantes.")}}
    .addOnFailureListener{failed("anúncio",it)}
   if(!discovering)client.startDiscovery(service,discovery,DiscoveryOptions.Builder().setStrategy(Strategy.P2P_CLUSTER).build())
    .addOnSuccessListener{if(running&&generation==proximityGeneration){discovering=true;note("Nearby: busca ativa. Aguardando outro aparelho do mesmo evento.")}}
    .addOnFailureListener{failed("busca",it)}
  }catch(e:SecurityException){failed("permissão",e)}
  handler.postDelayed({if(running&&generation==proximityGeneration&&(!advertising||!discovering))startTransports(generation)},15_000)
 }
 override fun onRequestPermissionsResult(requestCode:Int,permissions:Array<out String>,grantResults:IntArray) {
  super.onRequestPermissionsResult(requestCode,permissions,grantResults)
  if(requestCode==12){note(if(PingNotifications.enabled(this))"Notificações habilitadas." else "Notificações não autorizadas. Os avisos continuam na aba Avisos.");return}
  if(requestCode==11){
   locationPending=false
   if(grantResults.isNotEmpty()&&grantResults.any{it==PackageManager.PERMISSION_GRANTED})locate() else note("Localização não autorizada. Você pode consultar os endereços cadastrados.")
   return
  }
  if(requestCode==10&&grantResults.isNotEmpty()&&grantResults.all{it==PackageManager.PERMISSION_GRANTED})startWithPermissions()
  else note("Permissões negadas. Os dados já salvos continuam disponíveis.")
 }
 private fun stop(){running=false;advertising=false;discovering=false;proximityGeneration++;client.stopAdvertising();client.stopDiscovery();client.stopAllEndpoints();peers.clear();pending.clear();pings.clear();emit()}
 private val discovery=object:EndpointDiscoveryCallback(){
  override fun onEndpointFound(id:String,info:DiscoveredEndpointInfo){
   if(running&&device<info.endpointName&&id !in peers&&pending.add(id))client.requestConnection(device,id,lifecycle)
    .addOnFailureListener{pending.remove(id);note("Não conectou. Desligue e reative a proximidade para tentar novamente.")}
  }
  override fun onEndpointLost(id:String){pending.remove(id)}
 }
 private val lifecycle=object:ConnectionLifecycleCallback(){
  override fun onConnectionInitiated(id:String,info:ConnectionInfo){
   if(!running||isFinishing){client.rejectConnection(id);return}
   AlertDialog.Builder(this@MainActivity).setTitle("Conectar participante")
     .setMessage("Compare o código nos dois celulares: ${info.authenticationDigits}\nSó serão aceitos avisos com assinatura e autorização válidas do evento.")
    .setPositiveButton("Códigos iguais"){_,_->if(running)client.acceptConnection(id,payloads).addOnFailureListener{note("Falha ao aceitar conexão.")}}
    .setNegativeButton("Recusar"){_,_->client.rejectConnection(id);pending.remove(id)}.setCancelable(false).show()
  }
  override fun onConnectionResult(id:String,result:ConnectionResolution){
   pending.remove(id);if(!running)return
   if(result.status.isSuccess){peers.add(id);records.values.filter{live(it)}.forEach{send(id,it)};note("Participante conectado. Atualizações salvas estão sendo compartilhadas.")}
   else note("Conexão não concluída. Reative a proximidade para tentar novamente.")
  }
  override fun onDisconnected(id:String){peers.remove(id);pending.remove(id);pings.remove(id);if(running)note("Conexão encerrada. Buscando novos encontros.")}
 }
 private val payloads=object:PayloadCallback(){
  override fun onPayloadReceived(from:String,payload:Payload){
   val bytes=payload.asBytes()?:return;if(bytes.size>32768)return
   try {
    val o=JSONObject(String(bytes,Charsets.UTF_8))
    if(o.optString("control")=="ping") { send(from,JSONObject().put("control","pong").put("nonce",o.optString("nonce")));return }
    if(o.optString("control")=="pong") {
     val item=pings[from];if(item!=null&&item.first==o.optString("nonce")){pings.remove(from);note("Ping por proximidade: ${SystemClock.elapsedRealtime()-item.second} ms (ida e volta).")} ;return
    }
    if(accept(o,"proximity")){persist();peers.filter{it!=from}.forEach{send(it,o)};note("Nova informação recebida por proximidade.")}
   }catch(_:Exception){note("Pacote incompatível ignorado.")}
  }
  override fun onPayloadTransferUpdate(id:String,update:PayloadTransferUpdate){if(update.status==PayloadTransferUpdate.Status.FAILURE)note("Um envio falhou. A informação continua salva para o próximo encontro.")}
 }
 private fun send(id:String,o:JSONObject){val bytes=o.toString().toByteArray(Charsets.UTF_8);if(bytes.size>32768)return
  client.sendPayload(id,Payload.fromBytes(bytes)).addOnFailureListener{note("Não foi possível enviar. Dados preservados no aparelho.")}
 }
 private fun measurePeers(){
  if(peers.isEmpty()){note("Conecte outro participante para medir o ping de proximidade.");return}
  peers.forEach{id->val nonce=UUID.randomUUID().toString();pings[id]=nonce to SystemClock.elapsedRealtime();send(id,JSONObject().put("control","ping").put("nonce",nonce))}
  handler.postDelayed({val old=pings.filterValues{SystemClock.elapsedRealtime()-it.second>=5000}.keys.toList();old.forEach{pings.remove(it)};if(old.isNotEmpty())note("Ping de proximidade sem resposta em 5 segundos.")},5100)
 }
 private fun valid(o:JSONObject):Boolean {
  val t=o.optLong("created");val expiry=o.optLong("expires");val kind=o.optString("kind","bulletin")
   if(o.optInt("v")!=2||o.optString("event")!=event||!runCatching{UUID.fromString(o.getString("id"))}.isSuccess)return false
  if(o.optString("text").length !in 1..500||o.optString("sector").length !in 1..40||o.optString("title",o.optString("sector")).length !in 1..80)return false
   if(t<=0||t>now()+300000||expiry<=now()||expiry<=t||expiry-t>7*86_400_000L||kind !in listOf("bulletin","notice","agenda","facility"))return false
   if(o.optString("priority") !in listOf("normal","important","emergency")||o.optString("audience") !in listOf("all","team"))return false
   if(o.optString("audience")=="team" && o.optString("teamId").isBlank())return false
  if(kind=="agenda"&&(o.optLong("start")<=0||o.optLong("end")<=o.optLong("start")||o.optLong("end")>expiry))return false
  if(kind=="facility"){
   val lat=o.optDouble("lat");val lon=o.optDouble("lon")
   if(!lat.isFinite()||!lon.isFinite()||lat !in -90.0..90.0||lon !in -180.0..180.0||o.optString("category") !in listOf("gym","lodging"))return false
  }
  return o.toString().toByteArray(Charsets.UTF_8).size<=32768
 }
 private fun accept(o:JSONObject,route:String):Boolean {
  if(!valid(o))return false
  val id=o.getString("id");if(records.containsKey(id))return false
   val verified=SignedRecords.verified(o,event,SignedRecords.authority(prefs,event))?:return false
   records[id]=verified;routes[id]=route
   if(verified.optBoolean("deleted")){
    val manager=getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
    val root=verified.optString("replaces")
    records.values.filter{it.optString("id")==root||it.optString("replaces")==root}.forEach{manager.cancel(it.optString("id").hashCode())}
   }
   if(route!="local" && !verified.optBoolean("deleted") && visible(verified) && verified.optString("author")!=username() &&
    verified.optString("kind") in listOf("notice","bulletin","agenda")){
    UpdateWorker.notifyOnce(this,prefs,event,username(),verified)
   }
   return true
 }
 private fun publish(o:JSONObject){
   if(role() !in listOf("organization","coach")){note("Atletas só podem visualizar avisos.");return}
   if(role()=="coach" && (o.optString("kind") !in listOf("notice","agenda","bulletin")||teamId().isBlank()||o.optString("priority")=="emergency")){
    note("Técnicos só podem enviar avisos para sua equipe. Emergências são exclusivas da organização.");return
   }
  if(outbox.size>=100){note("Há 100 publicações pendentes. Sincronize antes de adicionar outras.");return}
  val kind=o.optString("kind","bulletin");val t=now();val start=o.optLong("start");val end=o.optLong("end")
  var expiry=if(kind=="agenda")end else if(kind=="facility")t+7*86_400_000L else t+o.optLong("hours",6).coerceIn(1,48)*3_600_000
  val n=JSONObject().put("v",2).put("id",UUID.randomUUID().toString()).put("event",event).put("kind",kind)
   .put("created",t).put("expires",expiry).put("title",o.optString("title").trim()).put("sector",o.optString("sector").trim())
   .put("text",o.optString("text").trim()).put("priority",o.optString("priority","normal")).put("start",start).put("end",end)
   val audience=if(role()=="coach")"team" else o.optString("audience","all")
   n.put("audience",audience).put("teamId",if(audience=="team")if(role()=="coach")teamId() else o.optString("teamId") else "")
   if(n.optString("priority")=="emergency" && (kind!="notice"||audience!="all")){
    note("Avisos de emergência devem ser enviados pela organização a todo o evento.");return
   }
   if(audience=="team" && (n.optString("teamId").isBlank() ||
    (role()=="organization" && (0 until cached("teams").length()).none{cached("teams").optJSONObject(it)?.optString("id")==n.optString("teamId")}))){
    note("Selecione uma equipe cadastrada e sincronizada antes de publicar.");return
   }
   if(kind=="facility")n.put("lat",o.optDouble("lat")).put("lon",o.optDouble("lon")).put("category",o.optString("category"))
   if(o.optString("id").isNotBlank()){
    val previous=records[o.optString("id")] ?: run{note("Publicação não encontrada.");return}
    if(!canEdit(previous)){note("Você não pode alterar esta publicação.");return}
    val root=previous.optJSONObject("original") ?: previous
    expiry=maxOf(expiry,root.optLong("expires"),previous.optLong("expires"))
    n.put("expires",expiry).put("replaces",root.getString("id")).put("original",root).put("deleted",false)
     .put("audience",root.optString("audience")).put("teamId",root.optString("teamId"))
   }
   if(kind=="bulletin"){
    val link=o.optString("link").trim()
    if(link.isNotBlank()){
     val url=runCatching{URL(link)}.getOrNull()
     if(url==null||url.protocol !in listOf("http","https")||url.host.isBlank()||url.userInfo!=null||link.length>1500){
      note("Use um link HTTP ou HTTPS válido.");return
     }
     n.put("link",link)
    }
    if(o.optBoolean("useAttachment")&&attachment!=null)n.put("attachment",attachment)
    else if(o.has("attachment"))n.put("attachment",o.getJSONObject("attachment"))
   }
   try{SignedRecords.sign(n,prefs)}catch(e:Exception){note(e.localizedMessage?:"Entre novamente para renovar sua autorização.");return}
  if(!accept(n,"local")){note("Confira o texto e as datas. A agenda deve terminar no futuro e em até 7 dias.");return}
   attachment=null;mutationVersion++
   outbox.add(n.getString("id"));persist();peers.forEach{send(it,n)};note("Aviso assinado salvo. Envio por proximidade iniciado para ${peers.size} conexão(ões); não há garantia de entrega. Aguardando servidor.")
  if(prefs.getString("server","")!!.isNotBlank())sync()
 }
 private fun canEdit(record:JSONObject):Boolean = record.optString("kind") in listOf("notice","agenda","bulletin") &&
  (role()=="organization"||(role()=="coach"&&(record.optJSONObject("original") ?: record).optString("author")==username()&&record.optString("teamId")==teamId()&&teamId().isNotBlank()))
 private fun deleteRecord(id:String){
  val previous=records[id] ?: return
  if(!canEdit(previous)){note("Você não pode excluir esta publicação.");return}
  if(outbox.size>=100){note("Sincronize as publicações pendentes antes de excluir.");return}
  val root=previous.optJSONObject("original") ?: previous
  val n=JSONObject(previous.toString())
  listOf("payload","signature","certificate","certificateSignature","attachment","link").forEach{n.remove(it)}
  n.put("id",UUID.randomUUID().toString()).put("created",now()).put("replaces",root.getString("id"))
   .put("original",root).put("deleted",true).put("expires",maxOf(previous.optLong("expires"),root.optLong("expires"),now()+86_400_000))
  try{
   SignedRecords.sign(n,prefs)
   if(!accept(n,"local")){note("Não foi possível excluir; confira a validade da publicação.");return}
   mutationVersion++
   outbox.add(n.getString("id"));persist();peers.forEach{send(it,n)}
   (getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager).cancel(id.hashCode())
   note("Aviso assinado salvo. Exclusão registrada; será propagada ao sincronizar ou encontrar participantes.")
   sync()
  }catch(e:Exception){note(e.localizedMessage ?: "Não foi possível assinar a exclusão.")}
 }
 override fun onActivityResult(requestCode:Int,resultCode:Int,data:Intent?){
  super.onActivityResult(requestCode,resultCode,data)
  if(requestCode!=BulletinFiles.REQUEST||resultCode!=RESULT_OK||data?.data==null)return
  if(role() !in listOf("coach","organization")||busy)return
  val base=prefs.getString("server","")!!;val token=prefs.getString("accessKey","")!!
  if(base.isBlank()||token.isBlank()){note("Configure o servidor e entre para enviar anexos.");return}
  val uri=data.data!!;busy=true;note("Enviando anexo ao servidor…")
  network.execute{try{
   val uploaded=BulletinFiles.upload(this,uri,base,token)
   runOnUiThread{busy=false;if(prefs.getString("accessKey","")==token){attachment=uploaded;note("Anexo enviado. Agora publique o boletim.")}else emit()}
  }catch(e:Exception){runOnUiThread{busy=false;note(e.localizedMessage ?: "Falha ao enviar anexo.")}}}
 }
 private fun openAttachment(id:String){
  val record=SignedRecords.effective(records.values).find{it.optString("id")==id&&visible(it)} ?: return
  val meta=record.optJSONObject("attachment") ?: return
  if(busy)return
  val token=prefs.getString("accessKey","")!!;val base=prefs.getString("server","")!!
  busy=true;note("Abrindo arquivo do boletim…")
  network.execute{try{
   val file=BulletinFiles.download(this,meta,base,token)
   runOnUiThread{busy=false;if(prefs.getString("accessKey","")==token)try{BulletinFiles.open(this,file,meta.getString("mime"));note("Arquivo salvo para abrir novamente sem internet.")}catch(_:Exception){note("Instale um leitor de PDF ou imagem para abrir este arquivo.")}}
  }catch(e:Exception){runOnUiThread{busy=false;note(e.localizedMessage ?: "Não foi possível abrir o arquivo.")}}}
 }
 private fun openLink(id:String){
  val record=SignedRecords.effective(records.values).find{it.optString("id")==id&&visible(it)} ?: return
  val link=record.optString("link");val uri=Uri.parse(link)
  if(uri.scheme !in listOf("http","https")||uri.host.isNullOrBlank()||uri.userInfo!=null)return
  AlertDialog.Builder(this).setTitle("Abrir link externo?").setMessage("Destino: ${uri.host}\nO conteúdo externo pode exigir internet.")
   .setPositiveButton("Abrir"){_,_->runCatching{startActivity(Intent(Intent.ACTION_VIEW,uri))}}.setNegativeButton("Cancelar",null).show()
 }
 private fun load(){
  records.clear();outbox.clear();favorites.clear();routes.clear()
   runCatching{val a=JSONArray(prefs.getString("notices:$event","[]"));for(i in 0 until a.length()){
    val o=SignedRecords.verified(a.getJSONObject(i),event,SignedRecords.authority(prefs,event),true)?:continue
    records[o.getString("id")]=o
   }}
  fun readSet(key:String,target:MutableSet<String>){runCatching{val a=JSONArray(prefs.getString("$key:$event","[]"));for(i in 0 until a.length())target.add(a.getString(i))}}
  readSet("outbox",outbox);readSet("favorites",favorites)
  runCatching{val o=JSONObject(prefs.getString("routes:$event","{}"));o.keys().forEach{routes[it]=o.getString(it)}}
  lastSync=prefs.getLong("lastSync:$event",0)
  online=if(prefs.getString("server","")!!.isBlank())"unconfigured" else "unknown"
 }
 private fun persist(){
  // Never evict a queued publication or a favorite silently.
  val retained=records.values.filter{it.getString("id") in outbox||it.getString("id") in favorites}
  val rest=records.values.filter{it.getString("id") !in outbox&&it.getString("id") !in favorites}.sortedByDescending{it.optLong("created")}.take(500)
  records.clear();(retained+rest).forEach{records[it.getString("id")]=it}
  routes.keys.retainAll(records.keys)
  prefs.edit().putString("notices:$event",JSONArray(records.values.toList()).toString()).putString("outbox:$event",JSONArray(outbox.toList()).toString())
   .putString("favorites:$event",JSONArray(favorites.toList()).toString()).putString("routes:$event",JSONObject(routes.toMap()).toString()).putLong("lastSync:$event",lastSync).apply()
 }
 private class ServerFailure(val code:Int,message:String):IllegalStateException(message)
 private fun request(base:String,path:String,access:String,publish:String,body:String?):JSONObject{
  val conn=URL(base+path).openConnection() as HttpURLConnection
  try {
   conn.connectTimeout=6000;conn.readTimeout=8000;conn.instanceFollowRedirects=false
   conn.setRequestProperty("Accept","application/json");conn.setRequestProperty("Authorization","Bearer $access")
   if(body!=null){conn.requestMethod="POST";conn.doOutput=true;conn.setRequestProperty("Content-Type","application/json; charset=utf-8");if(publish.isNotBlank())conn.setRequestProperty("X-Publish-Key",publish)
    conn.outputStream.use{it.write(body.toByteArray(Charsets.UTF_8))}}
   val code=conn.responseCode
    if(code !in 200..299){
     val message=runCatching{conn.errorStream?.bufferedReader()?.use{it.readText().take(1000)}?.let{JSONObject(it).optString("error")}}.getOrNull()
     throw ServerFailure(code,message?.takeIf{it.isNotBlank()} ?: "Servidor respondeu HTTP $code.")
    }
   val bytes=conn.inputStream.use { input ->
    val output=ByteArrayOutputStream();val buffer=ByteArray(8192)
    while(output.size()<=17_000_000){val n=input.read(buffer);if(n<0)break;output.write(buffer,0,n)}
    output.toByteArray()
   }
   if(bytes.size>17_000_000)throw IllegalStateException("Resposta do servidor muito grande.")
   return JSONObject(String(bytes,Charsets.UTF_8))
  }finally{conn.disconnect()}
 }
 private fun sync(){
  if(busy||destroyed)return
  val base=prefs.getString("server","")!!
  if(base.isBlank()){note("Configure o endereço do servidor na aba Rede.");return}
  val access=prefs.getString("accessKey","")!!;val publish=""
  if(access.isBlank()){note("Entre na sua conta para sincronizar. Os dados salvos podem ser consultados offline.");return}
  val current=event
   val queued=if(role() in listOf("organization","coach"))records.values.filter{
    it.getString("id") in outbox&&live(it)&&it.optString("author")==username()&&it.optString("authorRole")==role()&&
    (role()=="organization"||it.optString("teamId")==teamId())
   } else emptyList()
   val body=JSONObject().put("records",JSONArray(queued)).put("publicKey",SignedRecords.publicKey()).toString()
   val session=prefs.getString("accessKey","")!!
  busy=true;emit()
  network.execute{
   try {
    val started=SystemClock.elapsedRealtime()
    request(base,"/api/ping",access,"",null)
    val latency=SystemClock.elapsedRealtime()-started
     val response=try{request(base,"/api/events/$current/sync",access,publish,body)}
      catch(e:ServerFailure){
       if(e.code==403&&queued.isNotEmpty())request(base,"/api/events/$current/sync",access,"",
        JSONObject().put("records",JSONArray()).put("publicKey",SignedRecords.publicKey()).toString())
       else throw e
      }
    runOnUiThread{
     if(destroyed)return@runOnUiThread
     busy=false
      if(current!=event||prefs.getString("accessKey","")!=session)return@runOnUiThread
      try{SignedRecords.sessionProof(prefs,response,event)}catch(e:Exception){note(e.localizedMessage?:"Falha na assinatura do servidor.");return@runOnUiThread}
      cacheManagement(response)
     ping=latency;online="connected"
     val received=response.optJSONArray("records")?:JSONArray()
     var added=0
     for(i in 0 until received.length()){
      val n=received.optJSONObject(i)?:continue
      if(accept(n,"internet")){added++;peers.forEach{send(it,n)}}
     }
     val ack=response.optJSONArray("ack")?:JSONArray();val sent=queued.map{it.getString("id")}.toSet()
     for(i in 0 until ack.length()){val id=ack.optString(i);if(id in sent)outbox.remove(id)}
     lastSync=now();persist()
      note("Sincronização concluída • $added informação(ões) nova(s).")
    }
   }catch(e:Exception){runOnUiThread{if(!destroyed){busy=false;online="offline";ping=null;note("Servidor indisponível: ${e.localizedMessage ?: "falha de rede"}. Dados salvos mantidos.")}}}
  }
 }

 private fun authenticate(o:JSONObject,register:Boolean){
  if(busy){note("Aguarde a operação atual terminar.");return}
  val base=prefs.getString("server","")!!
  if(base.isBlank()){note("Primeiro configure o servidor na aba Rede.");return}
   val body=JSONObject().put("username",o.optString("username")).put("password",o.optString("password")).put("name",o.optString("name"))
    .put("requestedRole",o.optString("requestedRole","athlete")).put("publicKey",SignedRecords.publicKey()).toString()
  busy=true;emit()
  network.execute{
   try{
    val response=request(base,if(register)"/api/register" else "/api/login","","",body)
    runOnUiThread{
     if(destroyed)return@runOnUiThread
     busy=false
     val code=response.getString("event")
     if(!code.matches(Regex("[A-Z0-9-]{3,32}"))){note("Servidor informou evento inválido.");return@runOnUiThread}
     if(code!=event){stop();event=code;eventName=prefs.getString("eventName:$event","Meu evento")!!;prefs.edit().putString("event",event).apply();load()}
      try{SignedRecords.sessionProof(prefs,response,code)}catch(e:Exception){note(e.localizedMessage?:"Certificado de acesso inválido.");return@runOnUiThread}
      prefs.edit().putString("accessKey",response.getString("token")).putString("role",response.getString("role"))
       .putString("teamId",response.optString("teamId")).putString("requestedRole",response.optString("requestedRole"))
      .putString("name",response.getString("name")).putString("username",response.getString("username")).apply()
      UpdateWorker.schedule(this)
     note("Conta conectada. Sincronizando informações do evento.");sync()
    }
   }catch(e:Exception){runOnUiThread{if(!destroyed){busy=false;note(e.localizedMessage?:"Não foi possível entrar.")}}}
  }
 }
 private fun logout(){
  if(busy){note("Aguarde a sincronização antes de sair.");return}
  val base=prefs.getString("server","")!!;val token=prefs.getString("accessKey","")!!
   stop();UpdateWorker.cancel(this);clearSession()
  if(base.isNotBlank()&&token.isNotBlank())network.execute{runCatching{request(base,"/api/logout",token,"","{}")}}
   note("Você saiu da conta. O conteúdo permanece guardado, mas um novo login será necessário para abrir o evento.")
 }
 private fun cacheManagement(response:JSONObject){
  val edit=prefs.edit()
  response.optJSONArray("teams")?.let{edit.putString("teams:$event:${username()}",it.toString())}
  edit.putString("users:$event:${username()}",if(role()=="organization")(response.optJSONArray("users")?:JSONArray()).toString() else "[]")
  edit.apply()
 }
 private fun manage(op:String,o:JSONObject){
  if(busy){note("Aguarde a operação atual terminar.");return}
  if(op in listOf("teamDelete","roleUpdate","refreshUsers") && role()!="organization"){
   note("Apenas a organização pode realizar esta operação.");return
  }
  if(op=="teamSave" && role() !in listOf("coach","organization")){
   note("Apenas técnicos e organização podem criar equipes.");return
  }
  if(op in listOf("teamJoin","teamLeave") && role()!="athlete"){
   note("Este menu de entrada em equipes é exclusivo dos atletas.");return
  }
  if(op in listOf("memberSave","memberDelete") && (role() !in listOf("coach","organization") ||
   (role()=="coach"&&o.optString("teamId")!=teamId()))){
   note("Você só pode modificar o elenco da sua equipe.");return
  }
  val base=prefs.getString("server","")!!;val token=prefs.getString("accessKey","")!!
  if(base.isBlank()||token.isBlank()){note("Conecte ao servidor para gerenciar equipes e permissões.");return}
  val current=event
  busy=true;emit()
  network.execute{
   try{
    val response=request(base,"/api/manage",token,"",JSONObject(o.toString()).put("op",op)
     .put("publicKey",SignedRecords.publicKey()).toString())
    runOnUiThread{
     if(destroyed)return@runOnUiThread
     busy=false
     if(current!=event||prefs.getString("accessKey","")!=token)return@runOnUiThread
     try{SignedRecords.sessionProof(prefs,response,event)}catch(e:Exception){
      note(e.localizedMessage?:"Falha ao validar a atualização da equipe.");return@runOnUiThread
     }
     cacheManagement(response);note(if(op.startsWith("refresh"))"Dados atualizados." else "Alteração confirmada pelo servidor.");sync()
    }
   }catch(e:Exception){runOnUiThread{if(!destroyed){busy=false;note("Não foi salvo: ${e.localizedMessage}. Equipes e permissões precisam de conexão com o servidor.")}}}
  }
 }
 override fun onResume(){
  super.onResume();prefs.edit().putBoolean("foreground",true).putLong("foregroundAt",now()).apply()
  if(::web.isInitialized){mergeBackground();emit()}
 }
 override fun onPause(){prefs.edit().putBoolean("foreground",false).apply();super.onPause()}
 private fun openRoute(o:JSONObject){
  val lat=o.optDouble("lat");val lon=o.optDouble("lon")
  if(!lat.isFinite()||!lon.isFinite()||lat !in -90.0..90.0||lon !in -180.0..180.0)return
  val uri=Uri.parse("geo:$lat,$lon?q=$lat,$lon("+Uri.encode(o.optString("title").take(80))+")")
  try{startActivity(Intent(Intent.ACTION_VIEW,uri))}catch(_:Exception){note("Nenhum aplicativo de mapas instalado.")}
 }
 private fun locate(){
  if(locationPending)return
  if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED&&checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED){
   requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION),11);return
  }
  val manager=getSystemService(LOCATION_SERVICE) as LocationManager
  val provider=if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED&&manager.isProviderEnabled(LocationManager.GPS_PROVIDER))LocationManager.GPS_PROVIDER
   else if(manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER))LocationManager.NETWORK_PROVIDER else null
  if(provider==null){note("Ative a localização do celular para localizar você no mapa.");return}
  locationPending=true
  val listener=object:LocationListener{
   override fun onLocationChanged(location:Location){
    manager.removeUpdates(this);locationPending=false;locationListener=null
    val result=JSONObject().put("lat",location.latitude).put("lon",location.longitude).put("accuracy",location.accuracy.toDouble()).put("time",location.time)
    if(!destroyed)web.evaluateJavascript("window.EventoLocation && window.EventoLocation($result)",null)
   }
   override fun onProviderEnabled(provider:String){}
   override fun onProviderDisabled(provider:String){}
   @Deprecated("Android callback") override fun onStatusChanged(provider:String?,status:Int,extras:Bundle?){}
  }
  locationListener=listener
  try{
   manager.requestLocationUpdates(provider,1000L,0f,listener,Looper.getMainLooper())
   note("Buscando sua localização. Ela não é enviada a outros participantes.")
   handler.postDelayed({if(locationListener===listener){manager.removeUpdates(listener);locationListener=null;locationPending=false;note("Localização não obtida em 20 segundos. Tente em uma área aberta.")}},20000)
  }catch(_:SecurityException){locationListener=null;locationPending=false;note("Permissão de localização não disponível.")}
 }

 override fun onDestroy(){destroyed=true;prefs.edit().putBoolean("foreground",false).apply();locationListener?.let{(getSystemService(LOCATION_SERVICE) as LocationManager).removeUpdates(it)};handler.removeCallbacksAndMessages(null);if(running)stop();network.shutdownNow();web.removeJavascriptInterface("EventoNative");web.destroy();super.onDestroy()}
}
