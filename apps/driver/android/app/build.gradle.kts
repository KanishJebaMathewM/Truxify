plugins {
    id("com.android.application")
    id("kotlin-android")
    id("com.google.gms.google-services")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.truxify.driver"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        applicationId = "com.sigma.truxify.driver"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

   
       signingConfigs {
        create("release") {
            val keystorePropertiesFile = rootProject.file("key.properties")
            val keystoreProperties = java.util.Properties()

            if (keystorePropertiesFile.exists()) {
                keystorePropertiesFile.inputStream().use {
                    keystoreProperties.load(it)
                }

                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                storePassword = keystoreProperties.getProperty("storePassword")

                keystoreProperties.getProperty("storeFile")
                    ?.takeIf { it.isNotBlank() }
                    ?.let { storeFile = rootProject.file(it) }
            }
        }
    }
    

    buildTypes {
        release {
           // Release builds require the production keystore configured in key.properties.                          signingConfig = signingConfigs.getByName("release")
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    // Import the Firebase BoM
    implementation(platform("com.google.firebase:firebase-bom:34.15.0"))
    implementation("com.google.firebase:firebase-analytics")
    implementation("com.google.firebase:firebase-messaging")
    implementation("com.google.firebase:firebase-crashlytics")
}

val validateReleaseSigning by tasks.registering {
    doLast {
        val propertiesFile = rootProject.file("key.properties")

        check(propertiesFile.isFile) {
            "Missing key.properties. Copy key.properties.example and configure signing."
        }

        val properties = java.util.Properties()
        propertiesFile.inputStream().use {
            properties.load(it)
        }

        val required = listOf(
            "keyAlias",
            "keyPassword",
            "storePassword",
            "storeFile"
        )

        val missing = required.filter {
            properties.getProperty(it).isNullOrBlank()
        }

        check(missing.isEmpty()) {
            "Missing release signing properties: ${missing.joinToString()}"
        }

        val keystoreFile = rootProject.file(properties.getProperty("storeFile"))

        check(keystoreFile.isFile) {
            "Release keystore not found: ${keystoreFile.path}"
        }
    }
}

tasks.configureEach {
    if (
        name.contains("Release") &&
        (
            name.startsWith("assemble") ||
            name.startsWith("bundle") ||
            name.startsWith("package") ||
            name.startsWith("validateSigning")
        )
    ) {
        dependsOn(validateReleaseSigning)
    }
}