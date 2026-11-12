# The web page calls these methods by name through the JavaScript bridge.
-keepclassmembers class com.imeilens.scanner.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
-keep class com.imeilens.scanner.ScanWorker { *; }
-keep class com.imeilens.scanner.StopReceiver { *; }
