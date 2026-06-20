#!/bin/bash
# Stop Docker test environment
cd "$(dirname "$0")"
docker compose down
