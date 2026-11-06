# tod-node: runs the node CLI in Docker with its data volume (PowerShell twin of docker/tod-node).
$image = if ($env:TOD_NODE_IMAGE) { $env:TOD_NODE_IMAGE } else { "ghcr.io/lightcreator1007/tod-node:latest" }
$name = "tod-node"
# A bare -e NAME passes the host value only if it is set, so RPC URLs never land in the image or docker inspect.
$envs = @("-e", "TOD_NETWORK", "-e", "TOD_COORDINATOR", "-e", "BASE_SEPOLIA_RPC_URL", "-e", "ANVIL_RPC_URL", "-e", "NO_COLOR")
$tty = if (-not [Console]::IsInputRedirected -and -not [Console]::IsOutputRedirected) { @("-t") } else { @() }
$running = (docker inspect -f '{{.State.Running}}' $name 2>$null) -eq "true"

if ($args.Count -gt 0 -and $args[0] -eq "run") {
    if ($running) { Write-Error "tod-node is already running"; exit 6 }
    docker rm $name 2>$null | Out-Null  # a stopped container with this name would block docker run
    # --init forwards signals; 240 s covers the commit and reveal windows, so a stop can finish an owed reveal.
    docker run -d --init --restart unless-stopped --stop-timeout 240 --name $name -p 127.0.0.1:7777:7777 -v tod-data:/data @envs $image @args
} elseif ($args.Count -gt 0 -and $args[0] -eq "stop") {
    if (-not $running) { Write-Error "tod-node is not running"; exit 3 }
    # SIGTERM makes the daemon reveal what it owes, then exit; an explicit stop also keeps unless-stopped from restarting it.
    docker stop $name
} elseif ($running) {
    # While the daemon runs, commands go into its container so status and logs see the real node.
    docker exec -i @tty $name tod-app @args
} else {
    docker run --rm -i @tty -v tod-data:/data @envs $image @args
}
exit $LASTEXITCODE
