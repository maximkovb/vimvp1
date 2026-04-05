# Polls TikTok stats every 10 minutes against the local dev server.
# Run this in a separate terminal while `npm run dev` is running.
#
# Usage: .\scripts\poll-local.ps1

# Add ?force=true to bypass the 10-minute cooldown (useful for manual testing)
$url    = "http://localhost:3000/api/cron/poll-tiktok"
$secret = "vasyakosmos12"

Write-Host "Starting local TikTok poller (every 10 minutes). Press Ctrl+C to stop.`n"

while ($true) {
    $timestamp = Get-Date -Format "HH:mm:ss"
    try {
        $response = Invoke-RestMethod -Uri $url `
            -Method GET `
            -Headers @{ Authorization = "Bearer $secret" }
        Write-Host "[$timestamp] Polled: $($response | ConvertTo-Json -Compress)"
    } catch {
        Write-Host "[$timestamp] Error: $_"
    }
    Write-Host "  Next poll in 10 minutes..."
    Start-Sleep -Seconds 600
}
