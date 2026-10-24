# One-time per-user installation; afterwards the local MCP and agent run at logon without any prompts.
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
    localMcp = 'http://127.0.0.1:18787/mcp'
    readRoots = @($ProjectRoot)
    writeRoots = @($ProjectRoot)
    allowedPrograms = @('git', 'node', 'npm')
}
$settings | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $settingsPath -Encoding UTF8

if (-not (Test-Path -LiteralPath $tokenPath) -and -not $SkipSecretPrompt) {
    # Generate and DPAPI-protect a unique local MCP token. No prompts or passwords.
    $bytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $token = [Convert]::ToBase64String($bytes)
    $secureToken = ConvertTo-SecureString -String $token -AsPlainText -Force
    $encrypted = ConvertFrom-SecureString -SecureString $secureToken
    Set-Content -LiteralPath $tokenPath -Value $encrypted -Encoding ASCII
    $token = $null
    Write-Host 'Generated unique local MCP token (protected by current-user DPAPI).'
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
    Write-Warning 'Device is not yet authenticated: authorize it ONCE (existing OAuth or approved SSH identity). The service will not ask for credentials at every boot.'
}
if (-not (Test-Path -LiteralPath $tokenPath)) {
    Write-Warning 'Local MCP secret is missing; start is deferred until the authorized secret is configured.'
}
if ((Test-Path -LiteralPath $oauthPath) -and (Test-Path -LiteralPath $tokenPath)) {
    Start-ScheduledTask -TaskName $taskName
    Write-Host 'Agent startup requested; check ChatGPT GodControl devices_list for confirmation.'
}
