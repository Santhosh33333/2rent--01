# Capacitor ProGuard Rules

# Keep Capacitor
-keep class com.getcapacitor.** { *; }
-keep class com.capacitor.** { *; }

# Keep WebView JavaScript Interface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep native methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# Don't warn about Capacitor plugins
-dontwarn com.getcapacitor.**
-dontwarn com.capacitor.**
