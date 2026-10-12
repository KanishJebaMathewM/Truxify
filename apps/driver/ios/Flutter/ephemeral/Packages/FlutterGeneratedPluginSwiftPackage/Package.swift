// swift-tools-version: 5.9
// The swift-tools-version declares the minimum version of Swift required to build this package.
//
// Generated file. Do not edit.
//

import PackageDescription

let package = Package(
    name: "FlutterGeneratedPluginSwiftPackage",
    platforms: [
        .iOS("15.0")
    ],
    products: [
        .library(name: "FlutterGeneratedPluginSwiftPackage", type: .static, targets: ["FlutterGeneratedPluginSwiftPackage"])
    ],
    dependencies: [
        .package(name: "app_links", path: "../.packages/app_links-7.2.1"),
        .package(name: "battery_plus", path: "../.packages/battery_plus-7.1.2"),
        .package(name: "camera_avfoundation", path: "../.packages/camera_avfoundation-0.10.3+1"),
        .package(name: "connectivity_plus", path: "../.packages/connectivity_plus-7.3.1"),
        .package(name: "device_info_plus", path: "../.packages/device_info_plus-11.5.0"),
        .package(name: "firebase_auth", path: "../.packages/firebase_auth-6.7.0"),
        .package(name: "firebase_core", path: "../.packages/firebase_core-4.15.0"),
        .package(name: "firebase_messaging", path: "../.packages/firebase_messaging-16.7.0"),
        .package(name: "flutter_image_compress_common", path: "../.packages/flutter_image_compress_common-1.1.1"),
        .package(name: "flutter_secure_storage_darwin", path: "../.packages/flutter_secure_storage_darwin-0.3.2"),
        .package(name: "flutter_webrtc", path: "../.packages/flutter_webrtc-1.6.2+hotfix.3"),
        .package(name: "geolocator_apple", path: "../.packages/geolocator_apple-2.3.14"),
        .package(name: "image_picker_ios", path: "../.packages/image_picker_ios-0.8.13+9"),
        .package(name: "package_info_plus", path: "../.packages/package_info_plus-8.3.1"),
        .package(name: "permission_handler_apple", path: "../.packages/permission_handler_apple-9.6.2"),
        .package(name: "printing", path: "../.packages/printing-5.15.1"),
        .package(name: "sentry_flutter", path: "../.packages/sentry_flutter-8.14.2"),
        .package(name: "share_plus", path: "../.packages/share_plus-10.1.4"),
        .package(name: "shared_preferences_foundation", path: "../.packages/shared_preferences_foundation-2.5.7"),
        .package(name: "sqflite_darwin", path: "../.packages/sqflite_darwin-2.4.4"),
        .package(name: "url_launcher_ios", path: "../.packages/url_launcher_ios-6.4.2"),
        .package(name: "workmanager_apple", path: "../.packages/workmanager_apple-0.9.6"),
        .package(name: "FlutterFramework", path: "../.packages/FlutterFramework")
    ],
    targets: [
        .target(
            name: "FlutterGeneratedPluginSwiftPackage",
            dependencies: [
                .product(name: "app-links", package: "app_links"),
                .product(name: "battery-plus", package: "battery_plus"),
                .product(name: "camera-avfoundation", package: "camera_avfoundation"),
                .product(name: "connectivity-plus", package: "connectivity_plus"),
                .product(name: "device-info-plus", package: "device_info_plus"),
                .product(name: "firebase-auth", package: "firebase_auth"),
                .product(name: "firebase-core", package: "firebase_core"),
                .product(name: "firebase-messaging", package: "firebase_messaging"),
                .product(name: "flutter-image-compress-common", package: "flutter_image_compress_common"),
                .product(name: "flutter-secure-storage-darwin", package: "flutter_secure_storage_darwin"),
                .product(name: "flutter-webrtc", package: "flutter_webrtc"),
                .product(name: "geolocator-apple", package: "geolocator_apple"),
                .product(name: "image-picker-ios", package: "image_picker_ios"),
                .product(name: "package-info-plus", package: "package_info_plus"),
                .product(name: "permission-handler-apple", package: "permission_handler_apple"),
                .product(name: "printing", package: "printing"),
                .product(name: "sentry-flutter", package: "sentry_flutter"),
                .product(name: "share-plus", package: "share_plus"),
                .product(name: "shared-preferences-foundation", package: "shared_preferences_foundation"),
                .product(name: "sqflite-darwin", package: "sqflite_darwin"),
                .product(name: "url-launcher-ios", package: "url_launcher_ios"),
                .product(name: "workmanager-apple", package: "workmanager_apple"),
                .product(name: "FlutterFramework", package: "FlutterFramework")
            ]
        )
    ]
)
