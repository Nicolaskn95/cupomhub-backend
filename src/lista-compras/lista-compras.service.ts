import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { ListaCompras } from './schemas/lista-compras.schema'
import { ProdutoApelido } from './schemas/produto-apelido.schema'
import { RascunhoListaCompras } from './schemas/rascunho-lista.schema'
import { NotaFiscal } from '../nota-fiscal/schemas/nota-fiscal.schema'
import { Produto } from '../nota-fiscal/schemas/produto.schema'
import { EstabelecimentoUsuario } from '../nota-fiscal/schemas/estabelecimento-usuario.schema'
import { GerarListaDto } from './dto/gerar-lista.dto'
import { MarcarItemDto } from './dto/marcar-item.dto'
import { AdicionarItemDto } from './dto/adicionar-item.dto'
import { SalvarApelidoDto } from './dto/salvar-apelido.dto'
import { SalvarItensLoteDto } from './dto/salvar-itens-lote.dto'
import { AdicionarVozDto } from './dto/adicionar-voz.dto'
import { AtualizarRascunhoDto } from './dto/atualizar-rascunho.dto'
import { ProcessarRagDto } from './dto/processar-rag.dto'
import {
  CandidatoHistoricoMercado,
  ItemExtraidoPln,
  VozPlnRagService,
} from './voz-pln-rag.service'
import { removerAcentos } from '../produto-catalogo/utils/sanitizar-produto.util'

@Injectable()
export class ListaComprasService {
  constructor(
    @InjectModel(ListaCompras.name)
    private readonly listaComprasModel: Model<ListaCompras>,
    @InjectModel(ProdutoApelido.name)
    private readonly produtoApelidoModel: Model<ProdutoApelido>,
    @InjectModel(NotaFiscal.name)
    private readonly notaFiscalModel: Model<NotaFiscal>,
    @InjectModel(Produto.name) private readonly produtoModel: Model<Produto>,
    @InjectModel(EstabelecimentoUsuario.name)
    private readonly estabelecimentoUsuarioModel: Model<EstabelecimentoUsuario>,
    @Optional()
    @InjectModel(RascunhoListaCompras.name)
    private readonly rascunhoListaModel?: Model<RascunhoListaCompras>,
    @Optional()
    private readonly vozPlnRagService?: VozPlnRagService,
  ) {}

  private userFilter(userId: string) {
    return { $or: [{ userId: new Types.ObjectId(userId) }, { userId }] }
  }

  async listarMercadosComHistorico(userId: string) {
    const notas = await this.notaFiscalModel.aggregate([
      { $match: this.userFilter(userId) },
      {
        $group: {
          _id: '$cnpj',
          nomeOriginal: { $first: '$estabelecimento' },
          totalNotas: { $sum: 1 },
          meses: {
            $addToSet: {
              $dateToString: { format: '%Y-%m', date: '$dataEmissao' },
            },
          },
        },
      },
      {
        $project: {
          cnpj: '$_id',
          nomeOriginal: 1,
          totalNotas: 1,
          mesesDisponiveis: { $size: '$meses' },
          _id: 0,
        },
      },
    ])

    const estabelecimentosUsuarios =
      await this.estabelecimentoUsuarioModel.find(this.userFilter(userId))
    const deParaMap = new Map(
      estabelecimentosUsuarios.map((eu) => [eu.cnpj, eu.nomeDepara]),
    )

    return notas.map((n) => ({
      ...n,
      nomeDepara: deParaMap.get(n.cnpj) || null,
    }))
  }

  // ==================== RASCUNHO POR VOZ (PLN) ====================

  async obterRascunho(userId: string) {
    if (!this.rascunhoListaModel) {
      return { itens: [] }
    }
    const rascunho = await this.rascunhoListaModel.findOne(
      this.userFilter(userId),
    )
    if (!rascunho) {
      return { userId, itens: [] }
    }
    return rascunho
  }

  async adicionarItensPorVoz(userId: string, dto: AdicionarVozDto) {
    if (!this.rascunhoListaModel || !this.vozPlnRagService) {
      throw new BadRequestException('Serviço de voz/PLN não disponível.')
    }

    let extraidos: ItemExtraidoPln[] = []
    let textoTranscrito = dto.textoFalado || ''

    if (dto.audioBase64) {
      const resAudio = await this.vozPlnRagService.extrairItensDeAudioBase64(
        dto.audioBase64,
        dto.mimeType,
      )
      extraidos = resAudio.itens
      textoTranscrito = resAudio.textoTranscrito
    } else if (dto.textoFalado) {
      extraidos = await this.vozPlnRagService.extrairItensDeComandoVoz(
        dto.textoFalado,
      )
    }

    if (extraidos.length === 0) {
      throw new BadRequestException(
        'Não foi possível identificar produtos no comando de voz informado.',
      )
    }

    const existente = await this.rascunhoListaModel.findOne(
      this.userFilter(userId),
    )

    const itensAtuais = existente ? [...existente.itens] : []

    for (const novo of extraidos) {
      const chaveNovo = removerAcentos(novo.termoFalado.toLowerCase().trim())
      const idxExistente = itensAtuais.findIndex(
        (i) =>
          removerAcentos(i.termoFalado.toLowerCase().trim()) === chaveNovo &&
          i.unidade.toUpperCase() === novo.unidade.toUpperCase(),
      )

      if (idxExistente >= 0) {
        itensAtuais[idxExistente].quantidade = Number(
          (itensAtuais[idxExistente].quantidade + novo.quantidade).toFixed(2),
        )
        itensAtuais[idxExistente].adicionadoEm = new Date()
      } else {
        itensAtuais.push({
          termoFalado: novo.termoFalado,
          quantidade: novo.quantidade,
          unidade: novo.unidade,
          adicionadoEm: new Date(),
        })
      }
    }

    const atualizado = await this.rascunhoListaModel.findOneAndUpdate(
      this.userFilter(userId),
      {
        userId: new Types.ObjectId(userId),
        itens: itensAtuais,
      },
      { upsert: true, new: true },
    )

    return {
      rascunho: atualizado,
      itensExtraidos: extraidos,
      textoTranscrito,
    }
  }

  async atualizarRascunho(userId: string, dto: AtualizarRascunhoDto) {
    if (!this.rascunhoListaModel) {
      return { itens: dto.itens }
    }

    const itensLimpos = (dto.itens || [])
      .filter((i) => i.termoFalado && i.termoFalado.trim().length > 0)
      .map((i) => ({
        termoFalado: i.termoFalado.trim(),
        quantidade: Number(i.quantidade) > 0 ? Number(i.quantidade) : 1,
        unidade: (i.unidade || 'UN').toUpperCase().trim(),
        adicionadoEm: i.adicionadoEm ? new Date(i.adicionadoEm) : new Date(),
      }))

    return this.rascunhoListaModel.findOneAndUpdate(
      this.userFilter(userId),
      {
        userId: new Types.ObjectId(userId),
        itens: itensLimpos,
      },
      { upsert: true, new: true },
    )
  }

  async limparRascunho(userId: string) {
    if (this.rascunhoListaModel) {
      await this.rascunhoListaModel.deleteOne(this.userFilter(userId))
    }
    return { success: true }
  }

  // ==================== PROCESSAMENTO RAG NO MERCADO ====================

  private async construirCandidatosHistoricoUsuario(
    userId: string,
    cnpjSelecionado: string,
  ): Promise<{
    candidatos: CandidatoHistoricoMercado[]
    nomeEstabelecimentoSelecionado: string
  }> {
    const todasNotas = await this.notaFiscalModel
      .find(this.userFilter(userId))
      .populate({ path: 'produtos', model: Produto.name })

    const estabelecimentosUsuarios =
      await this.estabelecimentoUsuarioModel.find(this.userFilter(userId))
    const deParaMap = new Map(
      estabelecimentosUsuarios.map((eu) => [eu.cnpj, eu.nomeDepara]),
    )

    const apelidos = await this.produtoApelidoModel.find(
      this.userFilter(userId),
    )
    const apelidoMap = new Map(
      apelidos.map((a) => [a.nomeOriginal.toUpperCase().trim(), a.apelido]),
    )

    let nomeEstabelecimentoSelecionado =
      deParaMap.get(cnpjSelecionado) || 'Estabelecimento Desconhecido'

    // Agrupa por (noMercadoSelecionado + nomeOriginal) para priorizar histórico do mercado escolhido
    const mapaMercadoSelecionado = new Map<
      string,
      Array<{ produto: any; dataEmissao: Date; estabelecimento: string }>
    >()
    const mapaOutrosMercados = new Map<
      string,
      Array<{ produto: any; dataEmissao: Date; estabelecimento: string }>
    >()

    for (const nota of todasNotas) {
      const noMercado = nota.cnpj === cnpjSelecionado
      const nomeEstab =
        deParaMap.get(nota.cnpj) || nota.estabelecimento || 'Supermercado'

      if (
        noMercado &&
        nomeEstabelecimentoSelecionado === 'Estabelecimento Desconhecido' &&
        nota.estabelecimento
      ) {
        nomeEstabelecimentoSelecionado = nota.estabelecimento
      }

      const prods = (nota.produtos || []) as any[]
      for (const prod of prods) {
        if (!prod || !prod.nome) continue
        const chave = prod.nome.toUpperCase().trim()
        const destino = noMercado ? mapaMercadoSelecionado : mapaOutrosMercados
        if (!destino.has(chave)) destino.set(chave, [])
        destino.get(chave)!.push({
          produto: prod,
          dataEmissao: nota.dataEmissao || new Date(),
          estabelecimento: nomeEstab,
        })
      }
    }

    const candidatos: CandidatoHistoricoMercado[] = []

    const converterGrupoEmCandidato = (
      chave: string,
      ocorrencias: Array<{
        produto: any
        dataEmissao: Date
        estabelecimento: string
      }>,
      noMercadoSelecionado: boolean,
    ): CandidatoHistoricoMercado => {
      const ordenados = [...ocorrencias].sort(
        (a, b) =>
          new Date(b.dataEmissao).getTime() - new Date(a.dataEmissao).getTime(),
      )
      const maisRecente = ordenados[0]
      const prod = maisRecente.produto
      const valorUnitario =
        prod.valorUnitario ||
        (prod.quantidade > 0 ? prod.valorTotal / prod.quantidade : 0) ||
        0

      const apelido = apelidoMap.get(chave) || null

      return {
        nomeOriginal: prod.nome,
        nomeExibicao: apelido || prod.nome,
        apelido,
        unidade: prod.unidade || 'UN',
        valorUnitarioRecente: Number(valorUnitario.toFixed(2)),
        frequencia: ocorrencias.length,
        noMercadoSelecionado,
        estabelecimento: maisRecente.estabelecimento,
        ultimaCompra: new Date(maisRecente.dataEmissao),
      }
    }

    for (const [chave, ocorrencias] of mapaMercadoSelecionado.entries()) {
      candidatos.push(converterGrupoEmCandidato(chave, ocorrencias, true))
    }

    for (const [chave, ocorrencias] of mapaOutrosMercados.entries()) {
      // Só adiciona de outro mercado se a mesma descrição exata já não estiver no mercado selecionado
      if (!mapaMercadoSelecionado.has(chave)) {
        candidatos.push(converterGrupoEmCandidato(chave, ocorrencias, false))
      }
    }

    return { candidatos, nomeEstabelecimentoSelecionado }
  }

  async processarListaComRag(userId: string, dto: ProcessarRagDto) {
    if (!this.rascunhoListaModel || !this.vozPlnRagService) {
      throw new BadRequestException('Serviço RAG não disponível.')
    }

    const rascunho = await this.rascunhoListaModel.findOne(
      this.userFilter(userId),
    )

    if (!rascunho || !rascunho.itens || rascunho.itens.length === 0) {
      throw new BadRequestException(
        'Sua pré-lista está vazia. Adicione itens usando o comando de voz antes de processar no mercado.',
      )
    }

    const { candidatos, nomeEstabelecimentoSelecionado } =
      await this.construirCandidatosHistoricoUsuario(userId, dto.cnpj)

    const itensVinculados =
      await this.vozPlnRagService.vincularItensComHistorico(
        rascunho.itens.map((i) => ({
          termoFalado: i.termoFalado,
          quantidade: i.quantidade,
          unidade: i.unidade,
        })),
        candidatos,
      )

    const itensFinais = [...itensVinculados]

    // Opcionalmente mescla sugestões recorrentes do mercado que ainda não estejam na lista falada
    if (dto.incluirSugestoesRecorrentes) {
      const recorrentes = await this.calcularItensRecorrentesMercado(
        userId,
        dto.cnpj,
        dto.periodoMeses || 3,
      )
      const nomesOriginaisPresentes = new Set(
        itensFinais.map((i) => i.nomeOriginal.toUpperCase().trim()),
      )

      for (const rec of recorrentes) {
        if (!nomesOriginaisPresentes.has(rec.nomeOriginal.toUpperCase().trim())) {
          itensFinais.push({
            ...rec,
            termoFalado: rec.nome,
            nomeMercado: rec.nomeOriginal,
            origemMatch: 'RECORRENCIA' as any,
            estabelecimentoOrigem: null,
          })
        }
      }
    }

    const estimativaTotal = Number(
      itensFinais
        .reduce((sum, i) => sum + (i.valorEstimado || 0), 0)
        .toFixed(2),
    )

    const listaDocs = await this.listaComprasModel.findOneAndUpdate(
      this.userFilter(userId),
      {
        userId: new Types.ObjectId(userId),
        cnpj: dto.cnpj,
        nomeEstabelecimento: nomeEstabelecimentoSelecionado,
        periodoAnaliseMeses: dto.periodoMeses || 3,
        estimativaTotal,
        itens: itensFinais,
      },
      { upsert: true, new: true },
    )

    // Limpa o rascunho após gerar a lista processada no mercado
    await this.rascunhoListaModel.deleteOne(this.userFilter(userId))

    return listaDocs
  }

  // ==================== GERAÇÃO POR RECORRÊNCIA (EXISTENTE) ====================

  private async calcularItensRecorrentesMercado(
    userId: string,
    cnpj: string,
    periodoMeses: number,
  ) {
    const dataFim = new Date()
    const dataInicio = new Date()
    dataInicio.setMonth(dataInicio.getMonth() - periodoMeses)

    const notas = await this.notaFiscalModel
      .find({
        ...this.userFilter(userId),
        cnpj,
        dataEmissao: { $gte: dataInicio, $lte: dataFim },
      })
      .populate({ path: 'produtos', model: Produto.name })

    const produtosPlanos = notas.flatMap((nota) =>
      ((nota.produtos || []) as any[]).map((produto) => ({
        produto,
        dataEmissao: nota.dataEmissao,
      })),
    )

    const grupos = new Map<string, Array<{ produto: any; dataEmissao: Date }>>()

    for (const item of produtosPlanos) {
      if (!item.produto || !item.produto.nome) continue
      const nomeChave = item.produto.nome.toUpperCase().trim()
      if (!grupos.has(nomeChave)) grupos.set(nomeChave, [])
      grupos.get(nomeChave)!.push(item)
    }

    const apelidos = await this.produtoApelidoModel.find(
      this.userFilter(userId),
    )
    const apelidoMap = new Map(
      apelidos.map((a) => [a.nomeOriginal.toUpperCase().trim(), a.apelido]),
    )

    const itensFiltrados = []

    for (const [nomeChave, itens] of grupos.entries()) {
      const mesesDistintos = new Set(
        itens.map((i) => {
          const d = new Date(i.dataEmissao)
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        }),
      )

      const frequencia = mesesDistintos.size
      if (frequencia < 2) continue

      const quantidadeTotal = itens.reduce(
        (sum, i) => sum + i.produto.quantidade,
        0,
      )
      const mediaQuantidade = Math.ceil(quantidadeTotal / frequencia)

      const itensOrdenados = [...itens].sort(
        (a, b) => b.dataEmissao.getTime() - a.dataEmissao.getTime(),
      )
      const maisRecente = itensOrdenados[0].produto
      const valorUnitarioRecente =
        maisRecente.valorUnitario ||
        maisRecente.valorTotal / maisRecente.quantidade

      const nomeExibicao = apelidoMap.get(nomeChave) || maisRecente.nome
      const valorEstimado = mediaQuantidade * valorUnitarioRecente

      itensFiltrados.push({
        nome: nomeExibicao,
        nomeOriginal: maisRecente.nome,
        termoFalado: apelidoMap.get(nomeChave) || null,
        nomeMercado: maisRecente.nome,
        origemMatch: 'RECORRENCIA',
        estabelecimentoOrigem: null,
        quantidade: mediaQuantidade,
        unidade: maisRecente.unidade,
        valorEstimado,
        valorUnitarioRecente,
        frequencia,
        comprado: false,
      })
    }

    itensFiltrados.sort((a, b) => {
      if (b.frequencia !== a.frequencia) return b.frequencia - a.frequencia
      return a.nome.localeCompare(b.nome)
    })

    return itensFiltrados
  }

  async gerarLista(userId: string, dto: GerarListaDto) {
    const periodoMeses = dto.periodoMeses || 3
    const itensFiltrados = await this.calcularItensRecorrentesMercado(
      userId,
      dto.cnpj,
      periodoMeses,
    )

    const estimativaTotal = itensFiltrados.reduce(
      (sum, i) => sum + i.valorEstimado,
      0,
    )

    let nomeEstabelecimento = 'Estabelecimento Desconhecido'
    const estabelecimentoUsuario =
      await this.estabelecimentoUsuarioModel.findOne({
        ...this.userFilter(userId),
        cnpj: dto.cnpj,
      })

    if (estabelecimentoUsuario?.nomeDepara) {
      nomeEstabelecimento = estabelecimentoUsuario.nomeDepara
    } else {
      const notaQualquer = await this.notaFiscalModel.findOne({
        ...this.userFilter(userId),
        cnpj: dto.cnpj,
      })
      if (notaQualquer?.estabelecimento) {
        nomeEstabelecimento = notaQualquer.estabelecimento
      }
    }

    const listaDocs = await this.listaComprasModel.findOneAndUpdate(
      this.userFilter(userId),
      {
        userId: new Types.ObjectId(userId),
        cnpj: dto.cnpj,
        nomeEstabelecimento,
        periodoAnaliseMeses: periodoMeses,
        estimativaTotal,
        itens: itensFiltrados,
      },
      { upsert: true, new: true },
    )

    return listaDocs
  }

  async obterLista(userId: string) {
    const lista = await this.listaComprasModel.findOne(this.userFilter(userId))
    if (!lista) throw new NotFoundException('Lista não encontrada')
    return lista
  }

  async marcarItem(userId: string, index: number, dto: MarcarItemDto) {
    const field = `itens.${index}.comprado`
    const lista = await this.listaComprasModel.findOneAndUpdate(
      this.userFilter(userId),
      { $set: { [field]: dto.comprado } },
      { new: true },
    )
    if (!lista) throw new NotFoundException('Lista não encontrada')
    return lista
  }

  async salvarItensEmLote(userId: string, dto: SalvarItensLoteDto) {
    const updateQuery = dto.itens.reduce<Record<string, boolean>>(
      (acc, item) => {
        acc[`itens.${item.index}.comprado`] = item.comprado
        return acc
      },
      {},
    )

    const lista = await this.listaComprasModel.findOneAndUpdate(
      this.userFilter(userId),
      { $set: updateQuery },
      { new: true },
    )
    if (!lista) throw new NotFoundException('Lista não encontrada')
    return lista
  }

  async removerItem(userId: string, index: number) {
    // Unset first, then pull null to remove item at index
    const field = `itens.${index}`
    await this.listaComprasModel.updateOne(this.userFilter(userId), {
      $unset: { [field]: 1 },
    })
    const lista = await this.listaComprasModel.findOneAndUpdate(
      this.userFilter(userId),
      { $pull: { itens: null } },
      { new: true },
    )
    if (!lista) throw new NotFoundException('Lista não encontrada')

    // Recalculate estimativaTotal
    const estimativaTotal = lista.itens.reduce(
      (sum, item) => sum + item.valorEstimado,
      0,
    )
    lista.estimativaTotal = estimativaTotal
    await lista.save()

    return lista
  }

  async adicionarItem(userId: string, dto: AdicionarItemDto) {
    const valorEstimado = dto.valorEstimado || 0

    const newItem = {
      nome: dto.nome,
      nomeOriginal: dto.nome,
      termoFalado: dto.nome,
      nomeMercado: null,
      origemMatch: 'MANUAL',
      estabelecimentoOrigem: null,
      quantidade: dto.quantidade,
      unidade: dto.unidade,
      valorEstimado,
      valorUnitarioRecente:
        valorEstimado > 0 ? valorEstimado / dto.quantidade : 0,
      frequencia: 1, // default para item manual
      comprado: false,
    }

    const lista = await this.listaComprasModel.findOneAndUpdate(
      this.userFilter(userId),
      {
        $push: { itens: newItem },
        $inc: { estimativaTotal: valorEstimado },
      },
      { new: true },
    )
    if (!lista) throw new NotFoundException('Lista não encontrada')
    return lista
  }

  /**
   * Permite adicionar novos itens por comando de voz diretamente em uma lista já gerada,
   * processando-os imediatamente no RAG do mercado atual da lista!
   */
  async adicionarVozNaListaAtiva(userId: string, dto: AdicionarVozDto) {
    if (!this.vozPlnRagService) {
      throw new BadRequestException('Serviço de voz/PLN não disponível.')
    }

    const listaAtual = await this.listaComprasModel.findOne(
      this.userFilter(userId),
    )
    if (!listaAtual) {
      throw new NotFoundException('Lista ativa não encontrada.')
    }

    let extraidos: ItemExtraidoPln[] = []
    if (dto.audioBase64) {
      const resAudio = await this.vozPlnRagService.extrairItensDeAudioBase64(
        dto.audioBase64,
        dto.mimeType,
      )
      extraidos = resAudio.itens
    } else if (dto.textoFalado) {
      extraidos = await this.vozPlnRagService.extrairItensDeComandoVoz(
        dto.textoFalado,
      )
    }
    if (extraidos.length === 0) {
      throw new BadRequestException(
        'Não foi possível identificar produtos no comando de voz informado.',
      )
    }

    const { candidatos } = await this.construirCandidatosHistoricoUsuario(
      userId,
      listaAtual.cnpj,
    )

    const novosVinculados =
      await this.vozPlnRagService.vincularItensComHistorico(
        extraidos,
        candidatos,
      )

    const somaAdicional = novosVinculados.reduce(
      (acc, i) => acc + (i.valorEstimado || 0),
      0,
    )

    const listaAtualizada = await this.listaComprasModel.findOneAndUpdate(
      this.userFilter(userId),
      {
        $push: { itens: { $each: novosVinculados } },
        $inc: { estimativaTotal: Number(somaAdicional.toFixed(2)) },
      },
      { new: true },
    )

    return listaAtualizada
  }

  async excluirLista(userId: string) {
    const result = await this.listaComprasModel.deleteOne(
      this.userFilter(userId),
    )
    if (result.deletedCount === 0)
      throw new NotFoundException('Lista não encontrada')
    return { success: true }
  }

  async salvarApelido(userId: string, dto: SalvarApelidoDto) {
    const result = await this.produtoApelidoModel.findOneAndUpdate(
      { ...this.userFilter(userId), nomeOriginal: dto.nomeOriginal },
      {
        userId: new Types.ObjectId(userId),
        nomeOriginal: dto.nomeOriginal,
        apelido: dto.apelido,
      },
      { upsert: true, new: true },
    )
    return result
  }

  async listarApelidos(userId: string) {
    return this.produtoApelidoModel
      .find(this.userFilter(userId))
      .sort({ nomeOriginal: 1 })
  }

  async removerApelido(userId: string, id: string) {
    const result = await this.produtoApelidoModel.deleteOne({
      _id: new Types.ObjectId(id),
      ...this.userFilter(userId),
    })
    if (result.deletedCount === 0)
      throw new NotFoundException('Apelido não encontrado')
    return { success: true }
  }
}
