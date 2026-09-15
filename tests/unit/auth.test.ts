/**
 * Unit tests for authentication utility.
 *
 * getUserId identity is now session-derived — its contract is pinned in
 * tests/unit/auth-session-identity.test.ts (F8a). This file covers the
 * remaining helpers.
 */
import { describe, it, expect } from 'vitest';
import { isValidUserId, AuthError, unauthorizedResponse } from '@/lib/auth';

describe('Auth Utility', () => {
  describe('isValidUserId', () => {
    it('accepts alphanumeric ids with hyphens and underscores', () => {
      expect(isValidUserId('user_123-abc')).toBe(true);
      expect(isValidUserId('a'.repeat(64))).toBe(true);
    });

    it('rejects empty ids', () => {
      expect(isValidUserId('')).toBe(false);
    });

    it('rejects ids over 64 characters', () => {
      expect(isValidUserId('a'.repeat(65))).toBe(false);
    });

    it('rejects ids with special characters', () => {
      expect(isValidUserId('user<script>')).toBe(false);
      expect(isValidUserId('has space')).toBe(false);
    });
  });

  describe('AuthError', () => {
    it('creates error with default status 401', () => {
      const error = new AuthError('Not authenticated');

      expect(error.message).toBe('Not authenticated');
      expect(error.statusCode).toBe(401);
      expect(error.name).toBe('AuthError');
    });

    it('creates error with custom status', () => {
      const error = new AuthError('Forbidden', 403);

      expect(error.statusCode).toBe(403);
    });
  });

  describe('unauthorizedResponse', () => {
    it('creates 401 response with default message', async () => {
      const response = unauthorizedResponse();

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('Authentication required');
    });

    it('creates 401 response with custom message', async () => {
      const response = unauthorizedResponse('Custom error');

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('Custom error');
    });
  });
});
