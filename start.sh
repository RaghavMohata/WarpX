#!/bin/bash
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "Installing dependencies for the first time - this may take a minute..."
  npm install
fi

echo ""
echo "  Opening three tabs once the server is up:"
echo "    Customer site   http://localhost:3000/"
echo "    Owner dashboard http://localhost:3000/admin.html"
echo "    Driver Hub      http://localhost:3000/driver.html"
echo ""

open_url() {
  xdg-open "$1" 2>/dev/null || sensible-browser "$1" 2>/dev/null || true
}

# Wait until the server actually answers before opening anything. A fixed
# sleep opens the browser on a dead port whenever startup runs slow.
(
  for _ in $(seq 1 60); do
    curl -s -o /dev/null http://localhost:3000/ && break
    sleep 0.5
  done
  open_url http://localhost:3000/
  open_url http://localhost:3000/admin.html
  open_url http://localhost:3000/driver.html
) &

npm start
