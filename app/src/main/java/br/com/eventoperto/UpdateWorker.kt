package br.com.eventoperto

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/** Best effort server polling, NOT push. Android may defer it during Doze/battery saving. */
class UpdateWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val p = applicationContext.getSharedPreferences("eventoperto", Context.MODE_PRIVATE)
        val base = p.getString("server", "")!!
        val token = p.getString("accessKey", "")!!
        val event = p.getString("event", "DEMO-2026")!!
        val username = p.getString("username", "")!!
        if (base.isBlank() || token.isBlank() || (p.getBoolean("foreground", false) &&
            System.currentTimeMillis()-p.getLong("foregroundAt",0)<90_000)) return Result.success()
        return try {
            val conn = URL("$base/api/events/$event/sync").openConnection() as HttpURLConnection
            val response = try {
                conn.connectTimeout = 6000; conn.readTimeout = 8000
                conn.instanceFollowRedirects = false
                conn.requestMethod = "POST"; conn.doOutput = true
                conn.setRequestProperty("Authorization", "Bearer $token")
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                conn.outputStream.use { it.write(JSONObject().put("records", JSONArray())
                    .put("publicKey", SignedRecords.publicKey()).toString().toByteArray(Charsets.UTF_8)) }
                if (conn.responseCode == 401) return Result.success()
                if (conn.responseCode !in 200..299) return Result.retry()
                val bytes = conn.inputStream.use { it.readBytesLimited() }
                JSONObject(String(bytes, Charsets.UTF_8))
            } finally { conn.disconnect() }
            // Never write the previous user's data into a newly selected account.
            if (p.getString("accessKey", "") != token || p.getString("event", "") != event)
                return Result.success()
            SignedRecords.sessionProof(p, response, event)
            val role = p.getString("role", "guest")!!
            val team = p.getString("teamId", "")!!
            val list = response.optJSONArray("records") ?: JSONArray()
            val inbox = JSONArray()
            for (i in 0 until list.length()) {
                val raw = list.optJSONObject(i) ?: continue
                val o = SignedRecords.verified(raw, event, SignedRecords.authority(p, event)) ?: continue
                if (o.optLong("expires") <= System.currentTimeMillis()) continue
                inbox.put(o)
            }
            val effective=SignedRecords.effective((0 until inbox.length()).map { inbox.getJSONObject(it) })
            for(o in effective) {
                if (SignedRecords.visible(o, role, team) && o.optString("author") != username &&
                    o.optString("kind") in listOf("notice", "bulletin", "agenda")) {
                    notifyOnce(applicationContext, p, event, username, o)
                }
            }
            p.edit().putString("backgroundInbox:$event:$username", inbox.toString())
                .putString("teams:$event:$username", (response.optJSONArray("teams") ?: JSONArray()).toString())
                .putString("users:$event:$username",
                    ((if (role == "organization") response.optJSONArray("users") else null) ?: JSONArray()).toString())
                .apply()
            Result.success()
        } catch (_: Exception) { Result.retry() }
    }

    companion object {
        fun schedule(c: Context) {
            val request = PeriodicWorkRequestBuilder<UpdateWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(c).enqueueUniquePeriodicWork("ping-online-updates",
                ExistingPeriodicWorkPolicy.KEEP, request)
        }
        fun cancel(c: Context) { WorkManager.getInstance(c).cancelUniqueWork("ping-online-updates") }
        @Synchronized fun notifyOnce(c: Context, p: android.content.SharedPreferences, event: String,
                                    username: String, o: JSONObject) {
            val key = "notified:$event:$username"
            val ids = p.getStringSet(key, emptySet())!!.toMutableSet()
            val id = o.optString("id")
            if (!ids.add(id)) return
            // Bound metadata storage independently of the record cache.
            p.edit().putStringSet(key, ids.toList().takeLast(1500).toSet()).apply()
            PingNotifications.show(c, o)
        }
    }
}

private fun java.io.InputStream.readBytesLimited(): ByteArray {
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) {
        val n = read(buffer)
        if (n < 0) break
            require(output.size() + n <= 17_000_000)
        output.write(buffer, 0, n)
    }
    return output.toByteArray()
}
