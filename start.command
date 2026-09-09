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

# Wait until the server actually answers before opening anything. A fixed
# sleep opens the browser on a dead port whenever startup runs slow (first
# run, cold disk, slow laptop).
(
  for _ in $(seq 1 60); do
    curl -s -o /dev/null http://localhost:3000/ && break
    sleep 0.5
  done
  open http://localhost:3000/
  open http://localhost:3000/admin.html
  open http://localhost:3000/driver.html
) &

npm start
