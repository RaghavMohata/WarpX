#!/bin/bash
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "Installing dependencies for the first time - this may take a minute..."
  npm install
fi
(sleep 2 && open http://localhost:3000) &
npm start
