package br.com.eventoperto

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest

/** Private authenticated downloads, checked against metadata inside the signed publication. */
object BulletinFiles {
    const val REQUEST = 41
    private const val MAX = 10 * 1024 * 1024
    fun choose(a: Activity) {
        a.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            type="*/*"; addCategory(Intent.CATEGORY_OPENABLE)
            putExtra(Intent.EXTRA_MIME_TYPES,arrayOf("application/pdf","image/jpeg","image/png","image/webp"))
        },REQUEST)
    }
    private fun bytes(input:java.io.InputStream):ByteArray = input.use {
        val out=java.io.ByteArrayOutputStream(); val buffer=ByteArray(8192)
        while(true) { val n=it.read(buffer);if(n<0)break;require(out.size()+n<=MAX){"Limite de 10 MB por arquivo."};out.write(buffer,0,n) }
        out.toByteArray()
    }
    fun upload(a:Activity,uri:Uri,base:String,token:String):JSONObject {
        val mime=a.contentResolver.getType(uri) ?: ""
        require(mime in listOf("application/pdf","image/jpeg","image/png","image/webp")){"Escolha PDF, JPG, PNG ou WebP."}
        var name="arquivo"
        a.contentResolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use {
            if(it.moveToFirst())name=it.getString(0)
        }
        val data=bytes(a.contentResolver.openInputStream(uri) ?: error("Não foi possível ler o arquivo."))
        val c=URL("$base/api/attachments").openConnection() as HttpURLConnection
        try {
            c.connectTimeout=10000;c.readTimeout=30000;c.instanceFollowRedirects=false
            c.requestMethod="POST";c.doOutput=true;c.setFixedLengthStreamingMode(data.size)
            c.setRequestProperty("Authorization","Bearer $token");c.setRequestProperty("Content-Type",mime)
            c.setRequestProperty("X-File-Name",URLEncoder.encode(name,"UTF-8").replace("+","%20"))
            c.outputStream.use{it.write(data)}
            if(c.responseCode !in 200..299) {
                val message=runCatching { JSONObject(c.errorStream.bufferedReader().use{it.readText()}).optString("error") }.getOrDefault("Falha no envio.")
                error(message)
            }
            return JSONObject(c.inputStream.bufferedReader().use{it.readText()}).getJSONObject("attachment")
        } finally { c.disconnect() }
    }
    fun download(a:Activity,meta:JSONObject,base:String,token:String):File {
        val id=java.util.UUID.fromString(meta.getString("id")).toString()
        val mime=meta.getString("mime")
        val extension=mapOf("application/pdf" to "pdf","image/jpeg" to "jpg","image/png" to "png","image/webp" to "webp")[mime] ?: error("Tipo inválido.")
        val folder=File(a.filesDir,"bulletins").apply{mkdirs()}
        val f=File(folder,"$id.$extension")
        fun valid(data:ByteArray)=data.size.toLong()==meta.getLong("size") &&
            MessageDigest.getInstance("SHA-256").digest(data).joinToString(""){"%02x".format(it)}==meta.getString("sha256")
        if(f.exists()&&valid(f.readBytes()))return f
        val c=URL("$base/api/attachments/$id").openConnection() as HttpURLConnection
        try {
            c.connectTimeout=10000;c.readTimeout=30000;c.instanceFollowRedirects=false
            c.setRequestProperty("Authorization","Bearer $token")
            require(c.responseCode==200){"Não foi possível baixar. Conecte ao servidor e confira sua sessão."}
            val data=bytes(c.inputStream)
            require(valid(data)){"A integridade do arquivo não confere com o boletim."}
            f.writeBytes(data);return f
        } finally { c.disconnect() }
    }
    fun open(a:Activity,file:File,mime:String) {
        val uri=FileProvider.getUriForFile(a,a.packageName+".files",file)
        a.startActivity(Intent.createChooser(Intent(Intent.ACTION_VIEW).setDataAndType(uri,mime)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),"Abrir boletim"))
    }
}
