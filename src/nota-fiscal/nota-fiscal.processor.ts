import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from '@nestjs/common'
import { NotaFiscalService } from './nota-fiscal.service'

export interface ProcessarNotaJobData {
  url: string
  userId: string
}

@Processor('nota-fiscal-queue', {
  limiter: {
    max: 1,
    duration: 3000, // Anti-rate limit da SEFAZ: no máximo 1 consulta a cada 3 segundos
  },
})
export class NotaFiscalProcessor extends WorkerHost {
  private readonly logger = new Logger(NotaFiscalProcessor.name)

  constructor(private readonly notaFiscalService: NotaFiscalService) {
    super()
  }

  async process(job: Job<ProcessarNotaJobData>): Promise<any> {
    const { url, userId } = job.data
    this.logger.log(
      `[BullMQ] Processando job #${job.id} para usuário ${userId}...`,
    )

    await job.log(`Iniciando consulta da nota fiscal: ${url}`)

    try {
      const nota = await this.notaFiscalService.processarUrl(url, userId)
      await job.log(`Nota fiscal #${nota._id} processada e salva com sucesso.`)
      this.logger.log(`[BullMQ] Job #${job.id} concluído com sucesso.`)
      return nota
    } catch (error) {
      const mensagemErro =
        error instanceof Error ? error.message : 'Erro desconhecido'
      await job.log(`Falha ao processar job #${job.id}: ${mensagemErro}`)
      this.logger.error(
        `[BullMQ] Falha no processamento do job #${job.id}: ${mensagemErro}`,
      )
      throw error
    }
  }
}
