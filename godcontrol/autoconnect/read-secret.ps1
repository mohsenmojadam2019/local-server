# Read an existing, current-user DPAPI secret without putting it on the command line.
param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
$encrypted = (Get-Content -LiteralPath $Path -Raw).Trim()
$secure = ConvertTo-SecureString -String $encrypted
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr))
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
