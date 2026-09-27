import request from 'supertest';
import { createApp } from './app.js';

describe('application CORS policy', () => {
  it.each(['http://localhost:5173', 'http://127.0.0.1:5173'])(
    'allows the local Vite development origin %s',
    async (origin) => {
      const response = await request(createApp())
        .options('/api/telemetry/history/ORBITAL-X1')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'GET');

      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
    }
  );
});
