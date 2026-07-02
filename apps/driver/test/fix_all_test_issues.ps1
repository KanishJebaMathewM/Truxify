# fix_all_test_issues.ps1
Write-Host "=== FIXING ALL TEST ISSUES ===" -ForegroundColor Green

# 1. Create the setup folder and file
Write-Host "`n1. Creating test/setup/test_setup.dart..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path "test\setup" -Force | Out-Null

@'
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:firebase_core/firebase_core.dart';

void setupTestEnvironment() {
  TestWidgetsFlutterBinding.ensureInitialized();
  
  try {
    Supabase.initialize(
      url: 'https://mock-project.supabase.co',
      anonKey: 'mock-anon-key',
    );
  } catch (_) {}
  
  try {
    Firebase.initializeApp(
      options: const FirebaseOptions(
        apiKey: 'mock-api-key',
        appId: 'mock-app-id',
        messagingSenderId: 'mock-sender-id',
        projectId: 'mock-project-id',
      ),
    );
  } catch (_) {}
}
'@ | Out-File -FilePath "test\setup\test_setup.dart" -Encoding UTF8

Write-Host "✅ Created test/setup/test_setup.dart" -ForegroundColor Green

# 2. Fix imports in all test files
Write-Host "`n2. Fixing imports..." -ForegroundColor Yellow

$testFiles = Get-ChildItem -Path "test" -Filter "*.dart" -Recurse | Where-Object { $_.FullName -notlike "*\setup\*" }

foreach ($file in $testFiles) {
    $content = Get-Content $file.FullName -Raw
    
    # Fix import path
    if ($content -match "import '\.\./setup/test_setup.dart';") {
        $content = $content -replace "import '\.\./setup/test_setup.dart';", "import 'setup/test_setup.dart';"
        Set-Content -Path $file.FullName -Value $content -NoNewline
        Write-Host "✅ Fixed import in $($file.Name)" -ForegroundColor Green
    }
}

# 3. Add setupTestEnvironment to files that don't have it
Write-Host "`n3. Adding setup to test files..." -ForegroundColor Yellow

foreach ($file in $testFiles) {
    $content = Get-Content $file.FullName -Raw
    
    if ($content -notmatch "setupTestEnvironment" -and $content -match "void main\(\)") {
        # Add the import if missing
        if ($content -notmatch "import 'setup/test_setup.dart';") {
            $content = $content -replace "(import 'package:flutter_test/flutter_test.dart';)", "`$1`nimport 'setup/test_setup.dart';"
        }
        
        # Add setUpAll
        $content = $content -replace "(void main\(\) \{)", "`$1`n  setUpAll(() {`n    setupTestEnvironment();`n  });"
        Set-Content -Path $file.FullName -Value $content -NoNewline
        Write-Host "✅ Updated $($file.Name)" -ForegroundColor Green
    }
}

# 4. Clean and get packages
Write-Host "`n4. Cleaning and getting packages..." -ForegroundColor Yellow
flutter clean
flutter pub get

# 5. Add Firebase dependencies if missing
Write-Host "`n5. Checking Firebase dependencies..." -ForegroundColor Yellow
$pubspec = Get-Content "pubspec.yaml" -Raw
if ($pubspec -notmatch "firebase_core") {
    Write-Host "⚠️ Firebase Core not found in pubspec.yaml" -ForegroundColor Red
    Write-Host "Add this to pubspec.yaml:" -ForegroundColor Yellow
    Write-Host "  firebase_core: ^2.24.0" -ForegroundColor Cyan
}

Write-Host "`n=== DONE! ===" -ForegroundColor Green
Write-Host "Run: flutter test --coverage" -ForegroundColor Cyan