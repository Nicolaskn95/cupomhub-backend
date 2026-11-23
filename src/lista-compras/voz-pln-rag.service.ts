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

export interface CategoriaItemInfo {
  categoriaCodigo: string
  categoriaNome: string
  categoriaCor: string
  categoriaIcone: string
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
  categoriaCodigo?: string | null
  categoriaNome?: string | null
  categoriaCor?: string | null
  categoriaIcone?: string | null
}

export interface ItemVinculadoRag {
  nome: string
  nomeOriginal: string
  termoFalado: string
  nomeMercado: string | null
  origemMatch: 'MERCADO_SELECIONADO' | 'OUTRO_MERCADO' | 'SEM_HISTORICO'
  estabelecimentoOrigem: string | null
  categoriaCodigo: string
  categoriaNome: string
  categoriaCor: string
  categoriaIcone: string
  quantidade: number
  unidade: string
  pesoEstimadoKg?: number
  valorUnitarioRecente: number
  valorEstimado: number
  frequencia: number
  comprado: boolean
}

export const CATALOGO_CATEGORIAS_SUPERMERCADO: Record<
  string,
  CategoriaItemInfo
> = {
  HORTIFRUTI_FRUTAS: {
    categoriaCodigo: 'HORTIFRUTI_FRUTAS',
    categoriaNome: 'Frutas',
    categoriaCor: '#eab308',
    categoriaIcone: 'Apple',
  },
  HORTIFRUTI_VERDURAS_E_LEGUMES: {
    categoriaCodigo: 'HORTIFRUTI_VERDURAS_E_LEGUMES',
    categoriaNome: 'Verduras e Legumes',
    categoriaCor: '#22c55e',
    categoriaIcone: 'leafy-green',
  },
  ACOUGUE_E_PEIXARIA: {
    categoriaCodigo: 'ACOUGUE_E_PEIXARIA',
    categoriaNome: 'Açougue e Peixaria',
    categoriaCor: '#dc2626',
    categoriaIcone: 'Beef',
  },
  LATICINIOS_E_OVOS: {
    categoriaCodigo: 'LATICINIOS_E_OVOS',
    categoriaNome: 'Laticínios e Ovos',
    categoriaCor: '#0284c7',
    categoriaIcone: 'Milk',
  },
  PADARIA_E_CONFEITARIA: {
    categoriaCodigo: 'PADARIA_E_CONFEITARIA',
    categoriaNome: 'Padaria e Confeitaria',
    categoriaCor: '#92400e',
    categoriaIcone: 'Croissant',
  },
  MERCEARIA_SECA: {
    categoriaCodigo: 'MERCEARIA_SECA',
    categoriaNome: 'Mercearia Seca',
    categoriaCor: '#6d28d9',
    categoriaIcone: 'Package',
  },
  CONGELADOS: {
    categoriaCodigo: 'CONGELADOS',
    categoriaNome: 'Congelados',
    categoriaCor: '#3b82f6',
    categoriaIcone: 'Snowflake',
  },
  BEBIDAS: {
    categoriaCodigo: 'BEBIDAS',
    categoriaNome: 'Bebidas',
    categoriaCor: '#db2777',
    categoriaIcone: 'Wine',
  },
  LIMPEZA: {
    categoriaCodigo: 'LIMPEZA',
    categoriaNome: 'Limpeza',
    categoriaCor: '#06b6d4',
    categoriaIcone: 'SprayCan',
  },
  HIGIENE_E_BELEZA: {
    categoriaCodigo: 'HIGIENE_E_BELEZA',
    categoriaNome: 'Higiene e Beleza',
    categoriaCor: '#f472b6',
    categoriaIcone: 'Sparkles',
  },
  PET_SHOP: {
    categoriaCodigo: 'PET_SHOP',
    categoriaNome: 'Pet Shop',
    categoriaCor: '#f97316',
    categoriaIcone: 'PawPrint',
  },
  UTILIDADES_DOMESTICAS: {
    categoriaCodigo: 'UTILIDADES_DOMESTICAS',
    categoriaNome: 'Utilidades Domésticas',
    categoriaCor: '#475569',
    categoriaIcone: 'Lamp',
  },
}

const REGRAS_CATEGORIAS_REGEX: Array<[string, RegExp]> = [
  [
    'LIMPEZA',
    /\b(detergente\w*|det\b|desinfetante\w*|des\b|lysoform|sabao|amaciante\w*|agua sanitaria|alvejante\w*|cloro|esponja\w*|scotch brite|bombril|ype|veja|limpador\w*|desengordurante\w*|multiuso|vassoura\w*|rodo\w*|saco\w* lixo|lustra|lixivia|inseticida\w*|guardanapo\w*|guard\b|papel toalha|toalha papel|lava roupas|lav r\b|omo|tixan|ariel|comfort|downy|brilhante)\b/i,
  ],
  [
    'HIGIENE_E_BELEZA',
    /\b(shampoo\w*|xampu\w*|shamp\b|condicionador\w*|cond\b|sabonete\w*|sab l\b|sab emb\b|sab\b|creme dental|pasta\w* dente\w*|escova\w* dente\w*|desodorante\w*|desod\b|absorvente\w*|cotonete\w*|hidratante\w*|perfume\w*|fio dental|papel higienico|fralda\w*|protetor solar|esmalte\w*|acetona|algodao|enxaguante|listerine|colgate|oral b|rexona|dove|nivea)\b/i,
  ],
  [
    'PET_SHOP',
    /\b(racao|racoes|petisco\w*|pet\b|pedigree|whiskas|golden|premier|areia\w* gato\w*|coleira\w*|cachorro\w*|caes|canin\w*|felin\w*|sach[eê]\w* gato|sach[eê]\w* cao)\b/i,
  ],
  [
    'UTILIDADES_DOMESTICAS',
    /\b(lampada\w*|pilha\w*|panela\w*|copo\w*|prato\w*|talher\w*|bateria\w*|utensilio\w*|bazar|filtro\w* de papel|filtro\w* papel|filtro\w* cafe|papel aluminio|filme pvc|plastico filme|fosforo\w*|isqueiro\w*|vela\w*|prendedor\w*|tupperware|pote\w* plastico)\b/i,
  ],
  [
    'PADARIA_E_CONFEITARIA',
    /\b(pao|paes|biscoito\w*|bisc\b|bolacha\w*|rosquinha\w*|rosq\b|bolo\w*|torta\w*|croissant\w*|baguete\w*|salgado\w*|coxinha\w*|empada\w*|pastel|pasteis|torrada\w*|panetone\w*|confeitaria|padaria|bisnaguinha\w*|sonho\w*|brioche\w*)\b/i,
  ],
  [
    'CONGELADOS',
    /\b(congelad\w*|cong\b|sorvete\w*|pizza\w*|lasanha\w*|nugget\w*|hamburguer\w*|steak\w*|batata cong\w*|polpa\w* de fruta\w*|acai|gelo|pao de queijo cong\w*)\b/i,
  ],
  [
    'BEBIDAS',
    /\b(refrigerante\w*|refr\b|refri\b|ref\b|schweppes|coca|coca-cola|pepsi|guarana\w*|fanta|sprite|suco\w*|nectar|cerveja\w*|chopp|vinho\w*|vodka|whisky|gin|energetico\w*|energ\b|baly|red bull|monster|tonica|cha\w*|ice|gatorade|h2oh|agua\w*(?! sanitaria)|espumante\w*|cachaca|aguardente|isotonic\w*)\b/i,
  ],
  [
    'LATICINIOS_E_OVOS',
    /\b(leite\w*|queijo\w*|qjo\b|mussarela|mucarela|parmesao|iogurte\w*|requeijao|req\b|manteiga|margarina|ovo\w*|nata|creme de leite|leite condensado|coalhada|ricota|gorgonzola|provolone|catupiry|chantilly|yakult|leite fermentado|danone|presunto\w*|mortadela\w*|peito de peru|salame\w*)\b/i,
  ],
  [
    'MERCEARIA_SECA',
    /\b(arroz|feijao|feijoes|macarrao|mac\b|massa\w*|espaguete|penne|parafuso|talharim|miojo|lamen|oleo\w*|azeite\w*|farinha\w*|biju|polvilho|fuba|acucar\w*|adocante\w*|cafe\w*|sal\b|molho\w*|extrato\w*|enlatado\w*|milho\w*|ervilha\w*|sardinha\w*|sard\b|atum|lentilha\w*|grao de bico|vinagre\w*|mol tom|ext tom|bat pa\b|batata palha|yoki|salsaretti|conserva\w*|maionese\w*|maion\b|ketchup|mostarda|canjica|sucrilhos|cereal|cereais|cer\b|aveia|granola|caldo\w*|sazon|knorr|maggi|sabor ami|curry|tempero\w*|temp\b|siamar|kitano|colorau|cominho|oregano|pimenta do reino|chocolate\w*|choc\b|ch\b|garoto|lacta|nestle|barra chocolate|bombom|bombons|achocolatado\w*|nescau|toddy|gelatina\w*|po gel\b|ervas finas|fermento|amido de milho|maizena|azeitona\w*|palmito\w*|pipoca|amendoim|castanha\w*|nozes|geleia\w*|mel\b|doce de leite|goiabada)\b/i,
  ],
  [
    'ACOUGUE_E_PEIXARIA',
    /\b(picanha|alcatra|contra\s*file|contrafile|maminha|costela\w*|frango\w*|fgo\b|coxa\w*|sobrecoxa\w*|peito de frango|asa de frango|carne\w*|bov\w*|suin\w*|peixe\w*|salmao|tilapia\w*|merluza|camarao|camaroes|linguica\w*|ling\b|salsicha\w*|bife\w*|acougue|bacon|pernil|mignon|file mignon|patinho|acem|musculo|cupim|paleta|pescado\w*|bacalhau|toscana|calabresa|miolo acem|file de frango|charque|carne seca|fraldinha|lagarto|figado|coracao de frango|moela|lombo)\b/i,
  ],
  [
    'HORTIFRUTI_FRUTAS',
    /\b(maca|macas|banana\w*|laranja\w*|uva\w*|morango\w*|abacaxi\w*|melancia\w*|melao|meloes|mamao|mamoes|limao|limoes|pera\w*|manga\w*|maracuja\w*|kiwi\w*|pessego\w*|goiaba\w*|tangerina\w*|mexerica\w*|ponkan|ameixa\w*|cereja\w*|abacate\w*|caqui\w*|figo\w*|jabuticaba\w*|acerola\w*|pitaya\w*|coco\w*|framboesa\w*|amora\w*|mirtilo\w*)\b/i,
  ],
  [
    'HORTIFRUTI_VERDURAS_E_LEGUMES',
    /\b(alface\w*|tomate\w*|cebola\w*|cebolinha\w*|batata\w*|cenoura\w*|alho\w*|pimentao|pimentoes|pimenta\w*|chuchu\w*|abobrinha\w*|abobora\w*|abob\b|couve\w*|brocolis|espinafre\w*|repolho\w*|mandioca\w*|mandioquinha\w*|aipim|macaxeira|rucula\w*|cheiro verde|hortalica\w*|coentro\w*|agriao|salsa|salsinha|manjericao|hortela|alecrim|acelga|escarola|chicoria|beterraba\w*|vagem|vagens|pepino\w*|berinjela\w*|quiabo\w*|jil[oó]\w*|inhame\w*|car[aá]\w*|rabanete\w*|nabo\w*|gengibre\w*|cogumelo\w*|champignon|shimeji|shitake|hidroponic\w*)\b/i,
  ],
]

export const PESO_MEDIO_UNIDADE_KG: Record<string, number> = {
  tomate: 0.15,
  cebola: 0.15,
  batata: 0.2,
  cenoura: 0.15,
  banana: 0.12,
  maca: 0.18,
  laranja: 0.2,
  limao: 0.08,
  alho: 0.05,
  pimentao: 0.15,
  abobrinha: 0.25,
  berinjela: 0.3,
  pepino: 0.2,
  manga: 0.35,
  abacate: 0.4,
  mamao: 0.5,
  melancia: 3.0,
  melao: 1.5,
  chuchu: 0.25,
  mandioquinha: 0.1,
  mandioca: 0.4,
  pera: 0.18,
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
  [/\bCALAB\w*\b/g, 'CALABRESA'],
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
   * Classifica um item da lista de compras em uma das 12 categorias de corredor de supermercado
   * usando tanto o termo falado quanto o nome original fiscal do produto.
   */
  classificarCategoriaItem(
    termoFalado?: string | null,
    nomeOriginal?: string | null,
  ): CategoriaItemInfo {
    const textosParaTestar = [
      termoFalado ? this.expandirTextoFiscal(termoFalado) : '',
      nomeOriginal ? this.expandirTextoFiscal(nomeOriginal) : '',
    ].filter(Boolean)

    for (const texto of textosParaTestar) {
      const normalizado = removerAcentos(texto.toLowerCase())
      for (const [codigo, regex] of REGRAS_CATEGORIAS_REGEX) {
        if (regex.test(normalizado)) {
          return (
            CATALOGO_CATEGORIAS_SUPERMERCADO[codigo] ||
            CATALOGO_CATEGORIAS_SUPERMERCADO.MERCEARIA_SECA
          )
        }
      }
    }

    return CATALOGO_CATEGORIAS_SUPERMERCADO.MERCEARIA_SECA
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
  estimarPesoUnitarioKg(termoFalado: string, nomeOriginal?: string): number {
    const texto = removerAcentos(
      `${termoFalado} ${nomeOriginal || ''}`.toLowerCase(),
    ).replace(/[^a-z0-9]/g, '')

    for (const [chave, peso] of Object.entries(PESO_MEDIO_UNIDADE_KG)) {
      if (texto.includes(chave)) {
        return peso
      }
    }
    return 0.2 // Fallback: 200g por unidade de produto pesavel
  }

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
        const unidadeMercado = (escolhido.unidade || '').toUpperCase().trim()
        const unidadeItem = (item.unidade || '').toUpperCase().trim()

        let valorEstimado = 0
        let pesoEstimadoKg: number | undefined

        // Se o produto no mercado é vendido por KG (hortifrúti, verduras, carnes pesáveis)
        if (unidadeMercado === 'KG') {
          if (unidadeItem === 'KG') {
            valorEstimado = Number((item.quantidade * valorUnitario).toFixed(2))
            pesoEstimadoKg = item.quantidade
          } else if (unidadeItem === 'G' || unidadeItem === 'GR') {
            const pesoKg = item.quantidade / 1000
            valorEstimado = Number((pesoKg * valorUnitario).toFixed(2))
            pesoEstimadoKg = pesoKg
          } else {
            // Unidade ou contagem de peças (ex: 3 tomates, 2 cebolas)
            // Em vez de calcular por unidade (multiplicando pelo preço do kg inteiro),
            // calcula pelo peso estimado em kg do produto
            const pesoUnitarioKg = this.estimarPesoUnitarioKg(
              item.termoFalado,
              escolhido.nomeOriginal,
            )
            const pesoTotalKg = Number(
              (item.quantidade * pesoUnitarioKg).toFixed(3),
            )
            valorEstimado = Number((pesoTotalKg * valorUnitario).toFixed(2))
            pesoEstimadoKg = pesoTotalKg
          }
        } else {
          valorEstimado = Number((item.quantidade * valorUnitario).toFixed(2))
        }

        const catAuto = this.classificarCategoriaItem(
          item.termoFalado,
          escolhido.nomeOriginal,
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
          categoriaCodigo:
            escolhido.categoriaCodigo || catAuto.categoriaCodigo,
          categoriaNome: escolhido.categoriaNome || catAuto.categoriaNome,
          categoriaCor: escolhido.categoriaCor || catAuto.categoriaCor,
          categoriaIcone: escolhido.categoriaIcone || catAuto.categoriaIcone,
          quantidade: item.quantidade,
          unidade: item.unidade || escolhido.unidade || 'UN',
          pesoEstimadoKg,
          valorUnitarioRecente: valorUnitario,
          valorEstimado,
          frequencia: escolhido.frequencia,
          comprado: false,
        }
      }

      // Caso não tenha histórico em nenhum mercado
      const catSemHist = this.classificarCategoriaItem(item.termoFalado, null)

      return {
        nome: item.termoFalado,
        nomeOriginal: item.termoFalado.toUpperCase(),
        termoFalado: item.termoFalado,
        nomeMercado: null,
        origemMatch: 'SEM_HISTORICO',
        estabelecimentoOrigem: null,
        categoriaCodigo: catSemHist.categoriaCodigo,
        categoriaNome: catSemHist.categoriaNome,
        categoriaCor: catSemHist.categoriaCor,
        categoriaIcone: catSemHist.categoriaIcone,
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
