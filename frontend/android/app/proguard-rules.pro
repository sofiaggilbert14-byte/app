-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.react.** { *; }
-keep class expo.modules.** { *; }
-dontwarn com.facebook.hermes.**
-keepattributes *Annotation*

# Keep Parcelable implementations
-keepclassmembers class * implements android.os.Parcelable {
  public static final android.os.Parcelable$Creator CREATOR;
}
