import { Test, TestingModule } from '@nestjs/testing'
import { NotaFiscalController } from './nota-fiscal.controller'
import { NotaFiscalService } from './nota-fiscal.service'

describe('NotaFiscalController', () => {
  let controller: NotaFiscalController
  let service: Record<string, jest.Mock>

  beforeEach(async () => {
    service = {
      enfileirarProcessamento: jest.fn(),
      processarUrl: jest.fn(),
      processarChaveAcesso: jest.fn(),
      listarNotasPorUsuario: jest.fn(),
      listarEstabelecimentos: jest.fn(),
      listarNomesProdutos: jest.fn(),
      sugerirProdutosParecidos: jest.fn(),
      compararDuracaoProdutos: jest.fn(),
      buscarPorId: jest.fn(),
      atualizarNomeEstabelecimento: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotaFiscalController],
      providers: [
        {
          provide: NotaFiscalService,
          useValue: service,
        },
      ],
    }).compile()

    controller = module.get<NotaFiscalController>(NotaFiscalController)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  it('should call enfileirarProcessamento', async () => {
    const dto = { url: 'https://example.com' }
    service.enfileirarProcessamento.mockResolvedValue({ id: 'nf-1' })
    const result = await controller.processar(dto, 'user-1')
    expect(service.enfileirarProcessamento).toHaveBeenCalledWith(dto.url, 'user-1')
    expect(result).toEqual({ id: 'nf-1' })
  })

  it('should call processarChaveAcesso', async () => {
    const dto = { chaveAcesso: '12345678901234567890123456789012345678901234' }
    service.processarChaveAcesso.mockResolvedValue({ id: 'nf-1' })
    const result = await controller.processarChave(dto, 'user-1')
    expect(service.processarChaveAcesso).toHaveBeenCalledWith(dto.chaveAcesso, 'user-1')
    expect(result).toEqual({ id: 'nf-1' })
  })

  it('should call listarNotasPorUsuario', async () => {
    service.listarNotasPorUsuario.mockResolvedValue([])
    const result = await controller.listar('user-1')
    expect(service.listarNotasPorUsuario).toHaveBeenCalledWith('user-1')
    expect(result).toEqual([])
  })

  it('should call listarEstabelecimentos', async () => {
    service.listarEstabelecimentos.mockResolvedValue([])
    const result = await controller.listarEstabelecimentos('user-1')
    expect(service.listarEstabelecimentos).toHaveBeenCalledWith('user-1')
    expect(result).toEqual([])
  })

  it('should call listarNomesProdutos', async () => {
    service.listarNomesProdutos.mockResolvedValue(['ARROZ'])
    const result = await controller.listarNomesProdutos('user-1', 'arr')
    expect(service.listarNomesProdutos).toHaveBeenCalledWith('arr', 'user-1')
    expect(result).toEqual(['ARROZ'])
  })

  it('should call sugerirProdutosParecidos', async () => {
    service.sugerirProdutosParecidos.mockResolvedValue([])
    const result = await controller.sugerirProdutos('user-1', 'arroz')
    expect(service.sugerirProdutosParecidos).toHaveBeenCalledWith('arroz', 'user-1')
    expect(result).toEqual([])
  })

  it('should call compararDuracaoProdutos', async () => {
    service.compararDuracaoProdutos.mockResolvedValue({ produto1: 'arroz' })
    const result = await controller.compararDuracao('user-1', 'arroz', 'feijao')
    expect(service.compararDuracaoProdutos).toHaveBeenCalledWith('arroz', 'feijao', 'user-1')
    expect(result).toEqual({ produto1: 'arroz' })
  })

  it('should call buscarPorId', async () => {
    service.buscarPorId.mockResolvedValue({ id: 'nf-1' })
    const result = await controller.buscarPorId('nf-1', 'user-1')
    expect(service.buscarPorId).toHaveBeenCalledWith('nf-1', 'user-1')
    expect(result).toEqual({ id: 'nf-1' })
  })

  it('should call atualizarNomeEstabelecimento', async () => {
    const dto = { nomeDepara: 'Mercado Bom' }
    service.atualizarNomeEstabelecimento.mockResolvedValue({ cnpj: '123', nomeDepara: 'Mercado Bom' })
    const result = await controller.atualizarEstabelecimento('user-1', '123', dto)
    expect(service.atualizarNomeEstabelecimento).toHaveBeenCalledWith('123', dto.nomeDepara, 'user-1')
    expect(result).toEqual({ cnpj: '123', nomeDepara: 'Mercado Bom' })
  })

  it('should call atualizarNotaFiscal', async () => {
    service.atualizarNotaFiscal = jest.fn().mockResolvedValue({ id: 'nf-1', tipoPagamento: 'PIX' })
    const dto = { tipoPagamento: 'PIX', valorTributos: 15.5 }
    const result = await controller.atualizar('nf-1', dto, 'user-1')
    expect(service.atualizarNotaFiscal).toHaveBeenCalledWith('nf-1', dto, 'user-1')
    expect(result).toEqual({ id: 'nf-1', tipoPagamento: 'PIX' })
  })
})
