import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'
import {
  removerAcentos,
  sanitizarDescricaoProduto,
} from '../produto-catalogo/utils/sanitizar-produto.util'

export interface ItemExtraidoPln {
  termoFalado: string
  quantidade: number
  unidade: string
}

export interface CandidatoHistoricoMercado {
  nomeOriginal: string
  nomeExibicao: string
  apelido?: string | null
  unidade: string
  valorUnitarioRecente: number
  frequencia: number
  noMercadoSelecionado: boolean
  estabelecimento: string
  ultimaCompra: Date
}

export interface ItemVinculadoRag {
  nome: string
  nomeOriginal: string
  termoFalado: string
  nomeMercado: string | null
  origemMatch: 'MERCADO_SELECIONADO' | 'OUTRO_MERCADO' | 'SEM_HISTORICO'
  estabelecimentoOrigem: string | null
  quantidade: number
  unidade: string
  valorUnitarioRecente: number
  valorEstimado: number
  frequencia: number
  comprado: boolean
}

const NUMEROS_EXTENSO: Record<string, number> = {
  meio: 0.5,
  meia: 0.5,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
}

const MAPA_UNIDADES: Record<string, string> = {
  kg: 'KG',
  kilo: 'KG',
  kilos: 'KG',
  quilo: 'KG',
  quilos: 'KG',
  g: 'G',
  gr: 'G',
  grama: 'G',
  gramas: 'G',
  l: 'L',
  lt: 'L',
  litro: 'L',
  litros: 'L',
  ml: 'ML',
  mililitro: 'ML',
  mililitros: 'ML',
  pct: 'PCT',
  pacote: 'PCT',
  pacotes: 'PCT',
  cx: 'CX',
  caixa: 'CX',
  caixas: 'CX',
  lata: 'LATA',
  latas: 'LATA',
  bj: 'BJ',
  bandeja: 'BJ',
  bandejas: 'BJ',
  fd: 'FD',
  fardo: 'FD',
  fardos: 'FD',
  dz: 'DZ',
  duzia: 'DZ',
  duzias: 'DZ',
  un: 'UN',
  und: 'UN',
  unid: 'UN',
  unidade: 'UN',
  unidades: 'UN',
  garrafa: 'UN',
  garrafas: 'UN',
  pote: 'UN',
  potes: 'UN',
  saco: 'UN',
  sacos: 'UN',
  barra: 'UN',
  barras: 'UN',
  vidro: 'UN',
  vidros: 'UN',
}

const EXPANSOES_ABREVIACOES_FISCAIS: Array<[RegExp, string]> = [
  [/\bMAC\b/g, 'MACARRAO'],
  [/\bPEN\b/g, 'PENNE'],
  [/\bESPAG\w*\b/g, 'ESPAGUETE'],
  [/\bPARAF\w*\b/g, 'PARAFUSO'],
  [/\bMOID\w*\b/g, 'MOIDA'],
  [/\bBOV\w*\b/g, 'BOVINA'],
  [/\bSUIN\w*\b/g, 'SUINA'],
  [/\bFGO\b|\bFRG\b/g, 'FRANGO'],
  [/\bQJO\b|\bQJ\b/g, 'QUEIJO'],
  [/\bMUSS\w*\b|\bMUCAR\w*\b/g, 'MUSSARELA'],
  [/\bREQ\w*\b/g, 'REQUEIJAO'],
  [/\bBISC\b/g, 'BISCOITO'],
  [/\bREFR\w*\b|\bREF\b/g, 'REFRIGERANTE'],
  [/\bDET\b/g, 'DETERGENTE'],
  [/\bDESINF\w*\b|\bDES\b/g, 'DESINFETANTE'],
  [/\bSAB\b/g, 'SABONETE'],
  [/\bLIMP\b/g, 'LIMPADOR'],
  [/\bAG\s+SANIT\w*\b|\bAGUA\s+SANIT\w*\b/g, 'AGUA SANITARIA'],
  [/\bCR\s+LEITE\b/g, 'CREME DE LEITE'],
  [/\bLEITE\s+COND\w*\b/g, 'LEITE CONDENSADO'],
  [/\bMOL\s+TOM\w*\b/g, 'MOLHO DE TOMATE'],
  [/\bEXT\s+TOM\w*\b/g, 'EXTRATO DE TOMATE'],
  [/\bAZ\b/g, 'AZEITE'],
  [/\bOLIV\w*\b/g, 'OLIVA'],
  [/\bMARG\w*\b/g, 'MARGARINA'],
  [/\bMANT\w*\b/g, 'MANTEIGA'],
  [/\bACUC\w*\b/g, 'ACUCAR'],
  [/\bFAR\s+TRIG\w*\b/g, 'FARINHA DE TRIGO'],
  [/\bFAR\s+MAND\w*\b|\bFAR\s+MA\b/g, 'FARINHA DE MANDIOCA'],
  [/\bFAR\b/g, 'FARINHA'],
  [/\bPAP\s+HIG\w*\b/g, 'PAPEL HIGIENICO'],
  [/\bPAP\s+TOAL\w*\b|\bTOAL\s+PAP\w*\b/g, 'PAPEL TOALHA'],
  [/\bGUARD\w*\b/g, 'GUARDANAPO'],
  [/\bLING\b/g, 'LINGUICA'],
  [/\bCALAB\w*\b/g, 'CALABresa'],
  [/\bSARD\w*\b/g, 'SARDINHA'],
  [/\bMAION\w*\b/g, 'MAIONESE'],
]

const STOP_WORDS_BUSCA = new Set([
  'DE',
  'DA',
  'DO',
  'DAS',
  'DOS',
  'COM',
  'SEM',
  'PARA',
  'POR',
  'EM',
  'NO',
  'NA',
  'UM',
  'UMA',
  'UNS',
  'UMAS',
  'TIPO',
  'TP',
  'T1',
  'TRAD',
  'TRADICIONAL',
])

@Injectable()
export class VozPlnRagService {
  private readonly logger = new Logger(VozPlnRagService.name)

  constructor(private readonly configService: ConfigService) {}

  private getGeminiApiKey(): string {
    return (
      this.configService.get<string>('GEMINI_API_KEY') ||
      process.env.GEMINI_API_KEY ||
      ''
    ).trim()
  }

  private getGeminiModel(): string {
    return (
      this.configService.get<string>('GEMINI_MODEL') ||
      process.env.GEMINI_MODEL ||
      'gemini-3.5-flash-lite'
    ).trim()
  }

  /**
   * Chama a Gemini Interactions API (v1beta/interactions) com suporte a JSON Schema estruturado e entrada de texto ou multimodal (áudio).
   * Possui fallback automático entre gemini-3.5-flash-lite e gemini-3.1-flash-lite caso ocorra limite de taxa (429).
   */
  private async chamarGeminiJson<T>(
    systemInstruction: string,
    promptInput: string | Array<Record<string, any>>,
    jsonSchema: Record<string, any>,
  ): Promise<T | null> {
    const apiKey = this.getGeminiApiKey()
    if (!apiKey) {
      return null
    }

    const modeloPreferido = this.getGeminiModel()
    const modelosTentativa = Array.from(
      new Set([
        modeloPreferido,
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
      ]),
    )

    for (const model of modelosTentativa) {
      try {
        const response = await axios.post(
          'https://generativelanguage.googleapis.com/v1beta/interactions',
          {
            model,
            system_instruction: systemInstruction,
            input: promptInput,
            store: false,
            response_format: {
              type: 'text',
              mime_type: 'application/json',
              schema: jsonSchema,
            },
          },
          {
            headers: {
              'x-goog-api-key': apiKey,
              'Content-Type': 'application/json',
            },
            timeout: 20000,
          },
        )

        const data = response.data
        let rawText: string | null = data?.output_text || null

        if (!rawText && Array.isArray(data?.steps)) {
          for (let i = data.steps.length - 1; i >= 0; i--) {
            const step = data.steps[i]
            if (step?.type === 'model_output' && Array.isArray(step.content)) {
              const textPart = step.content.find(
                (c: any) => c?.type === 'text' && typeof c.text === 'string',
              )
              if (textPart) {
                rawText = textPart.text
                break
              }
            }
          }
        }

        if (!rawText) {
          continue
        }

        const cleaned = rawText
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim()

        return JSON.parse(cleaned) as T
      } catch (err: any) {
        this.logger.warn(
          `Aviso ao consultar modelo ${model} na Gemini API (${err?.message}). Tentando próximo fallback...`,
        )
      }
    }

    return null
  }

  /**
   * Transcreve áudio gravado no dispositivo (ex: iPhone Safari / PWA MediaRecorder) e extrai os itens via PLN usando Gemini.
   */
  async extrairItensDeAudioBase64(
    audioBase64: string,
    mimeType = 'audio/mp4',
  ): Promise<{ textoTranscrito: string; itens: ItemExtraidoPln[] }> {
    const base64Limpo = (audioBase64 || '')
      .replace(/^data:audio\/[^;]+;base64,/i, '')
      .trim()

    if (!base64Limpo) {
      return { textoTranscrito: '', itens: [] }
    }

    const mimeNormalizado = (mimeType || 'audio/mp4')
      .split(';')[0]
      .trim()
      .toLowerCase()

    const schema = {
      type: 'object',
      properties: {
        textoTranscrito: { type: 'string' },
        itens: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              termoFalado: { type: 'string' },
              quantidade: { type: 'number' },
              unidade: { type: 'string' },
            },
            required: ['termoFalado', 'quantidade', 'unidade'],
          },
        },
      },
      required: ['textoTranscrito', 'itens'],
    }

    const systemPrompt =
      'Você é um especialista em PLN e reconhecimento de voz em português brasileiro para listas de compras de supermercado. Transcreva fielmente o áudio enviado pelo usuário em "textoTranscrito" e extraia todos os produtos mencionados em "itens" com suas quantidades e unidades padronizadas (UN, KG, G, L, ML, PCT, CX, LATA, BJ, FD, DZ). Remova verbos de comando como "adicionar", "colocar", "comprar".'

    const inputMultimodal = [
      {
        type: 'text',
        text: 'Transcreva este áudio de lista de compras em português e extraia os itens estruturados.',
      },
      {
        type: 'audio',
        data: base64Limpo,
        mime_type: mimeNormalizado,
      },
    ]

    const respostaIa = await this.chamarGeminiJson<{
      textoTranscrito: string
      itens: ItemExtraidoPln[]
    }>(systemPrompt, inputMultimodal, schema)

    if (respostaIa) {
      const itensValidos = Array.isArray(respostaIa.itens)
        ? respostaIa.itens
            .map((item) => ({
              termoFalado: this.formatarTermoFalado(item.termoFalado || ''),
              quantidade:
                Number(item.quantidade) > 0 ? Number(item.quantidade) : 1,
              unidade: this.normalizarUnidade(item.unidade),
            }))
            .filter((i) => i.termoFalado.length >= 2)
        : []

      if (itensValidos.length > 0) {
        return {
          textoTranscrito: respostaIa.textoTranscrito || '',
          itens: itensValidos,
        }
      }

      if (respostaIa.textoTranscrito) {
        return {
          textoTranscrito: respostaIa.textoTranscrito,
          itens: this.extrairItensDeterministico(respostaIa.textoTranscrito),
        }
      }
    }

    return { textoTranscrito: '', itens: [] }
  }

  /**
   * Extrai itens estruturados (termoFalado, quantidade, unidade) de um comando de voz em português.
   * Exemplo: "adicionar 3 limoes, 1 kilo de carne moida, azeite, 1 macarrao penne, 1 sal"
   */
  async extrairItensDeComandoVoz(
    textoFalado: string,
  ): Promise<ItemExtraidoPln[]> {
    const bruto = (textoFalado || '').trim()
    if (!bruto) return []

    const deterministico = this.extrairItensDeterministico(bruto)

    // Se a chave Gemini estiver configurada, tenta refinar via LLM se o texto for longo/sem vírgulas ou usa o resultado validado
    const apiKey = this.getGeminiApiKey()
    if (apiKey) {
      const schema = {
        type: 'object',
        properties: {
          itens: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                termoFalado: { type: 'string' },
                quantidade: { type: 'number' },
                unidade: { type: 'string' },
              },
              required: ['termoFalado', 'quantidade', 'unidade'],
            },
          },
        },
        required: ['itens'],
      }

      const systemPrompt =
        'Você é um especialista em PLN para listas de compras de supermercado no Brasil. Extraia todos os produtos mencionados na fala do usuário com suas quantidades e unidades padronizadas (UN, KG, G, L, ML, PCT, CX, LATA, BJ, FD, DZ). Remova verbos de comando como "adicionar", "colocar", "comprar", "preciso de". Mantenha o nome do produto limpo e em português.'

      const userPrompt = `Fala do usuário: "${bruto}"\nExtraia a lista de itens.`

      const respostaIa = await this.chamarGeminiJson<{
        itens: ItemExtraidoPln[]
      }>(systemPrompt, userPrompt, schema)

      if (
        respostaIa &&
        Array.isArray(respostaIa.itens) &&
        respostaIa.itens.length > 0
      ) {
        const validados = respostaIa.itens
          .map((item) => ({
            termoFalado: this.formatarTermoFalado(item.termoFalado || ''),
            quantidade:
              Number(item.quantidade) > 0 ? Number(item.quantidade) : 1,
            unidade: this.normalizarUnidade(item.unidade),
          }))
          .filter((i) => i.termoFalado.length >= 2)

        if (validados.length > 0) {
          return validados
        }
      }
    }

    return deterministico
  }

  /**
   * Parser PLN determinístico em Português para comandos de voz de lista de compras.
   * Suporta frases com vírgulas, conjunções ("e", "mais", "também") e fala contínua sem pontuação.
   */
  extrairItensDeterministico(textoFalado: string): ItemExtraidoPln[] {
    if (!textoFalado || !textoFalado.trim()) return []

    let texto = textoFalado
      .replace(/\s+/g, ' ')
      .replace(/\.+$/g, '')
      .trim()

    // Remove comandos iniciais como "adicionar", "colocar na lista", "preciso comprar", etc.
    texto = texto.replace(
      /^(?:por favor\s+)?(?:adicionar|adicione|adiciona|colocar|coloca|coloque|incluir|inclui|p[oõ]e|por|comprar|anotar|anota|preciso de|acabou o|acabou a)(?:\s+na\s+lista)?\s+/i,
      '',
    )

    // Quebra comandos repetidos no meio da frase ("... adicionar ...", "... coloca ...")
    texto = texto.replace(
      /\b(?:adicionar|adicione|adiciona|colocar|coloca|incluir|inclui|p[oõ]e)\b/gi,
      ',',
    )

    // Substitui conectivos explícitos por vírgula
    texto = texto.replace(/\s+(?:e\s+mais|mais|tamb[eé]m)\s+/gi, ', ')

    // Substitui " e " antes de números/quantidades por vírgula (ex: "azeite e 1 sal" -> "azeite, 1 sal")
    const regexNumeroPalavra = Object.keys(NUMEROS_EXTENSO).join('|')
    const regexEAntesDeQtd = new RegExp(
      `\\s+e\\s+(?=(?:\\d+[.,]?\\d*|${regexNumeroPalavra})\\b)`,
      'gi',
    )
    texto = texto.replace(regexEAntesDeQtd, ', ')

    // Em fala contínua sem vírgulas, se houver um número precedido por uma palavra que não é preposição/medida, insere separador
    // Ex: "adicionar 3 limoes 1 kilo de carne moida" -> "3 limoes, 1 kilo de carne moida"
    const regexSepararNumerosContinuos = new RegExp(
      `([a-záàâãéêíóôõúç]{3,})\\s+(?=(\\d+[.,]?\\d*|${regexNumeroPalavra})\\s+[a-záàâãéêíóôõúç])`,
      'gi',
    )
    texto = texto.replace(
      regexSepararNumerosContinuos,
      (match, palavraAnterior) => {
        const pLower = removerAcentos(palavraAnterior.toLowerCase())
        // Não separa se a palavra anterior for "tipo", "total", "numero", "nota"
        if (['tipo', 'total', 'zero'].includes(pLower)) {
          return match
        }
        return `${palavraAnterior}, `
      },
    )

    const segmentosBrutos = texto
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    // Segunda passagem: se um segmento tiver " e " ligando dois substantivos distintos (e não expressões fixas), divide
    const segmentosFinais: string[] = []
    for (const seg of segmentosBrutos) {
      if (/\s+e\s+/i.test(seg) && !this.ehExpressaoCompostaComE(seg)) {
        const subPartes = seg
          .split(/\s+e\s+/i)
          .map((p) => p.trim())
          .filter(Boolean)
        segmentosFinais.push(...subPartes)
      } else {
        segmentosFinais.push(seg)
      }
    }

    const itensExtraidos: ItemExtraidoPln[] = []

    for (const seg of segmentosFinais) {
      const parsed = this.parseSegmentoItem(seg)
      if (parsed && parsed.termoFalado.length >= 2) {
        itensExtraidos.push(parsed)
      }
    }

    return itensExtraidos
  }

  private ehExpressaoCompostaComE(segmento: string): boolean {
    const norm = removerAcentos(segmento.toLowerCase())
    return /\b(coxa e sobrecoxa|sal e pimenta| queijo e presunto|alho e oleo|torrado e moido)\b/.test(
      norm,
    )
  }

  private parseSegmentoItem(segmento: string): ItemExtraidoPln | null {
    let limpo = segmento
      .replace(
        /^(?:adicionar|adicione|adiciona|colocar|coloca|incluir|inclui|comprar|preciso de|um pouco de)\s+/i,
        '',
      )
      .trim()

    if (!limpo) return null

    let quantidade = 1
    let unidade = 'UN'

    // 1. Verifica número no início (dígitos ou por extenso): ex "3 limoes", "1,5 kg de carne", "um kilo de carne", "meio quilo de cafe"
    const tokens = limpo.split(/\s+/)
    const primeiroTokenNorm = removerAcentos(tokens[0].toLowerCase())

    // Caso especial: "1500g" ou "2kg" colado no primeiro token
    const matchNumeroUnidadeColado = primeiroTokenNorm.match(
      /^(\d+(?:[.,]\d+)?)(kg|g|gr|l|lt|ml|un|pct|cx)$/,
    )

    if (matchNumeroUnidadeColado) {
      quantidade = parseFloat(matchNumeroUnidadeColado[1].replace(',', '.'))
      unidade = this.normalizarUnidade(matchNumeroUnidadeColado[2])
      tokens.shift()
    } else if (/^\d+(?:[.,]\d+)?$/.test(primeiroTokenNorm)) {
      quantidade = parseFloat(primeiroTokenNorm.replace(',', '.'))
      tokens.shift()
    } else if (NUMEROS_EXTENSO[primeiroTokenNorm] !== undefined) {
      quantidade = NUMEROS_EXTENSO[primeiroTokenNorm]
      tokens.shift()
    }

    // 2. Verifica se o próximo token é uma unidade (ex: "kilo", "quilos", "pacotes", "latas")
    if (tokens.length > 0) {
      const possivelUnidadeNorm = removerAcentos(
        tokens[0].toLowerCase().replace(/[.,]/g, ''),
      )
      if (
        MAPA_UNIDADES[possivelUnidadeNorm] &&
        tokens.length > 1 // garante que ainda sobra o nome do produto
      ) {
        unidade = MAPA_UNIDADES[possivelUnidadeNorm]
        tokens.shift()
      }
    }

    // 3. Remove preposição de ligação ("de", "do", "da") logo após a unidade/quantidade: "1 kilo de carne moida" -> "carne moida"
    if (
      tokens.length > 1 &&
      /^(de|do|da|dos|das)$/i.test(removerAcentos(tokens[0]))
    ) {
      tokens.shift()
    }

    // 4. Verifica se a unidade veio no final (ex: "carne moida 1 kg")
    if (tokens.length >= 2) {
      const ultimoNorm = removerAcentos(tokens[tokens.length - 1].toLowerCase())
      const penultimoNorm = removerAcentos(
        tokens[tokens.length - 2].toLowerCase(),
      )
      const matchColadoFinal = ultimoNorm.match(
        /^(\d+(?:[.,]\d+)?)(kg|g|gr|l|lt|ml|un|pct|cx)$/,
      )
      if (matchColadoFinal && quantidade === 1 && unidade === 'UN') {
        quantidade = parseFloat(matchColadoFinal[1].replace(',', '.'))
        unidade = this.normalizarUnidade(matchColadoFinal[2])
        tokens.pop()
      } else if (
        MAPA_UNIDADES[ultimoNorm] &&
        /^\d+(?:[.,]\d+)?$/.test(penultimoNorm) &&
        quantidade === 1
      ) {
        unidade = MAPA_UNIDADES[ultimoNorm]
        quantidade = parseFloat(penultimoNorm.replace(',', '.'))
        tokens.pop()
        tokens.pop()
      }
    }

    const termoFalado = this.formatarTermoFalado(tokens.join(' '))
    if (!termoFalado) return null

    return {
      termoFalado,
      quantidade: quantidade > 0 ? quantidade : 1,
      unidade,
    }
  }

  private normalizarUnidade(u?: string): string {
    if (!u) return 'UN'
    const limpo = removerAcentos(u.trim().toLowerCase())
    return MAPA_UNIDADES[limpo] || u.trim().toUpperCase() || 'UN'
  }

  private formatarTermoFalado(termo: string): string {
    const limpo = termo
      .replace(/^[,.;:\-\s]+|[,.;:\-\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!limpo) return ''
    return limpo.charAt(0).toUpperCase() + limpo.slice(1)
  }

  /**
   * Expande abreviações fiscais de NFC-e e normaliza para comparação semântica/léxica.
   */
  expandirTextoFiscal(descricao: string): string {
    const sanitizado = sanitizarDescricaoProduto(descricao || '')
    let texto = removerAcentos(sanitizado.toUpperCase())
    texto = texto.replace(/[/\\_\-.,]/g, ' ')

    for (const [regex, expansao] of EXPANSOES_ABREVIACOES_FISCAIS) {
      texto = texto.replace(regex, expansao.toUpperCase())
    }

    return texto.replace(/\s+/g, ' ').trim()
  }

  /**
   * Reduz plural em português para singular básico (ex: "LIMOES" -> "LIMAO", "OVOS" -> "OVO", "PAES" -> "PAO")
   */
  normalizarSingularToken(token: string): string {
    const t = removerAcentos(token.toUpperCase().trim())
    if (t.length <= 3) return t
    if (t.endsWith('OES') || t.endsWith('AES')) {
      return t.slice(0, -3) + 'AO'
    }
    if (t.endsWith('AIS')) {
      return t.slice(0, -3) + 'AL'
    }
    if (t.endsWith('EIS')) {
      return t.slice(0, -3) + 'EL'
    }
    if (t.endsWith('RES')) {
      return t.slice(0, -2)
    }
    if (t.endsWith('S') && !t.endsWith('SS')) {
      return t.slice(0, -1)
    }
    return t
  }

  extrairTokensSignificativos(texto: string): string[] {
    const expandido = this.expandirTextoFiscal(texto)
    return expandido
      .split(/[^A-Z0-9]+/)
      .map((t) => this.normalizarSingularToken(t))
      .filter(
        (t) =>
          t.length >= 2 &&
          !STOP_WORDS_BUSCA.has(t) &&
          !/^\d+(?:KG|G|GR|L|ML|UN|PC)?$/.test(t),
      )
  }

  /**
   * Calcula score léxico/semântico entre o termo falado pelo usuário e um produto candidato do histórico.
   */
  calcularScoreSimilaridade(
    termoFalado: string,
    candidato: CandidatoHistoricoMercado,
  ): number {
    const tokensFalados = this.extrairTokensSignificativos(termoFalado)
    if (tokensFalados.length === 0) return 0

    const textoCandidato = `${candidato.nomeOriginal} ${candidato.apelido || ''}`
    const tokensCandidato = this.extrairTokensSignificativos(textoCandidato)
    if (tokensCandidato.length === 0) return 0

    // Verifica se o apelido bate exatamente
    if (candidato.apelido) {
      const apelidoNorm = this.extrairTokensSignificativos(
        candidato.apelido,
      ).join(' ')
      const faladoNorm = tokensFalados.join(' ')
      if (apelidoNorm && apelidoNorm === faladoNorm) {
        return candidato.noMercadoSelecionado ? 1.0 : 0.92
      }
    }

    let matches = 0
    let matchPrincipal = false

    for (let idx = 0; idx < tokensFalados.length; idx++) {
      const tf = tokensFalados[idx]
      let melhorMatchToken = 0

      for (const tc of tokensCandidato) {
        if (tf === tc) {
          melhorMatchToken = 1.0
          break
        }
        // Prefix match para abreviações de cupom fiscal (ex: "PEN" para "PENNE", "MOID" para "MOIDA", min 3 letras)
        if (
          tf.length >= 3 &&
          tc.length >= 3 &&
          (tc.startsWith(tf) || tf.startsWith(tc))
        ) {
          melhorMatchToken = Math.max(melhorMatchToken, 0.85)
        }
      }

      if (idx === 0 && melhorMatchToken >= 0.85) {
        matchPrincipal = true
      }
      matches += melhorMatchToken
    }

    // Se o substantivo principal (primeiro token, ex: "limao", "carne", "azeite", "macarrao", "sal") não bateu de jeito nenhum, penaliza fortemente
    if (!matchPrincipal && tokensFalados.length === 1) {
      return 0
    }

    const coberturaFalado = matches / tokensFalados.length
    if (coberturaFalado < 0.5) {
      return 0
    }

    // Penalidade leve por excesso de palavras diferentes no candidato (evita que "sal" dê match maior em "biscoito salgado" do que em "sal refinado cisne")
    const precisaoCandidato = matches / Math.max(tokensCandidato.length, 1)

    let score = coberturaFalado * 0.75 + precisaoCandidato * 0.25
    if (matchPrincipal) {
      score += 0.1
    }

    // Bônus de prioridade para produtos já comprados no próprio mercado selecionado
    if (candidato.noMercadoSelecionado) {
      score += 0.12
    }

    // Bônus leve por frequência histórica
    score += Math.min(candidato.frequencia * 0.01, 0.05)

    return Number(Math.min(score, 1.0).toFixed(4))
  }

  /**
   * Motor RAG completo:
   * 1. Retrieval: Recupera os melhores candidatos do histórico do mercado selecionado (e outros mercados como fallback) para cada item falado.
   * 2. Generation/Matching: Consulta a Gemini API com os candidatos recuperados (ou usa o matcher determinístico de alta precisão) para decidir qual produto do mercado corresponde ao item falado.
   */
  async vincularItensComHistorico(
    itensFalados: ItemExtraidoPln[],
    candidatosHistorico: CandidatoHistoricoMercado[],
  ): Promise<ItemVinculadoRag[]> {
    if (!itensFalados || itensFalados.length === 0) return []

    // Para cada item falado, recupera os top 5 candidatos do histórico
    const candidatosPorItem = itensFalados.map((item, index) => {
      const ranqueados = candidatosHistorico
        .map((c) => ({
          candidato: c,
          score: this.calcularScoreSimilaridade(item.termoFalado, c),
        }))
        .filter((r) => r.score >= 0.45)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score
          if (
            a.candidato.noMercadoSelecionado !==
            b.candidato.noMercadoSelecionado
          ) {
            return a.candidato.noMercadoSelecionado ? -1 : 1
          }
          return b.candidato.frequencia - a.candidato.frequencia
        })
        .slice(0, 5)

      return {
        index,
        item,
        topCandidatos: ranqueados,
      }
    })

    // Se houver candidatos e GEMINI_API_KEY estiver ativa, pede ao Gemini para confirmar/escolher o melhor candidato semântico
    const escolhasIa = new Map<number, string | null>()
    const temAlgumCandidato = candidatosPorItem.some(
      (c) => c.topCandidatos.length > 0,
    )

    if (temAlgumCandidato && this.getGeminiApiKey()) {
      const payloadParaIa = candidatosPorItem.map((entry) => ({
        itemIndex: entry.index,
        termoFalado: entry.item.termoFalado,
        quantidade: entry.item.quantidade,
        unidadeFalada: entry.item.unidade,
        opcoesHistoricoMercado: entry.topCandidatos.map((tc) => ({
          nomeOriginal: tc.candidato.nomeOriginal,
          apelido: tc.candidato.apelido || undefined,
          noMercadoSelecionado: tc.candidato.noMercadoSelecionado,
          estabelecimento: tc.candidato.estabelecimento,
          precoUnitario: tc.candidato.valorUnitarioRecente,
        })),
      }))

      const schemaRag = {
        type: 'object',
        properties: {
          vinculos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                itemIndex: { type: 'number' },
                nomeOriginalEscolhido: {
                  type: 'string',
                  description:
                    'Exatamente o nomeOriginal da melhor opção em opcoesHistoricoMercado, ou string vazia "" se nenhuma opção corresponder ao produto falado.',
                },
              },
              required: ['itemIndex', 'nomeOriginalEscolhido'],
            },
          },
        },
        required: ['vinculos'],
      }

      const systemPromptRag = `Você é um motor de RAG especialista em notas fiscais de supermercado brasileiro (NFC-e).
Para cada item falado pelo usuário na lista de compras, analise as opções recuperadas do histórico de compras dele ("opcoesHistoricoMercado").
Regras:
1. Priorize SEMPRE opções onde "noMercadoSelecionado" for true, desde que sejam de fato o produto que o usuário pediu.
2. Lembre-se que notas fiscais usam abreviações (ex: "MAC BARILLA OVOS PEN" é "macarrão penne", "QJO MUSS" é "queijo mussarela", "LIMAO TAITI" é "limões").
3. Se nenhuma opção em "opcoesHistoricoMercado" corresponder de verdade ao produto pedido, retorne "" em "nomeOriginalEscolhido".`

      const respostaRag = await this.chamarGeminiJson<{
        vinculos: Array<{ itemIndex: number; nomeOriginalEscolhido: string }>
      }>(
        systemPromptRag,
        JSON.stringify(payloadParaIa, null, 2),
        schemaRag,
      )

      if (respostaRag && Array.isArray(respostaRag.vinculos)) {
        for (const v of respostaRag.vinculos) {
          escolhasIa.set(
            v.itemIndex,
            v.nomeOriginalEscolhido ? v.nomeOriginalEscolhido.trim() : null,
          )
        }
      }
    }

    // Constrói os itens vinculados finais
    return candidatosPorItem.map(({ index, item, topCandidatos }) => {
      let escolhido: CandidatoHistoricoMercado | null = null

      if (escolhasIa.has(index)) {
        const nomeIa = escolhasIa.get(index)
        if (nomeIa) {
          const matchIa = topCandidatos.find(
            (tc) =>
              tc.candidato.nomeOriginal.toUpperCase().trim() ===
              nomeIa.toUpperCase().trim(),
          )
          if (matchIa) {
            escolhido = matchIa.candidato
          }
        }
      } else if (topCandidatos.length > 0 && topCandidatos[0].score >= 0.55) {
        escolhido = topCandidatos[0].candidato
      }

      if (escolhido) {
        const valorUnitario = escolhido.valorUnitarioRecente || 0
        const valorEstimado = Number(
          (item.quantidade * valorUnitario).toFixed(2),
        )

        return {
          nome: item.termoFalado,
          nomeOriginal: escolhido.nomeOriginal,
          termoFalado: item.termoFalado,
          nomeMercado: escolhido.nomeOriginal,
          origemMatch: escolhido.noMercadoSelecionado
            ? 'MERCADO_SELECIONADO'
            : 'OUTRO_MERCADO',
          estabelecimentoOrigem: escolhido.noMercadoSelecionado
            ? null
            : escolhido.estabelecimento,
          quantidade: item.quantidade,
          unidade: item.unidade || escolhido.unidade || 'UN',
          valorUnitarioRecente: valorUnitario,
          valorEstimado,
          frequencia: escolhido.frequencia,
          comprado: false,
        }
      }

      // Caso não tenha histórico em nenhum mercado
      return {
        nome: item.termoFalado,
        nomeOriginal: item.termoFalado.toUpperCase(),
        termoFalado: item.termoFalado,
        nomeMercado: null,
        origemMatch: 'SEM_HISTORICO',
        estabelecimentoOrigem: null,
        quantidade: item.quantidade,
        unidade: item.unidade || 'UN',
        valorUnitarioRecente: 0,
        valorEstimado: 0,
        frequencia: 0,
        comprado: false,
      }
    })
  }
}
