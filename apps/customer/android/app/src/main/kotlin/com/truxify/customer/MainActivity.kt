package com.truxify.customer

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import android.os.BatteryManager
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

class MainActivity: FlutterActivity() {
    private val CHANNEL = "com.truxify.customer/native"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "getBatteryLevel" -> {
                    val batteryLevel = getBatteryLevel()
                    if (batteryLevel != -1) {
                        result.success(batteryLevel)
                    } else {
                        result.error("UNAVAILABLE", "Battery level not available.", null)
                    }
                }
                "getDeviceInfo" -> {
                    val info = mapOf(
                        "device" to Build.DEVICE,
                        "model" to Build.MODEL,
                        "android_version" to Build.VERSION.RELEASE,
                        "sdk_int" to Build.VERSION.SDK_INT
                    )
                    result.success(info)
                }
                "hwGenerateKeyPair" -> {
                    val alias = call.argument<String>("alias")
                    if (alias == null) {
                        result.error("BAD_ARGS", "alias is required", null)
                        return@setMethodCallHandler
                    }
                    try {
                        result.success(hwGenerateKeyPair(alias))
                    } catch (e: Exception) {
                        result.error("HW_KEYSTORE_ERROR", e.message, null)
                    }
                }
                "hwGetPublicKey" -> {
                    val alias = call.argument<String>("alias")
                    if (alias == null) {
                        result.error("BAD_ARGS", "alias is required", null)
                        return@setMethodCallHandler
                    }
                    try {
                        result.success(hwGetPublicKey(alias))
                    } catch (e: Exception) {
                        result.error("HW_KEYSTORE_ERROR", e.message, null)
                    }
                }
                "hwSign" -> {
                    val alias = call.argument<String>("alias")
                    val payload = call.argument<String>("payload")
                    if (alias == null || payload == null) {
                        result.error("BAD_ARGS", "alias and payload are required", null)
                        return@setMethodCallHandler
                    }
                    try {
                        result.success(hwSign(alias, payload))
                    } catch (e: Exception) {
                        result.error("HW_SIGN_ERROR", e.message, null)
                    }
                }
                "hwClearKeyPair" -> {
                    val alias = call.argument<String>("alias")
                    if (alias == null) {
                        result.error("BAD_ARGS", "alias is required", null)
                        return@setMethodCallHandler
                    }
                    try {
                        hwClearKeyPair(alias)
                        result.success(null)
                    } catch (e: Exception) {
                        result.error("HW_CLEAR_ERROR", e.message, null)
                    }
                }
                else -> {
                    result.notImplemented()
                }
            }
        }
    }

    private val hwKeyStoreType = "AndroidKeyStore"

    /// Generates an EC P-256 keypair *inside* the Android Keystore. The private
    /// key is hardware-backed and non-exportable: it can never be read back as
    /// plaintext. Returns the uncompressed (0x04|x|y) public key as hex.
    private fun hwGenerateKeyPair(alias: String): String {
        val keyStore = KeyStore.getInstance(hwKeyStoreType).apply { load(null) }
        if (keyStore.containsAlias(alias)) {
            return ecPublicKeyToUncompressedHex(keyStore, alias)
        }
        val kpg = KeyPairGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_EC,
            hwKeyStoreType,
        )
        val parameterSpec = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
        )
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setIsStrongBoxBacked(false)
            .build()
        kpg.initialize(parameterSpec)
        kpg.generateKeyPair()
        return ecPublicKeyToUncompressedHex(keyStore, alias)
    }

    private fun hwGetPublicKey(alias: String): String {
        val keyStore = KeyStore.getInstance(hwKeyStoreType).apply { load(null) }
        if (!keyStore.containsAlias(alias)) {
            throw IllegalStateException("Hardware keypair not initialized")
        }
        return ecPublicKeyToUncompressedHex(keyStore, alias)
    }

    /// Signs the payload with the hardware-backed private key. The key material
    /// is never exposed to the app; signing happens inside the Keystore.
    private fun hwSign(alias: String, payload: String): String {
        val keyStore = KeyStore.getInstance(hwKeyStoreType).apply { load(null) }
        val privateKey = keyStore.getKey(alias, null) as PrivateKey
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(privateKey)
        signature.update(payload.toByteArray(Charsets.UTF_8))
        return signature.sign().toHex()
    }

    private fun hwClearKeyPair(alias: String) {
        val keyStore = KeyStore.getInstance(hwKeyStoreType).apply { load(null) }
        if (keyStore.containsAlias(alias)) {
            keyStore.deleteEntry(alias)
        }
    }

    private fun ecPublicKeyToUncompressedHex(keyStore: KeyStore, alias: String): String {
        val cert = keyStore.getCertificate(alias)
        val ecPub = cert.publicKey as ECPublicKey
        val w = ecPub.w
        val x = stripTo32Bytes(w.affineX.toByteArray())
        val y = stripTo32Bytes(w.affineY.toByteArray())
        val out = ByteArray(65)
        out[0] = 0x04
        System.arraycopy(x, 0, out, 1, 32)
        System.arraycopy(y, 0, out, 33, 32)
        return out.toHex()
    }

    private fun stripTo32Bytes(value: ByteArray): ByteArray {
        return when {
            value.size == 32 -> value
            value.size > 32 -> value.copyOfRange(value.size - 32, value.size)
            else -> ByteArray(32 - value.size) + value
        }
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    private fun getBatteryLevel(): Int {
        val batteryLevel: Int
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            val batteryManager = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            batteryLevel = batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        } else {
            val intent = ContextWrapper(applicationContext).registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            batteryLevel = intent!!.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) * 100 / intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        }
        return batteryLevel
    }
}
