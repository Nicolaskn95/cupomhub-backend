import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { MongooseModule } from '@nestjs/mongoose'
import { BullModule } from '@nestjs/bullmq'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { NotaFiscalModule } from './nota-fiscal/nota-fiscal.module'
import { CategoriaModule } from './categoria/categoria.module'
import { AuthModule } from './auth/auth.module'
import { DuracaoMediaModule } from './duracao-media/duracao-media.module'
import { ListaComprasModule } from './lista-compras/lista-compras.module'
import { MercadoModule } from './mercado/mercado.module'
import { ProdutoCatalogoModule } from './produto-catalogo/produto-catalogo.module'
import { HistoricoCompraModule } from './historico-compra/historico-compra.module'
import { getRedisConnectionOptions } from './config/redis.config'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const mongoUri = configService.get<string>('MONGO_URI')
        const mongodbUri = configService.get<string>('MONGODB_URI')

        let uri = mongoUri || mongodbUri || 'mongodb://localhost:27017/deOlhoNaNota'
        // Se MONGODB_URI for localhost mas MONGO_URI for Atlas, prioriza Atlas
        if (mongodbUri && !mongodbUri.includes('localhost')) {
          uri = mongodbUri
        } else if (mongoUri) {
          uri = mongoUri
        }

        return { uri }
      },
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: getRedisConnectionOptions(configService),
      }),
    }),
    MercadoModule,
    NotaFiscalModule,
    CategoriaModule,
    AuthModule,
    DuracaoMediaModule,
    ListaComprasModule,
    ProdutoCatalogoModule,
    HistoricoCompraModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
