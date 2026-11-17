# app

## Overview
The single Gradle module (`:app`) of the Android project. `build.gradle` sets `compileSdk`/`targetSdk` 35, `minSdk` 24, version 1.26.0 (code 42), ABIs `arm64-v8a` and `armeabi-v7a`, and R8 shrinking for release. Dependencies: androidx webkit, work-runtime, exifinterface, ML Kit text-recognition and barcode-scanning; JUnit and org.json for tests. `proguard-rules.pro` holds the shrinker rules.

## Subdirectories & Boundaries
- src: [./src/README.md](./src/README.md) - source sets (`main`; `test` is not documented).
