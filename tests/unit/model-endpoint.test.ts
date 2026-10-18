import { describe, expect, it } from 'vitest';
import { modelTransportNotice } from '../../src/shared/model-endpoint';

describe('model transport notice', () => {
  it.each(['http://localhost:11434/v1', 'http://127.0.0.1:8000/v1', 'http://127.10.20.30/v1', 'http://127.1/v1', 'http://[::1]:8080/v1', 'https://models.example/v1', '', 'invalid-address'])('keeps local, encrypted or incomplete configuration unchanged: %s', endpoint => {
    expect(modelTransportNotice(endpoint)).toBeNull();
  });
  it.each(['http://192.0.2.10/v1', 'http://192.168.1.10/v1', 'http://localhost.example/v1', 'http://[2001:db8::1]/v1', 'HTTP://models.example/v1'])('warns for unencrypted remote or LAN transports: %s', endpoint => {
    expect(modelTransportNotice(endpoint)).toContain('未加密 HTTP');
    expect(modelTransportNotice(endpoint)).toContain('API Key');
  });
});
