import * as https from 'https'
import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
  Optional,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { NotaFiscal } from './schemas/nota-fiscal.schema'
import { Produto } from './schemas/produto.schema'
import { EstabelecimentoUsuario } from './schemas/estabelecimento-usuario.schema'
import {
  DadosNotaFiscal,
  ProdutoExtraido,
  TributosDetalhados,
} from './interface/INotaFiscal'
import { AtualizarNotaFiscalDto } from './dto/atualizar-nota-fiscal.dto'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue, QueueEvents } from 'bullmq'
import { ConfigService } from '@nestjs/config'
import { getRedisConnectionOptions } from '../config/redis.config'
import { HistoricoCompraService } from '../historico-compra/historico-compra.service'
import { ProdutoCatalogoService } from '../produto-catalogo/produto-catalogo.service'
import { MercadoService } from '../mercado/mercado.service'
import { EnderecoMercadoDto } from '../mercado/dto/upsert-mercado.dto'
import { CategoriaService } from '../categoria/categoria.service'
import { sanitizarDescricaoProduto } from '../produto-catalogo/utils/sanitizar-produto.util'

/** Remove quebras de linha e múltiplos espaços */
function normalizarTexto(val: string): string {
  if (typeof val !== 'string') return ''
  return val.replace(/\s+/g, ' ').trim()
}

function normalizarNomeProduto(val: string): string {
  return sanitizarDescricaoProduto(val)
}

@Injectable()
export class NotaFiscalService {
  private readonly logger = new Logger(NotaFiscalService.name)

  constructor(
    @InjectModel(NotaFiscal.name) private notaFiscalModel: Model<NotaFiscal>,
    @InjectModel(Produto.name) private produtoModel: Model<Produto>,
    @InjectModel(EstabelecimentoUsuario.name)
    private estabelecimentoUsuarioModel: Model<EstabelecimentoUsuario>,
    @InjectQueue('nota-fiscal-queue') private readonly notaFiscalQueue: Queue,
    private readonly configService: ConfigService,
    private readonly mercadoService: MercadoService,
    @Optional()
    private readonly historicoCompraService?: HistoricoCompraService,
    @Optional()
    private readonly produtoCatalogoService?: ProdutoCatalogoService,
    @Optional()
    private readonly categoriaService?: CategoriaService,
  ) {}

  /**
   * Enfileira a URL da nota fiscal no BullMQ com controle de taxa e aguarda o resultado do Worker.
   */
  async enfileirarProcessamento(url: string, userId: string): Promise<NotaFiscal> {
    if (!this.isUrlNotaFiscalValida(url)) {
      throw new BadRequestException('URL de nota fiscal inválida');
    }

    try {
      const job = await this.notaFiscalQueue.add(
        'processar-url',
        { url, userId },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 3000,
          },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );

      this.logger.log(`Job #${job.id} enfileirado para processar nota fiscal`);

      const redisOptions = getRedisConnectionOptions(this.configService);
      const queueEvents = new QueueEvents('nota-fiscal-queue', {
        connection: redisOptions,
      });

      try {
        const result = await job.waitUntilFinished(queueEvents, 30000);
        return result as NotaFiscal;
      } catch (waitError) {
        const message = waitError instanceof Error ? waitError.message : String(waitError);
        this.logger.warn(
          `Job #${job.id} não finalizou na fila ou falhou (${message}). Executando fallback direto...`,
        );
        return await this.processarUrl(url, userId);
      } finally {
        await queueEvents.close().catch(() => {});
      }
    } catch (queueAddError) {
      const message = queueAddError instanceof Error ? queueAddError.message : String(queueAddError);
      this.logger.warn(
        `Fila Redis indisponível (${message}). Executando processamento síncrono direto...`,
      );
      return await this.processarUrl(url, userId);
    }
  }

  async processarUrl(url: string, userId: string): Promise<NotaFiscal> {
    if (!this.isUrlNotaFiscalValida(url)) {
      throw new BadRequestException('URL de nota fiscal inválida')
    }

    const html = await this.buscarPagina(url)
    const dados = this.extrairDados(html)

    const userObjectId = new Types.ObjectId(userId)
    const notaExistente = await this.notaFiscalModel.findOne({
      chaveAcesso: dados.chaveAcesso,
      // Compat: notas antigas podem ter userId como string.
      $or: [{ userId: userObjectId }, { userId }],
    })

    if (notaExistente) {
      throw new ConflictException(
        'Esta nota fiscal já foi cadastrada anteriormente',
      )
    }

    const mercadoId = await this.obterOuCriarMercadoId(dados)

    const nota = new this.notaFiscalModel({
      ...dados,
      mercadoId,
      estabelecimentoOriginal: dados.estabelecimento,
      urlOriginal: url,
      produtos: [],
      userId: userObjectId,
    })
    await nota.save()

    const produtos = await this.produtoModel.insertMany(
      dados.produtos.map((p) => ({
        ...p,
        notaFiscal: nota._id,
      })),
    )

    nota.produtos = produtos.map((p) => p._id)
    await nota.save()

    // Persiste também na coleção escalável HistoricoCompra (tabela pivô)
    await this.salvarItensHistoricoCompra(
      nota,
      dados.produtos,
      userObjectId,
      dados.estabelecimento,
      dados.cnpj,
      dados.dataEmissao,
    )

    // Auto-categorização inteligente em background dos produtos recém-importados
    this.autoCategorizarProdutosNota(userObjectId.toString(), String(nota._id))

    return this.notaFiscalModel
      .findById(nota._id)
      .populate('produtos')
      .exec() as Promise<NotaFiscal>
  }

  /**
   * Consulta uma NFC-e pela Chave de Acesso (44 dígitos do barcode).
   *
   * Fluxo:
   * 1. Acessa a página de consulta pública da NFCe SP
   * 2. Extrai cookies de sessão e campos hidden do formulário ASP.NET
   * 3. Baixa a imagem do CAPTCHA
   * 4. Resolve o CAPTCHA com Tesseract OCR (pré-processado com sharp)
   * 5. Submete o formulário com a chave + captcha
   * 6. Faz scraping dos dados da nota fiscal na resposta
   * 7. Salva no MongoDB usando o fluxo existente
   *
   * Inclui retry de até 3 tentativas caso o CAPTCHA falhe.
   */
  async processarChaveAcesso(
    chaveAcesso: string,
    userId: string,
  ): Promise<NotaFiscal> {
    throw new BadRequestException(
      'A consulta manual por chave de acesso com resolução de CAPTCHA foi descontinuada. Por favor, utilize a leitura do QR Code do cupom fiscal.',
    );
  }

  private isUrlNotaFiscalValida(url: string): boolean {
    const dominiosValidos = [
      'nfce.fazenda.sp.gov.br',
      'sefaz.rs.gov.br',
      'sat.sef.sc.gov.br',
      'nfce.sefaz',
    ]
    return dominiosValidos.some((d) => url.includes(d))
  }

  private async buscarPagina(url: string): Promise<string> {
    try {
      const httpsAgent = new https.Agent({
        rejectUnauthorized: false,
        keepAlive: true,
        ciphers: 'DEFAULT:@SECLEVEL=1',
      })

      const response = await axios.get(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
          Connection: 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'sec-ch-ua':
            '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
        },
        httpsAgent,
        timeout: 25000,
        maxRedirects: 5,
      })

      return response.data as string
    } catch (error) {
      throw new BadRequestException(
        `Não foi possível acessar a página da nota fiscal: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      )
    }
  }

  private extrairDados(html: string): DadosNotaFiscal {
    const $ = cheerio.load(html)

    const textoBody = $('body').text()

    let estabelecimento = ''

    // Tenta pegar a linha imediatamente antes do CNPJ (geralmente o nome da loja)
    const estCnpjMatch = textoBody.match(/([^\n]*?)\s*CNPJ[:\s]*[\d./-]+/i)
    if (estCnpjMatch) {
      estabelecimento = normalizarTexto(estCnpjMatch[1])
    }

    // Fallback: primeira linha de texto "boa" que não pareça produto nem metadado
    if (!estabelecimento) {
      const linhas = textoBody
        .split('\n')
        .map((l) => normalizarTexto(l))
        .filter((l) => l.length > 3)

      const linhaCandidata = linhas.find((l) => {
        if (/^\d+\s/.test(l)) return false // evita linhas tipo "99 CREME"
        if (l.toUpperCase().includes('CNPJ')) return false
        if (/EMISS[ÃA]O|CHAVE|NFC-E|CONSUMIDOR|ENDEREÇO|CPF/i.test(l)) {
          return false
        }
        return true
      })

      if (linhaCandidata) {
        estabelecimento = linhaCandidata
      }
    }

    const cnpjMatch = $('body')
      .text()
      .match(/CNPJ[:\s]*([\d./-]+)/i)
    const cnpj = cnpjMatch ? cnpjMatch[1].trim() : ''

    const enderecoMatch = $('body')
      .text()
      .match(
        /(?:CNPJ[:\s]*[\d./-]+[\s\S]*?)(R\s+[\w\s,]+,\s*\d+[^]*?(?:SP|RJ|MG|RS|SC|PR|BA|PE|CE|GO|DF))/i,
      )
    const endereco = enderecoMatch
      ? enderecoMatch[1].replace(/\s+/g, ' ').trim()
      : ''

    const chaveMatch = $('body')
      .text()
      .match(/(?:Chave de acesso|Chave)[:\s]*([\d\s]{44,60})/i)
    const chaveAcesso = chaveMatch ? chaveMatch[1].replace(/\s/g, '') : ''

    const numeroMatch = $('body')
      .text()
      .match(/N[úu]mero[:\s]*(\d+)/i)
    const numero = numeroMatch ? numeroMatch[1] : ''

    const serieMatch = $('body')
      .text()
      .match(/S[ée]rie[:\s]*(\d+)/i)
    const serie = serieMatch ? serieMatch[1] : ''

    const dataMatch = $('body')
      .text()
      .match(/Emiss[ãa]o[:\s]*(\d{2}\/\d{2}\/\d{4})/i)
    let dataEmissao = new Date()
    if (dataMatch) {
      const [dia, mes, ano] = dataMatch[1].split('/').map(Number)
      dataEmissao = new Date(ano, mes - 1, dia)
    }

    const valorTotalMatch = $('body')
      .text()
      .match(/Valor total R\$[:\s]*([\d.,]+)/i)
    const valorTotal = valorTotalMatch
      ? parseFloat(valorTotalMatch[1].replace('.', '').replace(',', '.'))
      : 0

    const descontosMatch = $('body')
      .text()
      .match(/Descontos R\$[:\s]*([\d.,]+)/i)
    const descontos = descontosMatch
      ? parseFloat(descontosMatch[1].replace('.', '').replace(',', '.'))
      : 0

    const valorPagoMatch = $('body')
      .text()
      .match(/Valor a pagar R\$[:\s]*([\d.,]+)/i)
    const valorPago = valorPagoMatch
      ? parseFloat(valorPagoMatch[1].replace('.', '').replace(',', '.'))
      : valorTotal - descontos

    // 1. Extração de Tributos Incidentes (Lei Federal 12.741/2012)
    let valorTributos = 0
    let tributosDetalhados: TributosDetalhados | undefined

    const tributosTotaisMatch = textoBody.match(
      /(?:Informação\s+dos\s+Tributos\s+Totais\s+Incidentes|Tributos\s+Totais\s+Incidentes|Valor\s+aproximado\s+dos\s+tributos|Valor\s+aprox\.?\s*(?:dos\s*)?tributos|Tributos\s+Incidentes|Total\s+de\s+tributos)[^\d\n\r]*R\$?[:\s]*([\d.,]+)/i,
    )
    if (tributosTotaisMatch) {
      valorTributos =
        parseFloat(
          tributosTotaisMatch[1].replace(/\./g, '').replace(',', '.'),
        ) || 0
    }

    const fedMatch = textoBody.match(/Federal[:\s]*R\$?[:\s]*([\d.,]+)/i)
    const estMatch = textoBody.match(/Estadual[:\s]*R\$?[:\s]*([\d.,]+)/i)
    const munMatch = textoBody.match(/Municipal[:\s]*R\$?[:\s]*([\d.,]+)/i)

    if (fedMatch || estMatch || munMatch) {
      tributosDetalhados = {
        federal: fedMatch
          ? parseFloat(fedMatch[1].replace(/\./g, '').replace(',', '.')) || 0
          : undefined,
        estadual: estMatch
          ? parseFloat(estMatch[1].replace(/\./g, '').replace(',', '.')) || 0
          : undefined,
        municipal: munMatch
          ? parseFloat(munMatch[1].replace(/\./g, '').replace(',', '.')) || 0
          : undefined,
      }
      if (!valorTributos) {
        valorTributos =
          (tributosDetalhados.federal || 0) +
          (tributosDetalhados.estadual || 0) +
          (tributosDetalhados.municipal || 0)
      }
    }

    // 2. Extração de Forma de Pagamento, Tipo e Cartão
    const formaPagamentoMatch = $('body')
      .text()
      .match(/(?:Forma(?:\s+de)?\s+pagamento|Meio(?:\s+de)?\s+pagamento)[:\s]*([\w\sÀ-ÿ]+?)(?=(?:Valor|R\$|\d|\n|<|$))/i)
    let formaPagamento = formaPagamentoMatch
      ? formaPagamentoMatch[1].trim()
      : ''

    let tipoPagamento = ''
    if (/cr[eé]dito/i.test(formaPagamento) || (!formaPagamento && /cart[ãa]o\s+de\s+cr[eé]dito/i.test(textoBody))) {
      tipoPagamento = 'Cartão de Crédito'
    } else if (/d[eé]bito/i.test(formaPagamento) || (!formaPagamento && /cart[ãa]o\s+de\s+d[eé]bito/i.test(textoBody))) {
      tipoPagamento = 'Cartão de Débito'
    } else if (/pix/i.test(formaPagamento) || (!formaPagamento && /\bpix\b/i.test(textoBody))) {
      tipoPagamento = 'PIX'
    } else if (/dinheiro/i.test(formaPagamento) || (!formaPagamento && /\bdinheiro\b/i.test(textoBody))) {
      tipoPagamento = 'Dinheiro'
    } else if (/alimenta[çc][ãa]o/i.test(formaPagamento) || (!formaPagamento && /vale\s+alimenta[çc][ãa]o/i.test(textoBody))) {
      tipoPagamento = 'Vale Alimentação'
    } else if (/refei[çc][ãa]o/i.test(formaPagamento) || (!formaPagamento && /vale\s+refei[çc][ãa]o/i.test(textoBody))) {
      tipoPagamento = 'Vale Refeição'
    } else if (/cart[ãa]o/i.test(formaPagamento)) {
      tipoPagamento = 'Cartão'
    } else if (formaPagamento) {
      tipoPagamento = formaPagamento
    }

    if (!formaPagamento && tipoPagamento) {
      formaPagamento = tipoPagamento
    }

    let cartaoUsado = ''
    const bandeiraMatch = $('body')
      .text()
      .match(
        /(?:Bandeira(?:\s+do\s+cartão)?|Rede|Credenciadora)[:\s]*([A-Za-z0-9\s]+?)(?:\s+(?:Autorização|CNPJ|Valor|R\$|\d)|$)/i,
      )
    if (bandeiraMatch && bandeiraMatch[1]) {
      const cand = bandeiraMatch[1].trim()
      if (cand.length >= 2 && cand.length <= 30) {
        cartaoUsado = cand
      }
    }

    if (!cartaoUsado) {
      const bandeiras = [
        'Mastercard',
        'Visa',
        'Elo',
        'Hipercard',
        'American Express',
        'Amex',
        'Alelo',
        'Sodexo',
        'Ticket',
        'VR Benefícios',
        'Nubank',
        'Inter',
      ]
      for (const b of bandeiras) {
        const regex = new RegExp(`\\b${b}\\b`, 'i')
        if (regex.test(formaPagamento) || regex.test(textoBody)) {
          const idxPag = textoBody.search(/pagamento|cart[ãa]o|bandeira/i)
          if (idxPag !== -1) {
            const trecho = textoBody.slice(idxPag, idxPag + 300)
            if (regex.test(trecho)) {
              cartaoUsado = b
              break
            }
          }
        }
      }
    }

    const produtos = this.extrairProdutos($)

    return {
      chaveAcesso,
      numero,
      serie,
      dataEmissao,
      estabelecimento,
      cnpj,
      endereco,
      valorTotal,
      descontos,
      valorPago,
      formaPagamento,
      tipoPagamento,
      cartaoUsado,
      valorTributos,
      tributosDetalhados,
      produtos,
    }
  }

  private extrairProdutos($: cheerio.Root): ProdutoExtraido[] {
    const produtos: ProdutoExtraido[] = []
    const codigosIncluidos = new Set<string>()

    // 1. Tenta extração estruturada via seletores do portal da SEFAZ (ex: SP / padrão nacional)
    $('tr[id^="Item +"]').each((_, tr) => {
      const el = $(tr)
      const nomeEl = el.find('span.txtTit').first()
      const nomeRaw = nomeEl.text()
      if (!nomeRaw) return

      const rcodText = el.find('.RCod').text()
      const codMatch =
        rcodText.match(/\(C[óo]digo:\s*([A-Z0-9]+)\s*\)/i) ||
        rcodText.match(/([A-Z0-9]+)/i)
      const codigo = codMatch ? codMatch[1].trim() : ''
      if (!codigo || codigosIncluidos.has(codigo)) return
      codigosIncluidos.add(codigo)

      const rqtdText = el.find('.Rqtd').text()
      const qtdMatch = rqtdText.match(/Qtde\.?:\s*([\d.,]+)/i)
      const quantidade = qtdMatch
        ? parseFloat(qtdMatch[1].replace(',', '.'))
        : 1

      const runText = el.find('.RUN').text()
      const unMatch = runText.match(/UN:\s*(\w+)/i)
      const unidade = unMatch ? unMatch[1].trim() : 'UN'

      const rvlUnitText = el.find('.RvlUnit').text()
      const vlUnitMatch = rvlUnitText.match(/Vl\.\s*Unit\.:\s*([\d.,]+)/i)
      const valorUnitario = vlUnitMatch
        ? parseFloat(vlUnitMatch[1].replace(',', '.'))
        : 0

      const valorText = el.find('.valor').text()
      const vlTotMatch = valorText.match(/([\d.,]+)/)
      const valorTotal = vlTotMatch
        ? parseFloat(vlTotMatch[1].replace(',', '.'))
        : valorUnitario * quantidade

      produtos.push({
        nome: normalizarNomeProduto(nomeRaw),
        codigo,
        quantidade,
        unidade,
        valorUnitario,
        valorTotal,
      })
    })

    if (produtos.length > 0) {
      return produtos
    }

    // 2. Fallback via regex no texto do body (outros layouts de NFC-e)
    const texto = $('body').text().replace(/\s+/g, ' ')

    const regexProduto =
      /([A-Z0-9ÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇ][A-Z0-9ÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇ\s\d/.\-%&+*#]+?)\s*\(Código:\s*([A-Z0-9]+)\s*\)\s*Qtde\.?:\s*([\d.,]+)\s*UN:\s*(\w+)\s*Vl\. Unit\.:\s*([\d.,]+)\s*Vl\. Total\s*([\d.,]+)/gi

    for (const match of texto.matchAll(regexProduto)) {
      const codigo = match[2]
      if (codigosIncluidos.has(codigo)) continue
      codigosIncluidos.add(codigo)

      produtos.push({
        nome: normalizarNomeProduto(match[1]),
        codigo,
        quantidade: parseFloat(match[3].replace(',', '.')),
        unidade: match[4],
        valorUnitario: parseFloat(match[5].replace(',', '.')),
        valorTotal: parseFloat(match[6].replace(',', '.')),
      })
    }

    return produtos
  }

  async listarNotas(): Promise<NotaFiscal[]> {
    return this.notaFiscalModel.find().populate('produtos').exec()
  }

  private userFilter(userId: string) {
    return { $or: [{ userId: new Types.ObjectId(userId) }, { userId }] }
  }

  async listarNotasPorUsuario(userId: string): Promise<NotaFiscal[]> {
    return this.notaFiscalModel
      .find(this.userFilter(userId))
      .populate('produtos')
      .exec()
  }

  async buscarPorId(id: string, userId: string): Promise<NotaFiscal | null> {
    return this.notaFiscalModel
      .findOne({ _id: id, ...this.userFilter(userId) })
      .populate('produtos')
      .exec()
  }

  async atualizarNotaFiscal(
    id: string,
    dto: AtualizarNotaFiscalDto,
    userId: string,
  ): Promise<NotaFiscal> {
    const nota = await this.notaFiscalModel
      .findOne({ _id: id, ...this.userFilter(userId) })
      .exec()

    if (!nota) {
      throw new NotFoundException('Nota fiscal não encontrada')
    }

    if (dto.tipoPagamento !== undefined) {
      nota.tipoPagamento = dto.tipoPagamento ? normalizarTexto(dto.tipoPagamento) : ''
    }
    if (dto.cartaoUsado !== undefined) {
      nota.cartaoUsado = dto.cartaoUsado ? normalizarTexto(dto.cartaoUsado) : ''
    }
    if (dto.formaPagamento !== undefined) {
      nota.formaPagamento = dto.formaPagamento ? normalizarTexto(dto.formaPagamento) : ''
    }
    if (dto.valorTributos !== undefined) {
      nota.valorTributos = dto.valorTributos
    }
    if (dto.tributosDetalhados !== undefined) {
      nota.tributosDetalhados = dto.tributosDetalhados
    }

    await nota.save()

    return this.notaFiscalModel
      .findById(nota._id)
      .populate('produtos')
      .exec() as Promise<NotaFiscal>
  }

  async listarEstabelecimentos(userId: string): Promise<
    {
      cnpj: string
      nomeOriginal: string
      nomeDepara: string | null
      totalNotas: number
    }[]
  > {
    const resultado = await this.notaFiscalModel
      .aggregate([
        { $match: this.userFilter(userId) },
        { $sort: { dataEmissao: 1 } },
        {
          $group: {
            _id: '$cnpj',
            cnpj: { $first: '$cnpj' },
            nomeOriginal: {
              $first: {
                $ifNull: ['$estabelecimentoOriginal', '$estabelecimento'],
              },
            },
            totalNotas: { $sum: 1 },
          },
        },
        { $sort: { cnpj: 1 } },
      ])
      .exec()

    const maps = await this.estabelecimentoUsuarioModel
      .find({ userId: new Types.ObjectId(userId) })
      .lean()
      .exec()

    const porCnpj = new Map(maps.map((m) => [m.cnpj, m.nomeDepara]))

    return (
      resultado as { cnpj: string; nomeOriginal: string; totalNotas: number }[]
    ).map((row) => ({
      cnpj: row.cnpj,
      nomeOriginal: normalizarTexto(row.nomeOriginal || ''),
      nomeDepara: porCnpj.get(row.cnpj) ?? null,
      totalNotas: row.totalNotas,
    }))
  }

  async atualizarNomeEstabelecimento(
    cnpj: string,
    nomeDepara: string,
    userId: string,
  ) {
    const depara = normalizarTexto(nomeDepara)
    if (!depara) {
      throw new BadRequestException('Informe um nome para o estabelecimento')
    }

    const userObjectId = new Types.ObjectId(userId)
    const amostra = await this.notaFiscalModel
      .findOne({ cnpj, ...this.userFilter(userId) })
      .sort({ dataEmissao: 1 })
      .lean()
      .exec()

    if (!amostra) {
      throw new NotFoundException('CNPJ não encontrado nas suas notas')
    }

    const nomeOriginalCalculado = normalizarTexto(
      amostra.estabelecimentoOriginal?.trim() || amostra.estabelecimento || '',
    )

    const existente = await this.estabelecimentoUsuarioModel
      .findOne({ userId: userObjectId, cnpj })
      .exec()

    const nomeOriginalPersistido =
      existente?.nomeOriginal?.trim() || nomeOriginalCalculado

    await this.estabelecimentoUsuarioModel.findOneAndUpdate(
      { userId: userObjectId, cnpj },
      {
        $set: {
          nomeOriginal: nomeOriginalPersistido,
          nomeDepara: depara,
        },
      },
      { upsert: true, new: true },
    )

    const resultado = await this.notaFiscalModel.updateMany(
      { cnpj, ...this.userFilter(userId) },
      { $set: { estabelecimento: depara } },
    )

    const modificados =
      (resultado as { modifiedCount?: number; nModified?: number })
        .modifiedCount ?? 0

    return {
      cnpj,
      nomeOriginal: nomeOriginalPersistido,
      nomeDepara: depara,
      notasAtualizadas: modificados,
    }
  }

  async listarNomesProdutos(
    busca?: string,
    userId?: string,
  ): Promise<string[]> {
    let notaIds: Types.ObjectId[] | undefined
    if (userId) {
      notaIds = await this.notaFiscalModel
        .find(this.userFilter(userId))
        .distinct('_id')
        .exec()
    }

    const query = busca?.trim()
      ? { nome: { $regex: busca.trim(), $options: 'i' } }
      : {}
    const finalQuery = {
      ...query,
      ...(notaIds ? { notaFiscal: { $in: notaIds } } : {}),
    }
    const nomes = await this.produtoModel.distinct('nome', finalQuery).exec()
    return nomes.filter((n) => n?.trim()).sort((a, b) => a.localeCompare(b))
  }

  async sugerirProdutosParecidos(
    nomeProduto: string,
    userId?: string,
  ): Promise<string[]> {
    const nome = nomeProduto?.trim()
    if (!nome) return []

    const primeiraPalavra = nome.split(/\s+/)[0]
    if (!primeiraPalavra || primeiraPalavra.length < 2) return []

    const regex = new RegExp(
      primeiraPalavra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'i',
    )
    let notaIds: Types.ObjectId[] | undefined
    if (userId) {
      notaIds = await this.notaFiscalModel
        .find(this.userFilter(userId))
        .distinct('_id')
        .exec()
    }
    const todos = await this.produtoModel
      .distinct('nome', {
        nome: regex,
        ...(notaIds ? { notaFiscal: { $in: notaIds } } : {}),
      })
      .exec()
    const lista = todos
      .filter((n) => n?.trim() && n.trim() !== nome)
      .sort((a, b) => a.localeCompare(b))
    return lista.slice(0, 20)
  }

  async compararDuracaoProdutos(
    nome1: string,
    nome2: string,
    userId?: string,
  ): Promise<{
    produto1: {
      nome: string
      totalCompras: number
      duracaoMediaDias: number | null
      duracaoEntreComprasDias: number[]
    }
    produto2: {
      nome: string
      totalCompras: number
      duracaoMediaDias: number | null
      duracaoEntreComprasDias: number[]
    }
  }> {
    const notas = await this.notaFiscalModel
      .find(userId ? this.userFilter(userId) : {})
      .populate('produtos')
      .exec()

    type Duracao = {
      datasOrdenadas: Date[]
      duracaoEntreComprasDias: number[]
      duracaoMediaDias: number | null
      totalCompras: number
    }

    const mapa = new Map<string, Duracao>()

    const addData = (nome: string, data: Date) => {
      const n = nome?.trim()
      if (!n || (n !== nome1.trim() && n !== nome2.trim())) return
      const existente = mapa.get(n)
      if (existente) {
        existente.datasOrdenadas.push(data)
      } else {
        mapa.set(n, {
          datasOrdenadas: [data],
          duracaoEntreComprasDias: [],
          duracaoMediaDias: null,
          totalCompras: 0,
        })
      }
    }

    for (const nota of notas) {
      const dataNota =
        nota.dataEmissao instanceof Date
          ? nota.dataEmissao
          : new Date(nota.dataEmissao)
      for (const p of (nota.produtos || []) as { nome?: string }[]) {
        const nome = p.nome?.trim()
        if (nome) addData(nome, dataNota)
      }
    }

    mapa.forEach((valor) => {
      const datas = valor.datasOrdenadas
      datas.sort((a, b) => a.getTime() - b.getTime())
      valor.totalCompras = datas.length
      const duracaoEntre: number[] = []
      for (let i = 1; i < datas.length; i++) {
        const dias = Math.round(
          (datas[i].getTime() - datas[i - 1].getTime()) / (1000 * 60 * 60 * 24),
        )
        duracaoEntre.push(dias)
      }
      valor.duracaoEntreComprasDias = duracaoEntre
      valor.duracaoMediaDias =
        duracaoEntre.length > 0
          ? Math.round(
              duracaoEntre.reduce((a, b) => a + b, 0) / duracaoEntre.length,
            )
          : null
    })

    const d1 = mapa.get(nome1.trim()) ?? {
      datasOrdenadas: [],
      duracaoEntreComprasDias: [],
      duracaoMediaDias: null,
      totalCompras: 0,
    }
    const d2 = mapa.get(nome2.trim()) ?? {
      datasOrdenadas: [],
      duracaoEntreComprasDias: [],
      duracaoMediaDias: null,
      totalCompras: 0,
    }

    return {
      produto1: {
        nome: nome1,
        totalCompras: d1.totalCompras,
        duracaoMediaDias: d1.duracaoMediaDias,
        duracaoEntreComprasDias: d1.duracaoEntreComprasDias,
      },
      produto2: {
        nome: nome2,
        totalCompras: d2.totalCompras,
        duracaoMediaDias: d2.duracaoMediaDias,
        duracaoEntreComprasDias: d2.duracaoEntreComprasDias,
      },
    }
  }

  /**
   * Persiste os itens da nota fiscal na coleção HistoricoCompra (tabela pivô escalável).
   * Executa de forma resiliente, registrando logs sem interromper o fluxo principal.
   */
  private async salvarItensHistoricoCompra(
    nota: NotaFiscal,
    produtosExtraidos: ProdutoExtraido[],
    userId: Types.ObjectId,
    estabelecimentoNome: string,
    cnpj: string,
    dataCompra: Date,
  ): Promise<void> {
    if (!this.historicoCompraService) {
      return
    }

    try {
      // 1. Obtém ou cria o estabelecimento de referência do usuário
      const estabelecimento =
        await this.estabelecimentoUsuarioModel.findOneAndUpdate(
          { userId, cnpj },
          {
            $setOnInsert: {
              userId,
              cnpj,
              nomeOriginal: estabelecimentoNome,
              nomeDepara: estabelecimentoNome,
            },
          },
          { upsert: true, new: true },
        )

      const mercadoId = estabelecimento._id

      // 2. Prepara os itens do histórico de compra mapeando catálogo se disponível
      const itensHistorico = await Promise.all(
        produtosExtraidos.map(async (p) => {
          let produtoCatalogoId: Types.ObjectId | null = null

          if (this.produtoCatalogoService) {
            try {
              const prodCat =
                await this.produtoCatalogoService.processarItemCatalogo(
                  p.codigo,
                  p.nome,
                )
              if (prodCat) {
                produtoCatalogoId = prodCat._id
              }
            } catch {
              // Silencia erros no catálogo global para não travar a persistência do histórico
            }
          }

          return {
            usuarioId: userId,
            mercadoId,
            notaFiscalId: nota._id,
            produtoCatalogoId,
            codigoInternoMercado: p.codigo,
            descricaoBrutaNota: p.nome,
            quantidade: p.quantidade,
            unidade: p.unidade,
            precoUnitario: p.valorUnitario,
            precoTotal: p.valorTotal,
            dataCompra: dataCompra || new Date(),
          }
        }),
      )

      await this.historicoCompraService.registrarItensEmLote(itensHistorico)
      this.logger.log(
        `Registrados com sucesso ${itensHistorico.length} itens no HistoricoCompra para a nota fiscal ${String(nota._id)}`,
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      this.logger.error(
        `Erro ao registrar itens no HistoricoCompra: ${msg}`,
        stack,
      )
    }
  }

  /**
   * Converte string de endereço em objeto estruturado (rua, numero, bairro, cidade, uf)
   */
  private parseEndereco(enderecoStr?: string): EnderecoMercadoDto | undefined {
    if (!enderecoStr) return undefined
    const match = enderecoStr.match(
      /^(.*?),\s*(\d+|S\/N)\s*[-,\s]*(.*?)[-,\s]+([A-Za-zÀ-ÿ\s]+)[-,\s/]+([A-Z]{2})$/i,
    )
    if (match) {
      return {
        rua: match[1]?.trim(),
        numero: match[2]?.trim(),
        bairro: match[3]?.trim(),
        cidade: match[4]?.trim(),
        uf: match[5]?.trim().toUpperCase(),
      }
    }
    return {
      rua: enderecoStr.trim(),
    }
  }

  /**
   * Executa o upsert atômico do mercado global e retorna seu ObjectId.
   */
  private async obterOuCriarMercadoId(
    dados: DadosNotaFiscal,
  ): Promise<Types.ObjectId | undefined> {
    if (!dados.cnpj) return undefined
    try {
      const mercado = await this.mercadoService.processarUpsertMercado({
        cnpj: dados.cnpj,
        razaoSocial: dados.estabelecimento,
        nomeFantasia: dados.estabelecimento,
        endereco: this.parseEndereco(dados.endereco),
      })
      return mercado._id
    } catch (err) {
      this.logger.warn(
        `Não foi possível processar mercado pelo CNPJ ${dados.cnpj}: ${err instanceof Error ? err.message : err}`,
      )
      return undefined
    }
  }

  /**
   * Executa a classificação inteligente de categorias em background para os produtos da nota.
   * Não bloqueia a resposta da criação da nota nem gera falha caso o microsserviço demore.
   */
  private autoCategorizarProdutosNota(userId: string, notaId: string): void {
    if (this.categoriaService) {
      this.categoriaService
        .classificarProdutosComIa(userId, { notaFiscalId: notaId })
        .catch((err) => {
          this.logger.debug(
            `Auto-classificação em background para nota ${notaId} finalizada com aviso: ${err?.message}`,
          )
        })
    }
  }
}
