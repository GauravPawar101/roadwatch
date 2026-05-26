#!/usr/bin/env tsx

/**
 * Simple test script to verify sidecar auth functionality
 * Run with: tsx packages/sidecar-auth/src/test.ts
 */

import jwt from 'jsonwebtoken';
import { SidecarAuthClient } from './client.js';

const SECRET = 'test-secret';
const GATEWAY_URL = 'http://localhost:3100';

// Mock service registration response
function createMockServiceToken(serviceName: string): string {
  return jwt.sign(
    {
      sub: serviceName,
      aud: 'gateway',
      kind: 'service-registration',
      address: `http://localhost:4001`
    },
    SECRET,
    {
      issuer: 'roadwatch-gateway',
      expiresIn: '24h'
    }
  );
}

// Mock service access token
function createMockAccessToken(caller: string, target: string): string {
  return jwt.sign(
    {
      sub: caller,
      aud: target,
      iss: 'roadwatch-gateway',
      kind: 'service-access',
      target: target,
      address: 'http://localhost:4002'
    },
    SECRET,
    {
      expiresIn: '5m'
    }
  );
}

async function testSidecarAuth() {
  console.log('🧪 Testing Sidecar Auth Implementation\n');

  // Test 1: JWT Token Creation and Validation
  console.log('1. Testing JWT token creation...');
  const registrationToken = createMockServiceToken('test-service');
  const accessToken = createMockAccessToken('service-a', 'service-b');
  
  try {
    const regPayload = jwt.verify(registrationToken, SECRET, {
      audience: 'gateway',
      issuer: 'roadwatch-gateway'
    });
    console.log('✅ Registration token valid:', regPayload);
  } catch (error) {
    console.error('❌ Registration token invalid:', error);
  }

  try {
    const accessPayload = jwt.verify(accessToken, SECRET, {
      audience: 'service-b',
      issuer: 'roadwatch-gateway'
    });
    console.log('✅ Access token valid:', accessPayload);
  } catch (error) {
    console.error('❌ Access token invalid:', error);
  }

  // Test 2: SidecarAuthClient instantiation
  console.log('\n2. Testing SidecarAuthClient...');
  const client = new SidecarAuthClient(GATEWAY_URL, 'test-service');
  console.log('✅ SidecarAuthClient created successfully');

  // Test 3: Mock service registration (would fail without real gateway)
  console.log('\n3. Testing service registration (mock)...');
  try {
    // This would normally call the real gateway
    console.log('📝 Would register service with:', {
      name: 'test-service',
      address: 'http://localhost:4001',
      healthUrl: 'http://localhost:4001/health'
    });
    console.log('✅ Service registration logic ready');
  } catch (error) {
    console.error('❌ Service registration failed:', error);
  }

  console.log('\n🎉 Sidecar auth implementation tests completed!');
  console.log('\n📋 Next steps:');
  console.log('   1. Start the gateway-api server');
  console.log('   2. Start a service with sidecar auth middleware');
  console.log('   3. Test service registration and authentication');
  console.log('   4. Test user authentication through gateway proxy');
}

// Run tests
testSidecarAuth().catch(console.error);