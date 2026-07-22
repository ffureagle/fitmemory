$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceDatabase = Join-Path $projectRoot "backend\fitmemory.db"
$migrationProject = Join-Path $projectRoot "migration\FitMemory.Migrate\FitMemory.Migrate.csproj"

Write-Host ""
Write-Host "FitMemory - SQLite verilerini Supabase'e tasima" -ForegroundColor Cyan
Write-Host "Kaynak: $sourceDatabase"
Write-Host ""

if (-not (Test-Path -LiteralPath $sourceDatabase)) {
    throw "Yerel FitMemory veritabani bulunamadi: $sourceDatabase"
}

$securePassword = Read-Host "Supabase Database Password" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    if ([string]::IsNullOrWhiteSpace($plainPassword)) {
        throw "Veritabani parolasi bos olamaz."
    }

    $escapedPassword = $plainPassword.Replace('"', '""')
    $env:POSTGRES_CONNECTION_STRING =
        'Host=aws-0-eu-central-1.pooler.supabase.com;' +
        'Port=5432;' +
        'Database=postgres;' +
        'Username=postgres.lwjynpkzpwzhofcgvzti;' +
        'Password="' + $escapedPassword + '";' +
        'SSL Mode=Require;' +
        'GSS Encryption Mode=Disable;' +
        'Include Error Detail=false'

    $plainPassword = $null
    $escapedPassword = $null

    Write-Host ""
    Write-Host "Veriler aktariliyor..." -ForegroundColor Yellow
    $migrationOutput = & dotnet run --project $migrationProject --configuration Release -- --sqlite $sourceDatabase 2>&1
    if ($LASTEXITCODE -ne 0) {
        $rootCause = $migrationOutput |
            Where-Object { $_ -match 'MessageText:|password authentication|user not found|does not exist|Hedef PostgreSQL' } |
            Select-Object -Last 1
        if ([string]::IsNullOrWhiteSpace($rootCause)) {
            $rootCause = $migrationOutput | Select-Object -First 1
        }
        throw "Aktarim durdu. Ana neden: $rootCause"
    }

    $migrationOutput | ForEach-Object { Write-Host $_ }

    Write-Host ""
    Write-Host "Aktarim basariyla tamamlandi." -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "Aktarim basarisiz: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
    $env:POSTGRES_CONNECTION_STRING = $null
    $securePassword = $null
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    Write-Host ""
    Read-Host "Pencereyi kapatmak icin Enter'a basin"
}
