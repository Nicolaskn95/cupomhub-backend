import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import {
  CandidatoHistoricoMercado,
  VozPlnRagService,
} from './voz-pln-rag.service'

describe('VozPlnRagService', () => {
  let service: VozPlnRagService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VozPlnRagService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(''), // Testa determinístico sem depender de rede externa
          },
        },
      ],
    }).compile()

    service = module.get<VozPlnRagService>(VozPlnRagService)
    delete process.env.GEMINI_API_KEY
  })

  it('deve extrair exatamente os 5 itens do exemplo de comando de voz com PLN', () => {
    const frase =
      'adicionar 3 limoes, 1 kilo de carne moida, azeite, 1 macarrao penne, 1 sal'
    const itens = service.extrairItensDeterministico(frase)

    expect(itens).toEqual([
      { termoFalado: 'Limoes', quantidade: 3, unidade: 'UN' },
      { termoFalado: 'Carne moida', quantidade: 1, unidade: 'KG' },
      { termoFalado: 'Azeite', quantidade: 1, unidade: 'UN' },
      { termoFalado: 'Macarrao penne', quantidade: 1, unidade: 'UN' },
      { termoFalado: 'Sal', quantidade: 1, unidade: 'UN' },
    ])
  })

  it('deve extrair itens mesmo em fala contínua sem vírgulas e com numerais por extenso', () => {
    const frase =
      'adicionar dois pacotes de arroz um quilo de feijao carioca e 3 detergentes'
    const itens = service.extrairItensDeterministico(frase)

    expect(itens).toEqual([
      { termoFalado: 'Arroz', quantidade: 2, unidade: 'PCT' },
      { termoFalado: 'Feijao carioca', quantidade: 1, unidade: 'KG' },
      { termoFalado: 'Detergentes', quantidade: 3, unidade: 'UN' },
    ])
  })

  it('deve vincular itens falados com o histórico do mercado via RAG e atribuir a categoria correta a cada item', async () => {
    const itensFalados = [
      { termoFalado: 'Limoes', quantidade: 3, unidade: 'UN' },
      { termoFalado: 'Carne moida', quantidade: 1, unidade: 'KG' },
      { termoFalado: 'Azeite', quantidade: 1, unidade: 'UN' },
      { termoFalado: 'Macarrao penne', quantidade: 1, unidade: 'UN' },
      { termoFalado: 'Sal', quantidade: 1, unidade: 'UN' },
    ]

    const candidatos: CandidatoHistoricoMercado[] = [
      {
        nomeOriginal: 'LIMAO TAITI KG',
        nomeExibicao: 'LIMAO TAITI KG',
        unidade: 'KG',
        valorUnitarioRecente: 5.99,
        frequencia: 4,
        noMercadoSelecionado: true,
        estabelecimento: 'Confiança Supermercados',
        ultimaCompra: new Date(),
      },
      {
        nomeOriginal: 'CARNE MOIDA BOV PATINHO KG',
        nomeExibicao: 'CARNE MOIDA BOV PATINHO KG',
        unidade: 'KG',
        valorUnitarioRecente: 39.9,
        frequencia: 3,
        noMercadoSelecionado: true,
        estabelecimento: 'Confiança Supermercados',
        ultimaCompra: new Date(),
      },
      {
        nomeOriginal: 'MAC BARILLA OVOS PEN 500G',
        nomeExibicao: 'MAC BARILLA OVOS PEN 500G',
        unidade: 'UN',
        valorUnitarioRecente: 8.49,
        frequencia: 2,
        noMercadoSelecionado: true,
        estabelecimento: 'Confiança Supermercados',
        ultimaCompra: new Date(),
      },
      {
        nomeOriginal: 'AZEITE OLIVA ANDORINHA VD 500ML',
        nomeExibicao: 'AZEITE OLIVA ANDORINHA VD 500ML',
        unidade: 'UN',
        valorUnitarioRecente: 42.9,
        frequencia: 1,
        noMercadoSelecionado: false, // Comprado em outro mercado!
        estabelecimento: 'Tauste Supermercados',
        ultimaCompra: new Date(),
      },
    ]

    const resultado = await service.vincularItensComHistorico(
      itensFalados,
      candidatos,
    )

    expect(resultado).toHaveLength(5)

    // 1. Limões -> LIMAO TAITI KG (Mercado Selecionado) - Categoria Frutas
    expect(resultado[0].termoFalado).toBe('Limoes')
    expect(resultado[0].nomeMercado).toBe('LIMAO TAITI KG')
    expect(resultado[0].origemMatch).toBe('MERCADO_SELECIONADO')
    expect(resultado[0].categoriaCodigo).toBe('HORTIFRUTI_FRUTAS')
    expect(resultado[0].categoriaNome).toBe('Frutas')

    // 2. Carne moída -> CARNE MOIDA BOV PATINHO KG (Mercado Selecionado) - Categoria Açougue e Peixaria
    expect(resultado[1].termoFalado).toBe('Carne moida')
    expect(resultado[1].nomeMercado).toBe('CARNE MOIDA BOV PATINHO KG')
    expect(resultado[1].origemMatch).toBe('MERCADO_SELECIONADO')
    expect(resultado[1].valorEstimado).toBe(39.9)
    expect(resultado[1].categoriaCodigo).toBe('ACOUGUE_E_PEIXARIA')
    expect(resultado[1].categoriaNome).toBe('Açougue e Peixaria')

    // 3. Azeite -> AZEITE OLIVA ANDORINHA VD 500ML (Outro Mercado) - Categoria Mercearia Seca
    expect(resultado[2].termoFalado).toBe('Azeite')
    expect(resultado[2].nomeMercado).toBe('AZEITE OLIVA ANDORINHA VD 500ML')
    expect(resultado[2].origemMatch).toBe('OUTRO_MERCADO')
    expect(resultado[2].estabelecimentoOrigem).toBe('Tauste Supermercados')
    expect(resultado[2].categoriaCodigo).toBe('MERCEARIA_SECA')
    expect(resultado[2].categoriaNome).toBe('Mercearia Seca')

    // 4. Macarrão penne -> MAC BARILLA OVOS PEN 500G (Mercado Selecionado) - Categoria Mercearia Seca
    expect(resultado[3].termoFalado).toBe('Macarrao penne')
    expect(resultado[3].nomeMercado).toBe('MAC BARILLA OVOS PEN 500G')
    expect(resultado[3].origemMatch).toBe('MERCADO_SELECIONADO')
    expect(resultado[3].categoriaCodigo).toBe('MERCEARIA_SECA')
    expect(resultado[3].categoriaNome).toBe('Mercearia Seca')

    // 5. Sal -> Sem histórico - Categoria Mercearia Seca
    expect(resultado[4].termoFalado).toBe('Sal')
    expect(resultado[4].nomeMercado).toBeNull()
    expect(resultado[4].origemMatch).toBe('SEM_HISTORICO')
    expect(resultado[4].categoriaCodigo).toBe('MERCEARIA_SECA')
    expect(resultado[4].categoriaNome).toBe('Mercearia Seca')
  })
})
