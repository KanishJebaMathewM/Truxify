# update_all_tests.ps1
Write-Host "=== Adding Supabase Setup to All Test Files ===" -ForegroundColor Green

$files = @(
    "test\driver_metrics_test.dart",
    "test\earnings_screen_test.dart",
    "test\home_screen_test.dart",
    "test\profile_logout_test.dart",
    "test\shell_screen_test.dart",
    "test\theme_toggle_test.dart",
    "test\destination_picker_screen_test.dart"
)

foreach ($file in $files) {
    if (Test-Path $file) {
        Write-Host "Updating $file..." -ForegroundColor Yellow
        $content = Get-Content $file -Raw
        
        # Check if setup is already imported
        if ($content -notmatch "import '\.\./setup/test_setup.dart';") {
            # Add import after the last import
            $content = $content -replace "(import 'package:flutter_test/flutter_test.dart';)", "`$1`nimport '../setup/test_setup.dart';"
            
            # Add setUpAll if not exists
            if ($content -notmatch "setUpAll\(\(\) \{") {
                $content = $content -replace "(void main\(\) \{)", "`$1`n  setUpAll(() {`n    setupTestEnvironment();`n  });"
            }
            
            Set-Content -Path $file -Value $content -NoNewline
            Write-Host "✅ Updated $file" -ForegroundColor Green
        } else {
            Write-Host "⏭️ Already updated: $file" -ForegroundColor Gray
        }
    } else {
        Write-Host "❌ File not found: $file" -ForegroundColor Red
    }
}

Write-Host "`n✅ All done! Run: flutter test --coverage" -ForegroundColor Green