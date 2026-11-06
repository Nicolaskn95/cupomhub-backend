import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { json, urlencoded } from 'express'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  app.use(json({ limit: '15mb' }))
  app.use(urlencoded({ extended: true, limit: '15mb' }))

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') || [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://192.168.15.7:5173',
      'http://192.168.15.7:3000',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true,
  })

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )

  const port = process.env.PORT || 3001
  await app.listen(port, '0.0.0.0')
  console.log(`Server running on port ${port}`)
}
bootstrap()
