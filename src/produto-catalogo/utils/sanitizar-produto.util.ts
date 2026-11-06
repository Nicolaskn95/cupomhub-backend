/**
 * Utilitários para sanitização de descrições de produtos vindos de cupons fiscais (NFC-e)
 * e geração de chaves canônicas para agrupamento de produtos idênticos entre diferentes redes de supermercados.
 */

const SIGLAS_ESTADO =
  /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MG|MS|MT|PA|PB|PR|PE|PI|RJ|RN|RO|RS|SC|SP|SE|TO)\s+/i

const PREFIXOS_FISCAIS_EMBALAGEM =
  /^\s*\d*([.,]\d+)?\s*(UN|KG|LT|CX|PT|GL|FD|BJ|PC|PE|PÇ|FR|SH|MA|TP|LATA|BARRA|GR|G|M|PCT|SC|DG|TB|AM|TR|VD|EMB)\s*[-–:/.]\s*/i

const PREFIXOS_SETORES_MERCADO =
  /^\s*(HORT|HORTI|HF|FLV|ACOU|ACOUGUE|AÇOUGUE|MER|MERC|MERCEARIA|PAD|PADARIA|BEB|BEBIDAS|FRIOS|LATIC|LATICINIOS|BAZAR|HIG|HIGIENE|LIM|LIMPEZA|CARNES|DEPTO|DEP|SETOR)\b\s*[-–:/.]?\s*/i

const PREFIXOS_CODIGO_INTERNO_BALANCA =
  /^\s*(#|PLU\s*[:.-]?\s*)\d+\s*[-–:/.]?\s*|^\s*\d{1,6}\s*[-–]\s*|^\s*\d{4,6}\s+/i

const UNIDADES_SUFIXO =
  /\s+(UN|CX|BJ|KG|G|PCT|PC|PE|PÇ|LT|ML|GR|PAR|KIT|FD|SC|DG|TB|AM|FR|PT|TR|VD|EMB|LATA|BARRA)\s*$/i

const STOP_WORDS = new Set([
  'DE',
  'DA',
  'DO',
  'DAS',
  'DOS',
  'E',
  'COM',
  'SEM',
  'PARA',
  'EM',
  'NO',
  'NA',
  'NOS',
  'NAS',
  'POR',
  'AO',
  'AOS',
])

export const EXPANSOES_ABREVIACOES_FISCAIS: Array<[RegExp, string]> = [
  [/\bMUSC\b|\bMUSCL\b/g, 'MUSCULO'],
  [/\bMAC\b|\bMACARR\b/g, 'MACARRAO'],
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
  [/\bBISC\b|\bBOL\b/g, 'BISCOITO'],
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
  [/\bABOB\w*\b/g, 'ABOBRINHA'],
  [/\bCEN\b|\bCENOUR\w*\b/g, 'CENOURA'],
  [/\bBAT\b|\bBATAT\w*\b/g, 'BATATA'],
  [/\bTOM\b|\bTOMAT\w*\b/g, 'TOMATE'],
  [/\bCEB\b|\bCEBOL\w*\b/g, 'CEBOLA'],
  [/\bALF\b|\bALFAC\w*\b/g, 'ALFACE'],
  [/\bPRES\b|\bPRESUNT\w*\b/g, 'PRESUNTO'],
]

/**
 * Normaliza espaçamentos e espaços em branco repetidos.
 */
export function normalizarEspacos(texto: string): string {
  if (typeof texto !== 'string') return ''
  return texto.replace(/\s+/g, ' ').trim()
}

/**
 * Remove acentos de uma string mantendo caracteres alfanuméricos.
 */
export function removerAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Expande abreviações fiscais típicas da SEFAZ para termos canônicos legíveis.
 */
export function expandirAbreviacoesFiscais(texto: string): string {
  if (!texto) return ''
  let expandido = removerAcentos(texto.toUpperCase())
  for (const [regex, expansao] of EXPANSOES_ABREVIACOES_FISCAIS) {
    expandido = expandido.replace(regex, expansao)
  }
  return normalizarEspacos(expandido)
}

/**
 * Remove prefixos fiscais (quantidade/embalagem), departamentos/setores de mercado,
 * códigos internos de balança/PLU e sufixos repetitivos do nome do produto.
 */
export function sanitizarDescricaoProduto(descricao: string): string {
  if (!descricao || typeof descricao !== 'string') {
    return ''
  }

  let limpo = normalizarEspacos(descricao)

  // 1. Remove sigla de estado no início (ex: 'SP LEITE...')
  limpo = limpo.replace(SIGLAS_ESTADO, '').trim() || limpo

  // 2. Remove prefixos fiscais de quantidade e embalagem (ex: '1 UN - ', '0.686 KG - ', '1 PE - ')
  limpo = limpo.replace(PREFIXOS_FISCAIS_EMBALAGEM, '').trim() || limpo

  // 3. Remove prefixos de departamentos/setores de supermercado (ex: 'HORT BANANA', 'MERC ARROZ')
  limpo = limpo.replace(PREFIXOS_SETORES_MERCADO, '').trim() || limpo

  // 4. Remove códigos de balança / PLU no início (ex: '4011 - BANANA', '#123 LEITE')
  limpo = limpo.replace(PREFIXOS_CODIGO_INTERNO_BALANCA, '').trim() || limpo

  // 5. Segunda passada para combinações como 'HORT 0.500 KG - BANANA'
  limpo = limpo.replace(PREFIXOS_FISCAIS_EMBALAGEM, '').trim() || limpo

  // 6. Remove unidades coladas no final (ex: 'LEITE 1L UN')
  limpo = limpo.replace(UNIDADES_SUFIXO, '').trim() || limpo

  return normalizarEspacos(limpo)
}

/**
 * Validação de EAN / GTIN segundo padrão internacional GS1.
 */
export function isEanValido(ean?: string | null): boolean {
  if (!ean || typeof ean !== 'string') {
    return false
  }

  const valorNormalizado = ean.trim().toUpperCase()

  if (
    valorNormalizado === 'SEM GTIN' ||
    valorNormalizado === 'SEMGTIN' ||
    valorNormalizado === 'NAO INFORMADO' ||
    valorNormalizado === 'NULL'
  ) {
    return false
  }

  // Apenas dígitos
  if (!/^\d+$/.test(valorNormalizado)) {
    return false
  }

  const tamanho = valorNormalizado.length
  if (![8, 12, 13, 14].includes(tamanho)) {
    return false
  }

  // Códigos de pesagem interna de loja (prefixo 20 a 29 GS1)
  if (tamanho === 13 && valorNormalizado.startsWith('2')) {
    return false
  }

  return true
}

/**
 * Gera uma chave canônica determinística para agrupamento.
 * - Se possuir EAN válido: retorna 'EAN_{codigo}'
 * - Se não possuir EAN: higieniza o nome, desabrevia termos fiscais,
 *   remove acentos e stop-words, ordena os tokens alfabeticamente
 *   e gera 'CANON_{tokens_ordenados}'.
 */
export function gerarChaveCanonica(
  codigo?: string | null,
  nomeOuDescricao?: string | null,
): string {
  if (isEanValido(codigo)) {
    return `EAN_${codigo!.trim()}`
  }

  const nomeSanitizado = sanitizarDescricaoProduto(nomeOuDescricao || '')
  if (!nomeSanitizado) {
    return 'CANON_DESCONHECIDO'
  }

  // Desabrevia termos da SEFAZ (ex: MUSC -> MUSCULO, MAC -> MACARRAO)
  const desabreviado = expandirAbreviacoesFiscais(nomeSanitizado)
  const semAcentos = removerAcentos(desabreviado.toUpperCase())

  // Quebra por caracteres não alfanuméricos
  const tokens = semAcentos
    .split(/[^A-Z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t))

  if (tokens.length === 0) {
    return `CANON_${semAcentos.replace(/[^A-Z0-9]/g, '_')}`
  }

  // Ordena os tokens alfabeticamente para garantir correspondência agnóstica à ordem das palavras
  const tokensOrdenados = Array.from(new Set(tokens)).sort()

  return `CANON_${tokensOrdenados.join('_')}`
}
