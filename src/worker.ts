import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { Logger } from '@nestjs/common'

async function bootstrap() {
  const logger = new Logger('WorkerBootstrap')

  // Se houver porta injetada pela Railway, habilita escuta HTTP para suportar healthcheck
  const port = process.env.PORT
  if (port) {
    const app = await NestFactory.create(AppModule)
    app.enableShutdownHooks()
    await app.listen(port, '0.0.0.0')
    logger.log(`🚀 Worker BullMQ ativo e ouvindo healthcheck na porta ${port}`)
  } else {
    const app = await NestFactory.createApplicationContext(AppModule)
    app.enableShutdownHooks()
    logger.log('🚀 Worker BullMQ ativo em modo standalone')
  }

  logger.log('📦 Aguardando jobs da fila [nota-fiscal-queue] com rate limit...')
}

bootstrap().catch((err) => {
  console.error('❌ Erro fatal ao iniciar o Worker BullMQ:', err)
  process.exit(1)
})
