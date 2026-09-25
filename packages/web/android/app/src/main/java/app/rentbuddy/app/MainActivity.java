package app.rentbuddy.app;

import android.os.Build;
import android.os.Bundle;
import android.os.Process;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        installCrashReporter();
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
        }
    }

    private void installCrashReporter() {
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            StringBuilder full = new StringBuilder();
            full.append("THREAD: ").append(thread.getName()).append('\n');
            Throwable t = throwable;
            int depth = 0;
            while (t != null && depth < 8) {
                full.append(t.getClass().getName()).append(": ").append(String.valueOf(t.getMessage())).append('\n');
                StackTraceElement[] stack = t.getStackTrace();
                if (stack != null) {
                    for (int i = 0; i < Math.min(stack.length, 12); i++) {
                        full.append("    at ").append(stack[i].toString()).append('\n');
                    }
                }
                t = t.getCause();
                depth++;
            }
            String trace = full.length() > 4000 ? full.substring(0, 4000) : full.toString();
            try {
                sendCrash(trace);
            } catch (Exception ignored) {
            }
            if (prev != null) {
                prev.uncaughtException(thread, throwable);
            }
            Process.killProcess(Process.myPid());
        });
    }

    private void sendCrash(String trace) {
        try {
            String versionName = "";
            try {
                versionName = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception ignored) {
            }
            URL url = new URL("https://rentbuddy-api-s7rz.onrender.com/api/crash-report");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            String body =
                "{\"trace\":\"" + jsonEscape(trace) +
                "\",\"model\":\"" + jsonEscape(Build.MODEL) +
                "\",\"androidVersion\":\"" + jsonEscape(Build.VERSION.RELEASE) +
                "\",\"appVersion\":\"" + jsonEscape(versionName) +
                "\",\"packageName\":\"" + jsonEscape(getPackageName()) + "\"}";
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.getBytes(StandardCharsets.UTF_8));
            }
            int code = conn.getResponseCode();
            conn.disconnect();
            Log.i("NabriCrash", "report sent code=" + code);
        } catch (Exception e) {
            Log.e("NabriCrash", "report failed", e);
        }
    }

    private static String jsonEscape(String s) {
        if (s == null) {
            return "";
        }
        StringBuilder b = new StringBuilder();
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"':
                    b.append("\\\"");
                    break;
                case '\\':
                    b.append("\\\\");
                    break;
                case '\n':
                    b.append("\\n");
                    break;
                case '\r':
                    b.append("\\r");
                    break;
                case '\t':
                    b.append("\\t");
                    break;
                default:
                    b.append(c);
            }
        }
        return b.toString();
    }
}