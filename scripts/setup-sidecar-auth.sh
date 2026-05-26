#!/bin/bash

# Setup script for sidecar authentication
echo "🚀 Setting up Sidecar Authentication for Roadwatch"

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install

# Build sidecar-auth package
echo "🔨 Building sidecar-auth package..."
cd packages/sidecar-auth
pnpm build
cd ../..

# Install gateway dependencies
echo "📦 Installing gateway dependencies..."
cd apps/gateway-api
pnpm install
cd ../..

# Install backend-api dependencies
echo "📦 Installing backend-api dependencies..."
cd backend-api
pnpm install
cd ../..

echo "✅ Sidecar authentication setup complete!"
echo ""
echo "🎯 Next steps:"
echo "   1. Set environment variables:"
echo "      export SERVICE_AUTH_SECRET=your-secret-key"
echo "      export GATEWAY_URL=http://localhost:3100"
echo ""
echo "   2. Start the gateway:"
echo "      cd apps/gateway-api && pnpm dev"
echo ""
echo "   3. Start backend services:"
echo "      cd backend-api && pnpm dev"
echo ""
echo "   4. Test the implementation:"
echo "      tsx packages/sidecar-auth/src/test.ts"
echo ""
echo "📚 Read the documentation:"
echo "   docs/sidecar-auth-architecture.md"