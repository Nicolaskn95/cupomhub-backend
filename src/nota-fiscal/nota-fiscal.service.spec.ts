import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { getQueueToken } from '@nestjs/bullmq'
import { ConfigService } from '@nestjs/config'
import { BadRequestException } from '@nestjs/common'
import { Types } from 'mongoose'
import { NotaFiscalService } from './nota-fiscal.service'
import { NotaFiscal } from './schemas/nota-fiscal.schema'
import { Produto } from './schemas/produto.schema'
import { EstabelecimentoUsuario } from './schemas/estabelecimento-usuario.schema'
import { MercadoService } from '../mercado/mercado.service'

describe('NotaFiscalService', () => {
  let service: NotaFiscalService
  let mockNotaFiscalModel: any
  let mockProdutoModel: any
  let mockEstabelecimentoUsuarioModel: any
  let mockMercadoService: any
  let mockQueue: any
  let mockConfigService: any

  const validUserId = new Types.ObjectId().toString()
  const validNotaId = new Types.ObjectId().toString()

  beforeEach(async () => {
    mockNotaFiscalModel = {
      findOne: jest.fn(),
      findById: jest.fn(),
      find: jest.fn(),
      aggregate: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    }

    mockProdutoModel = {
      find: jest.fn(),
      distinct: jest.fn(),
      insertMany: jest.fn(),
    }

    mockEstabelecimentoUsuarioModel = {
      find: jest.fn(),
      findOneAndUpdate: jest.fn(),
    }

    mockMercadoService = {
      processarUpsertMercado: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
      }),
      buscarPorCnpj: jest.fn(),
      buscarPorId: jest.fn(),
    }

    mockQueue = {
      add: jest.fn(),
    }

    mockConfigService = {
      get: jest.fn().mockReturnValue(undefined),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotaFiscalService,
        {
          provide: getModelToken(NotaFiscal.name),
          useValue: mockNotaFiscalModel,
        },
        {
          provide: getModelToken(Produto.name),
          useValue: mockProdutoModel,
        },
        {
          provide: getModelToken(EstabelecimentoUsuario.name),
          useValue: mockEstabelecimentoUsuarioModel,
        },
        {
          provide: getQueueToken('nota-fiscal-queue'),
          useValue: mockQueue,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: MercadoService,
          useValue: mockMercadoService,
        },
      ],
    }).compile()

    service = module.get<NotaFiscalService>(NotaFiscalService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  describe('processarUrl', () => {
    it('should throw BadRequestException if URL is invalid', async () => {
      await expect(
        service.processarUrl('https://site-invalido.com/teste', validUserId),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('listarNotasPorUsuario', () => {
    it('should query notes by user and populate products', async () => {
      const mockNotas = [{ _id: validNotaId, estabelecimento: 'Mercado A' }]
      mockNotaFiscalModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockNotas),
        }),
      })

      const result = await service.listarNotasPorUsuario(validUserId)
      expect(result).toEqual(mockNotas)
    })
  })

  describe('buscarPorId', () => {
    it('should return note when found by id and user', async () => {
      const mockNota = { _id: validNotaId, estabelecimento: 'Mercado A' }
      mockNotaFiscalModel.findOne.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockNota),
        }),
      })

      const result = await service.buscarPorId(validNotaId, validUserId)
      expect(result).toEqual(mockNota)
    })
  })

  describe('listarNomesProdutos', () => {
    it('should return unique product names sorted alphabetically', async () => {
      mockNotaFiscalModel.find.mockReturnValue({
        distinct: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([new Types.ObjectId()]),
        }),
      })

      mockProdutoModel.distinct.mockReturnValue({
        exec: jest.fn().mockResolvedValue(['FEIJAO', 'ARROZ', 'CAFÉ']),
      })

      const result = await service.listarNomesProdutos('', validUserId)
      expect(result).toEqual(['ARROZ', 'CAFÉ', 'FEIJAO'])
    })
  })

  describe('atualizarNotaFiscal', () => {
    it('should update payment, card, and tax fields', async () => {
      const mockDoc: any = {
        _id: validNotaId,
        tipoPagamento: 'Dinheiro',
        save: jest.fn().mockResolvedValue(true),
      }
      mockNotaFiscalModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockDoc),
      })
      mockNotaFiscalModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockDoc),
        }),
      })

      const dto = {
        tipoPagamento: 'Cartão de Crédito',
        cartaoUsado: 'Nubank Mastercard',
        valorTributos: 18.75,
        tributosDetalhados: { federal: 10, estadual: 8.75 },
      }

      await service.atualizarNotaFiscal(validNotaId, dto, validUserId)

      expect(mockDoc.tipoPagamento).toBe('Cartão de Crédito')
      expect(mockDoc.cartaoUsado).toBe('Nubank Mastercard')
      expect(mockDoc.valorTributos).toBe(18.75)
      expect(mockDoc.tributosDetalhados).toEqual({ federal: 10, estadual: 8.75 })
      expect(mockDoc.save).toHaveBeenCalled()
    })
  })

  describe('extrairDados', () => {
    it('should extract taxes, payment type and card from html', () => {
      const html = `
        <html>
          <body>
            <div>MERCADO EXEMPLO LTDA CNPJ: 12.345.678/0001-90</div>
            <div>Chave de acesso: 3524 0112 3456 7800 0190 6500 1000 0000 0110 0000 0010</div>
            <div>Número: 000001 Série: 1 Emissão: 20/09/2026</div>
            <div>Valor total R$ 100,00</div>
            <div>Descontos R$ 0,00</div>
            <div>Valor a pagar R$ 100,00</div>
            <div>Forma de pagamento: Cartão de Crédito</div>
            <div>Bandeira: Mastercard</div>
            <div>Informação dos Tributos Totais Incidentes (Lei Federal 12.741/2012) R$ 14,50</div>
            <div>Federal R$ 9,00 Estadual R$ 5,50</div>
          </body>
        </html>
      `
      const dados = (service as any).extrairDados(html)
      expect(dados.valorTributos).toBe(14.5)
      expect(dados.tributosDetalhados).toEqual({ federal: 9, estadual: 5.5, municipal: undefined })
      expect(dados.tipoPagamento).toBe('Cartão de Crédito')
      expect(dados.cartaoUsado).toBe('Mastercard')
    })

    it('should correctly extract products with hyphens and special characters via SEFAZ table', () => {
      const html = `
        <html>
          <body>
            <tr id="Item + 1">
              <td valign="top">
                <span class="txtTit">F INF NAN COMF 0-6M</span>
                <span class="RCod">(Código: 81057)</span>
                <br>
                <span class="Rqtd"><strong>Qtde.:</strong>1</span>
                <span class="RUN"><strong>UN: </strong>LT</span>
                <span class="RvlUnit"><strong>Vl. Unit.:</strong> 71,78</span>
              </td>
              <td align="right" valign="top" class="txtTit noWrap">
                Vl. Total<br><span class="valor">71,78</span>
              </td>
            </tr>
          </body>
        </html>
      `
      const dados = (service as any).extrairDados(html)
      expect(dados.produtos).toHaveLength(1)
      expect(dados.produtos[0].nome).toBe('F INF NAN COMF 0-6M')
      expect(dados.produtos[0].codigo).toBe('81057')
      expect(dados.produtos[0].quantidade).toBe(1)
      expect(dados.produtos[0].unidade).toBe('LT')
      expect(dados.produtos[0].valorUnitario).toBe(71.78)
      expect(dados.produtos[0].valorTotal).toBe(71.78)
    })

    it('should correctly extract products with hyphens via fallback regex when table is absent', () => {
      const html = `
        <html>
          <body>
            <div>F INF NAN COMF 0-6M (Código: 81057) Qtde.: 1 UN: LT Vl. Unit.: 71,78 Vl. Total 71,78</div>
          </body>
        </html>
      `
      const dados = (service as any).extrairDados(html)
      expect(dados.produtos).toHaveLength(1)
      expect(dados.produtos[0].nome).toBe('F INF NAN COMF 0-6M')
      expect(dados.produtos[0].codigo).toBe('81057')
      expect(dados.produtos[0].quantidade).toBe(1)
      expect(dados.produtos[0].unidade).toBe('LT')
      expect(dados.produtos[0].valorUnitario).toBe(71.78)
      expect(dados.produtos[0].valorTotal).toBe(71.78)
    })
  })
})
