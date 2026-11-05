# tod-node: runs the node CLI in Docker with its data volume (PowerShell twin of docker/tod-node).
$image = if ($env:TOD_NODE_IMAGE) { $env:TOD_NODE_IMAGE } else { "ghcr.io/lightcreator1007/tod-node:latest" }
if ($args.Count -gt 0 -and $args[0] -eq "run") {
    # The daemon outlives the shell and restarts after a crash or reboot; its local API stays on loopback.
    docker run -d --restart unless-stopped --name tod-node -p 127.0.0.1:7777:7777 -v tod-data:/data $image @args
} else {
    docker run --rm -i -v tod-data:/data $image @args
}
exit $LASTEXITCODE
