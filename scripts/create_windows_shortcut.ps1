[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$Check
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$targetPath = Join-Path $projectRoot 'release\win-unpacked\Arpeggio.exe'
$workingDirectory = Split-Path -Parent $targetPath
$shortcutPath = Join-Path $projectRoot 'Arpeggio.lnk'

if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
  throw "Executable not found: $targetPath. Run npm run dist:dir first."
}

$shell = New-Object -ComObject WScript.Shell

if ($Install) {
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $targetPath
  $shortcut.WorkingDirectory = $workingDirectory
  $shortcut.IconLocation = "$targetPath,0"
  $shortcut.Description = 'Open the Arpeggio private guitar score library'
  $shortcut.Save()
}

if ($Check -or $Install) {
  if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) {
    throw "Shortcut not found: $shortcutPath"
  }
  $saved = $shell.CreateShortcut($shortcutPath)
  $verified = (
    $saved.TargetPath -eq $targetPath -and
    $saved.WorkingDirectory -eq $workingDirectory -and
    $saved.IconLocation -eq "$targetPath,0"
  )
  [pscustomobject]@{
    Verified = $verified
    Shortcut = $shortcutPath
    Target = $saved.TargetPath
    WorkingDirectory = $saved.WorkingDirectory
    Icon = $saved.IconLocation
  }
  if (-not $verified) { throw 'Shortcut configuration does not match the current packaged build.' }
}

if (-not $Install -and -not $Check) {
  Write-Output 'Use -Install to create the shortcut or -Check to validate it.'
}
