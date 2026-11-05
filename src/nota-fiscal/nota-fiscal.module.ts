import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { BullModule } from '@nestjs/bullmq'
import { NotaFiscalController } from './nota-fiscal.controller'
import { NotaFiscalService } from './nota-fiscal.service'
import { NotaFiscalProcessor } from './nota-fiscal.processor'
import { AuthModule } from '../auth/auth.module'
import { NotaFiscal, NotaFiscalSchema } from './schemas/nota-fiscal.schema'
import { Produto, ProdutoSchema } from './schemas/produto.schema'
import {
  EstabelecimentoUsuario,
  EstabelecimentoUsuarioSchema,
} from './schemas/estabelecimento-usuario.schema'
import { MercadoModule } from '../mercado/mercado.module'
import { HistoricoCompraModule } from '../historico-compra/historico-compra.module'
import { ProdutoCatalogoModule } from '../produto-catalogo/produto-catalogo.module'
import { CategoriaModule } from '../categoria/categoria.module'

@Module({
  imports: [
    AuthModule,
    MercadoModule,
    HistoricoCompraModule,
    ProdutoCatalogoModule,
    CategoriaModule,
    BullModule.registerQueue({
      name: 'nota-fiscal-queue',
    }),
    MongooseModule.forFeature([
      { name: NotaFiscal.name, schema: NotaFiscalSchema },
      { name: Produto.name, schema: ProdutoSchema },
      {
        name: EstabelecimentoUsuario.name,
        schema: EstabelecimentoUsuarioSchema,
      },
    ]),
  ],
  controllers: [NotaFiscalController],
  providers: [NotaFiscalService, NotaFiscalProcessor],
  exports: [NotaFiscalService, BullModule],
})
export class NotaFiscalModule {}
