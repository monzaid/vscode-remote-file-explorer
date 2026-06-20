#!/bin/bash
# Custom initialization for SSH test server
# Create test data directories and files
mkdir -p /home/testuser/testdir
echo "Hello from remote server!" > /home/testuser/sample.txt
echo "Line 1: This is a test file." > /home/testuser/data/test1.txt
echo "Line 2: With multiple lines." >> /home/testuser/data/test1.txt
echo "Line 3: For search testing." >> /home/testuser/data/test1.txt
echo '{"name": "test", "version": "1.0"}' > /home/testuser/data/config.json
chown -R testuser:testuser /home/testuser/
