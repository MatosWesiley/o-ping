package br.com.eventoperto

import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec

/** One non-exportable device key; organization-issued certificates grant offline publishing. */
object SignedRecords {
    private const val ALIAS = "ping-publisher-v1"
    private fun decode(s: String) = Base64.decode(s, Base64.DEFAULT)
    private fun encode(b: ByteArray) = Base64.encodeToString(b, Base64.NO_WRAP)
    private fun same(a:Any?,b:Any?):Boolean = when {
        a is JSONObject && b is JSONObject -> a.length()==b.length() &&
            a.keys().asSequence().all { b.has(it)&&same(a.opt(it),b.opt(it)) }
        a is org.json.JSONArray && b is org.json.JSONArray -> a.length()==b.length() &&
            (0 until a.length()).all { same(a.opt(it),b.opt(it)) }
        a is Number && b is Number -> a.toDouble()==b.toDouble()
        else -> a==b
    }
    private fun store(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    @Synchronized fun publicKey(): String {
        val ks = store()
        if (!ks.containsAlias(ALIAS)) {
            val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
            generator.initialize(KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256).build())
            generator.generateKeyPair()
        }
        return encode(store().getCertificate(ALIAS).publicKey.encoded)
    }
    private fun check(key: String, raw: String, signature: String): Boolean = runCatching {
        val public = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(decode(key)))
        Signature.getInstance("SHA256withECDSA").run {
            initVerify(public); update(raw.toByteArray(Charsets.UTF_8)); verify(decode(signature))
        }
    }.getOrDefault(false)
    fun fingerprint(key: String): String = runCatching {
        MessageDigest.getInstance("SHA-256").digest(decode(key))
            .take(12).joinToString(":") { "%02X".format(it) }
    }.getOrDefault("")
    fun authority(p: SharedPreferences, event: String): String =
        p.getString("trust:$event:${p.getString("server","")}", "") ?: ""

    fun sessionProof(p: SharedPreferences, response: JSONObject, event: String) {
        val key = response.getString("serverPublicKey")
        val existing = authority(p, event)
        require(existing.isBlank() || existing == key) {
            "A chave do servidor mudou. Confira com a organização; a confiança anterior foi preservada."
        }
        val raw = response.getString("certificate")
        val cert = JSONObject(raw)
        require(check(key, raw, response.getString("certificateSignature")) &&
            cert.getString("event") == event && cert.getString("publicKey") == publicKey() &&
            cert.getLong("expires") > System.currentTimeMillis()) { "Certificado do servidor inválido." }
        p.edit().putString("trust:$event:${p.getString("server","")}", key)
            .putString("certificate", raw)
            .putString("certificateSignature", response.getString("certificateSignature"))
            .putString("role", cert.getString("role"))
            .putString("teamId", cert.optString("teamId")).apply()
    }

    fun sign(record: JSONObject, p: SharedPreferences): JSONObject {
        publicKey()
        val certRaw = p.getString("certificate", "")!!
        val cert = JSONObject(certRaw)
        require(cert.getLong("expires") > System.currentTimeMillis()) {
            "Sua autorização offline venceu. Entre novamente com o servidor disponível."
        }
        record.put("author", cert.getString("username"))
            .put("authorName", cert.getString("name")).put("authorRole", cert.getString("role"))
        val raw = record.toString()
        val signature = Signature.getInstance("SHA256withECDSA").run {
            initSign(store().getKey(ALIAS, null) as PrivateKey)
            update(raw.toByteArray(Charsets.UTF_8)); encode(sign())
        }
        return record.put("payload", raw).put("signature", signature)
            .put("certificate", certRaw)
            .put("certificateSignature", p.getString("certificateSignature", ""))
    }

    fun verified(record: JSONObject, event: String, authority: String, cached: Boolean = false): JSONObject? = runCatching {
        if (authority.isBlank()) return null
        val certRaw = record.getString("certificate")
        if (!check(authority, certRaw, record.getString("certificateSignature"))) return null
        val cert = JSONObject(certRaw)
        if (cert.optString("event") != event ||
            (!cached && cert.optLong("expires") <= System.currentTimeMillis())) return null
        val raw = record.getString("payload")
        if (!check(cert.getString("publicKey"), raw, record.getString("signature"))) return null
        val data = JSONObject(raw)
        if (data.optString("event") != event ||
            data.optString("author") != cert.optString("username") ||
            data.optString("authorName") != cert.optString("name") ||
            data.optString("authorRole") != cert.optString("role")) return null
        for (key in data.keys()) {
            if (key in listOf("payload","signature","certificate","certificateSignature")) return null
            val a = data.get(key); val b = record.opt(key)
            if (!same(a,b)) return null
        }
        when (cert.optString("role")) {
            "coach" -> if (data.optString("kind") !in listOf("notice","agenda","bulletin") ||
                cert.optString("teamId").isBlank() || data.optString("teamId") != cert.optString("teamId") ||
                data.optString("audience") != "team" || data.optString("priority") == "emergency") return null
            "organization" -> {}
            else -> return null
        }
        if (data.optString("priority") == "emergency" &&
            (data.optString("kind") != "notice" || data.optString("audience") != "all" ||
             cert.optString("role") != "organization")) return null
        if (data.has("replaces")) {
            val original = data.optJSONObject("original") ?: return null
            if (original.has("replaces")) return null
            val root = verified(original,event,authority,true) ?: return null
            if (root.optString("id") != data.optString("replaces") ||
                root.optString("kind") != data.optString("kind") ||
                root.optString("kind") !in listOf("notice","agenda","bulletin") ||
                root.optString("audience") != data.optString("audience") ||
                root.optString("teamId") != data.optString("teamId") ||
                data.optLong("expires") < root.optLong("expires") ||
                (cert.optString("role") == "coach" && root.optString("author") != cert.optString("username"))) return null
        }
        data.put("payload", raw).put("signature", record.getString("signature"))
            .put("certificate", certRaw)
            .put("certificateSignature", record.getString("certificateSignature"))
    }.getOrNull()

    fun visible(o: JSONObject, role: String, team: String): Boolean =
        role != "guest" && (o.optString("audience","all") == "all" ||
            role == "organization" || (team.isNotBlank() && o.optString("teamId") == team))

    /** Immutable signed revisions: deterministic newest version wins, including tombstones. */
    fun effective(records: Collection<JSONObject>): List<JSONObject> =
        records.groupBy { it.optString("replaces").ifBlank { it.optString("id") } }
            .values.mapNotNull { versions ->
                versions.maxWithOrNull(compareBy<JSONObject> { it.optLong("created") }
                    .thenBy { if(it.has("replaces")) 1 else 0 }.thenBy { it.optString("id") })
                    ?.takeUnless { it.optBoolean("deleted") }
            }
}
