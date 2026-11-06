import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

@Schema({ _id: false })
export class ItemLista {
  @Prop({ required: true })
  nome: string

  @Prop({ required: true })
  nomeOriginal: string

  @Prop({ type: String, default: null })
  termoFalado?: string | null

  @Prop({ type: String, default: null })
  nomeMercado?: string | null

  @Prop({
    type: String,
    enum: [
      'MERCADO_SELECIONADO',
      'OUTRO_MERCADO',
      'SEM_HISTORICO',
      'RECORRENCIA',
      'MANUAL',
    ],
    default: 'RECORRENCIA',
  })
  origemMatch?: string

  @Prop({ type: String, default: null })
  estabelecimentoOrigem?: string | null

  @Prop({ required: true })
  quantidade: number

  @Prop({ required: true })
  unidade: string

  @Prop({ type: Number, required: false })
  pesoEstimadoKg?: number

  @Prop({ required: true })
  valorEstimado: number

  @Prop({ required: true })
  valorUnitarioRecente: number

  @Prop({ required: true })
  frequencia: number

  @Prop({ default: false })
  comprado: boolean
}

export const ItemListaSchema = SchemaFactory.createForClass(ItemLista)

@Schema({ timestamps: true })
export class ListaCompras extends Document {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', unique: true })
  userId: Types.ObjectId

  @Prop({ required: true })
  cnpj: string

  @Prop({ required: true })
  nomeEstabelecimento: string

  @Prop({ default: 3 })
  periodoAnaliseMeses: number

  @Prop({ default: 0 })
  estimativaTotal: number

  @Prop({ type: [ItemListaSchema], default: [] })
  itens: ItemLista[]
}

export const ListaComprasSchema = SchemaFactory.createForClass(ListaCompras)
