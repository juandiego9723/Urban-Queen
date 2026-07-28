Add-Type -AssemblyName System.Drawing

$inputPath = "$PSScriptRoot\public\logo-tikdance.jpg"
$outputPath = "$PSScriptRoot\public\app-icon.ico"

if (Test-Path $inputPath) {
    $img = [System.Drawing.Image]::FromFile($inputPath)
    $bmp = New-Object System.Drawing.Bitmap($img, 256, 256)
    $hIcon = $bmp.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($hIcon)
    
    $stream = [System.IO.File]::OpenWrite($outputPath)
    $icon.Save($stream)
    $stream.Close()
    
    $bmp.Dispose()
    $img.Dispose()
    Write-Host "ICO generado con éxito en $outputPath"
} else {
    Write-Error "No se encontró $inputPath"
}
