import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { NotFoundException } from '@nestjs/common'
import { Types } from 'mongoose'
import { ListaComprasService } from './lista-compras.service'
import { ListaCompras } from './schemas/lista-compras.schema'
import { ProdutoApelido } from './schemas/produto-apelido.schema'
import { NotaFiscal } from '../nota-fiscal/schemas/nota-fiscal.schema'
import { Produto } from '../nota-fiscal/schemas/produto.schema'
import { EstabelecimentoUsuario } from '../nota-fiscal/schemas/estabelecimento-usuario.schema'

describe('ListaComprasService', () => {
  let service: ListaComprasService
  let mockListaComprasModel: any
  let mockProdutoApelidoModel: any
  let mockNotaFiscalModel: any
  let mockProdutoModel: any
  let mockEstabelecimentoUsuarioModel: any

  const validUserId = new Types.ObjectId().toString()
  const validApelidoId = new Types.ObjectId().toString()

  beforeEach(async () => {
    mockListaComprasModel = {
      findOne: jest.fn(),
      deleteOne: jest.fn(),
      updateOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      create: jest.fn(),
    }

    mockProdutoApelidoModel = {
      find: jest.fn(),
      findOneAndUpdate: jest.fn(),
      deleteOne: jest.fn(),
    }

    mockNotaFiscalModel = {
      aggregate: jest.fn(),
      find: jest.fn(),
    }

    mockProdutoModel = {
      find: jest.fn(),
    }

    mockEstabelecimentoUsuarioModel = {
      find: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ListaComprasService,
        {
          provide: getModelToken(ListaCompras.name),
          useValue: mockListaComprasModel,
        },
        {
          provide: getModelToken(ProdutoApelido.name),
          useValue: mockProdutoApelidoModel,
        },
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
      ],
    }).compile()

    service = module.get<ListaComprasService>(ListaComprasService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  describe('obterLista', () => {
    it('should return user shopping list', async () => {
      const mockList = { _id: 'list-1', itens: [] }
      mockListaComprasModel.findOne.mockResolvedValue(mockList)

      const result = await service.obterLista(validUserId)
      expect(result).toEqual(mockList)
    })

    it('should throw NotFoundException when list not found', async () => {
      mockListaComprasModel.findOne.mockResolvedValue(null)

      await expect(service.obterLista(validUserId)).rejects.toThrow(NotFoundException)
    })
  })

  describe('excluirLista', () => {
    it('should delete shopping list when found', async () => {
      mockListaComprasModel.deleteOne.mockResolvedValue({ deletedCount: 1 })

      const result = await service.excluirLista(validUserId)
      expect(result).toEqual({ success: true })
    })

    it('should throw NotFoundException when list to delete is not found', async () => {
      mockListaComprasModel.deleteOne.mockResolvedValue({ deletedCount: 0 })

      await expect(service.excluirLista(validUserId)).rejects.toThrow(NotFoundException)
    })
  })

  describe('marcarItem', () => {
    it('should throw NotFoundException if list not found', async () => {
      mockListaComprasModel.findOneAndUpdate.mockResolvedValue(null)

      await expect(
        service.marcarItem(validUserId, 0, { comprado: true }),
      ).rejects.toThrow(NotFoundException)
    })

    it('should update item and return list', async () => {
      const mockList = { _id: 'list-1', itens: [{ nome: 'Arroz', comprado: true }] }
      mockListaComprasModel.findOneAndUpdate.mockResolvedValue(mockList)

      const result = await service.marcarItem(validUserId, 0, { comprado: true })
      expect(result).toEqual(mockList)
    })
  })

  describe('removerItem', () => {
    it('should throw NotFoundException if list not found', async () => {
      mockListaComprasModel.updateOne.mockResolvedValue({})
      mockListaComprasModel.findOneAndUpdate.mockResolvedValue(null)

      await expect(service.removerItem(validUserId, 0)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('should remove item from list and recalculate total', async () => {
      const mockList = {
        itens: [{ nome: 'Feijão', valorEstimado: 10 }],
        estimativaTotal: 0,
        save: jest.fn().mockResolvedValue(true),
      }
      mockListaComprasModel.updateOne.mockResolvedValue({})
      mockListaComprasModel.findOneAndUpdate.mockResolvedValue(mockList)

      const result = await service.removerItem(validUserId, 0)
      expect(mockList.estimativaTotal).toBe(10)
      expect(mockList.save).toHaveBeenCalled()
      expect(result).toBe(mockList)
    })
  })

  describe('removerApelido', () => {
    it('should throw NotFoundException if apelido not found', async () => {
      mockProdutoApelidoModel.deleteOne.mockResolvedValue({ deletedCount: 0 })

      await expect(service.removerApelido(validUserId, validApelidoId)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('should delete apelido successfully', async () => {
      mockProdutoApelidoModel.deleteOne.mockResolvedValue({ deletedCount: 1 })

      const result = await service.removerApelido(validUserId, validApelidoId)
      expect(result).toEqual({ success: true })
    })
  })

  describe('calcularItensRecorrentesMercado', () => {
    it('deve calcular quantidade decimal para produtos com unidade KG sem arredondar com Math.ceil', async () => {
      mockProdutoApelidoModel.find.mockResolvedValue([])
      const notas = [
        {
          dataEmissao: new Date('2026-01-10'),
          produtos: [
            {
              nome: 'TOMATE ITALIANO KG',
              quantidade: 0.45,
              unidade: 'KG',
              valorUnitario: 8.0,
              valorTotal: 3.6,
            },
          ],
        },
        {
          dataEmissao: new Date('2026-02-15'),
          produtos: [
            {
              nome: 'TOMATE ITALIANO KG',
              quantidade: 0.55,
              unidade: 'KG',
              valorUnitario: 8.0,
              valorTotal: 4.4,
            },
          ],
        },
      ]

      mockNotaFiscalModel.find.mockReturnValue({
        populate: jest.fn().mockResolvedValue(notas),
      })

      const resultado = await service.calcularItensRecorrentesMercado(
        validUserId,
        '12345678000199',
        3,
      )
      expect(resultado).toHaveLength(1)
      expect(resultado[0].unidade).toBe('KG')
      expect(resultado[0].quantidade).toBe(0.5)
      expect(resultado[0].pesoEstimadoKg).toBe(0.5)
      expect(resultado[0].valorEstimado).toBe(4.0)
    })
  })
})
