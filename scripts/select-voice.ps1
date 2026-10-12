# Chooses the Windows voice for the narration run and exports it as A11Y_VOICE for later steps.
# Needs Windows PowerShell 5.1, the same host the narration itself speaks through (src/narration/tts.ts).
# Usage: set REQUESTED_VOICE (optional), then run this script. Writes to $env:GITHUB_ENV when set.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo })

Write-Host 'Installed voices:'
foreach ($voice in $voices) { Write-Host ('  {0} ({1})' -f $voice.Name, $voice.Culture.Name) }

if ($voices.Count -eq 0) {
  Write-Host '::error::No speech voices are installed on this machine, so there is nothing to narrate with.'
  exit 1
}

$wanted = if ($env:REQUESTED_VOICE) { $env:REQUESTED_VOICE } else { 'Microsoft Zira Desktop' }
$chosen = $voices | Where-Object { $_.Name -eq $wanted } | Select-Object -First 1
if (-not $chosen) {
  $chosen = $voices | Where-Object { $_.Culture.Name -like 'en-*' } | Select-Object -First 1
  if (-not $chosen) { $chosen = $voices[0] }
  Write-Host "::warning::Voice '$wanted' is not installed here; narrating with '$($chosen.Name)' instead."
}

Write-Host "Narrating with: $($chosen.Name)"
if ($env:GITHUB_ENV) {
  # AppendAllText writes UTF-8 without a byte-order mark; Out-File in 5.1 would add one and corrupt the first line.
  [System.IO.File]::AppendAllText($env:GITHUB_ENV, "A11Y_VOICE=$($chosen.Name)`n")
}
