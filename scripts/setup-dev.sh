#!/bin/bash
set -e

echo "Setting up GolfClip development environment..."

cd "$(dirname "$0")/.."

# Install desktop backend in editable mode
echo "Installing desktop backend..."
pip install -e apps/desktop

# Install browser extension dependencies
echo "Installing browser extension dependencies..."
cd apps/browser && npm install && cd ../..

echo ""
echo "Development environment ready!"
echo ""
echo "To run the desktop backend:"
echo "  cd apps/desktop && uvicorn backend.main:app --reload --port 8420"
echo ""
echo "To run the browser extension:"
echo "  cd apps/browser && npm run dev"
