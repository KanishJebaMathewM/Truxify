\# Android Production Release Signing



This guide explains how to configure production signing for the Truxify Driver and Customer Android apps.



\## 1. Generate a release keystore



Run these commands from the repository root:



```powershell

keytool -genkeypair -v -keystore apps/driver/android/upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias driver

keytool -genkeypair -v -keystore apps/customer/android/upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias customer

```

