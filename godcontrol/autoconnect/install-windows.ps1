# One-time per-user installation; afterwards the agent runs at user logon.
# The opt-in file is an operator-controlled ON/OFF switch, not a credential.
[CmdletBinding()]
param(
    [string]$DeviceId = 'matin-windows',
    [string]$ProjectRoot = 'C:\xampp\htdocs\digizargar_front',
    [switch]$Disable,
    [switch]$SkipSecretPrompt
)
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'GodControl'
$consentPath = Join-Path $dir 'auto-connect.json'
$settingsPath = Join-Path $dir 'agent-settings.json'
$tokenPath = Join-Path $dir 'local-mcp-token.dpapi'
$taskName = 'GodControl-AutoConnect-' + $DeviceId
$godcontrolDir = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $godcontrolDir 'autoconnect\launcher.js'
$node = (Get-Command node.exe -ErrorAction Stop).Source

New-Item -ItemType Directory -Force -Path $dir | Out-Null
if ($Disable) {
    if (Test-Path -LiteralPath $consentPath) {
        $data = Get-Content -LiteralPath $consentPath -Raw | ConvertFrom-Json
        $data.enabled = $false
        $data | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $consentPath -Encoding UTF8
    }
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Auto-connect disabled for $DeviceId"
    return
}
if (-not (Test-Path -LiteralPath $ProjectRoot)) {
    throw "ProjectRoot does not exist: $ProjectRoot. Pass -ProjectRoot with an existing authorized directory."
}
if (-not (Test-Path -LiteralPath $launcher)) {
    throw "Agent launcher not found: $launcher"
}

$settings = [ordered]@{
    deviceId = $DeviceId
    deviceName = 'Matin Windows'
    hubUrl = 'wss://mcp.redcoweb.ir/agent/connect'
    localMcp = 'http://127.0.0.1:8787/mcp'
    readRoots = @($ProjectRoot)
    writeRoots = @($ProjectRoot)
    allowedPrograms = @('git', 'node', 'npm')
}
$settings | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $settingsPath -Encoding UTF8

if (-not (Test-Path -LiteralPath $tokenPath) -and -not $SkipSecretPrompt) {
    Write-Host 'One-time setup: enter the token from YOUR OWN local GodControl MCP service.'
    $secret = Read-Host 'Local MCP token' -AsSecureString
    $encrypted = ConvertFrom-SecureString -SecureString $secret
    if ($encrypted) { Set-Content -LiteralPath $tokenPath -Value $encrypted -Encoding ASCII }
}

$consent = [ordered]@{
    version = 1
    enabled = $true
    deviceId = $DeviceId
    approvedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$consent | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $consentPath -Encoding UTF8

# Register a LIMITED, per-user task: it cannot grant itself administrator rights.
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $node -Argument ('"' + $launcher + '"') -WorkingDirectory $godcontrolDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $taskSettings -Force | Out-Null

Write-Host "Installed startup task: $taskName"
Write-Host "Local consent switch: $consentPath"
Write-Host "To stop: .\autoconnect\install-windows.ps1 -DeviceId $DeviceId -Disable"
Write-Host "Check prerequisites: node .\autoconnect\launcher.js --check"
$oauthPath = Join-Path $HOME '.config\godcontrol\device-oauth.json'
if (-not (Test-Path -LiteralPath $oauthPath)) {
    Write-Warning 'OAuth enrollment is still required ONCE for the device. This task cannot bypass login/consent.'
}
if (-not (Test-Path -LiteralPath $tokenPath)) {
    Write-Warning 'Local MCP secret is missing; start is deferred until the authorized secret is configured.'
}
if ((Test-Path -LiteralPath $oauthPath) -and (Test-Path -LiteralPath $tokenPath)) {
    Start-ScheduledTask -TaskName $taskName
    Write-Host 'Agent startup requested; check ChatGPT GodControl devices_list for confirmation.'
}
