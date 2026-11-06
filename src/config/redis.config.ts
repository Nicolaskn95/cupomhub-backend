import { ConfigService } from '@nestjs/config'
import { ConnectionOptions } from 'bullmq'

export function getRedisConnectionOptions(
  configService: ConfigService,
): ConnectionOptions {
  let redisUrl =
    configService.get<string>('REDIS_URL') ||
    configService.get<string>('REDIS_PUBLIC_URL')

  // Se o Railway injetar a string literal com erro de interpolação ${{...}}, desconsidera
  if (redisUrl && !redisUrl.startsWith('${{')) {
    try {
      const parsed = new URL(redisUrl)
      return {
        host: parsed.hostname,
        port: Number(parsed.port) || 6379,
        username: parsed.username
          ? decodeURIComponent(parsed.username)
          : undefined,
        password: parsed.password
          ? decodeURIComponent(parsed.password)
          : undefined,
        tls: parsed.protocol === 'rediss:' ? {} : undefined,
        maxRetriesPerRequest: null,
      }
    } catch {
      // Ignora erro de parsing e tenta variáveis diretas
    }
  }

  return {
    host:
      configService.get<string>('REDISHOST') ||
      configService.get<string>('REDIS_HOST', 'localhost'),
    port: Number(
      configService.get<string | number>('REDISPORT') ||
        configService.get<string | number>('REDIS_PORT', 6379),
    ),
    password:
      configService.get<string>('REDISPASSWORD') ||
      configService.get<string>('REDIS_PASSWORD') ||
      undefined,
    username: configService.get<string>('REDISUSER') || undefined,
    maxRetriesPerRequest: null,
  }
}
