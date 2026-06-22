# Environment Setup & Compile-Time Injection

Truxify utilizes Flutter's internal dart-define/JSON define parsing engine to handle compilation token management.

## Required Environment Variables

To run the client applications successfully, you must configure the following key-value pairs. They can be injected individually using `--dart-define` flags or loaded from a configuration file.

| Variable | Description | Local Development Default |
|----------|-------------|---------------------------|
| `TRUXIFY_API_BASE_URL` | Local or Remote Backend API URL | `http://localhost:5000` |
| `SUPABASE_URL` | Supabase Project URL | `https://your-project-id.supabase.co` |
| `SUPABASE_ANON_KEY` | Public Supabase Anonymous Key | `your-anon-key-placeholder` |

## Local Development Execution

### 1. Using CLI individually
Run the command below (replace example values with your actual config):
```bash
flutter run \
  --dart-define=TRUXIFY_API_BASE_URL=http://localhost:5000 \
  --dart-define=SUPABASE_URL=https://your-project-id.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=your-anon-key
```

### 2. Using Makefile
If you have configured a `.env` file at the root of the repository, you can launch the applications using:
```bash
make run-driver
```
or
```bash
make run-customer
```

### 3. Using --dart-define-from-file (Recommended)
You can generate a shared JSON file using the setup script:
```bash
./scripts/generate_dart_defines.sh
```
And then run either app with:
```bash
flutter run --dart-define-from-file=dart_define.json
```

## VS Code launch.json Integration

Pre-configured launch profiles are provided under `.vscode/launch.json` for both `apps/driver` and `apps/customer`.

To manually add configurations to your launch profile:
```json
"toolArgs": [
  "--dart-define=TRUXIFY_API_BASE_URL=http://localhost:5000",
  "--dart-define=SUPABASE_URL=https://your-project-id.supabase.co",
  "--dart-define=SUPABASE_ANON_KEY=your-anon-key"
]
```
Or to use the auto-generated JSON file:
```json
"toolArgs": [
  "--dart-define-from-file=dart_define.json"
]
```

## Release Generation Build Targets

For release compilation, inject the production endpoints:

### Android APK:
```bash
flutter build apk --release \
  --dart-define=TRUXIFY_API_BASE_URL=https://api.truxify.com \
  --dart-define=SUPABASE_URL=https://your-prod-project.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=your-prod-anon-key
```

### iOS Bundle:
```bash
flutter build ios --release \
  --dart-define=TRUXIFY_API_BASE_URL=https://api.truxify.com \
  --dart-define=SUPABASE_URL=https://your-prod-project.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=your-prod-anon-key
```
