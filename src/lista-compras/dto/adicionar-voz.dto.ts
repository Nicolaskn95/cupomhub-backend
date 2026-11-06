import { IsOptional, IsString } from 'class-validator'

export class AdicionarVozDto {
  @IsOptional()
  @IsString()
  textoFalado?: string

  @IsOptional()
  @IsString()
  audioBase64?: string

  @IsOptional()
  @IsString()
  mimeType?: string
}
