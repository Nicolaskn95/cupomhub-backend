import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ListaComprasController } from './lista-compras.controller'
import { ListaComprasService } from './lista-compras.service'
import { VozPlnRagService } from './voz-pln-rag.service'
import {
  ListaCompras,
  ListaComprasSchema,
} from './schemas/lista-compras.schema'
import {
  ProdutoApelido,
  ProdutoApelidoSchema,
} from './schemas/produto-apelido.schema'
import {
  RascunhoListaCompras,
  RascunhoListaComprasSchema,
} from './schemas/rascunho-lista.schema'
import {
  NotaFiscal,
  NotaFiscalSchema,
} from '../nota-fiscal/schemas/nota-fiscal.schema'
import { Produto, ProdutoSchema } from '../nota-fiscal/schemas/produto.schema'
import {
  EstabelecimentoUsuario,
  EstabelecimentoUsuarioSchema,
} from '../nota-fiscal/schemas/estabelecimento-usuario.schema'
import {
  Categoria,
  CategoriaSchema,
} from '../categoria/schemas/categoria.schema'
import {
  Prefixo,
  PrefixoSchema,
} from '../categoria/schemas/prefixo-categoria.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ListaCompras.name, schema: ListaComprasSchema },
      { name: ProdutoApelido.name, schema: ProdutoApelidoSchema },
      { name: RascunhoListaCompras.name, schema: RascunhoListaComprasSchema },
      { name: NotaFiscal.name, schema: NotaFiscalSchema },
      { name: Produto.name, schema: ProdutoSchema },
      {
        name: EstabelecimentoUsuario.name,
        schema: EstabelecimentoUsuarioSchema,
      },
      { name: Categoria.name, schema: CategoriaSchema },
      { name: Prefixo.name, schema: PrefixoSchema },
    ]),
  ],
  controllers: [ListaComprasController],
  providers: [ListaComprasService, VozPlnRagService],
  exports: [ListaComprasService, VozPlnRagService],
})
export class ListaComprasModule {}
