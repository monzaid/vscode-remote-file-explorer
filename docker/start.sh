#!/bin/bash
# Start Docker test environment
cd "$(dirname "$0")"
docker compose up -d
echo "Waiting for containers to be ready..."
sleep 5
docker compose ps
echo ""
echo "Test SSH: ssh -o StrictHostKeyChecking=no -p 2222 testuser@localhost"
echo "Test FTP: ftp localhost 2121"
echo "Password for both: testpass / ftppass"
