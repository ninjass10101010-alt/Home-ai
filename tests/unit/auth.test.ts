/**
 * Unit tests for authentication utility
 */
import { describe, it, expect } from 'vitest';
import { getUserId, isValidUserId, AuthError, unauthorizedResponse } from '@/lib/auth';
import { NextRequest } from 'next/server';

// Re-export for testing (since isValidUserId is not exported)
// We'll test it indirectly through getUserId

describe('Auth Utility', () => {
  describe('getUserId', () => {
    it('returns user ID from x-user-id header', () => {
      const request = new NextRequest('http://localhost:3000/api/test', {
        headers: { 'x-user-id': 'user-123' },
      });
      
      expect(getUserId(request)).toBe('user-123');
    });

    it('returns null when no user ID header', () => {
      const request = new NextRequest('http://localhost:3000/api/test');
      
      expect(getUserId(request)).toBeNull();
    });

    it('validates user ID format', () => {
      // Valid IDs
      const validRequest = new NextRequest('http://localhost:3000/api/test', {
        headers: { 'x-user-id': 'user_123-abc' },
      });
      expect(getUserId(validRequest)).toBe('user_123-abc');

      // Invalid ID with special characters
      const invalidRequest = new NextRequest('http://localhost:3000/api/test', {
        headers: { 'x-user-id': 'user<script>' },
      });
      expect(getUserId(invalidRequest)).toBeNull();
    });

    it('rejects empty user ID', () => {
      const request = new NextRequest('http://localhost:3000/api/test', {
        headers: { 'x-user-id': '' },
      });
      
      expect(getUserId(request)).toBeNull();
    });

    it('rejects user ID over 64 characters', () => {
      const longId = 'a'.repeat(65);
      const request = new NextRequest('http://localhost:3000/api/test', {
        headers: { 'x-user-id': longId },
      });
      
      expect(getUserId(request)).toBeNull();
    });

    it('accepts user ID up to 64 characters', () => {
      const maxId = 'a'.repeat(64);
      const request = new NextRequest('http://localhost:3000/api/test', {
        headers: { 'x-user-id': maxId },
      });
      
      expect(getUserId(request)).toBe(maxId);
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
