import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common'
import { NotaFiscalService } from './nota-fiscal.service'
import { ProcessarNotaDto } from './dto/processar-nota.dto'
import { ProcessarChaveAcessoDto } from './dto/processar-chave-acesso.dto'
import { AtualizarEstabelecimentoDto } from './dto/atualizar-estabelecimento.dto'
import { AtualizarNotaFiscalDto } from './dto/atualizar-nota-fiscal.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { UserId } from '../auth/decorators/user.decorator'

@Controller('notas-fiscais')
export class NotaFiscalController {
  constructor(private readonly notaFiscalService: NotaFiscalService) {}

  @Post('processar')
  @UseGuards(JwtAuthGuard)
  async processar(@Body() dto: ProcessarNotaDto, @UserId() userId: string) {
    return this.notaFiscalService.enfileirarProcessamento(dto.url, userId)
  }

  @Post('processar-chave')
  @UseGuards(JwtAuthGuard)
  async processarChave(
    @Body() dto: ProcessarChaveAcessoDto,
    @UserId() userId: string,
  ) {
    return this.notaFiscalService.processarChaveAcesso(dto.chaveAcesso, userId)
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async listar(@UserId() userId: string) {
    return this.notaFiscalService.listarNotasPorUsuario(userId)
  }

  @UseGuards(JwtAuthGuard)
  @Get('estabelecimentos')
  async listarEstabelecimentos(@UserId() userId: string) {
    return this.notaFiscalService.listarEstabelecimentos(userId)
  }

  @UseGuards(JwtAuthGuard)
  @Get('produtos')
  async listarNomesProdutos(@UserId() userId: string, @Query('q') q?: string) {
    return this.notaFiscalService.listarNomesProdutos(q, userId)
  }

  @UseGuards(JwtAuthGuard)
  @Get('produtos/sugestoes')
  async sugerirProdutos(@UserId() userId: string, @Query('nome') nome: string) {
    return this.notaFiscalService.sugerirProdutosParecidos(nome ?? '', userId)
  }

  @UseGuards(JwtAuthGuard)
  @Get('produtos/comparar-duracao')
  async compararDuracao(
    @UserId() userId: string,
    @Query('produto1') produto1: string,
    @Query('produto2') produto2: string,
  ) {
    return this.notaFiscalService.compararDuracaoProdutos(
      produto1 ?? '',
      produto2 ?? '',
      userId,
    )
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async buscarPorId(@Param('id') id: string, @UserId() userId: string) {
    return this.notaFiscalService.buscarPorId(id, userId)
  }

  @UseGuards(JwtAuthGuard)
  @Patch('estabelecimentos/:cnpj')
  async atualizarEstabelecimento(
    @UserId() userId: string,
    @Param('cnpj') cnpj: string,
    @Body() dto: AtualizarEstabelecimentoDto,
  ) {
    return this.notaFiscalService.atualizarNomeEstabelecimento(
      cnpj,
      dto.nomeDepara,
      userId,
    )
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async atualizar(
    @Param('id') id: string,
    @Body() dto: AtualizarNotaFiscalDto,
    @UserId() userId: string,
  ) {
    return this.notaFiscalService.atualizarNotaFiscal(id, dto, userId)
  }
}

