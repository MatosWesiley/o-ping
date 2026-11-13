package br.com.eventoperto

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.graphics.BitmapFactory
import org.json.JSONObject

object PingNotifications {
    fun enabled(c: Context): Boolean =
        (Build.VERSION.SDK_INT < 33 ||
            c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            (c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).areNotificationsEnabled()

    fun channels(c: Context) {
        val m = c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        val audio = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        // New channel IDs: Android never reapplies sound changes to an existing channel.
        m.createNotificationChannel(NotificationChannel("ping-updates-sound", "Avisos e atualizações",
            NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Avisos de equipe, boletins e alterações na programação"
                setSound(sound,audio)
                enableVibration(true)
            })
        m.createNotificationChannel(NotificationChannel("ping-emergency-sound", "Comunicados de emergência",
            NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Comunicados de emergência recebidos da organização"
                enableVibration(true)
                setSound(sound,audio)
            })
    }
    fun show(c: Context, o: JSONObject, test: Boolean = false) {
        if (!enabled(c)) return
        channels(c)
        val emergency = o.optString("priority") == "emergency"
        val intent = Intent(c, MainActivity::class.java)
            .putExtra("notificationRecord", o.optString("id"))
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pi = PendingIntent.getActivity(c, o.optString("id").hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val text = o.optString("text")
        val n = Notification.Builder(c, if (emergency) "ping-emergency-sound" else "ping-updates-sound")
            .setSmallIcon(R.drawable.ic_notification)
            .setLargeIcon(BitmapFactory.decodeResource(c.resources,R.mipmap.ic_launcher))
            .setContentTitle(if (test) "Ping · teste de notificação" else
                (if (emergency) "Emergência · " else "") + o.optString("title"))
            .setContentText(text).setStyle(Notification.BigTextStyle().bigText(text))
            .setContentIntent(pi).setAutoCancel(true)
            .setCategory(if (emergency) Notification.CATEGORY_ALARM else Notification.CATEGORY_EVENT)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .build()
        (c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(o.optString("id", "test").hashCode(), n)
    }
}
