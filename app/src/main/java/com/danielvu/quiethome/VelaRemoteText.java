package com.danielvu.quiethome;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import org.json.JSONObject;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** Encrypts phone-to-TV text end to end. Cloudflare relays opaque AES-GCM
 * ciphertext, never a plaintext search or form entry. The TV's EC private key
 * is wrapped by Android Keystore before being stored in private app settings.
 */
final class VelaRemoteText {
    private final SharedPreferences prefs;
    private PrivateKey privateKey;
    private String publicKey;

    VelaRemoteText(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences("vela-remote-text", Context.MODE_PRIVATE);
    }

    synchronized String publicKey() {
        if (publicKey != null) return publicKey;
        try {
            String sealed = prefs.getString("private", "");
            String encoded = prefs.getString("public", "");
            if (!sealed.isEmpty() && !encoded.isEmpty()) {
                try {
                    byte[] pkcs8 = Base64.decode(VelaRemoteClient.decrypt(sealed), Base64.NO_WRAP);
                    privateKey = KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(pkcs8));
                    publicKey = encoded;
                    return publicKey;
                } catch (Exception staleKey) {
                    // An OS reinstall may rotate the Android Keystore wrapper;
                    // create a new TV-only key without retaining unusable data.
                    prefs.edit().remove("private").remove("public").apply();
                }
            }
            KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
            generator.initialize(new ECGenParameterSpec("secp256r1"));
            KeyPair pair = generator.generateKeyPair();
            encoded = Base64.encodeToString(pair.getPublic().getEncoded(), Base64.NO_WRAP);
            sealed = VelaRemoteClient.encrypt(Base64.encodeToString(pair.getPrivate().getEncoded(), Base64.NO_WRAP));
            prefs.edit().putString("private", sealed).putString("public", encoded).apply();
            privateKey = pair.getPrivate();
            publicKey = encoded;
            return publicKey;
        } catch (Exception ignored) { return ""; }
    }

    synchronized String decrypt(JSONObject message) {
        if (publicKey().isEmpty() || message == null) return null;
        try {
            byte[] ephemeral = Base64.decode(message.getString("ephemeral"), Base64.DEFAULT);
            byte[] iv = Base64.decode(message.getString("iv"), Base64.DEFAULT);
            byte[] cipherText = Base64.decode(message.getString("cipher"), Base64.DEFAULT);
            if (ephemeral.length < 70 || ephemeral.length > 130 || iv.length != 12
                || cipherText.length < 16 || cipherText.length > 320) return null;

            PublicKey phoneKey = KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(ephemeral));
            KeyAgreement agreement = KeyAgreement.getInstance("ECDH");
            agreement.init(privateKey);
            agreement.doPhase(phoneKey, true);
            byte[] aesKey = MessageDigest.getInstance("SHA-256").digest(agreement.generateSecret());
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(aesKey, "AES"), new GCMParameterSpec(128, iv));
            byte[] clear = cipher.doFinal(cipherText);
            if (clear.length > 240) return null;
            String text = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(clear)).toString();
            if (text.length() > 160 || text.indexOf('\n') >= 0 || text.indexOf('\r') >= 0 || text.indexOf('\0') >= 0) return null;
            return text;
        } catch (Exception ignored) { return null; }
    }
}
