#!/bin/bash
cd "$(dirname "$0")"
PORT=8765
python3 -m http.server "$PORT" >/tmp/last-one-left.log 2>&1 &
SERVER_PID=$!
sleep 1
open "http://localhost:$PORT"
echo "Last One Left is running at http://localhost:$PORT"
echo "Press Control-C to stop it."
trap 'kill $SERVER_PID 2>/dev/null' INT TERM EXIT
wait $SERVER_PID
