/**
 * Test setup file
 */

import { beforeAll, afterAll } from 'vitest';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

beforeAll(() => {
  console.log('\n🧪 Starting Kabir AI Safety Tests...\n');
  console.log('⚠️  CRITICAL: All tests must pass before deployment!\n');
});

afterAll(() => {
  console.log('\n✅ Test suite complete.\n');
});
