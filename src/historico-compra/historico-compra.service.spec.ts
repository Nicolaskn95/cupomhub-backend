import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { Types, BadRequestException } from 'mongoose'
import { HistoricoCompraService } from './historico-compra.service'
import { HistoricoCompra } from './schemas/historico-compra.schema'

describe('HistoricoCompraService', () => {
  let service: HistoricoCompraService
  let modelMock: any

  beforeEach(async () => {
    modelMock = {
      aggregate: jest.fn(),
      insertMany: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HistoricoCompraService,
        {
          provide: getModelToken(HistoricoCompra.name),
          useValue: modelMock,
        },
      ],
    }).compile()

    service = module.get<HistoricoCompraService>(HistoricoCompraService)
  })

  it('deve estar definido', () => {
    expect(service).toBeDefined()
  })

  describe('buscarEvolucaoPrecoProduto', () => {
    it('deve lançar BadRequestException se ID for inválido', async () => {
      await expect(
        service.buscarEvolucaoPrecoProduto('id-invalido'),
      ).rejects.toThrow(BadRequestException)
    })

    it('deve executar o pipeline de agregação com os estágios corretos ($match, $group, $sort, $project)', async () => {
      const validId = new Types.ObjectId().toString()
      const mockResult = [
        {
          produtoCatalogoId: validId,
          precoMinimo: 10.5,
          precoMaximo: 15.0,
          precoMedio: 12.75,
          totalRegistros: 4,
          dataMaisRecente: new Date('2026-09-20'),
          periodoDias: 30,
        },
      ]

      const mockQuery = {
        exec: jest.fn().mockResolvedValue(mockResult),
      }
      modelMock.aggregate.mockReturnValue(mockQuery)

      const resultado = await service.buscarEvolucaoPrecoProduto(validId)

      expect(modelMock.aggregate).toHaveBeenCalledTimes(1)
      const pipelineChamado = modelMock.aggregate.mock.calls[0][0]

      expect(pipelineChamado[0]).toHaveProperty('$match')
      expect(pipelineChamado[0].$match.produtoCatalogoId).toEqual(
        new Types.ObjectId(validId),
      )
      expect(pipelineChamado[0].$match.dataCompra).toHaveProperty('$gte')

      expect(pipelineChamado[1]).toHaveProperty('$group')
      expect(pipelineChamado[2]).toHaveProperty('$sort')
      expect(pipelineChamado[3]).toHaveProperty('$project')

      expect(resultado).toEqual(mockResult[0])
    })

    it('deve retornar null quando o produto não tiver histórico nos últimos 30 dias', async () => {
      const validId = new Types.ObjectId().toString()

      const mockQuery = {
        exec: jest.fn().mockResolvedValue([]),
      }
      modelMock.aggregate.mockReturnValue(mockQuery)

      const resultado = await service.buscarEvolucaoPrecoProduto(validId)

      expect(resultado).toBeNull()
    })
  })

  describe('listarProdutosAgrupados', () => {
    it('deve lançar BadRequestException se usuarioId for inválido', async () => {
      await expect(
        service.listarProdutosAgrupados('id-invalido'),
      ).rejects.toThrow(BadRequestException)
    })

    it('deve retornar produtos agrupados calculando estatísticas e estabelecimentos', async () => {
      const validUserId = new Types.ObjectId().toString()
      const mockGrupos = [
        {
          _id: new Types.ObjectId(),
          produtoCatalogoId: new Types.ObjectId(),
          nomePadronizado: 'LEITE INTEGRAL PIRACANJUBA 1L',
          categoria: {
            _id: new Types.ObjectId(),
            nome: 'LATICINIOS_E_OVOS',
            cor: '#3B82F6',
          },
          nomes: [
            '1 UN - LEITE INTEGRAL PIRACANJUBA 1L',
            'MERC PIRACANJUBA LEITE INTEGRAL 1L',
          ],
          totalGasto: 10.5,
          totalQuantidade: 2,
          vezesComprado: 2,
          itens: [
            {
              precoUnitario: 5.5,
              precoTotal: 5.5,
              quantidade: 1,
              dataCompra: new Date('2026-09-20'),
              estabelecimento: 'Mercado A',
            },
            {
              precoUnitario: 5.0,
              precoTotal: 5.0,
              quantidade: 1,
              dataCompra: new Date('2026-09-10'),
              estabelecimento: 'Mercado B',
            },
          ],
        },
      ]

      const mockQuery = {
        exec: jest.fn().mockResolvedValue(mockGrupos),
      }
      modelMock.aggregate.mockReturnValue(mockQuery)

      const resultado = await service.listarProdutosAgrupados(validUserId)

      expect(resultado).toHaveLength(1)
      expect(resultado[0].nome).toBe('LEITE INTEGRAL PIRACANJUBA 1L')
      expect(resultado[0].totalGasto).toBe(10.5)
      expect(resultado[0].totalQuantidade).toBe(2)
      expect(resultado[0].vezesComprado).toBe(2)
      expect(resultado[0].mediaPrecoUnitario).toBe(5.25)
      expect(resultado[0].ultimoPreco).toBe(5.5)
      expect(resultado[0].nomes).toEqual([
        '1 UN - LEITE INTEGRAL PIRACANJUBA 1L',
        'MERC PIRACANJUBA LEITE INTEGRAL 1L',
      ])
      expect(resultado[0].estabelecimentos['Mercado A']).toEqual({
        total: 5.5,
        count: 1,
        ultimoPreco: 5.5,
      })
      expect(resultado[0].estabelecimentos['Mercado B']).toEqual({
        total: 5.0,
        count: 1,
        ultimoPreco: 5.0,
      })
      expect(resultado[0].precosPorMes['2026-09']).toEqual({
        total: 10.5,
        count: 2,
      })
    })

    it('deve agrupar no mesmo produto itens de mercados diferentes com abreviações fiscais (ex: Musculo e Musc)', async () => {
      const validUserId = new Types.ObjectId().toString()
      const mockGruposDistintos = [
        {
          _id: 'MUSCULO',
          produtoCatalogoId: null,
          chaveCanonica: null,
          codigoInternoMercado: '101',
          nomePadronizado: null,
          categoria: null,
          nomes: ['1 PE - MUSCULO'],
          totalGasto: 38.0,
          totalQuantidade: 1,
          vezesComprado: 1,
          itens: [
            {
              precoUnitario: 38.0,
              precoTotal: 38.0,
              quantidade: 1,
              dataCompra: new Date('2026-09-20'),
              estabelecimento: 'Tauste Supermercados',
            },
          ],
        },
        {
          _id: 'MUSC',
          produtoCatalogoId: null,
          chaveCanonica: null,
          codigoInternoMercado: '202',
          nomePadronizado: null,
          categoria: null,
          nomes: ['MUSC'],
          totalGasto: 35.0,
          totalQuantidade: 1,
          vezesComprado: 1,
          itens: [
            {
              precoUnitario: 35.0,
              precoTotal: 35.0,
              quantidade: 1,
              dataCompra: new Date('2026-09-25'),
              estabelecimento: 'Carrefour',
            },
          ],
        },
      ]

      const mockQuery = {
        exec: jest.fn().mockResolvedValue(mockGruposDistintos),
      }
      modelMock.aggregate.mockReturnValue(mockQuery)

      const resultado = await service.listarProdutosAgrupados(validUserId)

      // Devem ser unificados em 1 único grupo CANON_MUSCULO
      expect(resultado).toHaveLength(1)
      expect(resultado[0].nome).toBe('MUSCULO')
      expect(resultado[0].nomes).toEqual(
        expect.arrayContaining(['1 PE - MUSCULO', 'MUSC']),
      )
      expect(resultado[0].vezesComprado).toBe(2)
      expect(resultado[0].totalGasto).toBe(73.0)
      expect(resultado[0].estabelecimentos['Tauste Supermercados']).toBeDefined()
      expect(resultado[0].estabelecimentos['Carrefour']).toBeDefined()
      expect(resultado[0].compras).toHaveLength(2)
    })
  })

  describe('registrarItensEmLote', () => {
    it('deve retornar array vazio se a lista de itens for vazia', async () => {
      const res = await service.registrarItensEmLote([])
      expect(res).toEqual([])
      expect(modelMock.insertMany).not.toHaveBeenCalled()
    })

    it('deve delegar a inserção para o insertMany do Mongoose', async () => {
      const itens = [
        {
          descricaoBrutaNota: 'Arroz 5kg',
          quantidade: 1,
          precoUnitario: 25.9,
        },
      ]
      modelMock.insertMany.mockResolvedValue(itens)

      const res = await service.registrarItensEmLote(itens as any)
      expect(modelMock.insertMany).toHaveBeenCalledWith(itens)
      expect(res).toEqual(itens)
    })
  })
})
