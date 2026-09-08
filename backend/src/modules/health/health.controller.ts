import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  async check() {
    // readyState 1 is "connected". A real ping is issued as well so that a
    // connection MongoDB has silently dropped is reported as down, not up.
    const connected = this.connection.readyState === 1;
    let pingOk = false;
    if (connected) {
      try {
        await this.connection.db?.admin().ping();
        pingOk = true;
      } catch {
        pingOk = false;
      }
    }

    const body = {
      status: pingOk ? 'ok' : 'degraded',
      database: {
        connected: pingOk,
        name: this.connection.name,
        host: this.connection.host,
      },
      time: new Date().toISOString(),
    };

    if (!pingOk) throw new ServiceUnavailableException(body);
    return body;
  }
}
