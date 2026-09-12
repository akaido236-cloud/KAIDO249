// KAIDO Android app module.
//
// Deliberately dependency-light: one Activity and a WebView. Fewer moving parts
// means the first CI build has the best chance of succeeding, and the APK stays
// small.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.kaido.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.kaido.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        // The runtime URL is injected at build time, never hard-coded. With no
        // value the shell ships INERT and shows an honest status page rather
        // than pointing at something arbitrary.
        val runtimeUrl = (project.findProperty("kaidoRuntimeUrl") as String?) ?: ""
        buildConfigField("String", "RUNTIME_URL", "\"$runtimeUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
}
