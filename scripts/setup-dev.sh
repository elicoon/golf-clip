#!/bin/bash
set -e

echo "Setting up GolfClip development environment..."

cd "$(dirname "$0")/.."

# Install Python packages in editable mode
echo "Installing Python packages..."
pip install -e packages/detection
pip install -e packages/api-schemas
pip install -e apps/desktop

# Install frontend dependencies
echo "Installing frontend dependencies..."
cd packages/frontend && npm install && cd ../..

echo ""
echo "Development environment ready!"
echo ""
echo "To run the desktop backend:"
echo "  cd apps/desktop && uvicorn backend.main:app --reload --port 8420"
echo ""
echo "To run the frontend:"
echo "  cd packages/frontend && npm run dev"
