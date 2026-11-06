import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'

export class RegisterDto {
  @IsOptional()
  @IsEmail({}, { message: 'Formato de e-mail inválido' })
  @MaxLength(128)
  email?: string

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(128)
  username?: string

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(128)
  password: string
}
