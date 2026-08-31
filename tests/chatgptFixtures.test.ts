import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { findSendButton, snapshotFromDocument } from '../src/chatgptAdapter';

function fixture(name: string): Document {
  const html = readFileSync(resolve(import.meta.dirname, 'fixtures', 'chatgpt', name), 'utf8');
  return new JSDOM(html).window.document;
}

describe('captured ChatGPT DOM fixtures', () => {
  it('observes a normal conversation as idle with durable message identity', () => {
    const snapshot = snapshotFromDocument(fixture('idle.html'), 'https://chatgpt.com/c/session-2');
    expect(snapshot.status).toBe('idle');
    expect(snapshot.latestAssistantMessageId).toBe('message:m2');
    expect(snapshot.latestAssistantText).toBe('latest result');
  });

  it('prefers generating and explicit failure surfaces over composer readiness', () => {
    expect(snapshotFromDocument(fixture('generating.html'), 'https://chatgpt.com/c/live').status).toBe('generating');
    expect(snapshotFromDocument(fixture('blocked.html'), 'https://chatgpt.com/').status).toBe('blocked');
    expect(snapshotFromDocument(fixture('error.html'), 'https://chatgpt.com/c/error').status).toBe('error');
  });

  it('supports custom-GPT conversation routes and localized send controls', () => {
    const doc = fixture('custom-gpt.html');
    const snapshot = snapshotFromDocument(doc, 'https://chatgpt.com/g/g-worker/c/custom-42');
    expect(snapshot.conversationId).toBe('custom-42');
    expect(snapshot.status).toBe('idle');
    expect(snapshot.latestAssistantMessageId).toBe('turn:turn-7');
    expect(findSendButton(doc)).not.toBeNull();
  });

  it('recognizes the current mobile composer DOM as a ready ChatGPT page', () => {
    const doc = fixture('mobile-composer.html');
    const snapshot = snapshotFromDocument(doc, 'https://chatgpt.com/');
    expect(snapshot.status).toBe('idle');
    expect(snapshot.signals).toContain('composer-ready');
    expect(findSendButton(doc)).not.toBeNull();
  });

  it('treats a visible login surface as authentication-required even when a composer exists', () => {
    const doc = fixture('logged-out-mobile.html');
    const snapshot = snapshotFromDocument(doc, 'https://chatgpt.com/');
    expect(snapshot.status).toBe('unauthorized');
    expect(snapshot.signals).toContain('login-ui');
  });

  it('classifies the login route as unauthorized without trusting page text', () => {
    const snapshot = snapshotFromDocument(fixture('idle.html'), 'https://chatgpt.com/auth/login');
    expect(snapshot.status).toBe('unauthorized');
  });
});
