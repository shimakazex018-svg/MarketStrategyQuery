# 需要管理员权限
$ruleName = "Market Cycle Strategy TCP 48101"
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if (-not $existing) {
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort 48101 -Profile Private
  Write-Host "Created firewall rule: $ruleName"
} else {
  Write-Host "Firewall rule already exists: $ruleName"
}
